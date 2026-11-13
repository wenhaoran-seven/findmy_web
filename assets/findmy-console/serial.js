const TagSerialCore = (() => {
  function hello(line) {
    // Boot output may be concatenated with the banner without a newline.
    // Ignore the prefix, then validate the complete TAG payload as before.
    const start = line.search(/TAG:/i);
    if(start < 0)return null;
    const banner = line.slice(start).trim();
    const m = /^TAG:([^,]+),ver:(V\d+\.\d+\.\d+),cid:([0-9a-f]{8}),key_max:(\d+),status:waitDistributeKey$/i.exec(banner);
    return m && {model:m[1], version:m[2], cid:m[3].toUpperCase(), max:Number(m[4])};
  }
  function validate(item, config) {
    if (!config.command || !/^[1-9]\d{11}$/.test(item.sn) || !/^[0-9a-f]{56}$/i.test(item.pubkey||'') || !/^[0-9a-f]{40}$/i.test(item.eid_hex||'')) throw Error('设备缺少有效 SN、公钥或 EID，请先保存烧录配置。');
    const expected = `AT+BURN=sn:${item.sn},pubkey:${item.pubkey.toUpperCase()},EID:${item.eid_hex.toUpperCase()},cid:${item.cid.toUpperCase()},mask:${config.mask},advT:14,channel:7,txpower:06,hint:00,state:00`;
    if (!/^[0-9A-F]{2}$/.test(config.mask) || config.cid !== item.cid.toUpperCase() || config.pubkey !== item.pubkey.toUpperCase() || config.command !== expected || expected.length+2>256) throw Error('烧录配置校验失败，请重新载入队列。');
    return expected+'\r\n';
  }
  class Queue {
    constructor({prepare, write, changed, log, completed, timeout=20000}) {
      Object.assign(this,{prepare,write,changed,log,completed,timeout});
      this.items=[];this.index=0;this.phase='idle';this.buffer='';this.pending=null;this.generation=0;this.timer=null;
    }
    get active(){return ['waiting','preparing','sending','awaiting','confirming'].includes(this.phase);}
    load(items){if(this.active||this.pending)throw Error('请先暂停，并处理当前设备的烧录结果。');this.items=items.map(d=>({...d}));this.index=0;this.phase='idle';this.buffer='';this.changed();}
    start(){if(this.pending)throw Error('上一条指令结果未确认，请先断开串口并核对实物，再重连重试当前设备。');if(!this.items[this.index])throw Error('请先从设备列表载入烧录队列。');this.buffer='';this.phase='waiting';this.changed();this.log('等待当前实物上报 A-01 或 T-08 待烧录提示。');}
    pause(reason='已暂停；继续时仍处理当前未完成设备。') {
      clearTimeout(this.timer);this.generation++;
      if(this.pending&&!this.pending.sent)this.pending=null;
      this.phase='paused';this.log(reason);this.changed();
    }
    disconnected(){this.pause(this.pending?.sent?'串口已断开，当前写入结果仍待确认；保留当前 SN，未切换下一台。':'串口已断开，队列已暂停。');this.buffer='';this.changed();}
    resetPending(sn){if(this.active)throw Error('请先暂停队列');if(this.pending?.item.sn===sn)this.pending=null;}
    feed(text){
      this.buffer+=text;
      if(this.buffer.length>8192){this.buffer='';this.pause('串口数据过长或缺少换行，已暂停。');return;}
      let match;
      while((match=/[\r\n]/.exec(this.buffer))){
        const line=this.buffer.slice(0,match.index).trim();this.buffer=this.buffer.slice(match.index+1);
        const index=this.index;if(line)this.line(line);
        // A success consumes the current packet. Buffered boot banners must not burn the next identity.
        if(this.index!==index||this.phase==='confirming'){this.buffer='';break;}
      }
    }
    line(line){
      this.log('RX '+line);
      const ack=/^OK\+SETKEY=sn:([1-9]\d{11})$/.exec(line);
      if(ack){
        const p=this.pending;
        if(!p?.sent){this.log('忽略：当前没有待确认的烧录指令。');return;}
        if(ack[1]!==p.item.sn){this.pause('成功回复 SN 与当前设备不符，未切换下一台，请核对实物。');return;}
        if(this.phase==='confirming')return;
        clearTimeout(this.timer);const wasActive=this.active;this.phase='confirming';this.buffer='';this.changed();
        const generation=++this.generation;
        Promise.resolve().then(()=>this.completed(p.item)).then(()=>{
          this.pending=null;this.index++;this.buffer='';
          this.phase=this.index===this.items.length?'done':wasActive&&generation===this.generation?'waiting':'paused';
          this.log('成功：'+p.item.name+' · SN '+p.item.sn+'；已保存烧录记录，请更换实物。');this.changed();
        }).catch(e=>this.pause('实物已回复成功，但保存记录失败：'+e.message+'；未切换下一台，请核对记录。'));return;
      }
      if(/^AT\+ERROR=/.test(line)){if(this.active||this.pending)this.pause('设备返回 '+line+'；未切换下一台。');return;}
      const tag=hello(line);
      if(!tag){if(this.phase==='waiting'&&/TAG:/i.test(line))this.pause('待烧录提示格式不符，已暂停。');return;}
      if(this.phase!=='waiting'){this.log('未发送：当前未开始、已暂停或正在等待上一条结果。');return;}
      const item=this.items[this.index];
      const isT08=tag.model.toUpperCase()==='T-08'&&/^V2\.\d+\.\d+$/i.test(tag.version);
      const isA01=tag.model==='A-01'&&tag.version==='V1.2.10';
      if(tag.max!==1||(!isT08&&!isA01)){this.pause('仅支持 A-01/V1.2.10 或 T-08/V2.x.x，且 key_max:1。');return;}
      if(!isT08&&tag.cid!==item.cid.toUpperCase()){this.pause('实物 CID '+tag.cid+' 与当前设备 CID '+item.cid+' 不符，未发送。');return;}
      const generation=++this.generation;const p={item,sent:false};this.pending=p;this.phase='preparing';this.changed();
      this.timer=setTimeout(()=>{if(this.pending===p)this.pause(p.sent?'等待成功回复超时，结果未确认；请核对实物，未切换下一台。':'读取配置超时，未发送烧录指令。');},this.timeout);
      (async()=>{
        try{
          const config=await this.prepare(item);
          if(this.generation!==generation||this.pending!==p)return;
          let command=validate(item,config);
          // T-08 CID is derived from each physical chip. Keep the account's
          // saved CID unchanged; echo this chip's CID only into this burn.
          if(isT08){command=command.replace(',cid:'+item.cid.toUpperCase()+',',',cid:'+tag.cid+',');this.log('T-08 本次使用实物 CID '+tag.cid+'；云端配置不变。');}
          this.phase='sending';p.sent=true;this.changed();this.log('TX '+command.trimEnd());
          await this.write(command);
          if(this.generation===generation&&this.pending===p){this.phase='awaiting';this.changed();}
        }catch(e){if(this.generation===generation&&this.pending===p)this.pause('烧录暂停：'+e.message);}
      })();
    }
  }
  return {hello,validate,Queue};
})();
