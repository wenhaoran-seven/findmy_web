const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert');
const html=fs.readFileSync('assets/findmy-console/index.html','utf8'),script=fs.readFileSync('assets/findmy-console/label-print.js','utf8');
const dom=new JSDOM(html,{url:'https://47.106.211.14/',runScripts:'outside-only'}),w=dom.window,doc=w.document;
w.setInterval=()=>0;w.confirm=()=>true;w.AbortSignal.timeout=()=>undefined;
let serial,posted=[],lookups=0;
w.TagSerialTransport=class{constructor(opts){serial=opts;this.connected=false;}async write(){} };
w.fetch=async(url,opt)=>({ok:true,json:async()=>{if(url==='/api/console'){lookups++;return {devices:[{sn:'123456789012',name:'平台名称',mac:'CCBBDDEEFFAA'}]};}if(url.endsWith('/health'))return {ok:true,layout_version:4,name_counting:'han2',font_options:true,paper_options:true,overflow:'omit',optional_mac:true};if(url.endsWith('/jobs')){posted.push(JSON.parse(opt.body));return {status:'spool_complete'};}throw Error(url);}});
w.eval(script);
async function submit(sn,name){doc.getElementById('lp-manual-sn').value=sn;doc.getElementById('lp-manual-name').value=name;await doc.getElementById('lp-manual-form').onsubmit({preventDefault(){}});}
(async()=>{
 await submit('123456789012','手动名称');assert.equal(posted.length,1);assert.equal(posted[0].device_name,'手动名称');assert.equal(posted[0].mac,'CCBBDDEEFFAA');assert.equal(lookups,1);assert(doc.getElementById('lp-rows').textContent.includes('打印完成'));
 await submit('000000000001','未入库设备');assert.equal(posted[1].mac,'');assert.equal(posted[1].sn,'000000000001');assert.equal(posted[1].device_name,'未入库设备');
 await submit('bad','名称');assert.equal(posted.length,2);
 doc.getElementById('lp-auto').checked=false;
 await doc.getElementById('lp-start').onclick();
 serial.feed('OK+SCAN:F6F6F6F6F6F6,-48,0,17,10FF123456789012F1AABBCCDDEEFF0BB8\r\n');
 assert.equal(doc.querySelectorAll('#lp-rows tr').length,3);assert(doc.getElementById('lp-rows').textContent.includes('FFEEDDCCBBAA'));assert.equal(posted.length,2);
 const saved=JSON.parse(w.localStorage.getItem('findmy-f6-printed-v1'));assert(saved.some(r=>r.mac===''&&r.source==='manual'));
 console.log('PASS: manual name preserved, SN MAC lookup, blank MAC, validation, persisted records, serial F6 unaffected; no physical printing');dom.window.close();
})().catch(e=>{console.error(e);process.exit(1);});
