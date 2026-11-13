const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
(async()=>{
const dom=new JSDOM('<meta name="local-token" content="test">',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
let idle,fetches=0,initTimes=0;w.requestIdleCallback=fn=>{idle=fn};w.setInterval=()=>0;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});
w.fetch=async()=>{fetches++;return{ok:true,json:async()=>({reports:[]})}};
w.eval(fs.readFileSync(__dirname+'/../assets/findmy-console/unified-track.js','utf8'));w.dispatchEvent(new w.Event('load'));idle();
const frame=w.document.querySelector('#ut-frame'),dialog=w.document.querySelector('dialog'),src=frame.src;
assert(frame&&src.includes('/baidu-map'));assert(!dialog.open);assert(dialog.inert);assert.equal(fetches,0);
let posts=[];frame.contentWindow.postMessage=data=>posts.push(data);
w.dispatchEvent(new w.MessageEvent('message',{origin:'http://localhost:8765',source:frame.contentWindow,data:{type:'baidu-ready'}}));
assert.equal(posts.length,0);assert.equal(fetches,0);
await w.UnifiedTrack.open({sn:'123456789012',name:'test',initTime:()=>initTimes++});
assert.strictEqual(w.document.querySelector('#ut-frame'),frame);assert.equal(frame.src,src);assert.equal(initTimes,2);assert(!dialog.inert);assert(!dialog.classList.contains('ut-preloading'));assert.equal(fetches,1);assert(w.document.querySelector('#ut-loading').hidden);
await w.UnifiedTrack.open({sn:'123456789013',name:'other',initTime:()=>initTimes++});assert.equal(initTimes,2);assert.equal(frame.src,src);assert.equal(w.document.querySelectorAll('#ut-frame').length,1);
dom.window.close();console.log('Idle preload sends no device data; ready iframe and time controls reused on opening');
})().catch(e=>{console.error(e);process.exit(1)});
