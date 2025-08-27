/* Law-Texts-ui – minimal, robust catalog renderer */

const LAW_INDEX = (window.LAW_INDEX_BASE || '').replace(/\/+$/,'');          // e.g. /law-index
const REMOTE_CATALOG = `${LAW_INDEX}/catalogs/ingest-catalog.json`;
const LOCAL_FALLBACK = `texts/catalog.json`;

const elLib = document.getElementById('library');
const elStatus = document.getElementById('status');
const elFallback = document.getElementById('fallbackNote');

const setStatus = (msg, isError=false) => {
  elStatus.textContent = msg || '';
  elStatus.classList.toggle('error', !!isError);
};

init().catch(err => setStatus(`Init error: ${err.message}`, true));

async function init(){
  setStatus('Loading catalog…');
  let items, usedFallback = false;

  // 1) Prefer remote catalog
  try {
    const r = await fetch(REMOTE_CATALOG, {cache:'no-store'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    items = await r.json();
  } catch (e) {
    // 2) Fallback only if remote fails
    const r2 = await fetch(LOCAL_FALLBACK, {cache:'no-store'});
    if (!r2.ok) throw new Error(`Catalog fetch failed (${e.message}); fallback also HTTP ${r2.status}`);
    items = await r2.json();
    usedFallback = true;
  }

  // Normalize -> array
  if (!Array.isArray(items)) items = [];
  // De-duplicate by slug (case-insensitive) or by normalized title
  const seen = new Map();
  const norm = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  for (const it of items) {
    const key = (it.slug ? norm(it.slug) : `t:${norm(it.title)}`);
    if (!seen.has(key)) seen.set(key, it);
  }
  items = [...seen.values()];

  // Sort newest first, then title
  items.sort((a,b)=> (b.year||0)-(a.year||0) || String(a.title).localeCompare(b.title));

  render(items);
  elFallback.hidden = !usedFallback;
  setStatus(`Loaded ${items.length} item(s).`);
}

function render(items){
  if (!items.length){ elLib.textContent = 'No items published yet.'; return; }
  elLib.innerHTML = '';
  items.forEach(async (it) => {
    const card = document.createElement('div');
    card.className = 'card';

    const h = document.createElement('h3');
    h.className = 'card__title';
    h.textContent = String(it.title || it.slug || 'Untitled');

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    const j = (it.jurisdiction || '').toUpperCase();
    const y = it.year ? ` · ${it.year}` : '';
    const ref = it.reference ? ` — ${it.reference}` : '';
    meta.textContent = `${j}${y}${ref}`;

    const actions = document.createElement('div');
    actions.className = 'actions';

    // TXT button – always constructed from catalog field
    if (it.txt){
      const url = joinURL(LAW_INDEX, it.txt);
      const a = document.createElement('a');
      a.className = 'btn btn--primary';
      a.href = url;
      a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'TXT';
      actions.appendChild(a);
    }

    // Page-map button – only show if the file exists
    const pmUrl = pageMapURL(it);
    if (pmUrl){
      const a2 = document.createElement('a');
      a2.className = 'btn';
      a2.textContent = 'Page-map';
      a2.href = pmUrl; a2.target = '_blank'; a2.rel = 'noopener';
      // verify exists (avoid 404 buttons)
      try {
        const head = await fetch(pmUrl, {method:'HEAD', cache:'no-store'});
        if (head.ok) actions.appendChild(a2);
      } catch { /* ignore */ }
    }

    card.appendChild(h);
    card.appendChild(meta);
    card.appendChild(actions);
    elLib.appendChild(card);
  });
}

function pageMapURL(it){
  // Prefer explicit pageMap property if present
  if (it.pageMap) return joinURL(LAW_INDEX, it.pageMap);
  // Otherwise, infer conventional location; caller will verify with HEAD.
  if (it.jurisdiction && it.slug){
    return `${LAW_INDEX}/page-maps/${it.jurisdiction}/${it.slug}.page-map.json`;
  }
  return '';
}

function joinURL(base, path){
  const p = String(path||'').replace(/^\/+/, '');
  return `${base}/${p}`;
}
