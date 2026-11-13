(() => {
 const button=document.querySelector('[data-export-location-database]');if(!button)return;
 button.onclick=async()=>{button.disabled=true;const note=document.querySelector('[data-location-database-status]');note.textContent='正在生成数据库快照…';
 try{const response=await fetch('/api/location-database/export',{headers:{'X-Local-Token':document.querySelector('meta[name="local-token"]').content}});if(!response.ok)throw Error('导出失败，请稍后重试');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='findmy-locations-'+new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace(/[:T]/g,'-')+'.sqlite3';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);note.textContent='已导出完整 SQLite 数据库，包含 Apple 和三个 Google 账号的位置、来源及地址缓存。';}catch(error){note.textContent=error.message;}finally{button.disabled=false;}};
})();
