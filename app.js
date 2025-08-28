/* Law-Texts-ui — Remote-only catalog reader */
const BASE = (window.LAW_INDEX_BASE || '').replace(/\/+$/, '');
const CATALOG_URL = `${BASE}/catalogs/ingest-catalog.json`;

const elCat  = document.getElementById('catalog');
const elStat = document.getElementById('status');
const elSrc  = document.getElementById('sourcePath');

function say(msg, isErr=false){
  if(elStat){ elStat.textContent = msg || ''; elStat.style.color = isErr ? '#b91c1c' : 'var(--muted)'; }
}

function card(item){
  const el = document.createElement('div'); el.className = 'card-item';

  const t = document.createElement('div');
  t.className = 'item-title';
  t.textContent = item.title || item.slug;
  el.appendChild(t);

  const m = document.createElement('div');
  m.className = 'item-meta';
  m.innerHTML = [
    (item.jurisdiction || '').toUpperCase(),
    item.year ? String(item.year) : '',
    item.reference ? item.reference : ''
  ].filter(Boolean).join(' · ');
  el.appendChild(m);

  const btns = document.createElement('div'); btns.className = 'badges';

  if (item.txt) {
    const a = document.createElement('a');
    a.className = 'badge'; a.textContent = 'TXT';
    a.href = `${BASE}/${item.txt.replace(/^\/+/, '')}`;
    a.target = '_blank'; a.rel = 'noopener';
    btns.appendChild(a);
  }
  if (item.pageMap) {
    const a = document.createElement('a');
    a.className = 'badge'; a.textContent = 'Page-map';
    a.href = `${BASE}/${item.pageMap.replace(/^\/+/, '')}`;
    a.target = '_blank'; a.rel = 'noopener';
    btns.appendChild(a);
  }
  el.appendChild(btns);
  return el;
}

function dedupeBySlug(items){
  const seen = new Set(); const out = [];
  for(const it of items){
    const key = String(it.slug||'').toLowerCase();
    if(!key || seen.has(key)) continue;
    seen.add(key); out.push(it);
  }
  return out;
}

async function boot(){
  try{
    if(elSrc){ elSrc.textContent = new URL(CATALOG_URL).pathname.replace(/^\//,''); }
    say('Loading catalog…');
    const res = await fetch(CATALOG_URL, { cache:'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    const list = dedupeBySlug(Array.isArray(arr) ? arr : []);

    list.sort((a,b)=>(b.year||0)-(a.year||0) || String(a.title).localeCompare(b.title));

    if(elCat){
      elCat.innerHTML = '';
      if(!list.length){
        elCat.innerHTML = '<div class="muted">No items published yet.</div>';
      }else{
        for(const it of list) elCat.appendChild(card(it));
      }
    }
    say(`Loaded ${list.length} item(s).`);
  }catch(e){
    if(elCat) elCat.innerHTML = '';
    say(`Catalog error: ${e.message}`, true);
  }
}
boot();
