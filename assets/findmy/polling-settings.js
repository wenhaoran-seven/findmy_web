/* Both platform pages edit the same server-side interval. */
(()=>{
 const container=document.querySelector('.overview,.device-overview');if(!container)return;
 const panel=document.createElement('div');panel.innerHTML='<form id="global-polling-form"><label for="global-polling-minutes">全局查询间隔（分钟）</label><div style="display:flex;gap:8px;margin-top:8px"><input id="global-polling-minutes" type="number" min="1" max="1440" step="1" required style="width:85px"><button type="submit">保存</button></div><small>Apple 与 Google 三个账号共用</small><small id="global-polling-message" role="status"></small></form>';container.append(panel);
 container.style.gridTemplateColumns='repeat(auto-fit,minmax(150px,1fr))';
 const form=panel.querySelector('form'),input=panel.querySelector('input'),button=panel.querySelector('button'),message=panel.querySelector('[role=status]');let dirty=false,saving=false;
 input.addEventListener('input',()=>{dirty=true;});
 async function request(body){const response=await fetch('/api/polling-settings',{method:body?'POST':'GET',headers:{'X-Local-Token':document.querySelector('meta[name="local-token"]').content,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(typeof result.detail==='string'?result.detail:'设置读取或保存失败');return result;}
 async function refresh(){if(saving||dirty||document.activeElement===input)return;try{const value=await request();input.value=value.interval_seconds/60;}catch(e){message.textContent=e.message;}}
 form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;saving=true;button.disabled=true;try{const value=await request({interval_minutes:Number(input.value)});input.value=value.interval_seconds/60;dirty=false;message.textContent='已保存，两个平台将在 5 秒内应用；已暂停的设备保持暂停。';}catch(e){message.textContent=e.message;}finally{saving=false;button.disabled=false;}};
 refresh();setInterval(refresh,5000);
})();
