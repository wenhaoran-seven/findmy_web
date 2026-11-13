const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="local-token"]').content;
let deviceList = [];
let taskList = [];
let scheduleData = null;
let taskPage = 1;
let taskPageSize = 10;
let taskSearch = '';
const selectedTaskIds = new Set();
let editingTaskId = null;
const mapSelectedIds = new Set();
const mapReports = new Map();
const mapVersions = new Map();
const mapRequests = new Map();
let mapSelectionInitialized = false;
function rememberedDevice() { try { return localStorage.getItem('findmy-device'); } catch { return null; } }
function rememberDevice(id) { try { localStorage.setItem('findmy-device', id); } catch {} }
function dateText(value) { return value ? new Date(value * 1000).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false}) : '—'; }
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
function showView(view) {
  document.querySelectorAll('[data-view]').forEach(panel => { panel.hidden = panel.dataset.view !== view; });
  document.querySelectorAll('[data-view-target]').forEach(button => {
    const active = button.dataset.viewTarget === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  if (view === 'devices') requestAnimationFrame(() => {
    if (!mapView.fitted) fitMapToTracks(); else renderMap();
  });
}
document.querySelectorAll('[data-view-target]').forEach(button => {
  button.onclick = () => showView(button.dataset.viewTarget);
});
async function api(path, body, method) {
  const response = await fetch('/api/' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {'X-Local-Token': token, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '请求失败');
  return data;
}
async function run(button, task, pending = '正在处理…') {
  button.disabled = true;
  notice(pending);
  try { await task(); } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
}
async function refreshAccount() {
  const s = await api('status');
  const states = {LOGGED_OUT:'尚未登录', REQUIRE_2FA:'等待双重验证', AUTHENTICATED:'认证尚未完成，请退出后重试', LOGGED_IN:'已登录'};
  $('account-status').textContent = (states[s.state] || s.state) + (s.account ? ' · ' + s.account : '');
  if (s.logged_in && s.location_ready === false) $('account-status').textContent += '（尚无位置查询权限）';
  $('login-form').hidden = s.state !== 'LOGGED_OUT';
  $('twofactor').hidden = s.state !== 'REQUIRE_2FA';
  $('logout').hidden = s.state === 'LOGGED_OUT' && !s.restore_error;
  if (s.state === 'REQUIRE_2FA') {
    const methods = await api('2fa/methods');
    $('methods').replaceChildren(...methods.map(m => new Option(m.label, m.id)));
  }
  if (s.restore_error || s.last_auth_error) notice(s.restore_error || s.last_auth_error.detail, true);
  return s;
}
function showPublic() {
  const d = deviceList.find(d => d.id === $('devices').value);
  rememberDevice($('devices').value);
  $('rename-name').value = d?.name || '';
  $('public-key').textContent = d ? JSON.stringify(d, null, 2) : '生成或导入标签后显示。';
}
async function refreshDevices(selected) {
  const previous = selected || $('devices').value || rememberedDevice();
  const exportIds = [...$('export-devices').querySelectorAll('input:checked')].map(e => e.value);
  deviceList = await api('devices');
  $('devices').replaceChildren(...(deviceList.length ? deviceList.map(d => new Option(d.name, d.id)) : [new Option('还没有设备','')]));
  if (deviceList.some(d => d.id === previous)) $('devices').value = previous;
  $('export-devices').replaceChildren(...deviceList.map(d => {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = d.id;
    input.checked = exportIds.length ? exportIds.includes(d.id) : d.id === $('devices').value;
    label.append(input, document.createTextNode(`${d.name} · ${d.id.slice(0,8)}`)); return label;
  }));
  showPublic();
  renderMapDeviceChoices();
}
const mapPalette = ['#d34a38', '#207cbb', '#168557', '#9a57c5', '#d18413', '#c03d88', '#3a79a1', '#7d8f25'];
let baiduReady = false;
let mapProvider = 'baidu';
let lastBaiduVersion = '';
const bottomMapState = {selectedId:null,movingId:null,playingId:null,progress:0,status:'',offsetIds:[]};
const dialogMapState = {selectedId:null,movingId:null,playingId:null,progress:0,status:'',offsetIds:[]};
function makePlaybackBar(prefix) {
  const bar=document.createElement('div'),label=document.createElement('label'),select=document.createElement('select');
  const progress=document.createElement('progress'),status=document.createElement('span');
  bar.className='track-playback-bar';label.textContent='轨迹回放时长';select.id=`${prefix}-duration`;
  for(const seconds of [15,30,60,120])select.append(new Option(`${seconds} 秒`,String(seconds),false,seconds===15));
  progress.id=`${prefix}-progress`;progress.max=100;progress.value=0;
  status.id=`${prefix}-status`;status.setAttribute('role','status');
  status.textContent='选择轨迹后可回放；线从空白逐渐画出，经过的水滴逐个显示。';
  label.append(select);bar.append(label,progress,status);return bar;
}
$('map-legend').before(makePlaybackBar('map-playback'));
document.querySelector('.track-dialog-body').after(makePlaybackBar('dialog-playback'));
const baiduLayer = document.createElement('iframe');
baiduLayer.id = 'baidu-map'; baiduLayer.className = 'baidu-map';
baiduLayer.style.visibility = 'hidden'; baiduLayer.style.pointerEvents = 'none';
const mapHost = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
const mapOrigin = document.querySelector('meta[name="map-origin"]')?.content || `${location.protocol}//${mapHost}:${location.port}`;
baiduLayer.src = `${mapOrigin}/baidu-map`;
// Baidu's SDK needs localStorage, so it needs a normal origin. The server
// exposes only /baidu-map on localhost; app data and tokens stay on 127.0.0.1.
baiduLayer.sandbox = 'allow-scripts allow-same-origin';
baiduLayer.referrerPolicy = 'origin'; baiduLayer.title = '百度地图轨迹';
$('history-map').prepend(baiduLayer);
const providerLabel = document.createElement('label'), providerSelect = document.createElement('select');
providerLabel.className = 'map-provider'; providerLabel.textContent = '底图'; providerSelect.id = 'map-provider';
providerSelect.append(new Option('百度地图', 'baidu'), new Option('OpenStreetMap', 'osm'));
providerLabel.append(providerSelect); document.querySelector('.map-actions').append(providerLabel);
const mapAttribution = document.querySelector('.map-attribution');
const osmLink = document.createElement('a');
osmLink.href = 'https://www.openstreetmap.org/copyright'; osmLink.target = '_blank';
osmLink.rel = 'noopener noreferrer'; osmLink.textContent = 'OpenStreetMap 贡献者';
const fallbackAttribution = [document.createTextNode('底图 © '), osmLink,
  document.createTextNode('；HOT 样式由 OpenStreetMap France 提供。加载底图会发送当前可视区域的瓦片编号（可推断查看区域）；设备密钥与完整位置报告不会发送。底图离线时，位置点和轨迹仍可显示。')];
mapAttribution.replaceChildren(...fallbackAttribution.map(node => node.cloneNode(true)));
const mapView = {zoom:12, x:0, y:0, fitted:false};
let mapScreenPoints = [];
let mapMessage = '';
let mapDrag = null;
function mapColor(id) {
  const index = Math.max(0, deviceList.findIndex(d => d.id === id));
  return mapPalette[index] || `hsl(${Math.round(index * 137.5) % 360} 66% 42%)`;
}
function trackActionButton(label,action,id,frame,state,durationId) {
  const button=document.createElement('button');button.type='button';button.className='secondary';
  button.textContent=label;button.dataset.mapAction=action;button.dataset.trackId=id;
  button.onclick=()=>{
    if(action==='play'&&state.playingId===id)frame.contentWindow.postMessage({type:'stop'},'*');
    else frame.contentWindow.postMessage({type:action,id,
      duration:action==='play'?Number($(durationId).value):undefined},'*');
  };
  return button;
}
function updateTrackControls(root,state,active,prefix) {
  root.querySelectorAll('[data-map-action]').forEach(button=>{
    const action=button.dataset.mapAction,id=button.dataset.trackId,playing=Boolean(state.playingId);
    button.disabled=!active||(playing&&!(action==='play'&&state.playingId===id))||
      (action==='reset'&&!state.offsetIds?.includes(id));
    button.classList.toggle('is-active',action==='select'&&state.selectedId===id||
      action==='move'&&state.movingId===id||action==='play'&&state.playingId===id);
    button.textContent=action==='select'&&state.selectedId===id?'取消':
      action==='move'&&state.movingId===id?'完成':
      action==='play'&&state.playingId===id?'停止':
      ({select:'选中','focus-group':'聚焦',move:'移动',reset:'归位',play:'回放'}[action]||button.textContent);
  });
  $(`${prefix}-duration`).disabled=!active||Boolean(state.playingId);
  $(`${prefix}-progress`).value=state.progress||0;
  $(`${prefix}-status`).textContent=!active?'切换到百度地图后可选中、移动和回放轨迹。':
    state.status||'轨迹线显示全部位置；放大可显示更多水滴。点击空白处取消高亮。';
}
function projectMap(lat, lon, zoom) {
  const size = 256 * 2 ** zoom;
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = safeLat * Math.PI / 180;
  return {x:(lon + 180) / 360 * size, y:(1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * size};
}
function baiduActive() { return mapProvider === 'baidu' && baiduReady; }
function applyMapProvider() {
  baiduLayer.style.visibility = baiduActive() ? 'visible' : 'hidden';
  baiduLayer.style.pointerEvents = baiduActive() ? 'auto' : 'none';
  $('map-tiles').hidden = baiduActive();
  $('map-canvas').hidden = baiduActive();
  if (baiduActive()) {
    const link=document.createElement('a'); link.href='https://map.baidu.com/';
    link.target='_blank'; link.rel='noopener noreferrer'; link.textContent='百度地图';
    mapAttribution.replaceChildren(document.createTextNode('底图 © '),link,
      document.createTextNode('。所选设备的轨迹点会在隔离地图页中绘制，并可被百度地图脚本访问；设备密钥和账号会话不会交给该页面。'));
  } else mapAttribution.replaceChildren(...fallbackAttribution.map(node => node.cloneNode(true)));
  mapView.fitted = false;
  lastBaiduVersion = '';
  fitMapToTracks();
  updateTrackControls($('map-legend'),bottomMapState,baiduActive(),'map-playback');
}
providerSelect.onchange = () => {
  if(baiduActive()&&providerSelect.value!=='baidu')baiduLayer.contentWindow.postMessage({type:'stop'},'*');
  mapProvider = providerSelect.value; applyMapProvider();
};
const providerHint = document.createElement('span'); providerHint.className = 'map-provider-hint';
providerHint.textContent = '百度地图加载中，暂用备用底图';
document.querySelector('.map-actions').append(providerHint);
window.addEventListener('message', event => {
  if (event.source !== baiduLayer.contentWindow || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'baidu-ready') {
    baiduReady = true; providerHint.textContent = '百度地图'; applyMapProvider();
  } else if (event.data.type === 'baidu-error') {
    baiduReady = false; mapProvider='osm'; providerSelect.value='osm';
    providerHint.textContent = '百度地图加载失败，已切换备用底图'; applyMapProvider();
  } else if (event.data.type === 'map-state') {
    Object.assign(bottomMapState,event.data);
    updateTrackControls($('map-legend'),bottomMapState,baiduActive(),'map-playback');
  }
});
setTimeout(() => {
  if (!baiduReady && mapProvider === 'baidu') {
    mapProvider='osm'; providerSelect.value='osm';
    providerHint.textContent='百度地图超时，已切换备用底图'; applyMapProvider();
  }
},12000);
function mapPoint(report) {
  const lat = Number(report.latitude), lon = Number(report.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? {lat, lon, report} : null;
}
const allMapTime = {start:null,end:null};
let mapTimeRange = allMapTime;
function readMapTimeRange(startId,endId) {
  const startText=$(startId).value,endText=$(endId).value;
  const minute=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if((startText&&!minute.test(startText))||(endText&&!minute.test(endText)))
    throw new Error('请选择有效的北京时间。');
  const start=startText?Date.parse(`${startText}:00+08:00`):null;
  const end=endText?Date.parse(`${endText}:00+08:00`)+59999:null;
  if((start!==null&&!Number.isFinite(start))||(end!==null&&!Number.isFinite(end)))
    throw new Error('请选择有效的北京时间。');
  if(start!==null&&end!==null&&start>end)
    throw new Error('开始时间不能晚于结束时间。');
  return {start,end};
}
function reportInMapTime(report,range) {
  if(range.start===null&&range.end===null)return true;
  const time=Date.parse(report.timestamp);
  return Number.isFinite(time)&&(range.start===null||time>=range.start)&&
    (range.end===null||time<=range.end);
}
function applyMapTimeRange() {
  try { mapTimeRange=readMapTimeRange('map-time-start','map-time-end');
    $('map-time-error').textContent=''; }
  catch(error) { $('map-time-error').textContent=error.message; return; }
  $('map-popup').hidden=true;lastBaiduVersion='';mapView.fitted=false;
  fitMapToTracks();
}
$('map-time-form').onsubmit=event=>{event.preventDefault();applyMapTimeRange();};
$('map-time-clear').onclick=()=>{
  $('map-time-start').value=$('map-time-end').value='';
  refreshTimeButton($('map-time-start'));refreshTimeButton($('map-time-end'));
  applyMapTimeRange();
};
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
    : (input.id.endsWith('start')?'选择开始时间':'选择结束时间');
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
  const value=input.value||(input.id.endsWith('start')?`${now.slice(0,10)}T00:00`:now);
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
for(const [id,title] of [['map-time-start','选择开始时间'],['map-time-end','选择结束时间'],
  ['track-dialog-time-start','选择开始时间'],['track-dialog-time-end','选择结束时间']])initTimeButton(id,title);
document.querySelectorAll('.map-time-form button[type="submit"]').forEach(button=>{button.hidden=true;});
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
  closeTimePicker();input.closest('form').requestSubmit();
};
timePicker.querySelector('.time-picker-confirm').onclick=()=>{
  if(!timePickerTarget)return;
  const input=timePickerTarget.input;
  input.value=`${timePickerDraftDate}T${pickerHour.value}:${pickerMinute.value}`;
  refreshTimeButton(input);closeTimePicker();input.closest('form').requestSubmit();
};
document.addEventListener('pointerdown',event=>{
  if(timePickerTarget&&!timePicker.contains(event.target)&&!timePickerTarget.button.contains(event.target))closeTimePicker();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&timePickerTarget){event.preventDefault();event.stopImmediatePropagation();closeTimePicker();}
},true);
window.addEventListener('resize',placeTimePicker);
document.addEventListener('scroll',placeTimePicker,true);
function renderMapDeviceChoices() {
  const ids = new Set(deviceList.map(d => d.id));
  for (const id of mapSelectedIds) if (!ids.has(id)) mapSelectedIds.delete(id);
  for (const id of mapReports.keys()) if (!ids.has(id)) { mapReports.delete(id); mapVersions.delete(id); }
  if (!mapSelectionInitialized) {
    if ($('devices').value) mapSelectedIds.add($('devices').value);
    mapSelectionInitialized = true;
  }
  $('map-devices').replaceChildren(...deviceList.map(d => {
    const label = document.createElement('label'), input = document.createElement('input'), swatch = document.createElement('span');
    input.type = 'checkbox'; input.value = d.id; input.checked = mapSelectedIds.has(d.id);
    input.onchange = () => {
      if (input.checked) mapSelectedIds.add(d.id); else mapSelectedIds.delete(d.id);
      mapView.fitted = false;
      refreshSelectedLocations().catch(e => { mapMessage = e.message; renderMap(); });
    };
    swatch.className = 'map-swatch'; swatch.style.background = mapColor(d.id);
    label.append(input, swatch, document.createTextNode(d.name)); return label;
  }));
  renderMap();
}
function selectedMapPoints() {
  return [...mapSelectedIds].map(id => ({id, device:deviceList.find(d => d.id === id),
    points:(mapReports.get(id)?.reports || []).filter(report=>reportInMapTime(report,mapTimeRange))
      .map(mapPoint).filter(Boolean).reverse()}));
}
function fitMapToTracks() {
  const points = selectedMapPoints().flatMap(item => item.points);
  if (!points.length) { renderMap(); return; }
  if (baiduActive()) {
    renderMap(); baiduLayer.contentWindow.postMessage({type:'fit'},'*');
    mapView.fitted=true; return;
  }
  const width = $('history-map').clientWidth || 800, height = $('history-map').clientHeight || 480;
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const point of points) {
    const p = projectMap(point.lat, point.lon, 0);
    minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
  }
  let zoom = 2;
  for (let candidate = 16; candidate >= 2; candidate--) {
    if ((maxX - minX) * 2 ** candidate <= Math.max(80, width - 100) &&
        (maxY - minY) * 2 ** candidate <= Math.max(80, height - 100)) { zoom = candidate; break; }
  }
  mapView.zoom = zoom;
  mapView.x = (minX + maxX) / 2 * 2 ** zoom;
  mapView.y = (minY + maxY) / 2 * 2 ** zoom;
  mapView.fitted = true;
  renderMap();
}
function renderMapTiles(width, height) {
  const z = mapView.zoom, count = 2 ** z;
  const left = mapView.x - width / 2, top = mapView.y - height / 2;
  const visible = new Set(), container = $('map-tiles');
  for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
    for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
      if (y < 0 || y >= count) continue;
      const key = `${z}/${x}/${y}`; visible.add(key);
      let tile = [...container.children].find(el => el.dataset.key === key);
      if (!tile) {
        tile = document.createElement('img'); tile.dataset.key = key; tile.alt = '';
        tile.draggable = false; tile.referrerPolicy = 'origin';
        tile.src = `https://a.tile.openstreetmap.fr/hot/${z}/${((x % count) + count) % count}/${y}.png`;
        container.append(tile);
      }
      tile.style.left = `${x * 256 - left}px`; tile.style.top = `${y * 256 - top}px`;
    }
  }
  for (const tile of [...container.children]) if (!visible.has(tile.dataset.key)) tile.remove();
}
function renderMap() {
  const element = $('history-map'), width = element.clientWidth, height = element.clientHeight;
  if (!width || !height) return;
  const groups = selectedMapPoints(), legend = $('map-legend');
  legend.replaceChildren();
  let total = 0;
  for (const group of groups) {
    const row=document.createElement('div'),label=document.createElement('span'),dot=document.createElement('i');
    row.className='map-track-row';
    dot.className='map-swatch'; dot.style.background=mapColor(group.id);
    label.append(dot,document.createTextNode(`${group.device?.name || group.id} · ${group.points.length} 点`));
    row.append(label);
    if(group.points.length){const controls=document.createElement('span');controls.className='map-track-controls';
      for(const [name,action] of [['选中','select'],['聚焦','focus-group'],['移动','move'],['归位','reset'],['回放','play']])
        controls.append(trackActionButton(name,action,group.id,baiduLayer,bottomMapState,'map-playback-duration'));
      row.append(controls);}
    legend.append(row); total+=group.points.length;
  }
  updateTrackControls(legend,bottomMapState,baiduActive(),'map-playback');
  $('report-count').textContent = `已选 ${groups.length} 台 · ${total} 个点`;
  $('location-note').textContent = mapMessage || (groups.length === 0 ? '请勾选要查看的设备。' : total === 0 ?
    (mapTimeRange.start!==null||mapTimeRange.end!==null?'所选时间段内暂无已保存的位置。':'所选设备暂无本地保存的位置。') :
    '拖动或缩放地图；点击彩色位置点查看时间、坐标和精度。');
  if (baiduActive()) {
    const version=`${mapTimeRange.start}:${mapTimeRange.end}|`+
      groups.map(g=>`${g.id}:${mapReports.get(g.id)?.fetched_at || 0}:${g.points.length}`).join('|');
    if (version !== lastBaiduVersion) {
      baiduLayer.contentWindow.postMessage({type:'tracks',groups:groups.map(g=>({
        id:g.id,name:g.device?.name || g.id,color:mapColor(g.id),
        points:g.points.map(p=>({lon:p.lon,lat:p.lat,time:p.report.timestamp,
          accuracy:p.report.accuracy_m,status:p.report.status}))}))},'*');
      lastBaiduVersion=version;
    }
    return;
  }
  const canvas = $('map-canvas'), ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
  if (!baiduActive()) {
    if (!mapView.x && !mapView.y) { const origin = projectMap(22.54,114.06,mapView.zoom); mapView.x=origin.x; mapView.y=origin.y; }
    renderMapTiles(width,height);
  }
  mapScreenPoints = [];
  for (const group of groups) {
    const color = mapColor(group.id);
    const coords = group.points.map(p => {
      const world = projectMap(p.lat,p.lon,mapView.zoom);
      return {...p, id:group.id, name:group.device?.name || group.id,
        x:world.x-mapView.x+width/2, y:world.y-mapView.y+height/2};
    });
    if (coords.length > 1) {
      ctx.beginPath(); coords.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
      ctx.strokeStyle = color; ctx.globalAlpha = .8; ctx.lineWidth = 2.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    for (const p of coords) {
      if (p.x < -8 || p.x > width+8 || p.y < -8 || p.y > height+8) continue;
      ctx.beginPath(); ctx.arc(p.x,p.y,5,0,Math.PI*2); ctx.fill(); ctx.stroke(); mapScreenPoints.push(p);
    }
  }
}
async function refreshSelectedLocations(force = false) {
  const ids = [...mapSelectedIds], failures = [];
  await Promise.all(ids.map(async id => {
    const task = taskList.find(t => t.device_id === id);
    const version = `${task?.history_count ?? 0}:${task?.last_run ?? 0}`;
    if (!force && mapVersions.get(id) === version) return;
    let pending = mapRequests.get(id);
    if (!pending) {
      pending = api(`devices/${id}/locations`).then(data => {
        mapReports.set(id,data); mapVersions.set(id,version);
      }).finally(() => mapRequests.delete(id));
      mapRequests.set(id,pending);
    }
    try { await pending; } catch (e) { failures.push(e.message); }
  }));
  mapMessage = failures.length ? `部分设备读取失败：${failures[0]}` : '';
  if (!mapView.fitted) fitMapToTracks(); else renderMap();
}
$('map-select-all').onclick = () => {
  deviceList.forEach(d => mapSelectedIds.add(d.id));
  renderMapDeviceChoices(); mapView.fitted = false;
  refreshSelectedLocations().catch(e => { mapMessage = e.message; renderMap(); });
};
$('map-clear-selection').onclick = () => {
  mapSelectedIds.clear(); renderMapDeviceChoices(); $('map-popup').hidden = true;
};
$('map-fit').onclick = fitMapToTracks;
function zoomMap(delta) {
  if (baiduActive()) {
    baiduLayer.contentWindow.postMessage({type:'zoom',delta},'*');
    $('map-popup').hidden = true; return;
  }
  const next = Math.max(2,Math.min(18,mapView.zoom+delta));
  const scale = 2 ** (next-mapView.zoom); mapView.x *= scale; mapView.y *= scale; mapView.zoom=next;
  $('map-popup').hidden = true; renderMap();
}
$('map-zoom-in').onclick = () => zoomMap(1);
$('map-zoom-out').onclick = () => zoomMap(-1);
$('history-map').addEventListener('wheel', e => { if (baiduActive()) return; e.preventDefault(); zoomMap(e.deltaY < 0 ? 1 : -1); }, {passive:false});
$('history-map').addEventListener('pointerdown', e => {
  if (baiduActive()) return;
  if (e.button !== 0 || e.target.closest('button, a, .map-popup')) return;
  mapDrag = {id:e.pointerId, x:e.clientX, y:e.clientY, moved:false};
  $('history-map').setPointerCapture(e.pointerId);
});
$('history-map').addEventListener('pointermove', e => {
  if (!mapDrag || mapDrag.id !== e.pointerId) return;
  const dx=e.clientX-mapDrag.x, dy=e.clientY-mapDrag.y;
  if (Math.abs(dx)+Math.abs(dy)>3) mapDrag.moved=true;
  mapDrag.x=e.clientX; mapDrag.y=e.clientY;
  if (mapDrag.moved) { mapView.x-=dx; mapView.y-=dy; $('map-popup').hidden=true; renderMap(); }
});
$('history-map').addEventListener('pointerup', e => {
  if (!mapDrag || mapDrag.id !== e.pointerId) return;
  const moved=mapDrag.moved; mapDrag=null;
  if (moved) return;
  const rect=$('history-map').getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
  showMapPoint(x,y);
});
function showMapPoint(x,y) {
  const rect=$('history-map').getBoundingClientRect();
  const hit=[...mapScreenPoints].reverse().find(p => Math.hypot(p.x-x,p.y-y)<=9);
  const popup=$('map-popup'); popup.hidden=!hit;
  if (!hit) return;
  popup.replaceChildren();
  const title=document.createElement('strong'), detail=document.createElement('div');
  title.textContent=hit.name;
  detail.textContent=`${hit.report.timestamp.replace('T',' ').replace('+08:00','')}（北京时间）\n${hit.lat.toFixed(7)}, ${hit.lon.toFixed(7)}\n精度：${hit.report.accuracy_m ?? '—'} 米 · status：${hit.report.status ?? '—'}`;
  popup.append(title,detail); popup.style.left=`${Math.min(x+12,rect.width-220)}px`; popup.style.top=`${Math.max(8,Math.min(y+12,rect.height-110))}px`;
}
$('history-map').addEventListener('pointercancel', () => { mapDrag=null; });
window.addEventListener('resize', renderMap);
// The per-device dialog has its own map and data. Opening it must not change
// the selection in the comparison map below the task table.
const trackDialog = $('track-dialog');
const trackDialogFrame = document.createElement('iframe');
trackDialogFrame.className = 'baidu-map';
trackDialogFrame.title = '单设备百度轨迹地图';
trackDialogFrame.sandbox = 'allow-scripts allow-same-origin';
trackDialogFrame.referrerPolicy = 'origin';
trackDialogFrame.style.visibility = 'hidden';
trackDialogFrame.style.pointerEvents = 'none';
$('track-dialog-map').prepend(trackDialogFrame);
const trackDialogControls=document.createElement('span');
trackDialogControls.id='track-dialog-controls';trackDialogControls.className='map-track-controls';
document.querySelector('.track-dialog-actions').insertBefore(trackDialogControls,
  $('track-dialog-provider').closest('label'));
let trackDialogDeviceId = null, trackDialogReport = null, trackDialogPoints = [], trackDialogLoaded = false;
let trackDialogTimeRange = allMapTime;
let trackDialogReady = false, trackDialogProvider = 'baidu', trackDialogSerial = 0;
let trackDialogFocused = -1, trackDialogScreenPoints = [], trackDialogDrag = null;
const trackDialogView = {zoom:12,x:0,y:0};
const mapFullscreenTarget=$('history-map').closest('section');
mapFullscreenTarget.classList.add('fullscreen-track-section');
const mapFullscreenButton=document.createElement('button');
mapFullscreenButton.type='button';mapFullscreenButton.className='secondary';
mapFullscreenButton.textContent='全屏地图';
document.querySelector('.map-actions').append(mapFullscreenButton);
const dialogFullscreenButton=document.createElement('button');
dialogFullscreenButton.type='button';dialogFullscreenButton.className='secondary';
dialogFullscreenButton.textContent='全屏轨迹';
document.querySelector('.track-dialog-actions').insertBefore(dialogFullscreenButton,
  $('track-dialog-provider').closest('label'));
function trackIsFullscreen(target){
  return document.fullscreenElement===target||target.classList.contains('map-window-expanded');
}
function updateFullscreenButtons(){
  mapFullscreenButton.textContent=trackIsFullscreen(mapFullscreenTarget)?'退出全屏':'全屏地图';
  dialogFullscreenButton.textContent=trackIsFullscreen(trackDialog)?'退出全屏':'全屏轨迹';
}
function refreshFullscreenMaps(){
  requestAnimationFrame(()=>setTimeout(()=>{
    if(baiduActive())baiduLayer.contentWindow?.postMessage({type:'resize'},'*');
    mapView.fitted=false;fitMapToTracks();
    if(trackDialog.open){
      if(trackDialogBaiduActive()){
        trackDialogFrame.contentWindow?.postMessage({type:'resize'},'*');
        sendTrackDialogMap(true);
      }else fitTrackDialogFallback();
    }
  },100));
}
async function toggleTrackFullscreen(target){
  closeTimePicker();
  if(target.classList.contains('map-window-expanded')){
    target.classList.remove('map-window-expanded');updateFullscreenButtons();refreshFullscreenMaps();return;
  }
  if(document.fullscreenElement===target){await document.exitFullscreen();return;}
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    await target.requestFullscreen();
  }catch{
    target.classList.add('map-window-expanded');updateFullscreenButtons();refreshFullscreenMaps();
  }
}
mapFullscreenButton.onclick=()=>toggleTrackFullscreen(mapFullscreenTarget);
dialogFullscreenButton.onclick=()=>toggleTrackFullscreen(trackDialog);
document.addEventListener('fullscreenchange',()=>{updateFullscreenButtons();refreshFullscreenMaps();});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const target=[trackDialog,mapFullscreenTarget].find(element=>element.classList.contains('map-window-expanded'));
  if(target){event.preventDefault();event.stopPropagation();target.classList.remove('map-window-expanded');
    updateFullscreenButtons();refreshFullscreenMaps();}
},true);
function trackDialogBaiduActive() { return trackDialogProvider === 'baidu' && trackDialogReady; }
function renderTrackDialogControls() {
  trackDialogControls.replaceChildren();
  if(trackDialogDeviceId&&trackDialogPoints.length){
    for(const [name,action] of [['选中','select'],['聚焦','focus-group'],['移动','move'],['归位','reset'],['回放','play']])
      trackDialogControls.append(trackActionButton(name,action,trackDialogDeviceId,
        trackDialogFrame,dialogMapState,'dialog-playback-duration'));
  }
  updateTrackControls(trackDialogControls,dialogMapState,trackDialogBaiduActive(),'dialog-playback');
}
function trackDialogData() {
  return [{id:trackDialogDeviceId,name:taskList.find(t=>t.device_id===trackDialogDeviceId)?.device_name || trackDialogDeviceId,
    color:mapColor(trackDialogDeviceId),
    points:trackDialogPoints.map(p=>({lon:p.lon,lat:p.lat,time:p.report.timestamp,
      accuracy:p.report.accuracy_m,status:p.report.status}))}];
}
function sendTrackDialogMap(fit=false) {
  if (!trackDialogBaiduActive() || !trackDialog.open) return;
  trackDialogFrame.contentWindow.postMessage({type:'tracks',groups:trackDialogData()},'*');
  if (fit) trackDialogFrame.contentWindow.postMessage({type:'fit'},'*');
}
function applyTrackDialogProvider(fit=true) {
  const active = trackDialogBaiduActive();
  trackDialogFrame.style.visibility = active ? 'visible' : 'hidden';
  trackDialogFrame.style.pointerEvents = active ? 'auto' : 'none';
  $('track-dialog-tiles').hidden = active;
  $('track-dialog-canvas').hidden = active;
  $('track-dialog-attribution').textContent = active
    ? '底图 © 百度地图。地图上显示的坐标可被百度地图脚本访问；设备密钥和账号信息不会发送。'
    : '底图 © OpenStreetMap 贡献者；HOT 样式由 OpenStreetMap France 提供。加载瓦片会发送当前可视区域；设备密钥和完整位置报告不会发送。';
  if (active) sendTrackDialogMap(fit);
  else if (fit) fitTrackDialogFallback();
  else renderTrackDialogFallback();
  updateTrackControls(trackDialogControls,dialogMapState,active,'dialog-playback');
}
window.addEventListener('message', event => {
  if (event.source !== trackDialogFrame.contentWindow || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'baidu-ready') {
    trackDialogReady = true;
    if (trackDialog.open) applyTrackDialogProvider();
  } else if (event.data.type === 'baidu-error') {
    trackDialogReady = false; trackDialogProvider = 'osm';
    $('track-dialog-provider').value = 'osm';
    if (trackDialog.open) {
      $('track-dialog-status').textContent = '百度地图加载失败，已切换备用底图。';
      applyTrackDialogProvider();
    }
  } else if (event.data.type === 'map-state') {
    Object.assign(dialogMapState,event.data);
    renderTrackDialogControls();
  }
});
function renderTrackDialogList() {
  const list = $('track-dialog-points');
  list.replaceChildren(...trackDialogPoints.map((point,index) => {
    const item=document.createElement('li'), button=document.createElement('button'), detail=document.createElement('small');
    button.type='button'; button.className=index===trackDialogFocused?'active':'';
    button.textContent=`${index+1}. ${point.report.timestamp.replace('T',' ').replace('+08:00','')} · 北京时间`;
    detail.textContent=`${point.lat.toFixed(7)}, ${point.lon.toFixed(7)} · 精度 ${point.report.accuracy_m ?? '—'} 米`;
    button.append(detail); button.onclick=()=>focusTrackDialogPoint(index);
    item.append(button); return item;
  }).reverse());
  $('track-dialog-count').textContent=`${trackDialogPoints.length} 个点`;
}
function setTrackDialogReport(data) {
  trackDialogReport=data;
  trackDialogPoints=(data?.reports || []).filter(report=>reportInMapTime(report,trackDialogTimeRange))
    .map(mapPoint).filter(Boolean)
    .sort((a,b)=>Date.parse(a.report.timestamp)-Date.parse(b.report.timestamp));
  trackDialogFocused=-1; $('track-dialog-popup').hidden=true;
  $('track-export').disabled=!trackDialogLoaded || !trackDialogPoints.length;
  $('track-export-result').textContent=trackDialogLoaded ? `当前时间范围共 ${trackDialogPoints.length} 个位置点，可导出原始经纬度和时间。` : '正在读取轨迹…';
  renderTrackDialogList(); renderTrackDialogControls(); applyTrackDialogProvider();
}
function trackDialogStatusText() {
  if(trackDialogPoints.length)return `所选时间段显示 ${trackDialogPoints.length} 个位置点；点击右侧列表可定位到地图。`;
  return trackDialogTimeRange.start!==null||trackDialogTimeRange.end!==null
    ? '所选时间段内暂无已保存的位置。' : '该设备暂无本地保存的位置。';
}
$('track-dialog-time-form').onsubmit=event=>{
  event.preventDefault();
  try { trackDialogTimeRange=readMapTimeRange('track-dialog-time-start','track-dialog-time-end');
    $('track-dialog-time-error').textContent=''; }
  catch(error) { $('track-dialog-time-error').textContent=error.message; return; }
  setTrackDialogReport(trackDialogReport);
  if(trackDialogReport)$('track-dialog-status').textContent=trackDialogStatusText();
};
$('track-dialog-time-clear').onclick=()=>{
  $('track-dialog-time-start').value=$('track-dialog-time-end').value='';
  refreshTimeButton($('track-dialog-time-start'));refreshTimeButton($('track-dialog-time-end'));
  $('track-dialog-time-form').requestSubmit();
};
async function openTrackDialog(id) {
  const entry=deviceList.find(d=>d.id===id);if(!entry)return;
  return UnifiedTrack.open({id:entry.id,sn:entry.sn,name:entry.name,initTime:initTimeButton,refreshTime:refreshTimeButton,closeTime:closeTimePicker});
  const task=taskList.find(t=>t.device_id===id);
  if (!task) return;
  const serial=++trackDialogSerial;
  trackDialogLoaded=false;
  $('track-comparison').open=false;$('track-summary-export').open=false;
  $('export-devices').querySelectorAll('input').forEach(input=>{input.checked=input.value===id;});
  trackDialogDeviceId=id; trackDialogProvider='baidu'; $('track-dialog-provider').value='baidu';
  trackDialogTimeRange=allMapTime;
  $('track-dialog-time-start').value=$('track-dialog-time-end').value='';
  refreshTimeButton($('track-dialog-time-start'));refreshTimeButton($('track-dialog-time-end'));
  $('track-dialog-time-error').textContent='';
  $('track-dialog-title').textContent=`${task.device_name} · ${task.device_id.slice(0,8)}`;
  $('track-dialog-status').textContent='正在读取本地已保存的位置…';
  trackDialog.showModal();
  if (!trackDialogFrame.src) trackDialogFrame.src=`${mapOrigin}/baidu-map`;
  setTrackDialogReport(mapReports.get(id) || null);
  try {
    const data=await api(`devices/${id}/locations`);
    if (serial!==trackDialogSerial || !trackDialog.open) return;
    trackDialogLoaded=true;
    setTrackDialogReport(data);
    $('track-dialog-status').textContent=trackDialogStatusText();
  } catch(error) {
    if (serial!==trackDialogSerial || !trackDialog.open) return;
    $('track-dialog-status').textContent=`读取失败：${error.message}`;
  }
}
$('track-dialog-close').onclick=()=>trackDialog.close();
trackDialog.addEventListener('close',()=>{
  if(timePickerTarget?.input.closest('dialog')===trackDialog)closeTimePicker();
  if(document.fullscreenElement===trackDialog)document.exitFullscreen().catch(()=>{});
  trackDialog.classList.remove('map-window-expanded');updateFullscreenButtons();
  if(trackDialogReady)trackDialogFrame.contentWindow.postMessage({type:'stop'},'*');
  trackDialogSerial++;trackDialogDeviceId=null;trackDialogReport=null;trackDialogPoints=[];trackDialogLoaded=false;
  if(baiduReady)baiduLayer.contentWindow.postMessage({type:'stop'},'*');
});
$('track-dialog-provider').onchange=e=>{
  if(trackDialogBaiduActive()&&e.target.value!=='baidu')trackDialogFrame.contentWindow.postMessage({type:'stop'},'*');
  trackDialogProvider=e.target.value;applyTrackDialogProvider();
};
$('track-dialog-compare').onclick=async()=>{
  if (!trackDialogDeviceId) return;
  mapSelectedIds.add(trackDialogDeviceId); mapView.fitted=false;
  $('track-comparison').open=true;
  renderMapDeviceChoices();
  try { await refreshSelectedLocations();
    $('track-dialog-status').textContent='已加入浮窗内的多设备轨迹对比，可继续勾选其他设备。';
    $('track-comparison').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) { $('track-dialog-status').textContent=`加入对比失败：${error.message}`; }
};
$('track-comparison').addEventListener('toggle',()=>{
  if($('track-comparison').open)requestAnimationFrame(()=>{mapView.fitted=false;fitMapToTracks();refreshSelectedLocations().catch(e=>{mapMessage=e.message;renderMap();});});
});
function trackExportRows() {
  const device=deviceList.find(d=>d.id===trackDialogDeviceId);
  const task=taskList.find(t=>t.device_id===trackDialogDeviceId);
  return trackDialogPoints.map(p=>({device_name:task?.device_name||device?.name||'',sn:device?.sn||'',
    timestamp:p.report.timestamp,latitude:p.lat,longitude:p.lon,accuracy_m:p.report.accuracy_m??null,status:p.report.status??null}));
}
function trackCsvCell(value) {
  let text=value===null||value===undefined?'':String(value);
  if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
$('track-export').onclick=()=>{
  try {
    if(!trackDialogLoaded||!trackDialogDeviceId)throw Error('请等待轨迹读取完成。');
    trackDialogTimeRange=readMapTimeRange('track-dialog-time-start','track-dialog-time-end');
    $('track-dialog-time-error').textContent='';setTrackDialogReport(trackDialogReport);
    const rows=trackExportRows();if(!rows.length)throw Error('所选时间范围没有可导出的位置。');
    const format=$('track-export-format').value;
    const fields=['device_name','sn','timestamp','latitude','longitude','accuracy_m','status'];
    const content=format==='json'?JSON.stringify(rows,null,2):'\ufeff'+[fields,...rows.map(row=>fields.map(k=>row[k]))].map(row=>row.map(trackCsvCell).join(',')).join('\r\n')+'\r\n';
    const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;
    link.download=`findmy-track-${(rows[0].sn||trackDialogDeviceId).replace(/[^a-zA-Z0-9_-]/g,'_')}.${format}`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    $('track-export-result').textContent=`已导出当前设备 ${rows.length} 个轨迹点（原始经纬度，时间包含时区）。`;
  } catch(error){$('track-export-result').textContent=error.message;}
};
function renderTrackDialogTiles(width,height) {
  const z=trackDialogView.zoom,count=2**z,left=trackDialogView.x-width/2,top=trackDialogView.y-height/2;
  const visible=new Set(),container=$('track-dialog-tiles');
  for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++){
    if(y<0||y>=count)continue;
    const key=`${z}/${x}/${y}`;visible.add(key);
    let tile=[...container.children].find(el=>el.dataset.key===key);
    if(!tile){tile=document.createElement('img');tile.dataset.key=key;tile.alt='';tile.draggable=false;tile.referrerPolicy='origin';
      tile.src=`https://a.tile.openstreetmap.fr/hot/${z}/${((x%count)+count)%count}/${y}.png`;container.append(tile);}
    tile.style.left=`${x*256-left}px`;tile.style.top=`${y*256-top}px`;
  }
  for(const tile of [...container.children])if(!visible.has(tile.dataset.key))tile.remove();
}
function renderTrackDialogFallback() {
  if (!trackDialog.open || trackDialogBaiduActive()) return;
  const element=$('track-dialog-map'),width=element.clientWidth,height=element.clientHeight;
  if(!width||!height)return;
  if(!trackDialogView.x&&!trackDialogView.y){const center=projectMap(22.54,114.06,trackDialogView.zoom);
    trackDialogView.x=center.x;trackDialogView.y=center.y;}
  renderTrackDialogTiles(width,height);
  const canvas=$('track-dialog-canvas'),ratio=devicePixelRatio||1;
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
  const coords=trackDialogPoints.map((p,index)=>{const world=projectMap(p.lat,p.lon,trackDialogView.zoom);
    return {...p,index,x:world.x-trackDialogView.x+width/2,y:world.y-trackDialogView.y+height/2};});
  const color=mapColor(trackDialogDeviceId);
  if(coords.length>1){ctx.beginPath();coords.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.strokeStyle=color;ctx.globalAlpha=.8;ctx.lineWidth=2.5;ctx.stroke();ctx.globalAlpha=1;}
  trackDialogScreenPoints=[];
  for(const p of coords){if(p.x< -9||p.x>width+9||p.y< -9||p.y>height+9)continue;
    ctx.beginPath();ctx.arc(p.x,p.y,p.index===trackDialogFocused?8:5,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();trackDialogScreenPoints.push(p);}
  const selected=coords[trackDialogFocused];
  if(selected && selected.x>=0 && selected.x<=width && selected.y>=0 && selected.y<=height)showTrackDialogPopup(selected);
  else $('track-dialog-popup').hidden=true;
}
function fitTrackDialogFallback() {
  if(!trackDialog.open)return;
  const width=$('track-dialog-map').clientWidth||800,height=$('track-dialog-map').clientHeight||480;
  if(!trackDialogPoints.length){renderTrackDialogFallback();return;}
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const p of trackDialogPoints){const point=projectMap(p.lat,p.lon,0);
    minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);
    minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
  let zoom=2;
  for(let candidate=16;candidate>=2;candidate--)if((maxX-minX)*2**candidate<=Math.max(80,width-100)
    &&(maxY-minY)*2**candidate<=Math.max(80,height-100)){zoom=candidate;break;}
  trackDialogView.zoom=zoom;trackDialogView.x=(minX+maxX)/2*2**zoom;trackDialogView.y=(minY+maxY)/2*2**zoom;
  renderTrackDialogFallback();
}
function showTrackDialogPopup(point) {
  const popup=$('track-dialog-popup'),rect=$('track-dialog-map').getBoundingClientRect();
  popup.hidden=false;
  const title=document.createElement('strong'),detail=document.createElement('div');
  title.textContent=taskList.find(t=>t.device_id===trackDialogDeviceId)?.device_name||'设备位置';
  detail.textContent=`${point.report.timestamp.replace('T',' ').replace('+08:00','')}（北京时间）\n${point.lat.toFixed(7)}, ${point.lon.toFixed(7)}\n精度：${point.report.accuracy_m ?? '—'} 米 · status：${point.report.status ?? '—'}`;
  popup.replaceChildren(title,detail);
  popup.style.left=`${Math.max(8,Math.min(point.x+12,rect.width-220))}px`;
  popup.style.top=`${Math.max(8,Math.min(point.y+12,rect.height-110))}px`;
}
function focusTrackDialogPoint(index) {
  const p=trackDialogPoints[index];if(!p)return;
  trackDialogFocused=index;
  $('track-dialog-points').querySelectorAll('button').forEach(button=>button.classList.remove('active'));
  const button=[...$('track-dialog-points').querySelectorAll('button')][trackDialogPoints.length-1-index];
  button?.classList.add('active');
  if(trackDialogBaiduActive())trackDialogFrame.contentWindow.postMessage({type:'focus',id:trackDialogDeviceId,index},'*');
  else {trackDialogView.zoom=Math.max(16,trackDialogView.zoom);
    const center=projectMap(p.lat,p.lon,trackDialogView.zoom);trackDialogView.x=center.x;trackDialogView.y=center.y;
    renderTrackDialogFallback();}
}
$('track-dialog-fit').onclick=()=>{
  trackDialogFocused=-1;renderTrackDialogList();$('track-dialog-popup').hidden=true;
  if(trackDialogBaiduActive())trackDialogFrame.contentWindow.postMessage({type:'fit'},'*');
  else fitTrackDialogFallback();
};
function zoomTrackDialog(delta) {
  if(trackDialogBaiduActive())trackDialogFrame.contentWindow.postMessage({type:'zoom',delta},'*');
  else {const next=Math.max(2,Math.min(18,trackDialogView.zoom+delta)),scale=2**(next-trackDialogView.zoom);
    trackDialogView.x*=scale;trackDialogView.y*=scale;trackDialogView.zoom=next;renderTrackDialogFallback();}
}
$('track-dialog-zoom-in').onclick=()=>zoomTrackDialog(1);
$('track-dialog-zoom-out').onclick=()=>zoomTrackDialog(-1);
$('track-dialog-map').addEventListener('wheel',e=>{if(trackDialogBaiduActive())return;e.preventDefault();zoomTrackDialog(e.deltaY<0?1:-1);},{passive:false});
$('track-dialog-map').addEventListener('pointerdown',e=>{
  if(trackDialogBaiduActive()||e.button!==0||e.target.closest('button,a,.map-popup'))return;
  trackDialogDrag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
  $('track-dialog-map').setPointerCapture(e.pointerId);
});
$('track-dialog-map').addEventListener('pointermove',e=>{
  if(!trackDialogDrag||trackDialogDrag.id!==e.pointerId)return;
  const dx=e.clientX-trackDialogDrag.x,dy=e.clientY-trackDialogDrag.y;
  if(Math.abs(dx)+Math.abs(dy)>3)trackDialogDrag.moved=true;
  trackDialogDrag.x=e.clientX;trackDialogDrag.y=e.clientY;
  if(trackDialogDrag.moved){trackDialogView.x-=dx;trackDialogView.y-=dy;renderTrackDialogFallback();}
});
$('track-dialog-map').addEventListener('pointerup',e=>{
  if(!trackDialogDrag||trackDialogDrag.id!==e.pointerId)return;
  const moved=trackDialogDrag.moved;trackDialogDrag=null;if(moved)return;
  const rect=$('track-dialog-map').getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
  const hit=[...trackDialogScreenPoints].reverse().find(p=>Math.hypot(p.x-x,p.y-y)<=9);
  if(hit)focusTrackDialogPoint(hit.index);else{$('track-dialog-popup').hidden=true;trackDialogFocused=-1;renderTrackDialogList();}
});
$('track-dialog-map').addEventListener('pointercancel',()=>{trackDialogDrag=null;});
window.addEventListener('resize',()=>{if(trackDialog.open&&!trackDialogBaiduActive())renderTrackDialogFallback();});
function taskState(s) {
  if (!s.configured) return '未设置';
  if (s.running && !s.enabled) return '已暂停，正在完成本次';
  return {running:'正在拉取', paused:'已暂停', retrying:'等待重试', queued:'排队中', waiting:'等待执行'}[s.state] || s.state;
}
function updateTaskSelection() {
  const count = selectedTaskIds.size;
  const pageTasks = visibleTasks();
  const pageSelected = pageTasks.filter(t => selectedTaskIds.has(t.device_id)).length;
  $('task-selection-count').textContent = `已选 ${count} 台${count ? '（跨页保留）' : ''}`;
  $('task-batch-edit').disabled = $('task-batch-delete').disabled = count === 0;
  $('task-clear-selection').disabled = count === 0;
  $('task-select-all').checked = pageTasks.length > 0 && pageSelected === pageTasks.length;
  $('task-select-all').indeterminate = pageSelected > 0 && pageSelected < pageTasks.length;
  $('task-select-all').disabled = pageTasks.length === 0;
}
function filteredTasks() {
  const query=taskSearch.trim().toLocaleLowerCase(),devices=new Map(deviceList.map(d=>[d.id,d]));
  const field=$('task-sort').value,direction=$('task-sort-direction').value==='desc'?-1:1;
  const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  const value=t=>field==='name'?t.device_name:field==='sn'?devices.get(t.device_id)?.sn:field==='latest_location'?(t.latest_location?Date.parse(t.latest_location):null):t[field];
  return taskList.filter(t=>[t.device_name,t.sn,devices.get(t.device_id)?.sn].some(v=>String(v??'').toLocaleLowerCase().includes(query))).sort((a,b)=>{
    const av=value(a),bv=value(b);if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
    return direction*(av==null?0:['name','sn'].includes(field)?collator.compare(String(av),String(bv)):av-bv)||collator.compare(a.device_name,b.device_name)||a.device_id.localeCompare(b.device_id);
  });
}
function visibleTasks() {
  return filteredTasks().slice((taskPage - 1) * taskPageSize, taskPage * taskPageSize);
}
function renderTaskPagination() {
  const count=filteredTasks().length;
  const pages = Math.max(1, Math.ceil(count / taskPageSize));
  taskPage = Math.min(Math.max(taskPage, 1), pages);
  const first = count ? (taskPage - 1) * taskPageSize + 1 : 0;
  const last = Math.min(taskPage * taskPageSize, count);
  $('task-page-summary').textContent = `${taskSearch.trim()?`匹配 ${count} / 共 ${taskList.length} 台`:`共 ${count} 台`} · 第 ${first}–${last} 台 · ${taskPage} / ${pages} 页`;
  $('task-page-size').value = String(taskPageSize);
  $('task-page-first').disabled = $('task-page-prev').disabled = taskPage === 1;
  $('task-page-last').disabled = $('task-page-next').disabled = taskPage === pages;
}
function renderSchedule(data) {
  scheduleData = data;
  taskList = data.tasks;
  $("apple-total").textContent=taskList.length;$("apple-enabled").textContent=taskList.filter(t=>t.enabled).length;$("apple-locations").textContent=taskList.reduce((n,t)=>n+t.history_count,0);$("apple-running").textContent=data.running_device_ids?.length?"正在查询 "+data.running_device_ids.length+" 台":"空闲";
  renderTaskPagination();
  const ids = new Set(taskList.map(t => t.device_id));
  for (const id of selectedTaskIds) if (!ids.has(id)) selectedTaskIds.delete(id);
  $('schedule-status').textContent = `已启用 ${taskList.filter(t => t.enabled).length} 个任务 · ${(data.running_device_ids || []).length ? `正在并发查询 ${data.running_device_ids.length} 台（最多 ${data.max_concurrency || 10} 台）` : '等待任务到期'}。各设备独立计时，时间均为北京时间。`;
  $('schedule-error').textContent = data.cooldown_until > Date.now()/1000 ? `Apple 请求限流，自动任务统一等待至 ${dateText(data.cooldown_until)}。` : '';
  $('task-list').replaceChildren(...visibleTasks().map(t => {
    const row = document.createElement('tr');
    const selection = document.createElement('td'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = selectedTaskIds.has(t.device_id);
    checkbox.setAttribute('aria-label', `选择 ${t.device_name}`);
    checkbox.onchange = () => { if (checkbox.checked) selectedTaskIds.add(t.device_id); else selectedTaskIds.delete(t.device_id); updateTaskSelection(); };
    selection.append(checkbox); row.append(selection);
    const device=deviceList.find(d=>d.id===t.device_id);
    const identity=document.createElement('td');
    const name=document.createElement('strong');name.textContent=t.device_name;
    const snLine=document.createElement('div');snLine.className='small';snLine.textContent='SN: '+(device?.sn||t.sn||'--');
    const macLine=document.createElement('div');macLine.className='small';macLine.textContent='MAC: '+(device?.public_key_hex ? (device.mac_address?.toUpperCase().replace(/:/g,'')||'--') : '--');
    const nameLine=document.createElement('div');nameLine.className='apple-name-line';const rename=document.createElement('button');rename.type='button';rename.className='apple-rename';rename.title='修改名称';rename.setAttribute('aria-label','修改名称 '+t.device_name);rename.textContent='✎';rename.onclick=()=>{openTaskEdit(t.device_id);$('task-edit-name').focus();};nameLine.append(name,rename);
    identity.append(nameLine,snLine,macLine);row.append(identity);
    const stateCell=document.createElement('td'),stateBadge=document.createElement('span');stateBadge.className='apple-status-chip '+(t.error?'failed':t.enabled?'enabled':'paused');stateBadge.textContent=taskState(t);stateCell.append(stateBadge);row.append(stateCell);
    for (const text of [String(t.history_count), t.latest_location ? new Date(t.latest_location).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '--']) {
      const td = document.createElement('td'); td.textContent = text; row.append(td);
    }
    row.children[4].title = '最新位置记录的时间（北京时间），不是查询时间';
    const actions = document.createElement('td');
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = '编辑';
    edit.onclick = () => openTaskEdit(t.device_id);
    const track = document.createElement('button'); track.type = 'button'; track.className = 'secondary'; track.textContent = '轨迹';
    track.onclick = () => openTrackDialog(t.device_id);
    actions.append(track, edit); row.append(actions); return row;
  }));
  if(!visibleTasks().length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;cell.className='small';cell.textContent=taskSearch.trim()?'没有匹配的设备，请调整名称或 SN。':'暂无设备。';row.append(cell);$('task-list').append(row);}
  updateTaskSelection();
}
$('task-search').addEventListener('input',()=>{taskSearch=$('task-search').value;taskPage=1;if(scheduleData)renderSchedule(scheduleData);});
for (const prefix of ['task-edit','task-batch','sn-add']) $(`${prefix}-form`).onsubmit=e=>e.preventDefault();
function openTaskEdit(id) {
  const t = taskList.find(item => item.device_id === id);
  if (!t) return;
  editingTaskId = id;
  $('task-edit-id').textContent = `设备 ID：${id} · 当前状态：${taskState(t)}`;
  $('task-edit-name').value = t.device_name;
  $('task-edit-error').textContent = t.error ? `最近错误：${t.error}` : '最近错误：无';
  $('task-edit-dialog').showModal();
}
async function saveTaskEdit(mode) {
  if (!$('task-edit-form').reportValidity()) return;
  const id = editingTaskId, t = taskList.find(item => item.device_id === id);
  if (!t) throw new Error('设备已不存在，请刷新页面');
  const name = $('task-edit-name').value.trim();
  const enabled = mode === 'start' ? true : mode === 'pause' ? false : t.enabled;
  if (mode !== 'save' || !t.configured) {
    await api('schedule', {device_id:id, enabled});
  }
  if (name !== t.device_name) await api(`devices/${id}/rename`, {name});
  await refreshDevices(); renderSchedule(await api('schedule'));
  $('task-edit-dialog').close();
  notice(`${name}：${mode === 'start' ? '已启动拉取' : mode === 'pause' ? '已暂停拉取' : '修改已保存'}。`);
}
for (const mode of ['save', 'start', 'pause']) {
  const button = $(`task-edit-${mode}`);
  button.onclick = () => run(button, () => saveTaskEdit(mode));
}
async function deleteTaskDevice(id) {
  await api(`devices/${id}`, undefined, 'DELETE');
  selectedTaskIds.delete(id);
}
$('task-edit-delete').onclick = () => {
  const id = editingTaskId, t = taskList.find(item => item.device_id === id);
  if (!t || !confirm(`确定删除设备「${t.device_name}」及其拉取任务？设备密钥会从列表移除。历史位置保留在统一数据库中，可通过数据库导出分析；请先备份仍需使用的设备密钥。`)) return;
  run($('task-edit-delete'), async () => {
    await deleteTaskDevice(id);
    await refreshDevices(); renderSchedule(await api('schedule'));
    $('task-edit-dialog').close(); notice(`已删除 ${t.device_name} 及其拉取任务；历史位置缓存保留。`);
  });
};
$('task-select-all').onchange = e => {
  visibleTasks().forEach(t => {
    if (e.target.checked) selectedTaskIds.add(t.device_id); else selectedTaskIds.delete(t.device_id);
  });
  $('task-list').querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = e.target.checked; });
  updateTaskSelection();
};
$('task-clear-selection').onclick = () => {
  selectedTaskIds.clear();
  if (scheduleData) renderSchedule(scheduleData);
};
for(const id of ['task-sort','task-sort-direction'])$(id).onchange=()=>{taskPage=1;if(scheduleData)renderSchedule(scheduleData);};
$('task-page-size').onchange = e => {
  const size = Number(e.target.value);
  if (![10, 20, 50, 100].includes(size)) return;
  taskPageSize = size; taskPage = 1;
  if (scheduleData) renderSchedule(scheduleData);
};
for (const [id, page] of [
  ['first', () => 1], ['prev', () => taskPage - 1], ['next', () => taskPage + 1],
  ['last', () => Math.max(1, Math.ceil(filteredTasks().length / taskPageSize))]
]) {
  $(`task-page-${id}`).onclick = () => {
    taskPage = page();
    if (scheduleData) renderSchedule(scheduleData);
  };
}
$('task-batch-edit').onclick = () => {
  $('task-batch-summary').textContent = `将对所选 ${selectedTaskIds.size} 台设备启动或停止查询任务。`;
  $('task-batch-dialog').showModal();
};
async function configureSelected(enabled) {

  const ids = [...selectedTaskIds], failed = [];
  for (const [index, id] of ids.entries()) {
    if (index % 10 === 0) notice(`正在设置：${index + 1}/${ids.length}…`);
    try { await api('schedule', {device_id:id, enabled}); }
    catch (e) { failed.push(`${taskList.find(t => t.device_id === id)?.device_name || id}：${e.message}`); }
  }
  renderSchedule(await api('schedule'));
  if (failed.length) notice(`成功 ${ids.length - failed.length} 台，失败 ${failed.length} 台：${failed.slice(0,3).join('；')}`, true);
  else { $('task-batch-dialog').close(); notice(`已为 ${ids.length} 台设备${enabled ? '启动' : '暂停'}。`); }
}
for (const mode of ['start', 'pause']) {
  const button = $(`task-batch-${mode}`);
  button.onclick = () => run(button, () => configureSelected(mode === 'start'));
}
$('task-batch-delete').onclick = () => {
  const ids = [...selectedTaskIds];
  if (!ids.length || !confirm(`确定删除所选 ${ids.length} 台设备及其拉取任务？设备密钥会从列表移除。历史位置保留在统一数据库中，可通过数据库导出分析；请先备份仍需使用的设备密钥。`)) return;
  run($('task-batch-delete'), async () => {
    const failed = [];
    for (const [index, id] of ids.entries()) {
      if (index % 10 === 0) notice(`正在删除：${index + 1}/${ids.length}…`);
      try { await deleteTaskDevice(id); } catch (e) { failed.push(`${taskList.find(t => t.device_id === id)?.device_name || id}：${e.message}`); }
    }
    await refreshDevices(); renderSchedule(await api('schedule'));
    if (failed.length) notice(`已删除 ${ids.length - failed.length} 台，失败 ${failed.length} 台：${failed.slice(0,3).join('；')}`, true);
    else notice(`已删除 ${ids.length} 台设备及其拉取任务；历史位置缓存保留。`);
  });
};
document.querySelectorAll('[data-close-dialog]').forEach(button => {
  button.onclick = () => $(button.dataset.closeDialog).close();
});
$('rename-form').onsubmit = e => { e.preventDefault(); run(e.submitter, async () => {
  const id = $('devices').value; if (!id) throw new Error('请先选择设备');
  await api(`devices/${id}/rename`, {name:$('rename-name').value});
  await refreshDevices(id); renderSchedule(await api('schedule')); notice('设备名称已保存。');
}); };
$('devices').addEventListener('change', showPublic);
$('export-select-all').onclick = () => { $('export-devices').querySelectorAll('input').forEach(input => { input.checked = true; }); };
$('export-select-current').onclick = () => { $('export-devices').querySelectorAll('input').forEach(input => { input.checked = input.value === (trackDialogDeviceId||$('devices').value); }); };
$('export-clear').onclick = () => { $('export-devices').querySelectorAll('input').forEach(input => { input.checked = false; }); };
$('sn-add-form').onsubmit = e => { e.preventDefault(); run($('sn-add-submit'), async () => {
  if (!$('sn-add-form').reportValidity()) return;
  const sn = $('sn-add-sn').value.trim();
  const result = await api('keys/import-sn', {sn, enabled:$('sn-add-enabled').checked});
  await refreshDevices(result.device.id);
  renderSchedule(await api('schedule'));
  $('sn-add-result').textContent = `${sn}：${result.created ? '设备已添加' : '已复用原设备'}，使用全局查询间隔，任务${$('sn-add-enabled').checked ? '已启动' : '保持暂停'}。`;
  notice($('sn-add-result').textContent);
  showView('devices');
}); };
const beijingInput = date => new Date(date.getTime() + 8*3600000).toISOString().slice(0,19);
$('export-start').value = beijingInput(new Date(Date.now() - 86400000));
$('export-end').value = beijingInput(new Date());
$('history-export-form').onsubmit = e => { e.preventDefault(); run(e.submitter, async () => {
  const ids = [...$('export-devices').querySelectorAll('input:checked')].map(input => input.value);
  if (!ids.length) throw new Error('请至少勾选一个导出设备');
  const start = $('export-start').value, end = $('export-end').value;
  if (!start || !end || start > end) throw new Error('开始时间不能晚于结束时间');
  const format = $('export-format').value;
  const response = await fetch('/api/locations/export', {method:'POST', headers:{'X-Local-Token':token, 'Content-Type':'application/json'}, body:JSON.stringify({device_ids:ids, start:start+'+08:00', end:end+'+08:00', format})});
  if (!response.ok) { const error = await response.json(); throw new Error(error.detail || '导出失败'); }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url;
  link.download = `findmy-summary-${start.replace(/[:T]/g,'-')}.${format}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  const count = response.headers.get('X-Report-Count');
  $('export-result').textContent = `已导出 ${ids.length} 个设备的汇总、共 ${count} 个位置。范围：${start.replace('T',' ')} 至 ${end.replace('T',' ')}（北京时间）。`;
  notice(count === '0' ? '该时间范围内没有已保存的位置；汇总文件仍保留每台设备的一行，位置数量为 0。' : `已导出 ${ids.length} 台设备的位置汇总。`);
}); };
$('network').onclick = () => run($('network'), async () => {
  const result = await api('network', {});
  $('network-result').replaceChildren();
  for (const c of result.checks) {
    const row = document.createElement('div'), label = document.createElement('span'), value = document.createElement('span');
    const unavailable = c.http_status >= 500 || c.http_status === 429;
    label.textContent = c.name; value.textContent = c.reachable ? `${unavailable ? '服务异常' : '可达'} · HTTP ${c.http_status} · ${c.elapsed_ms}ms` : `失败 · ${c.error}`;
    value.className = c.reachable && !unavailable ? 'ok' : 'bad'; row.append(label, value); $('network-result').append(row);
  }
  notice(result.has_service_errors ? '已连接到接口，但收到服务异常或限流响应，请检查各项 HTTP 状态。' : result.transport_ok ? 'HTTPS 连通性检测通过。登录与位置权限仍需账号验证。' : '部分链路未通过，请检查网络。', !result.transport_ok || result.has_service_errors);
});
$('anisette').onclick = () => run($('anisette'), async () => {
  const data = await api('anisette', {}); notice(data.message, !data.ready);
}, '正在初始化本地 Anisette，首次可能需要几分钟，请勿重复点击…');
$('login-form').onsubmit = e => { e.preventDefault(); run(e.submitter, async () => {
  const body = {username: $('username').value, password: $('password').value};
  $('password').value = '';
  let loginError;
  try { await api('login', body); } catch (error) { loginError = error; } finally { body.password = ''; }
  let s;
  try { s = await refreshAccount(); } catch (error) {
    if (!loginError) throw error;
  }
  if (loginError) throw loginError;
  notice(s.logged_in ? 'Apple ID 登录成功，可以获取位置。' : '请继续本页面的双重验证：选择方式、发送验证码，再提交六位验证码。');
}, '正在向 Apple 登录…'); };
$('send-code').onclick = () => run($('send-code'), async () => {
  await api('2fa/request', {method_id:Number($('methods').value)}); notice('验证码已请求，请在受信任设备或短信中查看。');
});
$('code-form').onsubmit = e => { e.preventDefault(); run(e.submitter, async () => {
  const code = $('code').value; $('code').value = '';
  await api('2fa/submit', {method_id:Number($('methods').value), code});
  const s = await refreshAccount(); notice(s.location_ready ? 'Apple ID 登录成功，已取得 Find My 查询权限，可以获取位置。' : s.logged_in ? '账号登录成功，但 Apple 尚未签发 Find My 查询令牌。' : '验证已提交，请查看账号状态。', s.logged_in && !s.location_ready);
}); };
$('logout').onclick = () => run($('logout'), async () => {
  await api('logout', {}); await refreshAccount(); notice('已清除本地账号会话，设备密钥已保留。');
});
$('generate-form').onsubmit = e => { e.preventDefault(); run(e.submitter, async () => {
  const d = await api('keys/generate', {name:$('device-name').value}); await refreshDevices(d.id);
  notice('密钥已生成并加密保存。请下载备份，再把公钥配置到标签固件。');
}); };
$('import-form').onsubmit = e => { e.preventDefault(); run(e.submitter, async () => {
  const raw = $('import-value').value.trim(), body = {name:$('import-name').value};
  if (raw.startsWith('{')) {
    let obj = JSON.parse(raw); obj = obj.key || obj;
    if (obj.type === 'keypair') body.private_key = obj.private_key; else body.accessory = obj;
  } else body.private_key = raw;
  const d = await api('keys/import', body); $('import-value').value = ''; await refreshDevices(d.id); notice('密钥已导入。');
}); };
$('export').onclick = () => run($('export'), async () => {
  const id = $('devices').value; if (!id) throw new Error('请先生成或导入设备');
  const data = await api(`devices/${id}/export`, {});
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = `findmy-key-${id}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); notice('私钥备份已下载，请妥善保管。');
});
$('fetch').onclick = () => run($('fetch'), async () => {
  const id = $('devices').value; if (!id) throw new Error('请先生成或导入设备');
  const data = await api(`devices/${id}/locations`, {});
  mapSelectedIds.add(id); mapReports.set(id,data); mapVersions.delete(id);
  renderMapDeviceChoices(); fitMapToTracks();
  notice(data.last_fetch_count ? `本次返回 ${data.last_fetch_count} 条，新增 ${data.new_count} 条，累计保存 ${data.count} 条位置报告。` : `本次返回为空，累计空结果 ${data.empty_count} 次；已保留 ${data.count} 条历史位置。`);
}, '正在从苹果云端获取并解密报告，最多等待约两分钟…');
(async () => { try { const s = await refreshAccount(); await refreshDevices(); renderSchedule(await api('schedule')); await refreshSelectedLocations(); if (!s.restore_error && !s.last_auth_error) notice(s.state === 'REQUIRE_2FA' ? '账号和密码已通过，等待双重验证。请在“账号与工具”中提交验证码。' : '本地服务已就绪。可从侧边栏管理设备、添加任务或导出位置。'); } catch(e) {notice(e.message,true);} })();

// Poll only the local cache/status; Apple requests belong to the backend task.
async function pollLocal() {
  try {
    renderSchedule(await api('schedule'));
    await refreshSelectedLocations();
  } catch (e) { $('schedule-error').textContent = `状态刷新失败：${e.message}`; }
  finally { setTimeout(pollLocal, 5000); }
}
setTimeout(pollLocal, 5000);
