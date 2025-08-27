/* Trust Law Textbooks — Catalog loader
   Remote-first (law-index) with local fallback (./texts/catalog.json)
   Also de-dupes items case-insensitively by slug. */

const LAW_INDEX_BASE = (window.LAW_INDEX_BASE || 'https://info1691.github.io/law-index').replace(/\/+$/,'');
const REMOTE_URL     = `${LAW_INDEX_BASE}/catalogs/ingest-catalog.json`;
const LOCAL_URL      = './texts/catalog.json';

const elLib   = document.getElementById('library');
const elList  = document.getElementById('catalogList');
const elStat  = document.getElementById('status');

boot();

async function boot(){
  setStatus('Loading catalog…');
  const items = await loadWithFallback();
  if(!items.length){
    setStatus('No items published yet.', true);
    elLib.textContent = 'No items published yet.';
    return;
  }
  const deduped = dedupeBySlug(items);
  renderLibrary(deduped);
  renderCatalog(deduped);
  setStatus(`Loaded ${deduped.length} item(s).`);
}

async function loadWithFallback(){
  // Try remote law-index first, then local file if remote 404/500/etc.
  try {
    const r = await fetch(REMOTE_URL, { cache:'no-store' });
    if(!r.ok) throw new Error(`remote ${r.status}`);
    return await r.json();
  } catch(_e){
    try {
      const r2 = await fetch(LOCAL_URL, { cache:'no-store' });
      if(!r2.ok) throw new Error(`local ${r2.status}`);
      return await r2.json();
    } catch(e2){
      setStatus(`Catalog error: ${String(e2.message || e2)}`, true);
      elLib.textContent = 'Failed to load catalog.';
      return [];
    }
  }
}

function dedupeBySlug(items){
  const seen = new Set();
  const out = [];
  for(const it of items){
    const key = String(it.slug||'').trim().toLowerCase();
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.sort((a,b)=>(b.year||0)-(a.year||0) || String(a.title).localeCompare(b.title));
}

function renderLibrary(items){
  elLib.innerHTML = '';
  for(const it of items){
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'item';
    a.textContent = `${it.title} ${(it.jurisdiction||'').toUpperCase()}${it.year?' · '+it.year:''}`;
    a.onclick = (ev)=>{ ev.preventDefault(); scrollToCard(it.slug); };
    elLib.appendChild(a);
  }
}

function renderCatalog(items){
  elList.innerHTML = '';
  for(const it of items){
    const card = document.createElement('div');
    card.className = 'card catalog book';
    card.id = `book-${safeId(it.slug)}`;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const t1 = document.createElement('div');
    t1.className = 'title';
    t1.textContent = it.title;

    const t2 = document.createElement('div');
    t2.className = 'byline';
    t2.textContent = [
      (it.jurisdiction||'').toUpperCase(),
      it.year ? `• ${it.year}` : '',
      it.reference ? `• ${it.reference}` : ''
    ].filter(Boolean).join(' ');

    meta.appendChild(t1);
    meta.appendChild(t2);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if(it.txt){
      const btnTxt = document.createElement('a');
      btnTxt.className = 'btn';
      btnTxt.textContent = 'TXT';
      btnTxt.href = join(LAW_INDEX_BASE, it.txt);
      btnTxt.target = '_blank'; btnTxt.rel = 'noopener';
      actions.appendChild(btnTxt);
    }
    if(it.pageMap){
      const btnMap = document.createElement('a');
      btnMap.className = 'btn';
      btnMap.textContent = 'Page-map';
      btnMap.href = join(LAW_INDEX_BASE, it.pageMap);
      btnMap.target = '_blank'; btnMap.rel = 'noopener';
      actions.appendChild(btnMap);
    }

    card.appendChild(meta);
    card.appendChild(actions);
    elList.appendChild(card);
  }
}

function setStatus(msg, isError=false){
  if(!elStat) return;
  elStat.textContent = msg || '';
  elStat.style.color = isError ? '#ef4444' : 'var(--muted)';
}

function scrollToCard(slug){
  const el = document.getElementById(`book-${safeId(slug)}`);
  if(el) el.scrollIntoView({ behavior:'smooth', block:'center' });
}

function safeId(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-'); }
function join(a,b){
  const left  = String(a||'').replace(/\/+$/,'');
  const right = String(b||'').replace(/^\/+/,'');
  return `${left}/${right}`;
}
