'use strict';
(() => {
 const banner=document.createElement('div');banner.id='account-health-banner';banner.setAttribute('role','status');
 banner.style.cssText='padding:10px 16px;white-space:pre-line;background:#fff0d9;color:#652900;display:none';
 document.querySelector('main')?.before(banner);
 let latest=[],connected=false;
 const seenKey='findmy-auth-alert:'+location.origin;
 let seen={};try{seen=JSON.parse(localStorage.getItem(seenKey)||'{}');}catch{}
 function render(){
  for(const h of latest){
   const el=document.querySelector(`[data-account-health="${h.id}"]`);
   if(el)el.textContent=' · '+h.message+' ['+h.code+'] · 最近检查 '+(h.last_check?new Date(h.last_check*1000).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'--');
  }
  const alerts=latest.filter(h=>['REAUTH_REQUIRED','RETRYING','UNAVAILABLE','STALE'].includes(h.code));
  banner.textContent=(connected?'':'账号状态连接中断，正在自动重连。\n')+alerts.map(h=>h.label+'：'+h.message+' ['+h.code+']').join('\n');
  banner.style.display=banner.textContent?'block':'none';
 }
 function update(rows){
  latest=rows;connected=true;
  const fresh=[];
  for(const h of rows){
   if(h.code==='REAUTH_REQUIRED'){
    const incident=String(h.last_check||'unknown');
    if(seen[h.id]!==incident){fresh.push(h.label);seen[h.id]=incident;}
   }else if(h.code==='HEALTHY')delete seen[h.id];
  }
  try{localStorage.setItem(seenKey,JSON.stringify(seen));}catch{}
  render();
  if(fresh.length){
   const d=document.createElement('dialog');
   const p=document.createElement('p');p.textContent=fresh.join('、')+'：Google 要求重新验证，自动查询已暂停。请到账号管理完成授权。';
   const button=document.createElement('button');button.textContent='知道了';button.onclick=()=>{d.close();d.remove();};
   d.append(p,button);document.body.append(d);d.showModal();
  }
 }
 // Account cards may be rerendered by the normal database refresh.
 const cards=document.getElementById('accounts');
 if(cards)new MutationObserver(()=>{for(const h of latest){const el=document.querySelector(`[data-account-health="${h.id}"]`);if(el&&!el.textContent)render();}}).observe(cards,{childList:true});
 async function connect(){
  for(;;){
   try{
    const response=await fetch('/api/account-health/events',{headers:{'X-Local-Token':document.querySelector('meta[name=local-token]').content},cache:'no-store'});
    if(!response.ok)throw Error('status connection failed');
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    for(;;){
     const {value,done}=await reader.read();if(done)throw Error('stream closed');
     pending+=decoder.decode(value,{stream:true});let boundary;
     while((boundary=pending.indexOf('\n\n'))>=0){
      const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
      if(frame.startsWith('data: '))update(JSON.parse(frame.slice(6)));
     }
    }
   }catch{connected=false;render();await new Promise(r=>setTimeout(r,5000));}
  }
 }
 connect();
})();
