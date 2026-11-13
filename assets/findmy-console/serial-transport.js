/* Web Serial connection lifetime. Each reader/writer belongs to exactly one session. */
class TagSerialTransport {
  constructor({serial,feed,log,disconnected,changed=()=>{}}){Object.assign(this,{serial,feed,log,disconnected,changed});this.session=null;this.opening=false;this.lost=false;}
  get connected(){return !!this.session&&!this.session.stopping;}
  async connect(){
    if(this.opening||this.session)throw Error('串口正在连接或清理，请稍后重试。');
    if(!this.serial)throw Error('请使用支持 Web Serial 的桌面 Chrome 或 Edge');
    this.opening=true;this.changed();let port,writer,reader,opened=false;
    try{
      port=await this.serial.requestPort();
      await port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none'});opened=true;
      writer=port.writable.getWriter();reader=port.readable.getReader();
      const s={port,writer,reader,stopping:false};this.session=s;this.lost=false;this.changed();
      const info=port.getInfo?.()||{},hex=n=>n===undefined?'--':n.toString(16).padStart(4,'0').toUpperCase();
      this.log(`串口已连接（115200 8N1，USB VID:${hex(info.usbVendorId)} PID:${hex(info.usbProductId)}），请点击开始自动烧录。`);
      s.task=this.read(s);
    }catch(e){
      try{reader?.releaseLock();}catch{}
      try{writer?.releaseLock();}catch{}
      if(opened)try{await port.close();}catch{}
      throw e;
    }finally{this.opening=false;this.changed();}
  }
  async read(s){
    const decoder=new TextDecoder();
    try{
      while(!s.stopping){const {value,done}=await s.reader.read();if(done)break;this.feed(decoder.decode(value,{stream:true}));}
    }catch(e){
      if(!s.stopping){this.lost=true;this.log(`串口读取中断：${e.name||'Error'} · ${e.message}。系统或浏览器已失去串口；请检查 USB 连接、供电和串口驱动。`);}
    }finally{
      if(!s.stopping)this.lost=true;
      s.stopping=true;this.changed();
      try{s.reader.releaseLock();}catch{}
      try{s.writer.releaseLock();}catch{}
      this.disconnected();
      try{await s.port.close();}catch{}
      if(this.session===s)this.session=null;this.changed();
      this.log('旧串口连接已清理，可以直接点击“连接串口”重新选择端口；不会自动续写。');
    }
  }
  async write(data){const s=this.session;if(!s||s.stopping)throw Error('串口未连接');await s.writer.write(new TextEncoder().encode(data));}
  async disconnect(){const s=this.session;if(!s)return;s.stopping=true;this.changed();try{await s.reader.cancel();}catch{}await s.task;}
}
