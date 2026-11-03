(() => {
 const filters=[...document.querySelectorAll('[data-filter]')];
 const cards=[...document.querySelectorAll('[data-category]')];
 const count=document.getElementById('photo-count');
 function filter(key){
  if(!filters.some(b=>b.dataset.filter===key))key='all';
  filters.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===key)));
  cards.forEach(c=>c.hidden=key!=='all'&&c.dataset.category!==key);
  if(count)count.textContent=`${cards.filter(c=>!c.hidden).length} project photographs`;
 }
 filters.forEach(b=>b.addEventListener('click',()=>{filter(b.dataset.filter);const u=new URL(location.href);if(b.dataset.filter==='all')u.searchParams.delete('service');else u.searchParams.set('service',b.dataset.filter);history.replaceState(null,'',u)}));
 if(filters.length)filter(new URLSearchParams(location.search).get('service')||'all');
 const dialog=document.getElementById('photo-dialog');
 if(!dialog)return;
 document.querySelectorAll('[data-photo]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const img=a.querySelector('img');dialog.querySelector('img').src=a.href;dialog.querySelector('img').alt=img.alt;dialog.querySelector('p').textContent=img.alt;dialog.showModal()}));
 dialog.querySelector('button').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
})();
