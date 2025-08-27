/* Robust catalog UI with visible error reporting */

// Global error guard so the page never goes blank silently
window.addEventListener('error', e => showFatal(`JS error: ${e.message}`));
window.addEventListener('unhandledrejection', e => showFatal(`Promise error: ${e.reason}`));

const elCatalog = document.getElementById('catalog');
const elStatus  = document.getElementById('status');
document.getElementById('sourcePath').textContent = 'catalogs/ingest-catalog.json';

function showFatal(msg){
  elStatus.textContent = msg;
  elStatus.classList.remove('muted');
  elStatus.style.color = '#b91c1c';
  elCatalog.innerHTML = '';
}

function setStatus(msg, muted=true){
  elStatus.textContent = msg || '';
  elStatus.classList.toggle('muted', !!muted);
  elStatus.style.color = muted ? '' : '#0f172a';
}

function getLawIndexBase(){
  const qp = new URLSearchParams(location.search);
  const fromParam = qp.get('law-index');
  const base =
    (typeof window.LAW_INDEX_BASE === 'string' && window.LAW_INDEX_BASE) ||
    (fromParam ? fromParam : `${location.origin}/law-index/`);
  return String(base).replace(/\/+$/, '') + '/';
}
const LAW_INDEX = getLawIndexBase();
const PRIMARY_CATALOG = LAW_INDEX + 'catalogs/ingest-catalog.json';
const FALLBACK_LOCAL  = 'texts/catalog.json';

function dedupeBySlug(items){
  const seen = new Set(), out = [];
  for(const it of items){
    const k = String(it.slug||it.title||'').trim().toLowerCase();
    if(!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}
function sortItems(items){
  return items.sort((a,b)=> (b.year||0)-(a.year||0) || String(a.title||'').localeCompare(String(b.title||'')));
}
function textHref(it){ return it?.txt ? LAW_INDEX + String(it.txt).replace(/^\/+/, '') : null; }
function pageMapHref(it){
  if(it?.pageMap) return LAW_INDEX + String(it.pageMap).replace(/^\/+/, '');
  if(!it?.slug || !it?.jurisdiction) return null;
  return LAW_INDEX + `page-maps/${String(it.jurisdiction).toLowerCase()}/${it.slug}.page-map.json`;
}

function render(items){
  elCatalog.innerHTML = '';
  if(!items.length){
    elCatalog.innerHTML = '<div class="card"><div class="meta">No items published yet.</div></div>';
    return;
  }
  for(const it of items){
    const card = document.createElement('div'); card.className='card';
    const h3=document.createElement('h3'); h3.textContent = it.title || it.slug || '(untitled)'; card.appendChild(h3);

    const meta=document.createElement('div'); meta.className='meta';
    const juris=(it.jurisdiction||'').toUpperCase(), year=it.year?` · ${it.year}`:'', ref=it.reference?` — ${it.reference}`:'';
    meta.textContent = `${juris}${year}${ref}`; card.appendChild(meta);

    const pills=document.createElement('div'); pills.className='pills';
    const p=document.createElement('span'); p.className='pill'; p.textContent=it.slug||''; pills.appendChild(p);
    card.appendChild(pills);

    const actions=document.createElement('div'); actions.className='actions';
    const aTxt=document.createElement('a'); aTxt.className='btn'; aTxt.textContent='TXT';
    const txtURL=textHref(it);
    if(txtURL){ aTxt.href=txtURL; aTxt.target='_blank'; aTxt.rel='noopener'; }
    else { aTxt.setAttribute('aria-disabled','true'); }
    actions.appendChild(aTxt);

    const aPM=document.createElement('a'); aPM.className='btn'; aPM.textContent='Page-map';
    const pmURL=pageMapHref(it);
    if(pmURL){ aPM.href=pmURL; aPM.target='_blank'; aPM.rel='noopener'; }
    else { aPM.setAttribute('aria-disabled','true'); }
    actions.appendChild(aPM);

    card.appendChild(actions);
    elCatalog.appendChild(card);
  }
}

async function loadPrimary(){
  setStatus('Loading catalog from law-index …');
  const res = await fetch(PRIMARY_CATALOG, { cache:'no-store' });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = sortItems(dedupeBySlug(Array.isArray(data)?data:[]));
  render(items);
  setStatus(`Loaded ${items.length} item(s) from law-index.`);
}

async function loadFallback(){
  setStatus('Primary unavailable. Trying local fallback…', false);
  const res = await fetch(FALLBACK_LOCAL, { cache:'no-store' });
  if(!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
  document.getElementById('sourcePath').textContent = 'texts/catalog.json (fallback)';
  const data = await res.json();
  const items = sortItems(dedupeBySlug(Array.isArray(data)?data:[]));
  render(items);
  setStatus(`Loaded ${items.length} item(s) from local fallback.`);
}

(async function boot(){
  try { await loadPrimary(); }
  catch(e){
    try { await loadFallback(); }
    catch(e2){ showFatal(`Unable to load any catalog: ${e2.message}`); }
  }
})();
