(function(){
  const ph = {
    'id-card':'🪪','earphones':'🎧','wallet':'👛','book':'📕','bottle':'🍶','charger':'🔌','keys':'🔑','bag':'🎒','other':'📦'
  };
  let items = [];
  let loaded = false;

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function showToast(msg){
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 2200);
  }

  function uid(){ return 'i_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }

  async function loadItems(){
    $('#boardGrid').innerHTML = '<div class="loading-state">Loading the board…</div>';
    try{
      const res = await window.storage.get('lost-found-items', true);
      items = res && res.value ? JSON.parse(res.value) : [];
    }catch(e){
      items = [];
    }
    loaded = true;
    renderAll();
  }

  async function saveItems(){
    try{
      const res = await window.storage.set('lost-found-items', JSON.stringify(items), true);
      if(!res) showToast('Could not save — try again');
    }catch(e){
      showToast('Could not save — try again');
    }
  }

  // ---------- tabs ----------
  $$('nav.tabs button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('nav.tabs button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      $$('.panel').forEach(p=>p.classList.remove('active'));
      $('#panel-'+btn.dataset.tab).classList.add('active');
      if(btn.dataset.tab==='board') renderBoard();
      if(btn.dataset.tab==='matches') renderMatches();
    });
  });

  // ---------- report form ----------
  let currentType = 'lost';
  $$('.type-toggle button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.type-toggle button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
      $('#submitBtn').textContent = currentType==='lost' ? 'Pin to board' : 'Pin to board';
    });
  });

  // default time to now
  function setDefaultTime(){
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('#f-time').value = now.toISOString().slice(0,16);
  }
  setDefaultTime();

  let photoDataUrl = null;
  function resetPhotoDrop(){
    $('#photoDrop').innerHTML = '<span id="photoDropText">Tap to upload a photo</span><input type="file" accept="image/*" id="f-photo">';
  }
  function handlePhotoFile(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(ev){
      const img = new Image();
      img.onload = function(){
        const maxDim = 420;
        let w = img.width, h = img.height;
        if(w > h && w > maxDim){ h = h*(maxDim/w); w = maxDim; }
        else if(h > maxDim){ w = w*(maxDim/h); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        photoDataUrl = canvas.toDataURL('image/jpeg', 0.72);
        $('#photoDrop').innerHTML = '<img src="'+photoDataUrl+'"><input type="file" accept="image/*" id="f-photo">';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  // Event delegation so this keeps working after the input inside #photoDrop is replaced.
  $('#photoDrop').addEventListener('change', (e)=>{
    if(e.target && e.target.id === 'f-photo'){
      handlePhotoFile(e.target.files[0]);
    }
  });

  $('#itemForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = $('#f-title').value.trim();
    const location = $('#f-location').value.trim();
    const time = $('#f-time').value;
    if(!title || !location || !time){ showToast('Fill in the item, location and time'); return; }

    const btn = $('#submitBtn');
    btn.disabled = true; btn.textContent = 'Pinning…';

    const item = {
      id: uid(),
      type: currentType,
      category: $('#f-category').value,
      title,
      description: $('#f-desc').value.trim(),
      location,
      time,
      contact: $('#f-contact').value.trim(),
      photo: photoDataUrl,
      status: 'open',
      createdAt: Date.now()
    };
    items.unshift(item);
    await saveItems();

    btn.disabled = false; btn.textContent = 'Pin to board';
    $('#itemForm').reset();
    setDefaultTime();
    photoDataUrl = null;
    resetPhotoDrop();

    const matchCount = countMatchesFor(item);
    showToast(matchCount > 0
      ? 'Pinned — ' + matchCount + ' possible match' + (matchCount>1?'es':'') + ' found'
      : 'Pinned to the board');
    renderAll();
  });

  // ---------- matching engine ----------
  function norm(s){ return (s||'').toLowerCase().trim(); }
  function words(s){ return new Set(norm(s).split(/[^a-z0-9]+/).filter(w=>w.length>2)); }
  function jaccard(a,b){
    const wa = words(a), wb = words(b);
    if(wa.size===0 || wb.size===0) return 0;
    let inter=0; wa.forEach(w=>{ if(wb.has(w)) inter++; });
    const union = new Set([...wa,...wb]).size;
    return union ? inter/union : 0;
  }
  function locationScore(a,b){
    const na=norm(a), nb=norm(b);
    if(!na||!nb) return 0;
    if(na===nb) return 1;
    if(na.includes(nb)||nb.includes(na)) return 0.75;
    return jaccard(a,b);
  }
  function timeScore(t1,t2){
    const d1=new Date(t1), d2=new Date(t2);
    if(isNaN(d1)||isNaN(d2)) return 0;
    const hrs = Math.abs(d2-d1)/36e5;
    if(hrs<=1) return 1;
    if(hrs<=3) return 0.8;
    if(hrs<=6) return 0.6;
    if(hrs<=24) return 0.35;
    if(hrs<=72) return 0.15;
    return 0;
  }
  function score(lost, found){
    const cat = (lost.category && lost.category===found.category) ? 1 : 0;
    const loc = locationScore(lost.location, found.location);
    const time = timeScore(lost.time, found.time);
    const text = jaccard(lost.title+' '+lost.description, found.title+' '+found.description);
    return Math.round(cat*30 + loc*30 + time*20 + text*20);
  }

  function computeMatches(){
    const lost = items.filter(i=>i.type==='lost' && i.status==='open');
    const found = items.filter(i=>i.type==='found' && i.status==='open');
    const pairs = [];
    lost.forEach(l=>{
      found.forEach(f=>{
        const s = score(l,f);
        if(s >= 35) pairs.push({lost:l, found:f, score:s});
      });
    });
    pairs.sort((a,b)=>b.score-a.score);
    return pairs;
  }

  function countMatchesFor(item){
    if(item.type==='lost'){
      return items.filter(i=>i.type==='found' && i.status==='open' && score(item,i)>=35).length;
    }else{
      return items.filter(i=>i.type==='lost' && i.status==='open' && score(i,item)>=35).length;
    }
  }

  // ---------- rendering ----------
  function fmtTime(t){
    const d = new Date(t);
    if(isNaN(d)) return t;
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' · ' + d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  }

  function renderStats(){
    const open = items.filter(i=>i.status==='open');
    const lost = open.filter(i=>i.type==='lost').length;
    const found = open.filter(i=>i.type==='found').length;
    const matches = computeMatches().length;
    $('#statsBar').innerHTML = `
      <div class="stat"><b>${lost}</b>lost</div>
      <div class="stat"><b>${found}</b>found</div>
      <div class="stat"><b>${matches}</b>matches</div>
    `;
  }

  let boardFilter = 'all';
  $('#boardFilters').addEventListener('click', (e)=>{
    if(e.target.tagName!=='BUTTON') return;
    boardFilter = e.target.dataset.f;
    $$('#boardFilters button').forEach(b=>b.classList.remove('active'));
    e.target.classList.add('active');
    renderBoard();
  });

  function renderBoard(){
    let list = items;
    if(boardFilter==='lost') list = items.filter(i=>i.type==='lost' && i.status==='open');
    else if(boardFilter==='found') list = items.filter(i=>i.type==='found' && i.status==='open');
    else if(boardFilter==='resolved') list = items.filter(i=>i.status==='resolved');
    else list = items.filter(i=>i.status==='open');

    const grid = $('#boardGrid');
    if(list.length===0){
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">
        <h3>Nothing here yet</h3>
        <p>Items you or others pin will show up on this board.</p>
      </div>`;
      return;
    }
    grid.innerHTML = list.map(itemCardHTML).join('');
    grid.querySelectorAll('[data-resolve]').forEach(b=>b.addEventListener('click', ()=>toggleResolved(b.dataset.resolve)));
    grid.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click', ()=>deleteItem(b.dataset.delete)));
  }

  function itemCardHTML(item){
    const photo = item.photo
      ? `<img src="${item.photo}" alt="">`
      : `<span class="ph-icon" style="font-size:34px;">${ph[item.category]||'📦'}</span>`;
    return `
      <div class="tag-card ${item.type} ${item.status==='resolved'?'resolved':''}">
        <span class="stamp">${item.type==='lost'?'🔴 LOST':'🟢 FOUND'}</span>
        ${item.status==='resolved' ? '<span class="resolved-flag">CLAIMED</span>' : ''}
        <div class="tag-photo">${photo}</div>
        <div class="tag-body">
          <h4>${escapeHtml(item.title)}</h4>
          <div class="tag-meta">
            <span>📍 ${escapeHtml(item.location)}</span>
            <span>🕐 ${fmtTime(item.time)}</span>
          </div>
          ${item.description ? `<div class="tag-desc">${escapeHtml(item.description)}</div>` : ''}
          ${item.contact ? `<div class="tag-desc" style="color:var(--ink-soft);">✎ ${escapeHtml(item.contact)}</div>` : ''}
          <div class="tag-actions">
            ${item.status==='open' ? `<button data-resolve="${item.id}">Mark claimed</button>` : `<button data-resolve="${item.id}">Reopen</button>`}
            <button class="danger" data-delete="${item.id}">Remove</button>
          </div>
        </div>
      </div>`;
  }

  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  async function toggleResolved(id){
    const it = items.find(i=>i.id===id);
    if(!it) return;
    it.status = it.status==='open' ? 'resolved' : 'open';
    await saveItems();
    renderAll();
    showToast(it.status==='resolved' ? 'Marked as claimed' : 'Reopened');
  }

  async function deleteItem(id){
    items = items.filter(i=>i.id!==id);
    await saveItems();
    renderAll();
    showToast('Removed from board');
  }

  function renderMatches(){
    const pairs = computeMatches();
    const box = $('#matchesList');
    if(pairs.length===0){
      box.innerHTML = `<div class="empty">
        <h3>No matches yet</h3>
        <p>Once a lost item and a found item look alike in category, location, time or description, they'll pair up here.</p>
      </div>`;
      return;
    }
    box.innerHTML = pairs.map(p => matchRowHTML(p)).join('');
    box.querySelectorAll('[data-resolve-pair]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const [lid,fid] = b.dataset.resolvePair.split('|');
        const l = items.find(i=>i.id===lid), f = items.find(i=>i.id===fid);
        if(l) l.status='resolved';
        if(f) f.status='resolved';
        await saveItems();
        renderAll();
        showToast('Both items marked as claimed');
      });
    });
  }

  function matchRowHTML(p){
    const l = p.lost, f = p.found;
    const lThumb = l.photo ? `<img src="${l.photo}">` : `<span style="font-size:22px;">${ph[l.category]||'📦'}</span>`;
    const fThumb = f.photo ? `<img src="${f.photo}">` : `<span style="font-size:22px;">${ph[f.category]||'📦'}</span>`;
    return `
      <div class="match-row">
        <div class="match-item">
          <div class="thumb">${lThumb}</div>
          <div>
            <p class="m-title">🔴 ${escapeHtml(l.title)}</p>
            <div class="m-meta">📍 ${escapeHtml(l.location)}<br>🕐 ${fmtTime(l.time)}${l.contact?'<br>✎ '+escapeHtml(l.contact):''}</div>
          </div>
        </div>
        <div class="match-center">
          <div class="string"></div>
          <div class="score-stamp"><b>${p.score}%</b><span>MATCH</span></div>
          <button class="resolve-both" data-resolve-pair="${l.id}|${f.id}">Mark both claimed</button>
        </div>
        <div class="match-item found-side">
          <div class="thumb">${fThumb}</div>
          <div>
            <p class="m-title">🟢 ${escapeHtml(f.title)}</p>
            <div class="m-meta">📍 ${escapeHtml(f.location)}<br>🕐 ${fmtTime(f.time)}${f.contact?'<br>✎ '+escapeHtml(f.contact):''}</div>
          </div>
        </div>
      </div>`;
  }

  function renderAll(){
    renderStats();
    renderBoard();
    renderMatches();
  }

  loadItems();
})();