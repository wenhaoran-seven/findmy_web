/* Account-qualified IDs prevent identical native IDs from crossing accounts. */
function fleetSelected(){return document.getElementById('accountFilter').value;}
function fleetMatches(d){return fleetSelected()==='all'||d.account_id===fleetSelected();}
function fleetIdentity(id){const m=/^(google[123])~([A-Za-z0-9_-]+)$/.exec(id||'');if(!m)throw Error('设备所属账号不明确，请刷新后重试。');return {account:m[1],id:m[2]};}
function fleetRoute(path){
 if(path==='status')return {url:'/api/fleet/status'};
 const [pathname,query='']=path.split('?'),params=new URLSearchParams(query);let account,tail=pathname;
 if(pathname.startsWith('devices/')){
  const parts=pathname.split('/'),ref=fleetIdentity(parts[1]);account=ref.account;parts[1]=ref.id;tail=parts.join('/');
 }else if(params.has('device_id')){
  const ref=fleetIdentity(params.get('device_id'));account=ref.account;params.set('device_id',ref.id);
 }else{account=fleetSelected();if(account==='all')throw Error('请先在上方选择一个 Google 账号，再执行此操作。');}
 if(!/^google[123]$/.test(account))throw Error('无效的账号。');
 return {url:'/api/accounts/'+account+'/'+tail+(params.size?'?'+params.toString():''),account};
}
function fleetPayload(value,account){
 if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.id==='string')return {...value,id:account+'~'+value.id,native_id:value.id,account_id:account,account_label:'Google 账号'+account.slice(-1)};
 return value;
}
function updateFleetUI(){
 const select=document.getElementById('accountFilter'),single=select.value!=='all';select.disabled=busy;
 for(const id of ['generate','sync','renew','network','authFile'])document.getElementById(id).disabled=busy||!single||!state?.accounts?.some(a=>a.id===select.value&&a.available);
 if(!state?.accounts)return;
 const accounts=state.accounts.filter(a=>!single||a.id===select.value),devices=state.devices.filter(fleetMatches);
 const unavailable=accounts.filter(a=>!a.available);document.getElementById('accountWarning').textContent=unavailable.map(a=>a.label+'：'+a.error).join(' ');
 document.getElementById('accountHint').textContent=single?'新增设备、授权、同步和续报操作仅作用于当前选定账号。':'当前显示三个账号；添加设备、导入授权、同步和续报前，请先选定一个账号。';
 document.getElementById('totalDevices').textContent=devices.length;document.getElementById('totalEnabled').textContent=devices.filter(d=>d.enabled).length;document.getElementById('totalLocations').textContent=devices.reduce((n,d)=>n+d.history_count,0);
 const count=accounts.reduce((n,a)=>n+(a.running_count||0),0);document.getElementById('currentJob').textContent=count?'正在查询 '+count+' 台':'空闲';
 document.getElementById('authState').textContent=accounts.map(a=>a.label+'：'+(!a.available?'不可用':a.authorized?'已授权':'待授权')).join(' · ');
 document.getElementById('authState').classList.toggle('warn',accounts.some(a=>!a.authorized));
 document.getElementById('accountState').textContent=document.getElementById('authState').textContent;
 document.getElementById('syncState').textContent=accounts.map(a=>a.label+' 最近同步：'+date(a.last_sync)).join('；');
 document.getElementById('renewState').textContent=accounts.map(a=>a.label+' 最近续报：'+date(a.renewal?.last_success)+(a.renewal?.error?' · '+a.renewal.error:'')).join('；');
 document.getElementById('notice').textContent='Google 三个账号统一管理；查询任务仍由各账号独立运行，关闭网页不会停止任务。';
 for(const option of select.options){if(option.value==='all')continue;const account=state.accounts.find(a=>a.id===option.value);option.textContent=account?account.label+(account.available?'（'+account.device_count+' 台）':'（暂不可用）'):option.textContent;}
}
function initFleetSelector(){
 const select=document.getElementById('accountFilter');select.value='all';
 select.onchange=()=>{selectedTasks.clear();exportIds.clear();devicePage=0;deviceSignature='';selected=state?.devices.find(fleetMatches)?.id||'';renderDeviceTable(true);renderJobs();renderExportChoices();updateFleetUI();};
 updateFleetUI();
}
