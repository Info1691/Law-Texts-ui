/* Trust Law Textbooks UI (robust) */

const BASE = (window.LAW_INDEX_BASE || '').replace(/\/+$/,''); // https://…/law-index
const REMOTE = `${BASE}/catalogs/ingest-catalog.json`;
const LOCAL  = `texts/catalog.json`; // fallback only if remote fails

const elLib = document.getElementById('library');
const elStatus = document.getElementById('status');
const elFallback = document.getElementById('fallbackNote');

const status = (msg, bad=false)=>{ elStatus.textContent=msg||''; elStatus.style.color=bad?'#b91c1c':'#597089'; };

init().catch(err=>status(`Init error: ${err.message}`,true));

async function init(){
  status('Loading catalog…');
  let items = [], usedFallback = false;

  try{
    const r = await fetch(REMOTE, {cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    items = await r.json();
  }catch(e){
    const r2 = await fetch(LOCAL, {cache:'no-store'});
    if(!r2.ok) throw new Error(`Catalog fetch failed (${e.message}); fallback also HTTP ${r2.status}`);
    items = await r2.json();
    usedFallback = true;
  }

  if(!Array.isArray(items)) items = [];

  // De-dup: by slug (case-insensitive) then by normalized title+jurisdiction+year
  const norm = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const seen = new Set();
  const deduped = [];
  for(const it of items){
    const k1 = it.slug ? `s:${norm(it.slug)}` : '';
    const k2 = `t:${norm(it.title)}|j:${norm(it.jurisdiction)}|y:${it.year||0}`;
    const key = k1 || k2;
    if(seen.has(key)) continue;
    seen.add(key); deduped.push(it);
  }

  // Sort newest first then title
  deduped.sort((a,b)=>(b.year||0)-(a.year||0) || String(a.title).localeCompare(b.title));

  render(deduped);
  elFallback.hidden = !usedFallback;
  status(`Loaded ${deduped.length} item(s).`);
}

function render(items){
  if(!items.length){ elLib.textContent='No items published yet.'; return; }
  elLib.innerHTML='';
  items.forEach(async it=>{
    const card = document.createElement('div'); card.className='card';

    const h = document.createElement('h3'); h.className='card__title';
    h.textContent = String(it.title || it.slug || 'Untitled');

    const meta = document.createElement('div'); meta.className='card__meta';
    const j = (it.jurisdiction||'').toUpperCase();
    const yr = it.year ? ` · ${it.year}` : '';
    const ref = it.reference ? ` — ${it.reference}` : '';
    meta.textContent = `${j}${yr}${ref}`;

    const actions = document.createElement('div'); actions.className='actions';

    // TXT button: use catalog-provided path exactly
    if(it.txt){
      const txtUrl = join(BASE, it.txt);
      actions.appendChild(makeLink('TXT', txtUrl, true));
    }

    // Page-map button: show only if exists; try common variants if none supplied
    const candidates = [];
    if(it.pageMap) candidates.push(join(BASE, it.pageMap));
    else if(it.jurisdiction && it.slug){
      const j = String(it.jurisdiction).trim();
      const s = String(it.slug).trim();
      candidates.push(`${BASE}/page-maps/${j}/${s}.page-map.json`);
      candidates.push(`${BASE}/page-maps/${j}/${s}-law.page-map.json`); // common variant
    }
    const pmUrl = await firstExisting(candidates);
    if(pmUrl) actions.appendChild(makeLink('Page-map', pmUrl, true));

    card.appendChild(h); card.appendChild(meta); card.appendChild(actions);
    elLib.appendChild(card);
  });
}

/* Helpers */
function join(base, path){
  const p = String(path||'').replace(/^\/+/,''); return `${base}/${p}`;
}
async function firstExisting(urls){
  for(const u of urls){
    try{
      const r = await fetch(u, {method:'HEAD', cache:'no-store'});
      if(r.ok) return u;
    }catch{/* ignore */}
  }
  return '';
}
function makeLink(label, url, newTab=false){
  const a = document.createElement('a');
  a.className = label==='TXT' ? 'btn btn--primary' : 'btn';
  a.textContent = label;
  a.href = url;
  if(newTab){ a.target = '_blank'; a.rel = 'noopener'; }
  // Explicit open for iPad/Safari quirks
  a.addEventListener('click', (e)=>{
    if(newTab){
      e.preventDefault();
      window.open(url, '_blank', 'noopener');
    }
  });
  return a;
}
