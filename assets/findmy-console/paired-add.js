/* One preview and durable submit for both platforms. */
let addOptions=[],addPreview=null,addPolling=false;
const addNames=()=>Object.fromEntries(addOptions.map(a=>[a.id,a.label]));
function invalidateAddPreview(){addPreview=null;$('add-preview-panel').hidden=true;}
function parseAddText(text){
  const delimiter=text.includes('\t')?'\t':',';let values=[],row=[],cell='',quoted=false;
  if(!text.includes(',')&&!text.includes('\t'))values=text.trim().split(/\r?\n/).filter(Boolean).map(s=>{const m=s.trim().match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);if(!m)throw Error('每行须包含 SN 和 pubkey');return [m[1],m[2],m[3]||''];});
  else{for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===delimiter||c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());cell='';if(c!==delimiter){if(row.some(Boolean))values.push(row);row=[];}}else cell+=c;}if(quoted)throw Error('引号未闭合，请检查输入');row.push(cell.trim());if(row.some(Boolean))values.push(row);}
  const aliases={sn:'sn','设备sn':'sn','序列号':'sn',pubkey:'pubkey',key:'pubkey','公钥':'pubkey','apple公钥':'pubkey',name:'name','名称':'name','设备名称':'name'},head={};
  (values[0]||[]).forEach((v,i)=>{const key=aliases[v.toLowerCase()];if(key)head[key]=i;});
  if(head.sn!==undefined&&head.pubkey!==undefined)values.shift();else Object.assign(head,{sn:0,pubkey:1,name:2});
  return values.map(r=>({sn:r[head.sn]||'',pubkey:r[head.pubkey]||'',name:r[head.name]||''}));
}
async function loadAddOptions(){
  addOptions=await api('paired-add/options');
  for(const platform of ['apple','google']){
    const el=$(platform+'-account'),old=el.value,rows=addOptions.filter(a=>a.platform===platform);
    el.innerHTML=rows.map(a=>{const disabled=!a.available||!a.authorized||(platform==='google'&&!a.free);return `<option value="${esc(a.id)}" ${disabled?'disabled':''}>${esc(a.label)}${platform==='google'?` · 已用 ${a.used}/100 · 空闲 ${a.free}${a.reserved?' · 待添加占位 '+a.reserved:''}`:''}${!a.available?' · 不可用':!a.authorized?' · 未授权':''}</option>`;}).join('');
    const valid=[...el.options].filter(o=>!o.disabled);el.value=valid.some(o=>o.value===old)?old:(valid[0]?.value||'');
    if(old&&old!==el.value)invalidateAddPreview();
  }
  $('add-capacity').textContent=`Google 可用账号共剩余 ${addOptions.filter(a=>a.platform==='google'&&a.available&&a.authorized).reduce((sum,a)=>sum+a.free,0)} 个位置。已有 SN 会在原账号复用，并在预览中注明。`;
}
function showAddPreview(job){
  addPreview=job;const names=addNames(),errors=job.items.filter(i=>i.error);
  $('add-preview-summary').textContent=`共 ${job.items.length} 台，${errors.length} 条错误。${errors.length?'请修正后重新预览。':'请核对账号分配后提交。'}${job.request.unburned?' 新设备声明为未烧录。':' 新设备烧录状态记为未知，不自动进入烧录队列。'}`;
  $('add-preview-rows').innerHTML=job.items.map(i=>`<tr><td>${esc(i.sn)}<small>${esc(i.name)}</small></td><td>${esc(names[i.apple_account]||i.apple_account)}${i.apple_reused?' · 复用':''}</td><td>${esc(names[i.google_account]||i.google_account)}${i.google_reused?' · 复用':''}</td><td class="${i.error?'danger':''}">${esc(i.error||'格式与现有记录核对通过；提交后核对 Apple 密钥')}</td></tr>`).join('');
  $('add-start').disabled=!!errors.length;$('add-start').textContent='添加并启动查询';$('add-preview-panel').hidden=false;
}
$('paired-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{invalidateAddPreview();const body={apple_account:$('apple-account').value,google_account:$('google-account').value,auto_allocate:$('add-auto').checked,unburned:$('add-unburned').checked,rows:parseAddText($('add-rows').value)};if(!body.apple_account||!body.google_account)throw Error('请先准备已授权且有容量的账号');showAddPreview(await api('paired-add/preview',body));});};
for(const id of ['apple-account','google-account','add-auto','add-unburned','add-rows'])$(id).addEventListener(id==='add-rows'?'input':'change',invalidateAddPreview);
$('add-start').onclick=e=>action(e.target,async()=>{if(!addPreview)throw Error('请重新预览');const job=await api('paired-add/'+addPreview.id+'/start',{});invalidateAddPreview();notice(`已提交 ${job.items.length} 台，后台分别添加并开启查询。`);await loadAddJobs();await loadAddOptions();});
$('add-file').onchange=e=>action($('add-preview'),async()=>{invalidateAddPreview();const file=e.target.files[0];if(!file)return;if(file.size>1000000)throw Error('文件最大1MB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const r=await api('paired-add/file',{filename:file.name,content:btoa(binary)});const quote=v=>'"'+String(v||'').replaceAll('"','""')+'"';$('add-rows').value=r.rows.map(r=>[r.sn,r.pubkey,r.name].map(quote).join(',')).join('\n');notice(`已读取 ${r.rows.length} 台，请点击“检查并预览分配”。`);});
$('add-template').onclick=()=>download('\ufeffSN,pubkey,名称\r\n','设备导入模板.csv','text/csv;charset=utf-8');
async function loadAddJobs(){
  const jobs=await api('paired-add'),names=addNames(),labels={pending:'等待处理',registering:'注册中',done:'已开启查询',error:'失败'};
  $('add-jobs').innerHTML=jobs.length?jobs.map(j=>{const done=j.items.filter(i=>i.apple==='done'&&i.google==='done').length,errors=j.items.some(i=>i.apple==='error'||i.google==='error');return `<details ${j.state!=='complete'?'open':''}><summary>${time(j.created_at)} · ${j.state==='complete'?'已结束':j.state==='queued'?'排队中':'执行中'} · 双平台成功 ${done}/${j.items.length}</summary><div class="table-scroll"><table><thead><tr><th>SN / 名称</th><th>Apple</th><th>Google</th></tr></thead><tbody>${j.items.map(i=>`<tr><td>${esc(i.sn)}<small>${esc(i.name)}</small></td><td>${esc(names[i.apple_account]||i.apple_account)} · ${labels[i.apple]}<small>${esc(i.apple==='error'?i.apple_error:'')}</small></td><td>${esc(names[i.google_account]||i.google_account)} · ${labels[i.google]}<small>${esc(i.google==='error'?i.google_error:'')}</small></td></tr>`).join('')}</tbody></table></div>${j.state==='complete'&&errors?`<button data-add-retry="${j.id}">仅重试失败项</button>`:''}</details>`;}).join(''):'<p>暂无添加任务。</p>';
}
$('add-jobs').onclick=e=>{const b=e.target.closest('[data-add-retry]');if(b)action(b,async()=>{await api('paired-add/'+b.dataset.addRetry+'/retry',{});await loadAddJobs();notice('已安排重试未成功的平台，成功项保持不变。');});};
async function refreshAdd(){if(addPolling)return;addPolling=true;try{await loadAddOptions();await loadAddJobs();}catch(e){notice(e.message);}finally{addPolling=false;}}
refreshAdd();setInterval(()=>{if(!$('view-add').hidden)refreshAdd();},5000);
