const fs=require('fs'),vm=require('vm'),assert=require('assert');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('assets/findmy/baidu_map.html','utf8'),dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;w.setTimeout=()=>0;w.parent.postMessage=()=>{};w.BMap_Symbol_SHAPE_POINT=1;
class Marker{constructor(p,o){this.p=p;this.o=o;this.events={};}addEventListener(k,f){this.events[k]=f;}setTop(){}}
w.BMap={Point:class{constructor(lng,lat){Object.assign(this,{lng,lat});}},Symbol:class{constructor(_,o){Object.assign(this,o);}},Polyline:class{},Marker,Geocoder:class{getLocation(p,fn){fn({address:'test'})}}};
const c=dom.getInternalVMContext(),run=s=>vm.runInContext(s,c);run(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
run("map={addOverlay(){},removeOverlay(){},pointToPixel(){return{x:50,y:50}},centerAndZoom(){},getZoom(){return 12}};groups=[{id:'track',name:'test',color:'blue',points:[{lat:22,lon:113},{lat:23,lon:114},{lat:24,lon:115}]}];selectedId='track';draw()");
const highlighted=()=>run("overlays.get('track').filter(x=>x.o?.icon?.strokeWeight===4).map(x=>x.p.lat)");assert.equal(highlighted().length,0);
run("showPointInfo(groups[0],groups[0].points[0],0)");assert.equal(highlighted().length,1);assert.equal(run('focused.index'),0);
run("overlays.get('track').filter(x=>x.events)[1].events.click()");assert.equal(run('focused.index'),1);assert.equal(highlighted().length,1);
w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{type:'focus',id:'track',index:0}}));assert.equal(run('focused.index'),0);assert.equal(highlighted().length,1);run('draw()');assert.equal(highlighted().length,1);assert.equal(run('focused.index'),0);
dom.window.close();console.log('Map click, list focus, selected highlight and redraw retention passed');
