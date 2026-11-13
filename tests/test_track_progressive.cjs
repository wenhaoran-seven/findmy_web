const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
(async()=>{
const dom=new JSDOM('<meta name="local-token" content="test">',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});w.setInterval=()=>0;
let release,calls=[];const now=Math.floor(Date.now()/1000),points=(a,b)=>Array.from({length:b-a},(_,i)=>({location_id:a+i,timestamp:now-100+a+i,latitude:22,longitude:114,platform:'google'}));
w.fetch=async(url,opts)=>{if(url.includes('location-address'))return {ok:false};calls.push({url,opts});if(calls.length===1)return{ok:true,json:async()=>({reports:points(20,30),total:30,has_more:true,next_cursor:'next'})};return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({reports:points(0,20),total:30,has_more:false})})});};
w.eval(fs.readFileSync(__dirname+'/../assets/findmy-console/unified-track.js','utf8'));const task=w.UnifiedTrack.open({sn:'123456789012',name:'test'}),q=id=>w.document.getElementById('ut-'+id);
while(!release)await new Promise(r=>setTimeout(r,10));
assert.equal(q('list').children.length,10);assert(q('export').disabled);assert(calls[0].url.includes('limit=10'));assert(calls[1].url.includes('limit=200'));
q('list').querySelector('button').click();const selected=q('list').querySelector('.active').textContent;release();await task;
assert.equal(q('list').children.length,20);assert(!q('export').disabled);assert.equal(q('list').querySelector('.active').textContent,selected);
q('time-start').dispatchEvent(new w.Event('change'));const old=calls.at(-1).opts.signal;
q('time-end').dispatchEvent(new w.Event('change'));assert(old.aborted);
dom.window.close();console.log('PASS: first10 before second page, 200 batch, complete-only export, selection retention, superseded request aborted');
})().catch(e=>{console.error(e);process.exit(1)});

