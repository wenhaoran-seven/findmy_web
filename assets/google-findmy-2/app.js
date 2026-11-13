const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="local-token"]').content;
const names = {draft:'尚未注册',unknown:'待同步确认',registered:'已注册',queued:'排队中',running:'运行中',success:'成功',failed:'失败',interrupted:'已中断',sync:'同步设备',register:'注册设备',locate:'查询位置',renew:'续报标识',delete:'删除并注销'};
const ownReportText = value => value === true ? 'true · 是' : value === false ? 'false · 否' : '— · 未提供';
const unknown11Text = value => value == null ? '—' : String(value);
const unknown11Hint = p => 'Google 返回的位置集合原始字段，含义待确认，不代表已确认电量；此值来自本条位置最近一次查询响应。获取时间：'+date(p.unknown_11_received_at);
const statuses = {0:'语义位置',1:'最近位置',2:'众包位置',3:'聚合位置'};
const date = t => t == null ? '—' : new Date(t * 1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const stored = (key, value) => {try {if(value === undefined) return localStorage.getItem(key);localStorage.setItem(key,value);} catch {} return '';};
let state = null, selected = stored('google-findhub-device') || '', busy = false, refreshPromise = null;
let currentView = 'devices', historyRows = [], historyRange = {start:null,end:null}, historyPage = 0, historyVersion = 0, loadedKey = '';
let selectedTasks = new Set(), exportIds = new Set(), editId = '', keyId = '', secretTimer;
let deviceSignature = '';
let devicePage = 0;
let deleteId = '', renameId = '', serialId = '';
const deviceNameOrder = new Intl.Collator('zh-CN', {numeric:true,sensitivity:'base'});
const historyCache = new Map();
function msg(text, error=false) {$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);if($('trackDialog').open){$('trackMessage').textContent=text;$('trackMessage').hidden=!text;$('trackMessage').classList.toggle('warning',error);}}
function cell(tr,value,cls='') {const td=document.createElement('td');td.textContent=value??'—';if(cls)td.className=cls;tr.append(td);return td;}
function emptyRow(target, cols, text) {const tr=document.createElement('tr'),td=cell(tr,text,'empty-cell');td.colSpan=cols;$(target).replaceChildren(tr);}
function badge(text, kind='') {const el=document.createElement('span');el.className='badge '+kind;el.textContent=text;return el;}
function clearSecret() {clearTimeout(secretTimer);$('secret').hidden=true;$('secret').textContent='';}
function showView(view) {
  currentView=['devices','add','serial-burn','jobs','settings'].includes(view)?view:'devices';
  document.querySelectorAll('[data-view]').forEach(el=>el.hidden=el.dataset.view!==currentView);
  document.querySelectorAll('.sidebar [data-view-target]').forEach(el=>{const active=el.dataset.viewTarget===currentView;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  if(location.hash!=='#'+currentView)history.replaceState(null,'','#'+currentView);
  if($('trackDialog').open)$('trackDialog').close();
  closeTimePicker();
  if($('exportDialog').open)$('exportDialog').close();
}
async function api(path,body) {
  const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Local-Token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const j=await r.json();if(!r.ok)throw Error(typeof j.detail==='string'?j.detail:'请求失败，请检查输入');return j;
}
async function run(button,fn,errorTarget) {
  if(busy)return;busy=true;if(button)button.disabled=true;
  if(errorTarget)$(errorTarget).textContent='';
  try {await fn();await refresh();} catch(e) {if(errorTarget)$(errorTarget).textContent=e.message;msg(e.message,true);} finally {busy=false;if(button)button.disabled=false;updateSelection();updateKeyStatus();renderExportChoices();}
}
function bind(id,fn,errorTarget) {$(id).addEventListener('click',e=>{e.preventDefault();run($(id),fn,errorTarget);});}
function device(id=selected) {const d=state?.devices.find(x=>x.id===id);if(!d)throw Error('请先添加并选择设备');return d;}
async function job(op,id) {await api('jobs/'+op+(id?'?device_id='+encodeURIComponent(id):''),{});msg('任务已加入队列；查询有新增位置时，会显示在“运行记录”中。');}
async function download(path,name) {const r=await fetch('/api/'+path,{headers:{'X-Local-Token':token}});if(!r.ok)throw Error('下载失败，请刷新页面后重试');saveBlob(await r.blob(),name);}
function saveBlob(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function taskState(d) {if(d.delete_state)return [d.delete_state==='pending'?'正在注销':'注销待重试',d.delete_state==='pending'?'running':'failed'];const j=state.jobs.find(x=>x.device_id===d.id&&['running','queued'].includes(x.state));if(j)return [names[j.state],'running'];if(d.error)return ['查询异常','failed'];if(d.registration!=='registered')return [names[d.registration]||d.registration,'warn'];return d.enabled?['定时启用','']:['已暂停','warn'];}
function intervalText(n) {return Number((n/60).toFixed(2))+' 分钟';}
function visibleDevices() {
  const q=$('deviceSearch').value.trim().toLowerCase(),field=$('deviceSort').value,direction=$('deviceSortDirection').value==='desc'?-1:1;
  return (state?.devices||[]).filter(d=>(d.name+' '+d.sn).toLowerCase().includes(q)).sort((a,b)=>{
    const av=a[field],bv=b[field];
    // Keep missing values last in either direction, then break ties consistently.
    if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
    const order=av==null?0:['name','sn'].includes(field)?deviceNameOrder.compare(String(av),String(bv)):Number(av)-Number(bv);
    return direction*order||deviceNameOrder.compare(a.name,b.name)||deviceNameOrder.compare(a.sn,b.sn)||a.id.localeCompare(b.id);
  });
}
function devicePageData() {
  const all=visibleDevices(),size=Number($('devicePageSize').value),pages=Math.max(1,Math.ceil(all.length/size));
  devicePage=Math.max(0,Math.min(devicePage,pages-1));
  return {all,size,pages,shown:all.slice(devicePage*size,(devicePage+1)*size)};
}
function rowButton(label,fn) {const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=fn;return b;}
function updateSelection() {const {shown}=devicePageData();$('selectionCount').textContent=`已选 ${selectedTasks.size} 台（跨页保留）`;$('batchOpen').disabled=busy||!selectedTasks.size;$('batchExport').disabled=busy||!selectedTasks.size;$('batchSerialBurn').disabled=busy||!selectedTasks.size;if(typeof serialBurn!=='undefined')serialBurn.render();$('clearDeviceSelection').disabled=!selectedTasks.size;$('selectAll').disabled=!shown.length;$('selectAll').checked=shown.length>0&&shown.every(d=>selectedTasks.has(d.id));$('selectAll').indeterminate=shown.some(d=>selectedTasks.has(d.id))&&!$('selectAll').checked;}
function renderDeviceTable(force=false) {
  const {all,size,pages,shown}=devicePageData(), signature=JSON.stringify([shown,all.length,state.devices.length,devicePage,size,state.jobs.filter(j=>['queued','running'].includes(j.state)),selected,[...selectedTasks]]);
  if(!force&&signature===deviceSignature){updateSelection();return;}deviceSignature=signature;
  $('deviceRows').replaceChildren();
  for(const d of shown) {
    const tr=document.createElement('tr');tr.classList.toggle('selected',d.id===selected);
    const selectCell=cell(tr,''),check=document.createElement('input');check.type='checkbox';check.checked=selectedTasks.has(d.id);check.setAttribute('aria-label','选择设备 '+d.name+' '+d.sn);check.onchange=()=>{check.checked?selectedTasks.add(d.id):selectedTasks.delete(d.id);updateSelection();};selectCell.append(check);
    const title=cell(tr,''),strong=document.createElement('strong'),sn=document.createElement('span');strong.className='row-name';strong.textContent=d.name;strong.title=d.name;sn.className='small';sn.textContent='SN: '+(d.sn||'--');const nameLine=document.createElement('div');nameLine.className='device-name-line';
    const rename=rowButton('',()=>openRename(d.id));rename.className='rename-icon';rename.title='修改名称';rename.disabled=!!d.delete_state;rename.setAttribute('aria-label','修改名称 '+d.name);
    rename.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const serialLine=document.createElement('div');serialLine.className='device-name-line';
    serialLine.append(sn);nameLine.append(strong,rename);const macLine=document.createElement('div');macLine.className='small';macLine.textContent='MAC: '+appleBroadcastMac(d.pubkey).replace(/:/g,'');macLine.title='由 Apple 公钥派生的双系统广播地址';title.append(nameLine,serialLine,macLine);if(d.renewal_excluded)title.append(badge('已暂停标识续报','failed'));
    const [text,kind]=taskState(d);cell(tr,'').append(badge(text,kind));cell(tr,d.history_count);cell(tr,d.latest_location == null ? '--' : date(d.latest_location));
    const actions=cell(tr,'');actions.append(rowButton('轨迹',()=>openTrack(d.id)));
    actions.append(rowButton('编辑',()=>openEdit(d.id)),rowButton('配置',()=>openKeys(d.id)));
    $('deviceRows').append(tr);
  }
  if(!shown.length)emptyRow('deviceRows',6,state.devices.length?'没有匹配的设备。':'暂无设备，点击“添加设备”生成第一台标签。');
  $('deviceListNote').textContent=`共 ${state.devices.length} 台设备 · 符合筛选 ${all.length} 台 · 当前显示 ${all.length?devicePage*size+1:0}–${devicePage*size+shown.length} 台`;
  $('devicePageLabel').textContent=`第 ${devicePage+1} / ${pages} 页`;
  $('deviceFirst').disabled=$('devicePrev').disabled=devicePage===0;
  $('deviceLast').disabled=$('deviceNext').disabled=devicePage+1>=pages;
  updateSelection();
}
function renderJobs() {
  $('jobsDevice').textContent='当前设备：'+(state.devices.find(d=>d.id===selected)?.name||'尚未选择')+'（从设备列表点击“轨迹”切换）';
  const jobs=(state.location_jobs||state.jobs).filter(j=>j.operation==='locate'&&j.state==='success'&&(j.result?.new_count??0)>0&&(!$('jobsCurrent').checked||j.device_id===selected));$('jobs').replaceChildren();
  for(const j of jobs){const tr=document.createElement('tr');cell(tr,date(j.created_at));cell(tr,names[j.operation]||j.operation);cell(tr,state.devices.find(d=>d.id===j.device_id)?.name||j.device_name||(j.device_id?'已移除设备':'全部设备'));cell(tr,'').append(badge(names[j.state]||j.state,j.state==='failed'?'failed':j.state==='running'?'running':''));cell(tr,j.error||j.result?.message||(j.result?.returned_count!==undefined?`返回 ${j.result.returned_count}，新增 ${j.result.new_count}`:j.result?.renewed_devices!==undefined?`已续报 ${j.result.renewed_devices} 台，排除 ${j.result.excluded_devices||0} 台`:''));$('jobs').append(tr);}
  if(!jobs.length)emptyRow('jobs',5,'暂无有新增位置的查询记录。');
}
function renderExportChoices() {
  if(!state)return;
  const devices=state.devices.filter(d=>exportIds.has(d.id));
  $('exportSelectionLabel').textContent=`已选 ${devices.length} 台设备`;
  $('exportDevices').replaceChildren();
  for(const d of devices){const item=document.createElement('span');item.textContent=d.name+' · '+d.sn;$('exportDevices').append(item);}
  if(!devices.length)$('exportDevices').textContent='所选设备已移除，请关闭窗口后重新选择。';
  $('exportSubmit').disabled=busy||!devices.length;
}
function openBatchExport() {
  if(busy||!selectedTasks.size)return;
  exportIds=new Set(selectedTasks);renderExportChoices();closeTimePicker();
  $('exportResult').textContent='不填写时间则导出全部历史。导出不包含密钥或账号信息。';
  $('exportDialog').showModal();document.body.classList.add('track-open');
}
async function refresh() {
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{state=await api('status');
    const ids=new Set(state.devices.map(d=>d.id));selectedTasks=new Set([...selectedTasks].filter(id=>ids.has(id)));exportIds=new Set([...exportIds].filter(id=>ids.has(id)));
    for(const id of historyCache.keys())if(!ids.has(id))historyCache.delete(id);
    if(keyId&&!ids.has(keyId))$('keysDialog').close();
    if(editId&&!ids.has(editId))$('editDialog').close();
    if(deleteId&&!ids.has(deleteId))$('deleteDialog').close();
    if(serialId&&!ids.has(serialId))$('serialDialog').close();
    if(!ids.has(selected)&&$('trackDialog').open)$('trackDialog').close();
    if(!ids.has(selected)){selected=state.devices[0]?.id||'';loadedKey='';historyVersion++;historyRows=[];clearSecret();}

    $('authState').textContent=state.authorized?'Google 授权已导入':'等待 Google 授权';$('authState').classList.toggle('warn',!state.authorized);
    $('accountState').textContent=state.authorized?'授权已导入；可同步设备列表核验 Google 连接。':'尚未完成授权，请先在电脑完成 Google 登录。';
    $('notice').textContent=state.network_mode==='server_proxy'?'服务运行在阿里云，Google 查询与推送均通过服务器上的 HTTP 代理出站；关闭本机不会中断云端任务。':state.network_via_pc?'服务运行在阿里云，Google 网络出口由本机提供。请保持本机开机、联网并运行 Google 服务入口。':'服务运行在阿里云，通过本机入口访问。';
    $('totalDevices').textContent=state.devices.length;$('totalEnabled').textContent=state.devices.filter(d=>d.enabled).length;$('totalLocations').textContent=state.devices.reduce((n,d)=>n+d.history_count,0);
    const running=state.jobs.find(j=>j.id===state.running_job), active=state.running_jobs?.length||0; $('currentJob').textContent=state.query_cooldown_until>Date.now()/1000?'查询限流冷却中':active>1?`并发查询 ${active}/${state.query_concurrency||10} 台`:running?(names[running.operation]||running.operation)+'中':state.running_job?'运行中':'空闲';
    $('syncState').textContent=`最近同步：${date(state.last_sync)} · 云端设备 ${state.cloud_devices?.length||0} 台`;
    $('renewState').textContent='每日自动续报 · 已排除 '+state.devices.filter(d=>d.renewal_excluded).length+' 台 · 最近成功：'+date(state.renewal?.last_success)+(state.renewal?.error?' · '+state.renewal.error:'');

    renderDeviceTable();renderJobs();renderExportChoices();updateKeyStatus();if($('trackDialog').open)await renderDetail();
  })();try {await refreshPromise;} finally {refreshPromise=null;}
}
async function historyFor(d) {const key=d.id+':'+d.history_count+':'+d.last_fetch;let cached=historyCache.get(d.id);if(cached?.key===key)return cached.rows;const rows=await api('devices/'+d.id+'/history');rows.sort((a,b)=>b.timestamp-a.timestamp);historyCache.set(d.id,{key,rows});return rows;}
function openTrack(id) {
  const entry=device(id);if(!entry)return;
  return UnifiedTrack.open({id:entry.id,sn:entry.sn,name:entry.name,initTime:initTimeButton,refreshTime:refreshTimeButton,closeTime:closeTimePicker});
  selected=id;stored('google-findhub-device',id);historyVersion++;loadedKey='';historyRows=[];historyPage=0;
  $('historyError').textContent='';$('trackMessage').hidden=true;map.tiles=true;$('mapTiles').textContent='隐藏地图底图';
  clearMap();emptyRow('history',9,'正在读取该设备的位置…');$('historyNote').textContent='正在读取该设备的位置…';$('mapNote').textContent='正在读取轨迹…';renderDeviceTable(true);renderJobs();
  if(!$('trackDialog').open)$('trackDialog').showModal();document.body.classList.add('track-open');
  $('trackDialog').scrollTop=0;
  renderDetail().catch(e=>msg(e.message,true));
}
async function renderDetail() {
  if(!state)return;const d=state.devices.find(x=>x.id===selected);$('empty').hidden=!!d;$('detail').hidden=!d;if(!d){historyRows=[];clearMap();return;}
  $('locationTitle').textContent=d.name+' · 历史位置与轨迹';$('locationDevice').textContent='SN '+d.sn+(d.renewal_excluded?' · 已暂停标识续报（失效测试），位置查询保持原设置':'');$('registration').textContent=names[d.registration]||d.registration;$('historyCount').textContent=d.history_count+' 条';$('latest').textContent=date(d.latest_location);$('fetched').textContent=date(d.last_fetch);
  $('stats').textContent=`定时任务：${d.enabled?'已启用':'暂停'} · 间隔 ${intervalText(d.interval_seconds)} · 最近返回 ${d.last_count??'—'} 条，新增 ${d.new_count||0} 条 · 空结果累计 ${d.empty_count||0} 次`;
  $('deviceError').textContent=d.delete_error||d.error||(d.stale?'超过 24 小时没有新位置，请检查标签与手机网络。':'');
  $('locate').disabled=!!d.delete_state;
  const key=d.id+':'+d.history_count+':'+d.last_fetch;if(loadedKey===key)return;const version=++historyVersion;
  try {const rows=await historyFor(d);if(version!==historyVersion||selected!==d.id)return;historyRows=rows;loadedKey=key;renderHistory(true);}catch(e){if(version===historyVersion){emptyRow('history',9,'读取位置失败，请稍后重试。');throw e;}}
}
function parseTime(value) {if(!value)return null;const t=Date.parse(value+'+08:00')/1000;if(!Number.isFinite(t))throw Error('请输入有效的北京时间');return t;}
function rangeFrom(start,end) {const a=parseTime(start),b=parseTime(end);if(a!==null&&b!==null&&a>b)throw Error('开始时间不能晚于结束时间');return {start:a,end:b===null?null:b+60};}
function inRange(p,range) {return (range.start===null||p.timestamp>=range.start)&&(range.end===null||p.timestamp<range.end);}
function filteredHistory(){return historyRows.filter(p=>inRange(p,historyRange));}
function hasCoordinates(p){return Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;}
const addressResults=new Map(),addressPending=new Set();
const addressKey=p=>`${p.latitude},${p.longitude}`;
function knownAddress(p){return addressResults.get(addressKey(p))||p.reverse_address;}
function renderAddressCell(td,p,id) {
  td.classList.add('location-address');td.replaceChildren();
  const a=document.createElement('a');a.href=`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;a.target='_blank';a.rel='noopener noreferrer';a.textContent='查看地图';td.append(a);
  if(p.name){const original=document.createElement('div');original.textContent=p.name;td.append(original);}
  const result=knownAddress(p),key=addressKey(p),text=document.createElement('div');text.className='address-text';text.setAttribute('role','status');
  if(result){text.textContent=result.found?'附近地址：'+result.address:'附近 1 公里内未找到地址';td.append(text);const source=document.createElement('small');source.className='small';source.textContent='Photon / OSM · '+(result.cached?'已缓存':'已查询并缓存');td.append(source);return;}
  const button=document.createElement('button');button.className='secondary address-query';button.type='button';button.textContent=addressPending.has(key)?'查询中…':'查询地址';button.disabled=addressPending.has(key);td.append(button,text);
  button.onclick=async()=>{
    if(addressPending.has(key))return;addressPending.add(key);button.disabled=true;button.textContent='查询中…';text.textContent='';
    try {
      const result=await api('devices/'+id+'/address',{latitude:p.latitude,longitude:p.longitude});addressResults.set(key,result);p.reverse_address=result;
      if(selected===id&&$('trackDialog').open){for(const row of historyRows)if(addressKey(row)===key)row.reverse_address=result;renderHistory(false);}
    } catch(e){if(td.isConnected)text.textContent=e.message;}
    finally {addressPending.delete(key);if(button.isConnected){button.disabled=false;button.textContent='查询地址';}}
  };
}
function renderHistory(fit=false) {
  const rows=filteredHistory(),pages=Math.max(1,Math.ceil(rows.length/100));historyPage=Math.max(0,Math.min(historyPage,pages-1));$('history').replaceChildren();
  for(const p of rows.slice(historyPage*100,(historyPage+1)*100)){const tr=document.createElement('tr');cell(tr,date(p.timestamp));cell(tr,Number.isFinite(p.latitude)?p.latitude.toFixed(7):'—');cell(tr,Number.isFinite(p.longitude)?p.longitude.toFixed(7):'—');cell(tr,Number.isFinite(p.altitude)?p.altitude+' 米':'—');cell(tr,Number.isFinite(p.accuracy_m)?p.accuracy_m.toFixed(1)+' 米':'—');cell(tr,p.status==null?'—':p.status+' · '+(statuses[p.status]||'未知'));cell(tr,ownReportText(p.is_own_report));cell(tr,unknown11Text(p.unknown_11)).title=unknown11Hint(p);const td=cell(tr,p.name||'—');if(hasCoordinates(p))renderAddressCell(td,p,selected);$('history').append(tr);}
  if(!rows.length)emptyRow('history',9,historyRows.length?'所选时间段没有位置记录。':'暂无位置。标签被附近安卓设备接收并上报后，才可能查询到位置。');
  $('historyNote').textContent=`当前设备 · 筛选 ${rows.length} 条 / 全部 ${historyRows.length} 条`;$('historyPage').textContent=`第 ${historyPage+1} / ${pages} 页`;$('historyPrev').disabled=historyPage===0;$('historyNext').disabled=historyPage+1>=pages;
  map.points=rows.filter(hasCoordinates).slice().sort((a,b)=>a.timestamp-b.timestamp);$('mapNote').textContent=map.points.length?`${map.points.length} 条位置 · ${new Set(map.points.map(p=>p.latitude+","+p.longitude)).size} 个不同坐标 · 拖动平移，滚轮缩放`:'当前范围没有可显示的坐标';if(fit)fitMap();else drawMap();
}
function openSerial(id) {if(busy)return;const d=device(id);serialId=id;$('serialValue').value=d.sn;$('serialDevice').textContent=d.name+' · 当前 SN '+d.sn;$('serialError').textContent='';$('serialDialog').showModal();$('serialValue').focus();$('serialValue').select();}
function openRename(id) {if(busy)return;const d=device(id);renameId=id;$('renameName').value=d.name;$('renameSn').textContent='SN '+d.sn;$('renameError').textContent='';$('renameDialog').showModal();$('renameName').focus();$('renameName').select();}
function openEdit(id) {if(busy)return;const d=device(id);editId=id;$('editName').value=d.name;$('editSn').textContent='SN '+d.sn;$('editError').textContent='';$('editDialog').showModal();}
function openDelete(id) {
  if(busy)return;const d=device(id);deleteId=id;
  $('deleteName').textContent=d.name;$('deleteSn').textContent=d.sn;
  $('deleteHistory').textContent=`已保存 ${d.history_count} 条位置。删除后历史与密钥加密归档，设备从列表及导出选择中移除。`;
  $('deleteConfirmSn').value='';$('deleteSubmit').disabled=true;$('deleteError').textContent=d.delete_error||'';
  $('deleteDialog').showModal();$('deleteConfirmSn').focus();
}
async function saveEdit(enabled) {if(!$('editForm').reportValidity())return;const name=$('editName').value.trim();if(!name)throw Error('设备名称不能为空');const body={name};if(enabled!==undefined)body.enabled=enabled;await api('devices/'+editId+'/configure',body);$('editDialog').close();msg(enabled===undefined?'设备设置已保存':enabled?'设备设置已保存，定时查询已启动':'设备设置已保存，定时查询已暂停');}
function openKeys(id,allowBusy=false) {if(busy&&!allowBusy)return;const d=device(id);keyId=id;clearSecret();$('keyDevice').textContent=d.name+' · '+(names[d.registration]||d.registration);$('sn').value=d.sn;$('eid').value=d.eid_hex;$('adv').value=d.advertisement_hex.match(/.{2}/g).join(' ');$('address').textContent='设备广播地址：'+d.static_random_address;$('cid').value=d.cid||'3A105789';$('pubkey').value=d.pubkey||'';$('mask').value='计算中…';$('burnConfigError').textContent='';$('cid').readOnly=!!d.cid;$('burnCommand').value='';$('register').disabled=d.registration==='registered';$('register').textContent=d.registration==='registered'?'已注册到 Google':'注册到 Google';$('keysDialog').showModal();loadBurnConfig(id);}
function updateKeyStatus(){const d=state?.devices.find(x=>x.id===keyId);if(!d||!$('keysDialog').open)return;const pending=state.jobs.some(j=>j.device_id===keyId&&j.operation==='register'&&['running','queued'].includes(j.state));$('keyDevice').textContent=d.name+' · '+(names[d.registration]||d.registration);$('register').disabled=busy||d.registration==='registered'||pending;$('register').textContent=d.registration==='registered'?'已注册到 Google':pending?'正在注册':'注册到 Google';}
async function batchConfigure(enabled) {if(!$('batchForm').reportValidity())return;const ids=[...selectedTasks];let success=0;const errors=[];for(const id of ids){try{await api('devices/'+id+'/schedule',{enabled});success++;}catch(e){errors.push(device(id).name+'：'+e.message);}}if(errors.length){$('batchError').textContent=errors.join('；');msg(`已完成 ${success} 台，${errors.length} 台未完成。请查看弹窗内原因。`,true);}else{$('batchDialog').close();msg(`已${enabled?'启动':'暂停'} ${success} 台设备，使用全局查询间隔。`);}}
function csvValue(value) {let s=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
async function exportData(options={}) {
  const ids=options.ids||exportIds;if(!ids.size)throw Error('请至少选择一台设备');const range=options.range||rangeFrom($('exportStart').value,$('exportEnd').value),mode=options.mode||$('exportMode').value,format=options.format||$('exportFormat').value,devices=state.devices.filter(d=>ids.has(d.id)).map(d=>({...d}));if(devices.length!==ids.size)throw Error('所选设备已发生变化，请重新选择');const output=[];
  if(!options.direct)$('exportResult').textContent='正在读取所选设备的已保存位置…';
  for(const d of devices){const all=options.rowsById?.get(d.id)??await api('devices/'+d.id+'/history'),rows=all.filter(p=>inRange(p,range)).sort((a,b)=>a.timestamp-b.timestamp);
    if(mode==='summary')output.push({device_name:d.name,sn:d.sn,interval_seconds:d.interval_seconds,start_time:range.start===null?'全部时间':date(range.start),end_time:range.end===null?'全部时间':date(range.end-1),location_count:rows.length,earliest_time:rows.length?date(rows[0].timestamp):'',latest_time:rows.length?date(rows.at(-1).timestamp):''});
    else for(const r of rows)output.push({device_name:d.name,sn:d.sn,time_beijing:date(r.timestamp),timestamp:r.timestamp,latitude:r.latitude??null,longitude:r.longitude??null,altitude:r.altitude??null,accuracy_m:r.accuracy_m??null,status:r.status??null,status_name:statuses[r.status]||'',is_own_report:r.is_own_report??null,unknown_11:r.unknown_11??null,unknown_11_received_at:r.unknown_11_received_at??null,unknown_11_received_beijing:r.unknown_11_received_at==null?'':date(r.unknown_11_received_at),name:r.name||'',address:knownAddress(r)?.address||'',address_source:knownAddress(r)?.provider||''});
  }
  const keys=mode==='summary'?['device_name','sn','interval_seconds','start_time','end_time','location_count','earliest_time','latest_time']:['device_name','sn','time_beijing','timestamp','latitude','longitude','altitude','accuracy_m','status','status_name','is_own_report','unknown_11','unknown_11_received_at','unknown_11_received_beijing','name','address','address_source'];
  const labels={device_name:'设备名称',sn:'设备SN',interval_seconds:'查询间隔（秒）',start_time:'筛选开始时间（北京时间）',end_time:'筛选结束时间（北京时间）',location_count:'位置数量',earliest_time:'最早位置时间（北京时间）',latest_time:'最新位置时间（北京时间）',time_beijing:'位置时间（北京时间）',timestamp:'Unix时间戳',latitude:'纬度',longitude:'经度',altitude:'高度（米）',accuracy_m:'精度（米）',status:'Status',status_name:'位置类型',is_own_report:'机主上报',unknown_11:'未知字段11（位置集合，含义待确认）',unknown_11_received_at:'未知字段11获取时间戳',unknown_11_received_beijing:'未知字段11获取时间（北京时间）',name:'地点名称',address:'附近地址（已查询）',address_source:'地址来源'};
  const content=format==='json'?JSON.stringify(output,null,2):'\ufeff'+[keys.map(k=>csvValue(labels[k])).join(','),...output.map(row=>keys.map(k=>csvValue(row[k])).join(','))].join('\r\n');saveBlob(new Blob([content],{type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'}),`${options.direct?'google-track-'+devices[0].sn:'google-locations-'+mode}-${new Date(Date.now()+8*3600000).toISOString().slice(0,10)}.${format}`);const note=`已导出 ${options.direct?devices[0].name:devices.length+' 台设备'}，${output.length} 行${mode==='summary'?'汇总':'位置明细'}。`;if(!options.direct)$('exportResult').textContent=note;msg(note);
}
// The trajectory dialog loads its basemap by default; points remain usable offline.
const map={points:[],zoom:15,cx:0,cy:0,tiles:true,pixels:[],drag:null,tileKey:''};
function project(lat,lon,z) {const size=256*2**z,s=Math.sin(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180);return {x:(lon+180)/360*size,y:(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*size};}
function clearMap() {map.points=[];map.pixels=[];map.tileKey='';$('mapTileLayer').replaceChildren();$('mapPopup').hidden=true;const canvas=$('mapCanvas');canvas.width=canvas.width;drawMap();}
function fitMap() {
  $('mapPopup').hidden=true;if(!map.points.length){drawMap();return;}const rect=$('historyMap').getBoundingClientRect(),w=Math.max(rect.width,300),h=Math.max(rect.height,250);let bounds;
  for(let z=17;z>=1;z--){let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const p of map.points){const q=project(p.latitude,p.longitude,z);minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minY=Math.min(minY,q.y);maxY=Math.max(maxY,q.y);}bounds={minX,maxX,minY,maxY};map.zoom=z;if(maxX-minX<w-100&&maxY-minY<h-100)break;}map.cx=(bounds.minX+bounds.maxX)/2;map.cy=(bounds.minY+bounds.maxY)/2;map.tileKey='';drawMap();
}
function drawMap() {
  if(!$('trackDialog').open||$('detail').hidden)return;const box=$('historyMap'),canvas=$('mapCanvas'),w=box.clientWidth,h=box.clientHeight;if(!w||!h)return;const ratio=window.devicePixelRatio||1;canvas.width=w*ratio;canvas.height=h*ratio;const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);const left=map.cx-w/2,top=map.cy-h/2;
  if(map.tiles&&map.points.length){const tileKey=[map.zoom,Math.floor(left/256),Math.floor(top/256),w,h].join(':');if(tileKey!==map.tileKey){map.tileKey=tileKey;$('mapTileLayer').replaceChildren();const n=2**map.zoom;for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++){if(y<0||y>=n)continue;const img=document.createElement('img');img.alt='';img.dataset.x=x;img.dataset.y=y;img.referrerPolicy='no-referrer';img.src=`https://a.tile.openstreetmap.fr/hot/${map.zoom}/${((x%n)+n)%n}/${y}.png`;img.onerror=()=>{img.hidden=true;$('mapNote').textContent='底图暂不可用，位置点和轨迹仍可查看。';};$('mapTileLayer').append(img);}}for(const img of $('mapTileLayer').children){img.style.left=(Number(img.dataset.x)*256-left)+'px';img.style.top=(Number(img.dataset.y)*256-top)+'px';}}
  else {$('mapTileLayer').replaceChildren();map.tileKey='';ctx.strokeStyle='#dce4db';ctx.lineWidth=1;for(let x=0;x<w;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}}
  map.pixels=map.points.map(p=>{const q=project(p.latitude,p.longitude,map.zoom);return {x:q.x-left,y:q.y-top,p};});
  if(!map.pixels.length){ctx.fillStyle='#718078';ctx.textAlign='center';ctx.font='14px sans-serif';ctx.fillText('暂无可显示的位置',w/2,h/2);return;}
  ctx.strokeStyle='#2a795c';ctx.lineWidth=2;ctx.beginPath();map.pixels.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.stroke();
  for(const [i,q] of map.pixels.entries()){if(q.x<-10||q.x>w+10||q.y<-10||q.y>h+10)continue;ctx.beginPath();ctx.arc(q.x,q.y,i===map.pixels.length-1?7:4,0,Math.PI*2);ctx.fillStyle=i===map.pixels.length-1?'#e89235':'#216f57';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}
}
function zoomMap(delta){const z=Math.max(1,Math.min(19,map.zoom+delta)),factor=2**(z-map.zoom);map.cx*=factor;map.cy*=factor;map.zoom=z;map.tileKey='';drawMap();}
$('historyMap').addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;map.drag={id:e.pointerId,x:e.clientX,y:e.clientY,cx:map.cx,cy:map.cy,moved:false};$('historyMap').setPointerCapture(e.pointerId);});
$('historyMap').addEventListener('pointermove',e=>{if(!map.drag)return;const dx=e.clientX-map.drag.x,dy=e.clientY-map.drag.y;if(Math.hypot(dx,dy)>4)map.drag.moved=true;map.cx=map.drag.cx-dx;map.cy=map.drag.cy-dy;drawMap();});
$('historyMap').addEventListener('pointerup',e=>{if(!map.drag)return;const drag=map.drag;map.drag=null;if($('historyMap').hasPointerCapture(e.pointerId))$('historyMap').releasePointerCapture(e.pointerId);if(drag.moved)return;const box=$('historyMap').getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top;const q=map.pixels.reduce((best,q)=>Math.hypot(q.x-x,q.y-y)<=(best?Math.hypot(best.x-x,best.y-y):Infinity)?q:best,null);if(q&&Math.hypot(q.x-x,q.y-y)<22){$('mapPopup').textContent=`${date(q.p.timestamp)}\n${q.p.latitude.toFixed(7)}, ${q.p.longitude.toFixed(7)}\n高度 ${Number.isFinite(q.p.altitude)?q.p.altitude+' 米':'—'}\n精度 ${q.p.accuracy_m??'—'} 米 · Status ${q.p.status??'—'}\n机主上报：${ownReportText(q.p.is_own_report)}\n未知字段11（待确认）：${unknown11Text(q.p.unknown_11)}\n字段获取时间：${date(q.p.unknown_11_received_at)}`;$('mapPopup').hidden=false;}else $('mapPopup').hidden=true;});
$('historyMap').addEventListener('pointercancel',()=>map.drag=null);$('historyMap').addEventListener('wheel',e=>{e.preventDefault();zoomMap(e.deltaY<0?1:-1);},{passive:false});
new ResizeObserver(()=>drawMap()).observe($('historyMap'));
$('mapFit').onclick=fitMap;$('mapZoomIn').onclick=()=>zoomMap(1);$('mapZoomOut').onclick=()=>zoomMap(-1);$('mapTiles').onclick=()=>{map.tiles=!map.tiles;map.tileKey='';$('mapTiles').textContent=map.tiles?'隐藏地图底图':'加载地图底图';drawMap();};
document.querySelectorAll('[data-view-target]').forEach(b=>b.onclick=()=>showView(b.dataset.viewTarget));window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());$('keysDialog').addEventListener('close',()=>{clearSecret();keyId='';});
$('deleteDialog').addEventListener('close',()=>{deleteId='';});
$('renameDialog').addEventListener('close',()=>{renameId='';});
$('serialDialog').addEventListener('close',()=>{serialId='';});
$('serialForm').onsubmit=e=>{e.preventDefault();if(!$('serialForm').reportValidity())return;run($('serialSave'),async()=>{
  const id=serialId,sn=$('serialValue').value.trim();if(!/^[1-9][0-9]{11}$/.test(sn))throw Error('SN 必须是首位非零的 12 位数字');
  await api('devices/'+id+'/sn',{sn});$('serialDialog').close();msg('SN 已保存。实物设备中的 SN 如需同步，请重新写入。');
},'serialError');};
$('renameForm').onsubmit=e=>{e.preventDefault();if(!$('renameForm').reportValidity())return;run($('renameSave'),async()=>{
  const id=renameId,name=$('renameName').value.trim();if(!name)throw Error('设备名称不能为空');
  await api('devices/'+id+'/rename',{name});$('renameDialog').close();msg('设备名称已保存。');
},'renameError');};
$('deleteConfirmSn').oninput=()=>{$('deleteSubmit').disabled=busy||$('deleteConfirmSn').value.trim()!==state?.devices.find(d=>d.id===deleteId)?.sn;};
$('deleteForm').onsubmit=e=>{e.preventDefault();if(!$('deleteForm').reportValidity())return;run($('deleteSubmit'),async()=>{
  const d=device(deleteId),confirm_sn=$('deleteConfirmSn').value.trim();if(confirm_sn!==d.sn)throw Error('请输入所选设备的完整 SN');
  await api('devices/'+d.id+'/delete',{confirm_sn});$('deleteDialog').close();
  msg('删除任务已提交：查询已暂停，正在核实 Google 注销结果。完成前设备会保留在列表中。');
},'deleteError');};
$('deviceSearch').oninput=()=>{devicePage=0;renderDeviceTable(true);};$('jobsCurrent').onchange=renderJobs;
for(const id of ['devicePageSize','deviceSort','deviceSortDirection'])$(id).onchange=()=>{devicePage=0;renderDeviceTable(true);};
$('deviceFirst').onclick=()=>{devicePage=0;renderDeviceTable(true);};$('devicePrev').onclick=()=>{devicePage--;renderDeviceTable(true);};
$('deviceNext').onclick=()=>{devicePage++;renderDeviceTable(true);};$('deviceLast').onclick=()=>{devicePage=devicePageData().pages-1;renderDeviceTable(true);};
$('selectAll').onchange=()=>{for(const d of devicePageData().shown)$('selectAll').checked?selectedTasks.add(d.id):selectedTasks.delete(d.id);renderDeviceTable(true);};
$('clearDeviceSelection').onclick=()=>{selectedTasks.clear();renderDeviceTable(true);};
$('batchOpen').onclick=()=>{$('batchSummary').textContent=`将修改 ${selectedTasks.size} 台设备。`;$('batchError').textContent='';$('batchDialog').showModal();};

