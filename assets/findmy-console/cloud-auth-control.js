window.setupCloudAuth=function(a){
 const el=id=>document.getElementById(id), node=el('cloud-state'), base='accounts/'+a.id+'/cloud-authorization';
 const names={queued:'等待启动',starting:'正在启动云端浏览器',google_login:'请在授权窗口登录 Google',encryption:'请完成加密数据验证（可能需要手机 PIN）',importing:'正在保存授权',waiting_import:'验证已完成，等待采集服务保存',complete:'授权成功，浏览器已关闭',failed:'授权失败',cancel_requested:'正在关闭浏览器',cancelled:'已取消',expired:'授权超时',interrupted:'授权服务已重启'};
 let current=null;
 function render(r){current=r; if(!r)return;node.textContent=(names[r.state]||r.state)+(r.error?'：'+r.error:'');const active=['queued','starting','google_login','encryption','importing','waiting_import','cancel_requested'].includes(r.state);el('cloud-start').disabled=active;el('cloud-cancel').hidden=!active;el('cloud-open').hidden=!active;el('cloud-open').href='/auth-browser/'+r.id;}
 el('cloud-start').onclick=async()=>{const email=el('cloud-email').value.trim();if(!email){node.textContent='请输入 Google 邮箱';return;}const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;el('cloud-start').disabled=true;try{const r=await api(base,{email});render(r);if(popup)popup.location.replace(r.url);}catch(e){if(popup)popup.close();node.textContent=e.message;el('cloud-start').disabled=false;}};
 el('cloud-cancel').onclick=async()=>{if(current)try{render(await api(base+'/'+current.id+'/cancel',{}));}catch(e){node.textContent=e.message;}};
 async function poll(){if(!node.isConnected)return;try{render(await api(base));}catch(e){node.textContent=e.message;}if(node.isConnected && (!node.closest("dialog") || node.closest("dialog").open))setTimeout(poll,2000);}poll();
};
