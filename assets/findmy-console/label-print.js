/* F6 button advertisement: 10 FF SN(BCD6) F1 MAC(LE6) mV(BE2). */
(function(root){
function parse(line){
 const m=/OK\+SCAN:([0-9A-F]{12}),(-?\d+),(\d+),(\d+),([0-9A-F]+)\s*$/i.exec(line);
 if(!m||m[1].toUpperCase()!=='F6F6F6F6F6F6'||m[5].length%2||Number(m[4])*2!==m[5].length)return null;
 const a=m[5].match(/../g).map(x=>parseInt(x,16));
 for(let i=0;i<a.length;){const n=a[i];if(!n||i+n>=a.length)return null;
  if(n===16&&a[i+1]===255&&a[i+8]===241){const hex=xs=>xs.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase(),sn=hex(a.slice(i+2,i+8));if(!/^\d{12}$/.test(sn))return null;return {sn,mac:hex(a.slice(i+9,i+15).reverse()),rssi:Number(m[2]),battery_mv:(a[i+15]<<8)|a[i+16]};}i+=n+1;
 }return null;
}
function labelContent(r){
 if(!/^\d{12}$/.test(r.sn)||! /^[0-9A-F]{12}$/.test(r.mac))throw Error('SN / MAC 格式无效');
 const qr=(name,value,mode,version=1)=>{
  const code=root.qrcode(version,'H');code.addData(value,mode);code.make();const n=code.getModuleCount(),size=n+8;let path='';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))path+=`M${x+4},${y+4}h1v1h-1z`;
  return `<section class="label-cell" aria-label="${name}二维码"><svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg></section>`;
 };
 const text=(name,value)=>{const line=t=>`<div class="digits">${[...t].map(c=>`<span>${c}</span>`).join('')}</div>`;return `<section class="label-cell" aria-label="${name}字符"><div>${line(value.slice(0,6))}${line(value.slice(6))}</div></section>`;};
 return qr('SN',r.sn,'Numeric')+text('SN',r.sn)+qr('MAC',r.mac,'Alphanumeric',2)+text('MAC',r.mac)+`<section class="label-cell" aria-label="设备名称" style="overflow-wrap:anywhere;white-space:normal;font-family:SimHei,sans-serif;font-weight:bold">${String(r.device_name||'设备名称').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</section>`;
}
root.F6LabelContent=labelContent;
root.F6PrintParser={parse};
if(typeof document==='undefined')return;
const $=id=>document.getElementById('lp-'+id),key='findmy-f6-printed-v1';
const settingFields={width:'width',height:'height',gap:'gap',row_gap:'row-gap',columns:'columns',margin_left:'margin-left',margin_right:'margin-right',qr_size:'qr-size',qr_ecc:'qr-ecc',offset_x:'offset-x',offset_y:'offset-y',text_size:'text-size',name_size:'name-size',name_char_limit:'name-char-limit',font_family:'font-family',font_weight:'font-weight'};
function readSettings(){const result={};for(const [key,id] of Object.entries(settingFields)){const el=$(id);if(!el.checkValidity())throw Error('打印参数无效，请检查 '+el.parentElement.textContent);result[key]=el.type==='checkbox'?el.checked:el.tagName==='SELECT'?el.value:Number(el.value);}if(result.qr_size>Math.min(result.width,result.height))throw Error('二维码尺寸不能超过单张标签宽高');return result;}
try{const saved=JSON.parse(localStorage.getItem('findmy-print-settings-v1')||'{}');for(const [key,id] of Object.entries(settingFields)){if(saved[key]===undefined)continue;const el=$(id);if(el.type==='checkbox')el.checked=!!saved[key];else el.value=saved[key];}}catch{}
for(const id of Object.values(settingFields))$(id).addEventListener('change',()=>{try{localStorage.setItem('findmy-print-settings-v1',JSON.stringify(readSettings()));$('settings-status').textContent='参数已保存，下次新打印或重新打印时生效；已提交任务保持原参数。';}catch(e){$('settings-status').textContent=e.message;}});
let records=new Map(),buffer='',listening=false,busy=false,current=null,autoPaused=false,storageError='';
try{for(const r of JSON.parse(localStorage.getItem(key)||'[]'))if(/^\d{12}$/.test(r.sn)&&/^[0-9A-F]{12}$/.test(r.mac))records.set(r.sn+'/'+r.mac,{...r,printed:!!r.printed||r.jobStatus==='spool_complete'});}catch{storageError='无法读取已打印记录；请检查浏览器存储。';}
function save(){try{localStorage.setItem(key,JSON.stringify([...records.values()].filter(r=>r.printed||r.job)));storageError='';}catch{storageError='已打印标识保存失败，刷新后可能丢失。';log(storageError);}}
function log(s){$('log').textContent=(new Date().toLocaleTimeString()+' '+s+'\n'+$('log').textContent).slice(0,8000);}
function render(){
 const connected=transport.connected;
 $('connect').disabled=busy||!!transport.session||transport.opening;
 $('connect').textContent=transport.opening?'正在连接…':connected?'串口已连接':'选择串口并监听';
 $('stop').disabled=busy||!connected||!listening;$('start').disabled=busy||!connected||listening;$('disconnect').disabled=busy||!connected;
 $('clear').disabled=!!current||![...records.values()].some(r=>r.printed||r.job);
 $('status').textContent=`${connected?(listening?'正在监听全 F6 广播':'串口已连接，监听已停止'):'串口未连接'} · 已识别 ${records.size} 台 · 已打印 ${[...records.values()].filter(r=>r.printed).length} 台${storageError?' · '+storageError:''}`;
 $('rows').replaceChildren();
 for(const [k,r] of [...records].reverse().sort((a,b)=>(b[1].lastSeenAt||0)-(a[1].lastSeenAt||0))){const tr=document.createElement('tr');for(const text of [r.device_name||'--',r.sn,r.mac,Number.isFinite(r.rssi)?r.rssi+' dBm':'--',Number.isFinite(r.battery_mv)?(r.battery_mv/1000).toFixed(3)+' V':'--',r.time||'--',r.printed?'打印完成':r.printStatus||'待打印']){const td=document.createElement('td');td.textContent=text;tr.append(td);}const td=document.createElement('td'),b=document.createElement('button');b.textContent='重新打印';b.disabled=!!current;b.onclick=()=>{if(current)return;r.printed=false;r.job=null;r.jobStatus=null;r.printStatus='待打印';save();print(r);};td.append(b);tr.append(td);$('rows').append(tr);}

}
let namesLoading=false;
async function refreshDeviceNames(){
 if(namesLoading||!records.size)return;
 namesLoading=true;
 try{
  const response=await fetch('/api/console',{headers:{'X-Local-Token':document.querySelector('meta[name=local-token]').content},signal:AbortSignal.timeout(15000)});
  if(!response.ok)return;
  const data=await response.json(),names=new Map((data.devices||[]).map(d=>[d.sn,d.name]));
  for(const r of records.values()){const name=names.get(r.sn);if(name)r.device_name=name;}
  render();
 }catch{}finally{namesLoading=false;}
}
function feed(chunk){buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);if(!listening)continue;const p=parse(line);if(!p)continue;const k=p.sn+'/'+p.mac,old=records.get(k);if(old){old.time=new Date().toLocaleString();old.lastSeenAt=Date.now();old.rssi=p.rssi;old.battery_mv=p.battery_mv;render();continue;}const r={...p,time:new Date().toLocaleString(),lastSeenAt:Date.now(),printed:false};records.set(k,r);log('识别 SN '+r.sn+' / MAC '+r.mac);render();refreshDeviceNames();pump();}if(buffer.length>8192)buffer='';}
const transport=new TagSerialTransport({serial:navigator.serial,feed,changed:()=>render(),disconnected:()=>{listening=false;buffer='';render();},log:s=>log(s.replace('，请点击开始自动烧录。','。').replace('不会自动续写','需要手动继续监听'))});
async function action(fn){busy=true;render();try{await fn();}catch(e){log(e.message);}finally{busy=false;render();}}
async function start(){buffer='';listening=true;try{await transport.write('AT+SCAN1\r\n');log('TX AT+SCAN1');}catch(e){listening=false;throw e;}}
async function stop(){await transport.write('AT+SCAN0\r\n');listening=false;buffer='';log('TX AT+SCAN0');}
$('connect').onclick=()=>action(async()=>{if(typeof serialTransport!=='undefined'&&(serialTransport.session||serialTransport.opening))throw Error('请先断开串口烧录页面的连接。');await transport.connect();await start();});
$('start').onclick=()=>action(start);$('stop').onclick=()=>action(stop);
$('disconnect').onclick=()=>action(async()=>{try{await stop();}finally{await transport.disconnect();}});
function pump(){if(!$('auto').checked||autoPaused||current)return;const r=[...records.values()].find(r=>!r.printed&&!r.job);if(r)print(r);}
const bridge='http://127.0.0.1:18765';
async function bridgeRequest(path,body){const response=await fetch(bridge+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail));return data;}
async function print(r){
 if(current)return;
 current=r;render();
 try{
  const health=await bridgeRequest('/health');if(!health.ok)throw Error(health.detail);if(health.layout_version!==4||health.name_counting!=='han2'||!health.font_options||!health.paper_options||health.overflow!=='omit')throw Error('本机打印服务需要升级，请重启本机打印服务一次；之后参数修改无需重启');
  if(!r.job){
   const settings=readSettings(),{width,height,gap,row_gap}=settings;
   if(![width,height,gap,row_gap].every(Number.isFinite)||width<10||width>20||height<10||height>100||gap<0||gap>5||row_gap<0||row_gap>10||width*settings.columns+gap*(settings.columns-1)+settings.margin_left+settings.margin_right>104)throw Error('参数无效：单张宽10–20mm、高10–100mm，列间距0–5mm，行间距0–10mm，总宽不超过104mm。');
   const response=await fetch('/api/console',{headers:{'X-Local-Token':document.querySelector('meta[name=local-token]').content},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('无法读取设备名称，请稍后重试');
   const snapshot=await response.json(),device=snapshot.devices?.find(d=>d.sn===r.sn);
   if(!device?.name?.trim())throw Error('未找到此 SN 的设备名称，已暂停打印，请先在设备列表添加或核对');
   r.device_name=device.name.trim();
   r.job={id:crypto.randomUUID(),sn:r.sn,mac:r.mac,device_name:r.device_name,...settings};r.printStatus='准备提交';save();if(storageError){r.job=null;throw Error('请先允许浏览器存储，避免重复打印');}
  }
  let result=await bridgeRequest('/jobs',r.job);log('本机打印任务 '+r.job.id+' · '+r.sn);
  const deadline=Date.now()+65000;
  while(['queued','printing','submitted'].includes(result.status)&&Date.now()<deadline){r.printStatus=result.detail;render();await new Promise(resolve=>setTimeout(resolve,700));result=await bridgeRequest('/jobs/'+r.job.id);}
  r.printed=result.status==='spool_complete';r.printStatus=r.printed?'打印完成':result.detail;r.jobStatus=result.status;save();log(r.sn+'：'+r.printStatus);
  if(['error','attention','uncertain','queued','printing','submitted'].includes(result.status)){autoPaused=true;log('自动打印已暂停，请核对打印机和实物；不会自动重发。');}
 }catch(e){autoPaused=true;r.printStatus=(r.job?'结果待核对，不自动重发：':'无法打印：')+e.message;save();log(r.printStatus+'。请确认本机打印服务运行，并允许浏览器访问本地网络。');}
 finally{current=null;render();pump();}
}
$('check').onclick=()=>action(async()=>{try{const h=await bridgeRequest('/health');$('bridge').textContent=h.ok?'本机服务已连接：'+h.printer+'':h.detail;}catch(e){$('bridge').textContent='连接失败。当前网页：'+location.origin+'；本机接口：'+bridge+'。请允许此网站访问本地网络，并在连接打印机的电脑上操作。';throw e;}});

$('auto').onchange=()=>{autoPaused=false;pump();};
$('clear').onclick=()=>{if(!confirm('清除全部已打印及已提交标识？之后会生成新任务并重新出纸。请先确认系统队列中没有等待中的任务。自动打印将暂停。'))return;for(const r of records.values()){r.printed=false;r.job=null;r.jobStatus=null;r.printStatus='待打印';}autoPaused=true;$('auto').checked=false;save();render();log('已清除已打印标识，可手动打印或重新开启自动打印。');};
window.addEventListener('beforeunload',e=>{if(transport.session){e.preventDefault();e.returnValue='请先停止监听并断开串口';}});
render();refreshDeviceNames();setInterval(refreshDeviceNames,15000);
})(typeof window==='undefined'?globalThis:window);
