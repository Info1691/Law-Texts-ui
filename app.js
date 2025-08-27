/* Trust Law Textbooks — Catalog app (light, button-first) */

const LAW_INDEX = (window.LAW_INDEX_BASE || '').replace(/\/+$/, '') + '/';
const REMOTE_CATALOG = LAW_INDEX + 'catalogs/ingest-catalog.json';
const LOCAL_FALLBACK = 'texts/catalog.json';

const elLib  = document.getElementById('library');
const elStat = document.getElementById('status');
const elSrc  = document.getElementById('srcPath');

function setStatus(msg, isError=false){
  elStat.textContent = msg || '';
  elStat.style.color = isError ? '#b91c1c' : 'var(--muted)';
}

/* Deduplicate by normalized key; prefer entries that actually have artifacts */
function dedupe(items){
  const pickStr = v => typeof v === 'string' ? v.trim() : '';
  const keyOf = it =>
    (pickStr(it.slug) || (pickStr(it.title)+'|'+(it.year||'')+'|'+pickStr(it.jurisdiction))).toLowerCase();

  const map = new Map();
  for(const it of items){
    const k = keyOf(it);
    const prev = map.get(k);
    if(!prev){ map.set(k, it); continue; }

    // Merge: prefer entries that have txt/pageMap, keep best title/reference
    const merged = { ...prev, ...it };
    merged.txt      = pickStr(it.txt)      || pickStr(prev?.txt)      || '';
    merged.pageMap  = pickStr(it.pageMap)  || pickStr(prev?.pageMap)  || '';
    merged.title    = pickStr(prev?.title) || pickStr(it.title);
    merged.reference= pickStr(prev?.reference) || pickStr(it.reference);
    map.set(k, merged);
  }
  return [...map.values()];
}

function prettyJur(j){ return (j||'').toUpperCase(); }

function card(item){
  const div = document.createElement('div');
  div.className = 'card';

  const h = document.createElement('h2');
  h.textContent = item.title || '(untitled)';
  div.appendChild(h);

  const m = document.createElement('div');
  m.className = 'meta';
  const bits = [];
  if(item.jurisdiction) bits.push(prettyJur(item.jurisdiction));
  if(item.year) bits.push(String(item.year));
  if(item.reference) bits.push(item.reference);
  m.textContent = bits.join(' · ');
  div.appendChild(m);

  const act = document.createElement('div');
  act.className = 'actions';

  if(item.txt){
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = LAW_INDEX + item.txt.replace(/^\/+/, '');
    a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'TXT';
    act.appendChild(a);
  }

  if(item.pageMap){
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = LAW_INDEX + item.pageMap.replace(/^\/+/, '');
    a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Page-map';
    act.appendChild(a);
  }

  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = item.slug || (item.title || '').toLowerCase().replace(/\s+/g,'-');
  act.appendChild(b);

  div.appendChild(act);
  return div;
}

function render(items){
  elLib.innerHTML = '';
  if(!items.length){
    elLib.innerHTML = '<div class="note">No items published yet.</div>';
    return;
  }
  // Sort: newest first, then title
  items.sort((a,b) => (b.year||0)-(a.year||0) || String(a.title).localeCompare(b.title));
  for(const it of items){ elLib.appendChild(card(it)); }
  setStatus(`Loaded ${items.length} item(s).`);
}

async function loadCatalog(){
  // Try remote first
  try{
    elSrc.textContent = 'catalogs/ingest-catalog.json';
    const r = await fetch(REMOTE_CATALOG, { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    render(dedupe(Array.isArray(data)?data:[]));
    return;
  }catch(e){
    setStatus(`Remote catalog error (${e.message}). Trying local fallback…`, true);
  }

  // Fallback (local)
  try{
    elSrc.textContent = 'texts/catalog.json (local fallback)';
    const r = await fetch(LOCAL_FALLBACK, { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    render(dedupe(Array.isArray(data)?data:[]));
  }catch(e){
    setStatus(`Fallback failed: ${e.message}`, true);
    elLib.innerHTML = '<div class="note">Failed to load catalog.</div>';
  }
}

loadCatalog();