$('editDelete').onclick=()=>{const id=editId;$('editDialog').close();openDelete(id);};
$('editForm').onsubmit=e=>{e.preventDefault();run($('editSave'),()=>saveEdit(undefined),'editError');};bind('editStart',()=>saveEdit(true),'editError');bind('editPause',()=>saveEdit(false),'editError');
$('batchForm').onsubmit=e=>{e.preventDefault();run($('batchStart'),()=>batchConfigure(true),'batchError');};bind('batchPause',()=>batchConfigure(false),'batchError');
$('generateForm').onsubmit=e=>{e.preventDefault();run($('generate'),async()=>{const name=$('name').value.trim();if(!name)throw Error('请输入设备名称');const d=await api('devices',{name});selected=d.id;stored('google-findhub-device',selected);$('name').value='';loadedKey='';msg('设备密钥已生成。请注册到 Google，再烧录 SN 与 EID。');await refresh();showView('devices');openKeys(d.id,true);});};
bind('sync',()=>job('sync'));bind('renew',()=>job('renew'));bind('locate',()=>job('locate',device().id));bind('register',()=>job('register',device(keyId).id));
bind('download',()=>download('devices/'+device(keyId).id+'/firmware','google-fmdn-'+device(keyId).sn+'.h'));
bind('copy',async()=>{device(keyId);try{await navigator.clipboard.writeText($('eid').value);msg('已复制广播 EID。');}catch{$('eid').select();msg('请复制已选中的 EID 文本。');}});
let burnLoadVersion=0;
async function loadBurnConfig(id) {
  const version=++burnLoadVersion;
  try {
    const result=await api('devices/'+id+'/burn-config');
    if(version!==burnLoadVersion||keyId!==id||!$('keysDialog').open)return;
    $('mask').value=result.mask;
    if($('pubkey').value.trim().toUpperCase()===result.pubkey&&$('cid').value.trim().toUpperCase()===result.cid)$('burnCommand').value=result.command||'';
  } catch(e) {if(version===burnLoadVersion&&keyId===id&&$('keysDialog').open){$('mask').value='';$('burnConfigError').textContent=e.message;}}
}
async function saveBurnConfig() {
  const id=keyId;
  ++burnLoadVersion;
  $('burnCommand').value='';$('burnConfigError').textContent='';
  const result=await api('devices/'+id+'/burn-config',{cid:$('cid').value.trim(),pubkey:$('pubkey').value.trim()});
  if(keyId!==id||!$('keysDialog').open)return null;
  $('cid').value=result.cid;$('cid').readOnly=true;$('pubkey').value=result.pubkey;$('mask').value=result.mask;$('burnCommand').value=result.command;
  return result;
}
bind('saveBurnConfig',async()=>{if(await saveBurnConfig())msg('烧录配置已保存，已生成含 mask 的完整 AT 指令。');},'burnConfigError');
bind('copyAt',async()=>{const result=await saveBurnConfig();if(!result)return;try{await navigator.clipboard.writeText(result.command+'\r\n');msg('配置已保存，AT 烧录指令已复制（含回车换行）。');}catch{msg('配置已保存，指令已生成，请从文本框复制。');}},'burnConfigError');
for(const id of ['cid','pubkey'])$(id).oninput=()=>{$('burnCommand').value='';$('burnConfigError').textContent='';};
bind('identity',async()=>{const id=device(keyId).id,result=await api('devices/'+id+'/identity');if(keyId!==id||!$('keysDialog').open)return;clearSecret();$('secret').textContent=result.eik_hex+'\n'+result.note;$('secret').hidden=false;secretTimer=setTimeout(clearSecret,30000);});
bind('network',async()=>{const rows=await api('network',{});$('networkResult').hidden=false;$('networkResult').textContent=rows.map(r=>`${r.host}: ${r.reachable?'可连接（HTTP '+r.http_status+'）':r.error}`).join('\n')+'\n根路径 404 表示服务可达，不等于账号授权成功。';});
$('authFile').onchange=()=>run(null,async()=>{try{const file=$('authFile').files[0];if(!file)return;if(file.size>2000000)throw Error('文件过大');const r=await api('auth/import',JSON.parse(await file.text()));msg(r.note);}finally{$('authFile').value='';}});
$('historyFilter').onsubmit=e=>{e.preventDefault();$('historyError').textContent='';try{historyRange=rangeFrom($('historyStart').value,$('historyEnd').value);historyPage=0;renderHistory(true);}catch(e){$('historyError').textContent=e.message;}};
$('historyClear').onclick=()=>{$('historyStart').value=$('historyEnd').value='';refreshTimeButton($('historyStart'));refreshTimeButton($('historyEnd'));$('historyError').textContent='';historyRange={start:null,end:null};historyPage=0;renderHistory(true);};$('historyPrev').onclick=()=>{historyPage--;renderHistory();};$('historyNext').onclick=()=>{historyPage++;renderHistory();};
bind('exportCurrent',async()=>{
  const d=device();if(!loadedKey||!loadedKey.startsWith(d.id+':'))throw Error('请等待当前设备的历史位置加载完成');
  const range=rangeFrom($('historyStart').value,$('historyEnd').value);
  await exportData({ids:new Set([d.id]),range,mode:'detail',format:'csv',direct:true,rowsById:new Map([[d.id,historyRows.slice()]])});
});
$('batchExport').onclick=openBatchExport;
$('exportDialog').addEventListener('close',()=>{closeTimePicker();document.body.classList.remove('track-open');});
$('exportForm').onsubmit=e=>{e.preventDefault();run($('exportSubmit'),exportData,'exportResult');};
const timePicker=document.createElement('div');
timePicker.className='time-picker-popover';timePicker.hidden=true;
timePicker.setAttribute('role','dialog');timePicker.setAttribute('aria-label','选择时间');
timePicker.innerHTML=`<div class="time-picker-heading">选择时间</div>
  <div class="time-picker-month"><button type="button" data-picker-month="-1" aria-label="上个月">‹</button><strong class="time-picker-month-label"></strong><button type="button" data-picker-month="1" aria-label="下个月">›</button></div>
  <div class="time-picker-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
  <div class="time-picker-days"></div>
  <div class="time-picker-time"><span>时间</span><div><select class="time-picker-hour" aria-label="小时"></select><b>:</b><select class="time-picker-minute" aria-label="分钟"></select></div></div>
  <div class="time-picker-footer"><button type="button" class="time-picker-clear">↶ 清空</button><span></span><button type="button" class="time-picker-now">当前时间</button><button type="button" class="time-picker-confirm">✓ 确定</button></div>`;
