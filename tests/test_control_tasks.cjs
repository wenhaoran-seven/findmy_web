const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('assets/findmy-console/console.js','utf8');
const api=source.slice(source.indexOf('async function api('),source.indexOf('\nconst proxy='));
async function run(responses){const calls=[];const ctx={token:'test',Error,JSON,Promise,setTimeout:fn=>fn(),fetch:async(path,opt)=>{calls.push({path,opt});return {ok:true,json:async()=>responses.shift()};}};vm.createContext(ctx);vm.runInContext(api,ctx);return {ctx,calls};}
(async()=>{
 let {ctx,calls}=await run([{control_task:'id'},{state:'running'},{state:'done',code:200,result:{ok:true}}]);
 assert.equal((await ctx.api('accounts/apple1/proxy/login',{})).ok,true);assert.equal(calls.length,3);assert.equal(calls[0].opt.headers['X-Control-Async'],'1');
 ({ctx}=await run([{control_task:'id'},{state:'uncertain',code:409,result:{detail:'unknown outcome'}}]));
 await assert.rejects(()=>ctx.api('accounts/apple1/proxy/login',{}),/unknown outcome/);
 console.log('PASS: control task waits for completion, uncertain outcome is not success');
})().catch(e=>{console.error(e);process.exit(1);});
