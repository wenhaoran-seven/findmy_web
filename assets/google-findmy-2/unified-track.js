/* Shared Apple-style single-SN track dialog, used by all four platforms. */
(() => {
  let dialog, frame, canvas, tiles, options, rows=[], shown=[], serial=0, ready=false, playing=false, aborter;
  let view={zoom:12,x:0,y:0}, hits=[], drag=null, focus=-1, listPage=0;
  const listPageSize=100;
  const q=id=>dialog.querySelector('#ut-'+id);
  const time=t=>new Date(t*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const origin=()=>document.querySelector('meta[name="map-origin"]')?.content || 'http://localhost:8765';
  const text=(id,s)=>{q(id).textContent=s;};
  const post=data=>frame.contentWindow?.postMessage(data,origin());
  function build(){
    dialog=document.createElement('dialog');dialog.className='unified-track';dialog.setAttribute('aria-labelledby','ut-title');
    dialog.innerHTML=`<header><div><div class="ut-step">单设备轨迹</div><h2 id="ut-title"></h2><p id="ut-status" role="status"></p></div><button id="ut-close" type="button">关闭</button></header>
      <div class="ut-tools"><button id="ut-fit">适应轨迹</button><button data-action="select">选中</button><button data-action="focus-group">聚焦</button><button data-action="move">移动</button><button data-action="reset">归位</button><button id="ut-play">回放</button><button id="ut-fullscreen">全屏轨迹</button><label>底图<select id="ut-provider"><option value="baidu">百度地图</option><option value="osm">OpenStreetMap</option></select></label><label>位置来源<select id="ut-source"><option value="all">全部平台</option><option value="apple">Apple</option><option value="google">Google</option></select></label></div>
      <form id="ut-range" class="ut-tools"><label>开始时间（北京时间）<input id="ut-time-start" type="datetime-local" step="60"></label><label>结束时间（北京时间）<input id="ut-time-end" type="datetime-local" step="60"></label><button type="submit">显示所选时间段</button><button id="ut-clear" type="button">全部时间</button><span id="ut-error" role="alert"></span></form>
      <div class="ut-tools"><label>轨迹明细格式<select id="ut-format"><option value="csv">CSV（Excel 可打开）</option><option value="json">JSON</option></select></label><button id="ut-export" disabled>导出当前设备轨迹</button><span id="ut-export-note"></span></div>
      <p id="ut-warning" role="status"></p><div class="ut-body"><div id="ut-map"><div id="ut-tiles"></div><canvas id="ut-canvas"></canvas><iframe id="ut-frame" title="单设备百度轨迹地图" sandbox="allow-scripts allow-same-origin" referrerpolicy="origin"></iframe><div id="ut-zoom"><button id="ut-in">+</button><button id="ut-out">−</button></div></div><aside><h3>轨迹列表 <span id="ut-count"></span></h3><p>按时间倒序，点击位置可定位到地图。</p><div id="ut-address-panel"><strong id="ut-selected-location">请选择一个位置</strong><p id="ut-address-result">地址将由后台自动补全。</p><p>100 米内共用附近地址，地址仅供参考。</p></div><div class="ut-tools"><button id="ut-list-prev">上一页</button><span id="ut-list-page"></span><button id="ut-list-next">下一页</button></div><ol id="ut-list"></ol></aside></div>
      <div class="ut-tools"><label>轨迹回放时长<select id="ut-duration"><option value="15" selected>15 秒</option><option value="30">30 秒</option><option value="60">60 秒</option><option value="120">120 秒</option></select></label><progress id="ut-progress" max="100" value="0"></progress><span id="ut-play-status"></span></div><p id="ut-attribution"></p>`;
    document.body.append(dialog);frame=q('frame');canvas=q('canvas');tiles=q('tiles');
    q('close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{serial++;aborter?.abort();post({type:'stop'});if(document.fullscreenElement===dialog)document.exitFullscreen().catch(()=>{});dialog.classList.remove('ut-expanded');options?.closeTime?.();});
    q('range').onsubmit=e=>{e.preventDefault();apply();};q('source').onchange=apply;
    q('clear').onclick=()=>{q('time-start').value=q('time-end').value='';options.refreshTime?.(q('time-start'));options.refreshTime?.(q('time-end'));apply();};
    q('fit').onclick=()=>{if(active())post({type:'fit'});else fit();};
    q('provider').onchange=()=>{post({type:'stop'});mapDisplay();};
    q('play').onclick=()=>{if(active())post({type:playing?'stop':'play',id:'track',duration:Number(q('duration').value)});};
    dialog.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>post({type:b.dataset.action,id:'track'}));
    q('fullscreen').onclick=async()=>{try{if(document.fullscreenElement===dialog)await document.exitFullscreen();else await dialog.requestFullscreen();}catch{dialog.classList.toggle('ut-expanded');}setTimeout(()=>{post({type:'resize'});draw();},100);};
    q('list-prev').onclick=()=>{listPage--;renderList();};q('list-next').onclick=()=>{listPage++;renderList();};
    q('export').onclick=exportRows;
    setInterval(()=>{if(dialog.open&&shown[focus])refreshAddress();},15000);
    q('in').onclick=()=>zoom(1);q('out').onclick=()=>zoom(-1);
    q('map').addEventListener('wheel',e=>{if(active())return;e.preventDefault();zoom(e.deltaY<0?1:-1);},{passive:false});
    canvas.addEventListener('pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;view.x-=dx;view.y-=dy;drag.x=e.clientX;drag.y=e.clientY;draw();});
    canvas.addEventListener('pointerup',e=>{if(!drag)return;const moved=drag.moved;drag=null;if(moved)return;const rect=canvas.getBoundingClientRect();const hit=[...hits].reverse().find(p=>Math.hypot(p.x-e.clientX+rect.left,p.y-e.clientY+rect.top)<10);if(hit)select(hit.i);});
    canvas.addEventListener('pointercancel',()=>drag=null);
    window.addEventListener('resize',()=>{if(dialog.open){draw();post({type:'resize'});}});
    window.addEventListener('message',e=>{
      if(e.source!==frame.contentWindow||e.origin!==origin()||!e.data)return;
      if(e.data.type==='baidu-ready'){ready=true;mapDisplay();}
      if(e.data.type==='baidu-error'){ready=false;q('provider').value='osm';mapDisplay();text('play-status','百度地图暂时不可用，已切换备用底图。');}
      if(e.data.type==='location-selected'&&e.data.id==='track'&&Number.isInteger(e.data.index)&&shown[e.data.index]){focus=e.data.index;listPage=Math.floor((shown.length-1-focus)/listPageSize);renderList();renderAddress();refreshAddress();}
      if(e.data.type==='map-state'){playing=!!e.data.playingId;q('progress').value=e.data.progress||0;text('play-status',e.data.status||'');text('play',playing?'停止回放':'回放');}
    });
  }
  function active(){return ready&&q('provider').value==='baidu';}
  function mapDisplay(){
    const on=active();frame.hidden=!on;tiles.hidden=canvas.hidden=q('zoom').hidden=on;
    dialog.querySelectorAll('[data-action]').forEach(b=>b.disabled=!on||!shown.length);q('play').disabled=!on||!shown.length;
    text('attribution',on?'百度地图会接收显示的坐标；导出保留原始 WGS84 经纬度，不包含设备密钥。':'底图 © OpenStreetMap 贡献者；HOT 样式由 OpenStreetMap France 提供。备用底图支持缩放和平移，回放需切换至百度地图。');
    if(on){post({type:'tracks',groups:[{id:'track',name:options.name,color:'#207cbb',points:shown.map(p=>({lon:p.longitude,lat:p.latitude,time:new Date(p.timestamp*1000+8*3600000).toISOString().replace('Z','+08:00'),accuracy:p.accuracy_m,status:p.status,source:p.source_label}))}]});post({type:'fit'});}else fit();
  }
  function range(){
    const a=q('time-start').value,b=q('time-end').value;
    const start=a?Date.parse(a+':00+08:00')/1000:-Infinity,end=b?Date.parse(b+':00+08:00')/1000+59.999:Infinity;
    if(Number.isNaN(start)||Number.isNaN(end)||start>end)throw Error('请选择有效时间范围，开始时间不能晚于结束时间。');
    return {start,end};
  }
  function apply(){
    let r;try{r=range();text('error','');}catch(e){text('error',e.message);return;}
    post({type:'stop'});const source=q('source').value;
    shown=rows.filter(p=>p.timestamp>=r.start&&p.timestamp<=r.end&&(source==='all'||p.platform===source||p.source===source));
    focus=-1;listPage=0;renderList();renderAddress();text('export-note',`当前筛选共 ${shown.length} 个位置点，导出包含来源。`);q('export').disabled=!shown.length;mapDisplay();
  }
  function renderList(){
    text('count',`${shown.length} 个点`);const list=q('list');list.replaceChildren();
    const pages=Math.max(1,Math.ceil(shown.length/listPageSize));listPage=Math.max(0,Math.min(listPage,pages-1));text('list-page',`${listPage+1} / ${pages} 页`);q('list-prev').disabled=listPage===0;q('list-next').disabled=listPage===pages-1;
    const end=shown.length-1-listPage*listPageSize,stop=Math.max(-1,end-listPageSize);
    for(let i=end;i>stop;i--){const p=shown[i],li=document.createElement('li'),b=document.createElement('button'),detail=document.createElement('small');
      b.type='button';b.classList.toggle('active',i===focus);b.textContent=`${time(p.timestamp)} · ${p.source_label}`;
      detail.textContent=`${p.latitude.toFixed(7)}, ${p.longitude.toFixed(7)} · 精度 ${p.accuracy_m??'--'} 米${p.altitude==null?'':` · 高度 ${p.altitude} 米`}`;
      const extra=document.createElement('small');extra.textContent=`Status: ${p.status??'--'}${p.platform==='google'?` · 机主上报: ${p.is_own_report??'--'} · 未知字段11: ${p.unknown_11??'--'}`:''}`;
      b.append(detail,extra);b.onclick=()=>select(i);li.append(b);list.append(li);
    }
  }
  function select(i){focus=i;listPage=Math.floor((shown.length-1-focus)/listPageSize);renderList();renderAddress();refreshAddress();const p=shown[i];if(active())post({type:'focus',id:'track',index:i});else{const xy=project(p.latitude,p.longitude);view.x=xy.x;view.y=xy.y;draw();}}
  function renderAddress(){
    const point=shown[focus];
    text('selected-location',point?`${time(point.timestamp)} · ${point.source_label}`:'请选择一个位置');
    const address=point?.reverse_address;
    text('address-result',address?(address.found?address.address:'附近未找到可用地址')+' · '+address.provider:point?(point.address_status==='retry'?'地址服务暂不可用，后台稍后重试。':point.address_status==='empty'?'附近暂未找到地址，后台将自动重试。':'地址排队补全中…'):'选中位置可查看自动补全的地址。');
  }
  async function refreshAddress(){
    const point=shown[focus];if(!point?.location_id)return;const current=serial;
    try{
      const response=await fetch('/api/location-address/'+point.location_id,{headers:{'X-Local-Token':document.querySelector('meta[name="local-token"]').content}});
      if(!response.ok)return;const data=await response.json();
      if(serial!==current||!dialog.open)return;
      point.address_status=data.status;if(data.address)point.reverse_address=data.address;
      if(shown[focus]===point)renderAddress();
    }catch{}
  }
  function project(lat,lon,z=view.zoom){const size=256*2**z,rad=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;return{x:(lon+180)/360*size,y:(1-Math.asinh(Math.tan(rad))/Math.PI)/2*size};}
  function fit(){
    if(!dialog.open||active())return;const rect=q('map').getBoundingClientRect();
    if(!shown.length){view={zoom:4,...project(35,105,4)};draw();return;}
    let pts;for(let z=18;z>=2;z--){pts=shown.map(p=>project(p.latitude,p.longitude,z));const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);const minx=xs.reduce((a,b)=>Math.min(a,b),Infinity),maxx=xs.reduce((a,b)=>Math.max(a,b),-Infinity),miny=ys.reduce((a,b)=>Math.min(a,b),Infinity),maxy=ys.reduce((a,b)=>Math.max(a,b),-Infinity);if((maxx-minx<rect.width-80&&maxy-miny<rect.height-80)||z===2){view={zoom:Math.min(z,shown.length===1?16:18),x:(minx+maxx)/2,y:(miny+maxy)/2};if(view.zoom!==z){view.x/=2**(z-view.zoom);view.y/=2**(z-view.zoom);}break;}}
    draw();
  }
  function zoom(delta){const z=Math.max(2,Math.min(19,view.zoom+delta)),scale=2**(z-view.zoom);view.x*=scale;view.y*=scale;view.zoom=z;draw();}
  function draw(){
    if(!dialog?.open||active())return;const {width:w,height:h}=q('map').getBoundingClientRect();if(!w||!h)return;
    const scale=devicePixelRatio||1;canvas.width=w*scale;canvas.height=h*scale;const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.clearRect(0,0,w,h);
    tiles.replaceChildren();const left=view.x-w/2,top=view.y-h/2,n=2**view.zoom;
    for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++){
      if(y<0||y>=n)continue;const image=document.createElement('img');image.src=`https://a.tile.openstreetmap.fr/hot/${view.zoom}/${((x%n)+n)%n}/${y}.png`;image.alt='';image.style.left=(x*256-left)+'px';image.style.top=(y*256-top)+'px';tiles.append(image);
    }
    hits=shown.map((p,i)=>{const xy=project(p.latitude,p.longitude);return{x:xy.x-left,y:xy.y-top,i};});
    ctx.strokeStyle='#207cbb';ctx.lineWidth=2;ctx.beginPath();hits.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
    hits.forEach(p=>{ctx.fillStyle=p.i===focus?'#d34a38':shown[p.i].platform==='apple'?'#168557':'#207cbb';ctx.beginPath();ctx.arc(p.x,p.y,p.i===focus?7:4,0,Math.PI*2);ctx.fill();});
  }
  function exportRows(){
    const data=shown.map(p=>({device_name:options.name,sn:options.sn||'',...p,time_beijing:time(p.timestamp),address:p.reverse_address?.address||'',address_source:p.reverse_address?.provider||''}));if(!data.length)return;
    const format=q('format').value,fields=['device_name','sn','source_label','platform','source','timestamp','time_beijing','latitude','longitude','altitude','accuracy_m','status','is_own_report','unknown_11','unknown_11_received_at','address','address_source'];
    const cell=v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const body=format==='json'?JSON.stringify(data,null,2):'\ufeff'+[fields,...data.map(p=>fields.map(k=>p[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([body],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`track-${(options.sn||options.id).replace(/[^\w-]/g,'_')}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);text('export-note',`已导出 ${data.length} 个位置点，包含来源。`);
  }
  window.UnifiedTrack={async open(config){
    options=config;if(!dialog){build();config.initTime?.('ut-time-start','选择开始时间');config.initTime?.('ut-time-end','选择结束时间');}
    const current=++serial;aborter?.abort();aborter=new AbortController();rows=[];shown=[];playing=false;q('progress').value=0;q('duration').value='15';q('source').value='all';q('provider').value='baidu';q('time-start').value=q('time-end').value='';config.refreshTime?.(q('time-start'));config.refreshTime?.(q('time-end'));text('error','');text('warning','');text('title',`${config.name} · SN ${config.sn||'--'}`);text('status','正在合并已保存的 Apple / Google 位置…');text('play-status','');if(!dialog.open)dialog.showModal();if(!frame.src)frame.src=origin()+'/baidu-map';apply();
    try{const params=new URLSearchParams(config.sn?{sn:config.sn}:{device_id:config.id});const response=await fetch((config.endpoint||'/api/unified-track')+'?'+params,{headers:{'X-Local-Token':document.querySelector('meta[name="local-token"]').content},signal:aborter.signal});const data=await response.json();if(!response.ok)throw Error(data.detail||'读取失败');if(serial!==current||!dialog.open)return;
      rows=data.reports.map(p=>({...p,source:p.platform,source_label:p.platform==='apple'?'Apple':'Google'}));apply();text('status',`${config.sn?'按 SN 合并':'当前设备'}，已读取 ${rows.length} 条位置；筛选不会触发云端查询。`);text('warning',(data.warnings||[]).join(' '));
    }catch(e){if(serial===current&&e.name!=='AbortError'){text('status','读取失败：'+e.message);text('warning','未获得完整轨迹，请稍后重试。');}}
  }};
})();
