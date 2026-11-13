const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
(async()=>{
const dom=new JSDOM('<meta name="local-token" content="test">',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});w.setInterval=()=>0;
w.fetch=async()=>({ok:true,json:async()=>({reports:[{timestamp:Date.now()/1000,latitude:22,longitude:113,platform:'google'}]})});
let downloads=[];w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
w.eval(fs.readFileSync(__dirname+'/../assets/findmy-console/unified-track.js','utf8'));await w.UnifiedTrack.open({sn:'123456789012',name:'test'});
const q=id=>w.document.getElementById('ut-'+id),message=type=>w.dispatchEvent(new w.MessageEvent('message',{origin:'http://localhost:8765',source:q('frame').contentWindow,data:{type}}));
assert(!q('loading').hidden);assert(q('tiles').hidden);assert.equal(q('tiles').children.length,0);assert(!q('export-note'));assert(!q('format'));assert(q('export-menu').hidden);
q('export').click();assert(!q('export-menu').hidden);q('export-menu').querySelector('[data-export-format=json]').click();assert(q('export-menu').hidden);assert(downloads[0].endsWith('.json'));
q('export').click();q('export-menu').querySelector('[data-export-format=csv]').click();assert(downloads[1].endsWith('.csv'));
message('baidu-error');assert.equal(q('provider').value,'osm');assert(!q('tiles').hidden);assert(q('loading').hidden);
q('provider').value='baidu';q('provider').dispatchEvent(new w.Event('change'));assert(!q('loading').hidden);assert(q('tiles').hidden);
message('baidu-ready');assert(q('loading').hidden);assert(!q('frame').hidden);assert(q('tiles').hidden);assert.equal(q('attribution').textContent,'');
message('baidu-error');assert.equal(q('provider').value,'baidu');
dom.window.close();console.log('Map loading, failure fallback, retry, ready and CSV/JSON export passed');
})().catch(e=>{console.error(e);process.exit(1)});
