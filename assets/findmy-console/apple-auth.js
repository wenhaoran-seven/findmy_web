/* Explicit Apple authentication progress and recoverable 2FA steps. */
function setupAppleAuth(a){
 const host=$('auth-body');host.innerHTML=`<p id="apple-auth-status" role="status" aria-live="polite">正在读取账号状态…</p><p id="apple-auth-error" role="alert" class="danger"></p><button id="apple-status">刷新登录状态</button><form id="apple-login"><label>Apple ID<input id="apple-user" autocomplete="username" required></label><label>密码<input id="apple-pass" type="password" autocomplete="current-password" required></label><button>登录</button></form><div id="apple-factor" hidden><p>需要双重验证：选择验证方式 → 发送验证码 → 输入验证码并提交。</p><button id="apple-methods">刷新验证方式</button><select id="apple-method" aria-label="验证方式"></select><button id="apple-request">发送验证码</button><input id="apple-code" placeholder="6 位验证码" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button id="apple-submit">提交验证码</button></div><button id="apple-logout">退出当前账号</button><button id="auth-network">检测网络</button><details><summary>状态详情</summary><pre id="auth-result"></pre></details>`;
 let busy=false,last=null,closed=false;
 const el=id=>host.querySelector('#'+id),live=()=>!closed&&host.contains(el('apple-auth-status'));
 const set=(id,value)=>{if(live())el(id).textContent=value;};
 function render(s){if(!live())return;last=s;el('auth-result').textContent=JSON.stringify(s,null,2);const need=s.state==='REQUIRE_2FA',logged=s.logged_in;
 el('apple-factor').hidden=!need;el('apple-login').hidden=need||logged;
 set('apple-auth-status',need?'需要双重验证，请完成下方验证码操作。':logged?(s.location_ready?'登录成功，位置查询已就绪。':'账号已登录，但位置查询尚未就绪，请查看状态详情。'):'当前未登录，请填写账号和密码。');
 el('apple-request').disabled=busy||!need||!el('apple-method').options.length;el('apple-submit').disabled=busy||!need||!el('apple-method').options.length;
 }
 async function methods(){const ms=await proxy(a.id,'2fa/methods');if(!live())return;el('apple-method').innerHTML=ms.map(m=>`<option value="${m.id}">${esc(m.label)}</option>`).join('');if(!ms.length)throw Error('Apple 未返回可用验证方式，请稍后刷新验证方式。');}
 async function status(){const s=await proxy(a.id,'status');render(s);if(s.state==='REQUIRE_2FA'&&!el('apple-method').options.length)await methods();return s;}
 async function run(message,fn){if(busy||!live())return;busy=true;set('apple-auth-error','');set('apple-auth-status',message);host.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await fn();}catch(e){set('apple-auth-error',e.message);set('apple-auth-status','操作未完成，请刷新登录状态核对进度，不要连续重复登录。');}
 finally{busy=false;if(live()){host.querySelectorAll('button').forEach(b=>b.disabled=false);const need=last?.state==='REQUIRE_2FA';el('apple-request').disabled=!need||!el('apple-method').options.length;el('apple-submit').disabled=!need||!el('apple-method').options.length;}refresh().catch(()=>{});}}
 el('apple-login').onsubmit=e=>{e.preventDefault();run('正在登录 Apple，可能需要等待，请勿重复提交…',async()=>{const password=el('apple-pass').value,username=el('apple-user').value.trim();el('apple-pass').value='';const s=await proxy(a.id,'login',{username,password});render(s);if(s.state==='REQUIRE_2FA')await methods();});};
 el('apple-status').onclick=()=>run('正在核对登录状态…',status);
 el('apple-methods').onclick=()=>run('正在读取验证方式…',async()=>{await methods();render(last);});
 el('apple-request').onclick=()=>run('正在发送验证码…',async()=>{const s=await proxy(a.id,'2fa/request',{method_id:Number(el('apple-method').value)});render(s);if(s.state==='REQUIRE_2FA')set('apple-auth-status','验证码请求已发送，请查看短信或受信任的 Apple 设备，输入 6 位验证码后提交。');});
 el('apple-submit').onclick=()=>run('正在验证验证码…',async()=>{const code=el('apple-code').value.trim();if(!/^\d{6}$/.test(code))throw Error('请输入6位数字验证码');const s=await proxy(a.id,'2fa/submit',{method_id:Number(el('apple-method').value),code});el('apple-code').value='';render(s);});
 el('apple-logout').onclick=()=>{if(confirm('退出此 Apple 账号并暂停它的查询任务？'))run('正在退出…',async()=>{const s=await proxy(a.id,'logout',{});el('apple-method').replaceChildren();render(s);});};
 el('auth-network').onclick=()=>run('正在检测网络…',async()=>{const r=await proxy(a.id,'network',{});set('auth-result',JSON.stringify(r,null,2));set('apple-auth-status','网络检测完成，请展开状态详情。');});
 $('auth').addEventListener('close',()=>{closed=true;},{once:true});
 run('正在读取账号状态…',status);
}