document.body.append(timePicker);
let timePickerTarget=null,timePickerDraftDate='',timePickerYear=0,timePickerMonth=0;
const pickerHour=timePicker.querySelector('.time-picker-hour');
const pickerMinute=timePicker.querySelector('.time-picker-minute');
for(let hour=0;hour<24;hour++)pickerHour.append(new Option(`${String(hour).padStart(2,'0')} 时`,String(hour).padStart(2,'0')));
for(let minute=0;minute<60;minute++)pickerMinute.append(new Option(`${String(minute).padStart(2,'0')} 分`,String(minute).padStart(2,'0')));
function beijingNowMinute() { return new Date(Date.now()+8*3600000).toISOString().slice(0,16); }
function refreshTimeButton(input) {
  const button=input._timeButton;if(!button)return;
  const value=input.value;
  button.querySelector('.time-picker-value').textContent=value
    ? `${Number(value.slice(0,4))}年${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日 ${value.slice(11,16)}`
    : (input.id.toLowerCase().endsWith('start')?'选择开始时间':'选择结束时间');
  button.classList.toggle('is-empty',!value);
}
function closeTimePicker() {
  if(timePickerTarget)timePickerTarget.button.setAttribute('aria-expanded','false');
  timePickerTarget=null;timePicker.hidden=true;
}
function placeTimePicker() {
  if(!timePickerTarget||timePicker.hidden)return;
  const rect=timePickerTarget.button.getBoundingClientRect();
  const width=timePicker.offsetWidth,height=timePicker.offsetHeight;
  timePicker.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-width-12))}px`;
  timePicker.style.top=`${rect.bottom+8+height>innerHeight-12&&rect.top-height-8>=12
    ? rect.top-height-8 : Math.max(12,Math.min(rect.bottom+8,innerHeight-height-12))}px`;
}
function renderTimePickerDays() {
  const monthNames=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  timePicker.querySelector('.time-picker-month-label').textContent=`${monthNames[timePickerMonth]} ${timePickerYear}`;
  const first=(new Date(Date.UTC(timePickerYear,timePickerMonth,1)).getUTCDay()+6)%7;
  const days=new Date(Date.UTC(timePickerYear,timePickerMonth+1,0)).getUTCDate();
  const total=Math.max(35,Math.ceil((first+days)/7)*7);
  const today=beijingNowMinute().slice(0,10),grid=timePicker.querySelector('.time-picker-days');
  grid.replaceChildren();
  for(let index=0;index<total;index++){
    const date=new Date(Date.UTC(timePickerYear,timePickerMonth,1-first+index));
    const value=date.toISOString().slice(0,10),button=document.createElement('button');
    button.type='button';button.textContent=String(date.getUTCDate());button.setAttribute('aria-label',value);
    if(date.getUTCMonth()!==timePickerMonth)button.classList.add('is-adjacent');
    if(value===today)button.classList.add('is-today');
    if(value===timePickerDraftDate){button.classList.add('is-selected');button.setAttribute('aria-selected','true');}
    button.onclick=()=>{
      timePickerDraftDate=value;timePickerYear=date.getUTCFullYear();timePickerMonth=date.getUTCMonth();
      renderTimePickerDays();placeTimePicker();
    };
    grid.append(button);
  }
}
function openTimePicker(input,button) {
  if(timePickerTarget?.input===input){closeTimePicker();return;}
  closeTimePicker();
  const root=input.closest(':fullscreen,.map-window-expanded')||input.closest('dialog')||document.body;root.append(timePicker);
  timePickerTarget={input,button};button.setAttribute('aria-expanded','true');
  const now=beijingNowMinute();
  const value=input.value||(input.id.toLowerCase().endsWith('start')?`${now.slice(0,10)}T00:00`:now);
  timePickerDraftDate=value.slice(0,10);
  timePickerYear=Number(value.slice(0,4));timePickerMonth=Number(value.slice(5,7))-1;
  pickerHour.value=value.slice(11,13);pickerMinute.value=value.slice(14,16);
  renderTimePickerDays();timePicker.hidden=false;placeTimePicker();
}
function initTimeButton(id,title) {
  const input=$(id),button=document.createElement('button');
  input.hidden=true;button.type='button';button.className='time-picker-trigger';
  button.setAttribute('aria-label',title);button.setAttribute('aria-expanded','false');
  button.innerHTML='<span class="time-picker-clock" aria-hidden="true"></span><span class="time-picker-value"></span><span class="time-picker-chevron" aria-hidden="true"></span>';
  input.before(button);input._timeButton=button;refreshTimeButton(input);
  button.onclick=()=>openTimePicker(input,button);
}
document.querySelectorAll('input[type="datetime-local"]').forEach(input=>initTimeButton(input.id,input.closest('label').firstChild.textContent.trim()));
$('historyFilter').querySelector('button[type="submit"]').hidden=true;
timePicker.querySelectorAll('[data-picker-month]').forEach(button=>button.onclick=()=>{
  const date=new Date(Date.UTC(timePickerYear,timePickerMonth+Number(button.dataset.pickerMonth),1));
  timePickerYear=date.getUTCFullYear();timePickerMonth=date.getUTCMonth();renderTimePickerDays();placeTimePicker();
});
timePicker.querySelector('.time-picker-now').onclick=()=>{
  const now=beijingNowMinute();timePickerDraftDate=now.slice(0,10);
  timePickerYear=Number(now.slice(0,4));timePickerMonth=Number(now.slice(5,7))-1;
  pickerHour.value=now.slice(11,13);pickerMinute.value=now.slice(14,16);
  renderTimePickerDays();placeTimePicker();
};
timePicker.querySelector('.time-picker-clear').onclick=()=>{
  if(!timePickerTarget)return;
  const input=timePickerTarget.input;input.value='';refreshTimeButton(input);
  closeTimePicker();if(input.closest('form').id==='historyFilter')$('historyFilter').requestSubmit();
};
timePicker.querySelector('.time-picker-confirm').onclick=()=>{
  if(!timePickerTarget)return;
  const input=timePickerTarget.input;
  input.value=`${timePickerDraftDate}T${pickerHour.value}:${pickerMinute.value}`;
  refreshTimeButton(input);closeTimePicker();if(input.closest('form').id==='historyFilter')$('historyFilter').requestSubmit();
};
document.addEventListener('pointerdown',event=>{
  if(timePickerTarget&&!timePicker.contains(event.target)&&!timePickerTarget.button.contains(event.target))closeTimePicker();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&timePickerTarget){event.preventDefault();event.stopImmediatePropagation();closeTimePicker();}
},true);
window.addEventListener('resize',placeTimePicker);
document.addEventListener('scroll',placeTimePicker,true);
$('trackDialog').addEventListener('close',()=>{closeTimePicker();document.body.classList.remove('track-open');historyVersion++;loadedKey='';map.drag=null;});
// SERIAL_BURN_CORE_BEGIN
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
    get active(){return ['waiting','preparing','sending','awaiting'].includes(this.phase);}
    load(items){if(this.active||this.pending)throw Error('请先暂停，并处理当前设备的烧录结果。');this.items=items.map(d=>({...d}));this.index=0;this.phase='idle';this.buffer='';this.changed();}
    start(){if(this.pending)throw Error('上一条指令结果未确认，请先断开串口并核对实物，再重连重试当前设备。');if(!this.items[this.index])throw Error('请先从设备列表载入烧录队列。');this.buffer='';this.phase='waiting';this.changed();this.log('等待当前实物上报 A-01 或 T-08 待烧录提示。');}
    pause(reason='已暂停；继续时仍处理当前未完成设备。') {
      clearTimeout(this.timer);this.generation++;
      if(this.pending&&!this.pending.sent)this.pending=null;
      this.phase='paused';this.log(reason);this.changed();
    }
    disconnected(){this.pause(this.pending?.sent?'串口已断开，当前写入结果未确认；未切换下一台。':'串口已断开，队列已暂停。');this.pending=null;this.buffer='';this.changed();}
    feed(text){
      this.buffer+=text;
      if(this.buffer.length>8192){this.buffer='';this.pause('串口数据过长或缺少换行，已暂停。');return;}
      let match;
      while((match=/[\r\n]/.exec(this.buffer))){
        const line=this.buffer.slice(0,match.index).trim();this.buffer=this.buffer.slice(match.index+1);
        const index=this.index;if(line)this.line(line);
        // A success consumes the current packet. Buffered boot banners must not burn the next identity.
        if(this.index!==index){this.buffer='';break;}
      }
    }
    line(line){
      this.log('RX '+line);
      const ack=/^OK\+SETKEY=sn:([1-9]\d{11})$/.exec(line);
      if(ack){
        const p=this.pending;
        if(!p?.sent){this.log('忽略：当前没有待确认的烧录指令。');return;}
        if(ack[1]!==p.item.sn){this.pause('成功回复 SN 与当前设备不符，未切换下一台，请核对实物。');return;}
        clearTimeout(this.timer);this.pending=null;this.generation++;
        const wasActive=this.active;this.index++;
        this.phase=this.index===this.items.length?'done':wasActive?'waiting':'paused';
        this.completed(p.item);this.log('成功：'+p.item.name+' · SN '+p.item.sn+(this.phase==='done'?'；队列全部完成。':'；已切换下一台，请更换实物后上电。'));this.changed();return;
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
// SERIAL_BURN_CORE_END

function appleBroadcastMac(pubkey) {
  if (!/^[0-9a-f]{56}$/i.test(pubkey || '') || /^0+$/.test(pubkey)) return '--';
  const bytes=pubkey.slice(0,12).match(/../g).map(v=>parseInt(v,16));
  bytes[0] |= 0xC0;
  return bytes.map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join(':');
}

const serialBurn = (() => {
  let port=null, reader=null, writer=null, reading=null, connecting=false, closing=false, opening=false;
  const supported=!!navigator.serial && window.isSecureContext;
  const logRows=[];const ledgerKey='tag-serial-burn-results-v1';
  let receipts=[];try{const v=JSON.parse(stored(ledgerKey)||'[]');if(Array.isArray(v))receipts=v.slice(-1000);}catch{}
  function log(text){logRows.push(new Date().toLocaleTimeString('zh-CN',{hour12:false})+' '+text);if(logRows.length>200)logRows.shift();$('uartLog').textContent=logRows.join('\n');$('uartLog').scrollTop=$('uartLog').scrollHeight;}
  function completed(item){receipts.push({id:item.id,name:item.name,sn:item.sn,at:new Date().toISOString()});receipts=receipts.slice(-1000);stored(ledgerKey,JSON.stringify(receipts));}
  const queue=new TagSerialCore.Queue({
    async prepare(item){
      const current=state.devices.find(d=>d.id===item.id);
      if(!current||current.delete_state||['sn','pubkey','eid_hex','cid'].some(k=>current[k]!==item[k]))throw Error('网页设备配置已变更或正在删除，请重新载入队列。');
      if(!item.burnConfig)throw Error('烧录配置尚未预载，请重新载入队列。');
      return item.burnConfig;
    },
    async write(command){if(!writer)throw Error('串口未连接');await writer.write(new TextEncoder().encode(command));},changed:render,log,completed
  });
  const labels={idle:'尚未开始',waiting:'等待实物待烧录提示',preparing:'正在核对烧录配置',sending:'正在发送指令',awaiting:'等待成功回复',paused:'已暂停',done:'全部完成'};
  function render(){
    const connected=!!port&&!closing;const locked=queue.active||!!queue.pending;
    $('uartSupport').textContent=supported?'使用本机 Edge / Chrome，通过当前 127.0.0.1 页面连接电脑上的串口。串口参数：115200 · 8N1 · 无流控。':'当前浏览器不支持串口。请在电脑 Edge / Chrome 中打开本账号的 127.0.0.1 地址（或 HTTPS 页面）。';
    $('uartConnect').disabled=!supported||!!port||connecting||closing;
    $('uartDisconnect').disabled=!port||closing;
    $('uartLoad').disabled=opening||locked||!selectedTasks.size;
    $('uartReburn').disabled=locked;
    $('uartStart').disabled=!connected||queue.active||!!queue.pending||queue.index>=queue.items.length||opening;
    $('uartPause').disabled=!queue.active;
    $('uartStatus').textContent=(connected?'串口已连接':'串口未连接')+' · '+labels[queue.phase];
    $('uartProgress').textContent=`本队列已完成 ${queue.index} / ${queue.items.length} 台`;
    const current=queue.items[queue.index];$('uartCurrent').textContent=current?current.name+' · SN '+current.sn+' · CID '+current.cid:'—';
    const table=$('uartQueue');table.replaceChildren();
    queue.items.forEach((item,i)=>{const tr=document.createElement('tr');cell(tr,i+1);cell(tr,item.name);cell(tr,item.sn);cell(tr,i<queue.index?'已确认成功':i===queue.index?labels[queue.phase]:'等待前序完成');if(i===queue.index)tr.classList.add('selected');table.append(tr);});
    if(!queue.items.length)emptyRow('uartQueue',4,'请在设备列表勾选设备，然后载入队列。');
  }
  async function load(){
    if(opening)return;
    if(queue.active||queue.pending){msg('请先暂停并处理当前烧录结果，再重新载入队列。',true);return;}
    opening=true;render();
    try{
      const ids=[...selectedTasks];const latest=await api('status');
      const allow=$('uartReburn').checked;let skipped=0;
      const items=ids.map(id=>latest.devices.find(d=>d.id===id));
      if(items.some(d=>!d||d.delete_state))throw Error('所选设备有删除或注销中的记录，请重新选择。');
      const usable=items.filter(d=>{if(!allow&&receipts.some(r=>r.id===d.id&&r.sn===d.sn)){skipped++;return false;}return true;});
      if(!usable.length)throw Error(skipped?'所选设备在本浏览器已烧录成功。需要重写时，请明确勾选允许重新写入。':'请先在设备列表勾选设备。');
      for(const d of usable)if(!/^[1-9]\d{11}$/.test(d.sn)||!/^[0-9A-F]{56}$/i.test(d.pubkey||'')||!/^[0-9A-F]{40}$/i.test(d.eid_hex||'')||!/^[0-9A-F]{8}$/i.test(d.cid||''))throw Error(d.name+' 的 SN、公钥、EID 或 CID 不完整，请先到配置中保存。');
      showView('serial-burn');log('正在预载 '+usable.length+' 台烧录配置，完成后即可开始。');
      // Fetch before connecting the physical unit; keep selection order even
      // when responses arrive out of order. Limit server work to four requests.
      const prepared=new Array(usable.length);let cursor=0;
      await Promise.all(Array.from({length:Math.min(4,usable.length)},async()=>{
        while(cursor<usable.length){const i=cursor++;const d=usable[i];const config=await api('devices/'+d.id+'/burn-config');TagSerialCore.validate(d,config);prepared[i]={...d,burnConfig:config};}
      }));
      const confirmed=await api('status');
      for(const d of prepared){const current=confirmed.devices.find(v=>v.id===d.id);if(!current||current.delete_state||['sn','pubkey','eid_hex','cid'].some(k=>current[k]!==d[k]))throw Error('预载期间设备配置发生变化，请重新载入队列。');}
      state.devices=confirmed.devices;
      queue.load(prepared);log('已按勾选顺序载入 '+usable.length+' 台'+(skipped?'；跳过本浏览器已成功的 '+skipped+' 台':'')+'。配置预载完成，收到待烧录提示后直接发送；修改配置后请重新载入队列。');
    }catch(e){msg(e.message,true);log(e.message);}finally{opening=false;render();}
  }
  async function readLoop(){
    const decoder=new TextDecoder();
    try{while(reader){const {value,done}=await reader.read();if(done)break;queue.feed(decoder.decode(value,{stream:true}));}}
    catch(e){if(!closing)log('串口读取失败：'+e.message);}
    finally{try{reader?.releaseLock();}catch{}reader=null;if(!closing){queue.disconnected();void disconnect();}}
  }
  async function connect(){
    connecting=true;render();let candidate;
    try{
      candidate=await navigator.serial.requestPort();
      await candidate.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none'});
      port=candidate;writer=port.writable.getWriter();reader=port.readable.getReader();
      reading=readLoop();log('串口已连接。请点击开始自动烧录，再让当前实物进入待分配状态。');
    }catch(e){log(e.name==='NotFoundError'?'已取消串口选择。':'连接失败：'+e.message+'；请关闭其他占用串口的软件。');if(candidate&&!port)try{await candidate.close();}catch{}if(port)await disconnect();}
    finally{connecting=false;render();}
  }
  async function disconnect(){
    if(closing||!port)return;closing=true;queue.disconnected();render();
    try{
      if(reader)await reader.cancel();if(reading)await reading;
      if(writer){try{await writer.abort();}catch{}try{writer.releaseLock();}catch{}writer=null;}
      await port.close();
    }catch(e){log('关闭串口：'+e.message);}finally{port=null;reading=null;closing=false;render();}
  }
  $('uartLoad').onclick=load;
  $('batchSerialBurn').onclick=load;
  $('uartConnect').onclick=connect;$('uartDisconnect').onclick=disconnect;
  $('uartStart').onclick=()=>{try{queue.start();}catch(e){log(e.message);}};
  $('uartPause').onclick=()=>queue.pause();
  $('uartExport').onclick=()=>saveBlob(new Blob([JSON.stringify({account_origin:location.origin,exported_at:new Date().toISOString(),receipts,log:logRows},null,2)],{type:'application/json'}),'串口烧录记录.json');
  if(navigator.serial)navigator.serial.addEventListener('disconnect',event=>{if(event.target===port||event.port===port)void disconnect();});
  window.addEventListener('beforeunload',event=>{if(port){event.preventDefault();event.returnValue='';}});
  render();return {render,queue};
})();

showView(location.hash.slice(1));refresh().catch(e=>msg(e.message,true));setInterval(()=>{if(!busy)refresh().catch(e=>msg(e.message,true));},5000);
