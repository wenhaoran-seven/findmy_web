/* Shared Apple-style single-SN track dialog, used by all four platforms. */
(() => {
  let dialog, frame, canvas, tiles, options, rows=[], shown=[], serial=0, ready=false, playing=false, aborter, mapTimer, mapFailed=false, timeInitialized=false;
  let view={zoom:12,x:0,y:0}, hits=[], drag=null, focus=-1, listLimit=20;
  const listBatchSize=20;
  let loading=false, earliestTime=null;
  const q=id=>dialog.querySelector('#ut-'+id);
  const time=t=>new Date(t*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const origin=()=>document.querySelector('meta[name="map-origin"]')?.content || 'http://localhost:8765';
  const text=(id,s)=>{q(id).textContent=s;};
  const post=data=>frame.contentWindow?.postMessage(data,origin());
  function build(){
    dialog=document.createElement('dialog');dialog.className='unified-track';dialog.setAttribute('aria-labelledby','ut-title');
    dialog.innerHTML=`<header><div><div class="ut-step">单设备轨迹</div><h2 id="ut-title"></h2><p id="ut-status" role="status"></p></div><button id="ut-close" type="button">关闭</button></header>

      <form id="ut-range" class="ut-tools"><label><input aria-label="开始时间（北京时间）" id="ut-time-start" type="datetime-local" step="60"></label><label><input aria-label="结束时间（北京时间）" id="ut-time-end" type="datetime-local" step="60"></label><button id="ut-clear" type="button">全部时间</button><span id="ut-error" role="alert"></span><div class="ut-export-tools ut-range-export"><button type="button" id="ut-export" disabled aria-expanded="false" aria-controls="ut-export-menu">导出当前设备轨迹</button><div id="ut-export-menu" hidden><button type="button" data-export-format="csv">CSV（Excel 可打开）</button><button type="button" data-export-format="json">JSON</button></div></div></form>

      <p id="ut-warning" role="status"></p><div class="ut-body"><div id="ut-map"><div id="ut-tiles"></div><canvas id="ut-canvas"></canvas><iframe id="ut-frame" title="单设备百度轨迹地图" sandbox="allow-scripts allow-same-origin" referrerpolicy="origin"></iframe><div id="ut-loading" role="status">百度地图加载中…</div><div id="ut-zoom"><button id="ut-in">+</button><button id="ut-out">−</button></div></div><aside><div class="ut-tools ut-list-tools"><span id="ut-count" role="status"></span><label><select id="ut-source" aria-label="位置来源"><option value="all">全部平台</option><option value="apple">Apple</option><option value="google">Google</option></select></label></div><ol id="ut-list"></ol></aside></div>
      <div class="ut-tools"><label><select id="ut-duration" aria-label="轨迹回放时长"><option value="15" selected>15 秒</option><option value="30">30 秒</option><option value="60">60 秒</option><option value="120">120 秒</option></select></label><button id="ut-play" type="button">回放</button><progress id="ut-progress" max="100" value="0"></progress><span id="ut-play-status"></span><select id="ut-provider" aria-label="底图" style="margin-left:auto"><option value="baidu">百度地图</option><option value="osm">OpenStreetMap</option></select></div><p id="ut-attribution"></p>`;
    document.body.append(dialog);frame=q('frame');canvas=q('canvas');tiles=q('tiles');
    q('close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{serial++;aborter?.abort();post({type:'stop'});if(document.fullscreenElement===dialog)document.exitFullscreen().catch(()=>{});dialog.classList.remove('ut-expanded');options?.closeTime?.();});
    q('range').onsubmit=e=>{e.preventDefault();loadRows();};q('source').onchange=loadRows;q('time-start').onchange=loadRows;q('time-end').onchange=loadRows;
    q('clear').onclick=()=>{const now=Date.now(),format=ms=>new Date(ms+8*3600000).toISOString().slice(0,16);let earliest=earliestTime==null?Infinity:earliestTime*1000;for(const p of rows){if(Number.isFinite(p.timestamp))earliest=Math.min(earliest,p.timestamp*1000);}q('time-start').value=Number.isFinite(earliest)?format(earliest):'';q('time-end').value=format(now);options.refreshTime?.(q('time-start'));options.refreshTime?.(q('time-end'));loadRows();};
    q('provider').onchange=()=>{post({type:'stop'});if(q('provider').value==='baidu'&&mapFailed)loadMap();mapDisplay();};
    q('play').onclick=()=>{if(active())post({type:playing?'stop':'play',id:'track',duration:Number(q('duration').value)});};
    dialog.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>post({type:b.dataset.action,id:'track'}));
    const listPane=q('list').parentElement;
    listPane.addEventListener('scroll',()=>{if(listLimit<shown.length&&listPane.scrollTop+listPane.clientHeight>=listPane.scrollHeight-100){listLimit=Math.min(shown.length,listLimit+listBatchSize);renderList();}},{passive:true});
    q('export').onclick=()=>{const menu=q('export-menu');menu.hidden=!menu.hidden;q('export').setAttribute('aria-expanded',String(!menu.hidden));};
    q('export-menu').onclick=e=>{const b=e.target.closest('[data-export-format]');if(!b)return;closeExport();exportRows(b.dataset.exportFormat);};
    dialog.addEventListener('click',e=>{if(!e.target.closest('.ut-export-tools'))closeExport();});
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape'&&!q('export-menu').hidden){e.preventDefault();e.stopPropagation();closeExport();}});
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
      if(e.data.type==='baidu-ready'){clearTimeout(mapTimer);ready=true;mapFailed=false;if(dialog.open)mapDisplay();}
      if(e.data.type==='baidu-error'&&!ready)mapFailure();
      if(e.data.type==='location-selected'&&e.data.id==='track'&&Number.isInteger(e.data.index)&&shown[e.data.index]){focus=e.data.index;listLimit=Math.max(listLimit,Math.ceil((shown.length-focus)/listBatchSize)*listBatchSize);renderList();q('list').querySelector('.active')?.scrollIntoView({block:'nearest'});refreshAddress();}
      if(e.data.type==='map-state'){playing=!!e.data.playingId;q('progress').value=e.data.progress||0;text('play-status',playing?(e.data.status||''):'');text('play',playing?'停止回放':'回放');}
    });
  }
  function closeExport(){q('export-menu').hidden=true;q('export').setAttribute('aria-expanded','false');}
  function mapFailure(){clearTimeout(mapTimer);mapFailed=true;ready=false;if(dialog.open&&q('provider').value==='baidu'){q('provider').value='osm';mapDisplay();text('play-status','百度地图暂时不可用，已切换备用底图。');}}
  function loadMap(){clearTimeout(mapTimer);mapFailed=false;ready=false;frame.src=origin()+'/baidu-map?v=20261112-small-markers';mapTimer=setTimeout(()=>{if(!ready)mapFailure();},15000);}
  function active(){return ready&&q('provider').value==='baidu';}
  function mapDisplay(fitView=true){
    if(!dialog.open||!options)return;
    const on=active(),osm=q('provider').value==='osm';frame.hidden=osm;tiles.hidden=canvas.hidden=q('zoom').hidden=!osm;q('loading').hidden=on||osm;
    dialog.querySelectorAll('[data-action]').forEach(b=>b.disabled=!on||!shown.length);q('play').disabled=!on||!shown.length;
    text('attribution',!on&&!osm?'':on?'':'底图 © OpenStreetMap 贡献者；HOT 样式由 OpenStreetMap France 提供。备用底图支持缩放和平移，回放需切换至百度地图。');
    if(on){post({type:'tracks',groups:[{id:'track',name:options.name,color:'#207cbb',points:shown.map(p=>({lon:p.longitude,lat:p.latitude,time:new Date(p.timestamp*1000+8*3600000).toISOString().replace('Z','+08:00'),accuracy:p.accuracy_m,status:p.status,source:p.source_label}))}]});if(fitView)post({type:'fit'});if(shown[focus])post({type:'focus',id:'track',index:focus});}else if(osm){if(fitView)fit();else draw();}
  }
  function range(){
    const a=q('time-start').value,b=q('time-end').value;
    const start=a?Date.parse(a+':00+08:00')/1000:-Infinity,end=b?Date.parse(b+':00+08:00')/1000+59.999:Infinity;
    if(Number.isNaN(start)||Number.isNaN(end)||start>end)throw Error('请选择有效时间范围，开始时间不能晚于结束时间。');
    return {start,end};
  }
  function apply(append=false){
    const selected=shown[focus],scrollTop=q('list').parentElement.scrollTop;
    let r;try{r=range();text('error','');}catch(e){text('error',e.message);return;}
    post({type:'stop'});const source=q('source').value;
    shown=rows.filter(p=>p.timestamp>=r.start&&p.timestamp<=r.end&&(source==='all'||p.platform===source||p.source===source));
    focus=append&&selected?shown.indexOf(selected):-1;if(!append)listLimit=listBatchSize;renderList();q('list').parentElement.scrollTop=append?scrollTop:0;closeExport();q('export').disabled=loading||!shown.length;mapDisplay(!append);
  }
  function renderList(){
    text('count',`共 ${shown.length} 个位置`);const list=q('list'),pane=list.parentElement,scrollTop=pane.scrollTop;list.replaceChildren();
    const end=shown.length-1,stop=Math.max(-1,end-listLimit);
    for(let i=end;i>stop;i--){const p=shown[i],li=document.createElement('li'),b=document.createElement('button'),detail=document.createElement('small');
      b.type='button';b.classList.toggle('active',i===focus);
      const heading=document.createElement('span'),stamp=document.createElement('span'),source=document.createElement('span');
      heading.className='ut-list-heading';stamp.textContent=time(p.timestamp);source.className='ut-list-source';source.textContent=p.platform==='apple'?'Apple':'Google';heading.append(stamp,source);b.append(heading);
      detail.textContent=`${p.latitude.toFixed(7)}, ${p.longitude.toFixed(7)}`;
      const extra=document.createElement('small');
      extra.textContent=p.reverse_address?.found?p.reverse_address.address:(p.address_status==='empty'?'附近暂未找到地址':'地址正在补全');
      b.append(detail,extra);b.onclick=()=>select(i);li.append(b);list.append(li);
    }
    pane.scrollTop=scrollTop;
  }
  function select(i){focus=i;listLimit=Math.max(listLimit,Math.ceil((shown.length-focus)/listBatchSize)*listBatchSize);renderList();refreshAddress();const p=shown[i];if(active())post({type:'focus',id:'track',index:i});else{const xy=project(p.latitude,p.longitude);view.x=xy.x;view.y=xy.y;draw();}}
  async function refreshAddress(){
    const point=shown[focus];if(options?.readonly||!point?.location_id)return;const current=serial;
    try{
      const response=await fetch('/api/location-address/'+point.location_id,{headers:{'X-Local-Token':document.querySelector('meta[name="local-token"]').content}});
      if(!response.ok)return;const data=await response.json();
      if(serial!==current||!dialog.open)return;
      point.address_status=data.status;if(data.address)point.reverse_address=data.address;
      if(shown[focus]===point){renderList();}
    }catch{}
  }
  function project(lat,lon,z=view.zoom){const size=256*2**z,rad=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;return{x:(lon+180)/360*size,y:(1-Math.asinh(Math.tan(rad))/Math.PI)/2*size};}
  function fit(){
    if(!dialog.open||q('provider').value!=='osm')return;const rect=q('map').getBoundingClientRect();
    if(!shown.length){view={zoom:4,...project(35,105,4)};draw();return;}
    let pts;for(let z=18;z>=2;z--){pts=shown.map(p=>project(p.latitude,p.longitude,z));const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);const minx=xs.reduce((a,b)=>Math.min(a,b),Infinity),maxx=xs.reduce((a,b)=>Math.max(a,b),-Infinity),miny=ys.reduce((a,b)=>Math.min(a,b),Infinity),maxy=ys.reduce((a,b)=>Math.max(a,b),-Infinity);if((maxx-minx<rect.width-80&&maxy-miny<rect.height-80)||z===2){view={zoom:Math.min(z,shown.length===1?16:18),x:(minx+maxx)/2,y:(miny+maxy)/2};if(view.zoom!==z){view.x/=2**(z-view.zoom);view.y/=2**(z-view.zoom);}break;}}
    draw();
  }
  function zoom(delta){const z=Math.max(2,Math.min(19,view.zoom+delta)),scale=2**(z-view.zoom);view.x*=scale;view.y*=scale;view.zoom=z;draw();}
  function draw(){
    if(!dialog?.open||q('provider').value!=='osm')return;const {width:w,height:h}=q('map').getBoundingClientRect();if(!w||!h)return;
    const scale=devicePixelRatio||1;canvas.width=w*scale;canvas.height=h*scale;const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.clearRect(0,0,w,h);
    tiles.replaceChildren();const left=view.x-w/2,top=view.y-h/2,n=2**view.zoom;
    for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++){
      if(y<0||y>=n)continue;const image=document.createElement('img');image.src=`https://a.tile.openstreetmap.fr/hot/${view.zoom}/${((x%n)+n)%n}/${y}.png`;image.alt='';image.style.left=(x*256-left)+'px';image.style.top=(y*256-top)+'px';tiles.append(image);
    }
    hits=shown.map((p,i)=>{const xy=project(p.latitude,p.longitude);return{x:xy.x-left,y:xy.y-top,i};});
    ctx.strokeStyle='#207cbb';ctx.lineWidth=2;ctx.beginPath();hits.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
    hits.forEach(p=>{ctx.fillStyle=p.i===focus?'#d34a38':shown[p.i].platform==='apple'?'#168557':'#207cbb';ctx.beginPath();ctx.arc(p.x,p.y,p.i===focus?7:4,0,Math.PI*2);ctx.fill();});
  }
  function exportRows(format){
    const data=shown.map(p=>({device_name:options.name,sn:options.sn||'',...p,time_beijing:time(p.timestamp),address:p.reverse_address?.address||'',address_source:p.reverse_address?.provider||''}));if(!data.length)return;
    const fields=['device_name','sn','source_label','platform','source','timestamp','time_beijing','latitude','longitude','altitude','accuracy_m','status','is_own_report','unknown_11','unknown_11_received_at','address','address_source'];
    const cell=v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const body=format==='json'?JSON.stringify(data,null,2):'\ufeff'+[fields,...data.map(p=>fields.map(k=>p[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([body],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`track-${(options.sn||options.id).replace(/[^\w-]/g,'_')}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  async function loadRows(){
    let r;try{r=range();text('error','');}catch(e){text('error',e.message);return;}
    const current=++serial,config=options;aborter?.abort();aborter=new AbortController();
    const signal=aborter.signal;loading=true;rows=[];shown=[];apply();
    text('status','正在读取最新10个位置…');text('warning','');
    let cursor='',first=true;
    try{
      do{
        const params=new URLSearchParams(config.sn?{sn:config.sn}:{device_id:config.id,account_id:config.account_id});
        params.set('limit',first?'10':'200');params.set('platform',q('source').value);
        if(Number.isFinite(r.start))params.set('start',r.start);if(Number.isFinite(r.end))params.set('end',r.end);
        if(cursor)params.set('cursor',cursor);
        const response=await fetch((config.endpoint||'/api/unified-track')+'?'+params,{headers:config.readonly?{}:{'X-Local-Token':document.querySelector('meta[name="local-token"]').content},signal});
        const data=await response.json();if(!response.ok)throw Error(data.detail||'读取失败');
        if(serial!==current||!dialog.open)return;
        if(first)earliestTime=data.earliest??null;
        const ids=new Set(rows.map(p=>p.location_id).filter(x=>x!=null));
        const incoming=data.reports.filter(p=>p.location_id==null||!ids.has(p.location_id)).map(p=>({...p,source:p.platform,source_label:p.platform==='apple'?'Apple':'Google'}));
        rows.push(...incoming);rows.sort((a,b)=>a.timestamp-b.timestamp||(a.location_id||0)-(b.location_id||0));
        cursor=data.has_more?data.next_cursor:'';
        if(data.has_more&&!cursor)throw Error('缺少后续分页游标');
        loading=!!cursor;apply(!first);first=false;
        text('status',loading?`已加载 ${rows.length} / ${data.total} 个位置，正在加载其余位置…`:`已读取 ${rows.length} 条位置；筛选不会触发云端查询。`);
        text('warning',(data.warnings||[]).join(' '));
        // Yield a frame so the first ten points are painted before the next request.
        if(cursor)await new Promise(resolve=>setTimeout(resolve,50));
        if(serial!==current||!dialog.open)return;
      }while(cursor);
    }catch(e){if(serial===current&&e.name!=='AbortError'){loading=false;text('status',`已保留 ${rows.length} 个位置，后续读取失败：`+e.message);text('warning','轨迹尚未完整加载，导出已禁用；请重新选择时间范围重试。');q('export').disabled=true;}}
  }
  function preload(){
    if(document.visibilityState==='hidden')return;
    if(dialog)return;
    build();dialog.classList.add('ut-preloading');dialog.setAttribute('aria-hidden','true');dialog.inert=true;
    loadMap();
  }
  function schedulePreload(){
    if('requestIdleCallback' in window)window.requestIdleCallback(preload,{timeout:5000});
    else setTimeout(preload,1500);
  }
  if(document.readyState==='complete')schedulePreload();
  else window.addEventListener('load',schedulePreload,{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!dialog)schedulePreload();});
  window.UnifiedTrack={async open(config){
    options=config;if(!dialog)build();if(!timeInitialized){config.initTime?.('ut-time-start','选择开始时间');config.initTime?.('ut-time-end','选择结束时间');timeInitialized=true;}dialog.classList.remove('ut-preloading');dialog.removeAttribute('aria-hidden');dialog.inert=false;
    const current=++serial;aborter?.abort();aborter=new AbortController();rows=[];shown=[];playing=false;q('progress').value=0;q('duration').value='15';q('source').value='all';q('provider').value='baidu';const openedAt=Date.now(),beijingInput=ms=>new Date(ms+8*3600000).toISOString().slice(0,16);q('time-start').value=beijingInput(openedAt-24*3600000);q('time-end').value=beijingInput(openedAt);config.refreshTime?.(q('time-start'));config.refreshTime?.(q('time-end'));text('error','');text('warning','');text('title',`${config.name} · SN ${config.sn||'--'}`);text('status','正在合并已保存的 Apple / Google 位置…');text('play-status','');if(!dialog.open)dialog.showModal();if(!frame.src||mapFailed)loadMap();apply();requestAnimationFrame(()=>{if(dialog.open)post({type:'resize'});});
    earliestTime=null;await loadRows();
  }};
})();
