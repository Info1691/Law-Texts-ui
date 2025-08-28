/* Law-Texts-ui – simple catalog viewer */

const LAW_INDEX = (window.LAW_INDEX_BASE || '').replace(/\/+$/,'');
const CATALOG_URL = window.CATALOG_OVERRIDE
  || (LAW_INDEX ? `${LAW_INDEX}/catalogs/ingest-catalog.json` : 'texts/catalog.json');

const elCatalog = document.getElementById('catalog');
const elStatus  = document.getElementById('status');
const elSourceHint = document.getElementById('sourceHint');

function setStatus(msg,isErr=false){
  elStatus.textContent = msg || '';
  elStatus.style.color = isErr ? '#b91c1c' : 'var(--muted)';
}

function escapeHTML(s){ return String(s).replace(/[&<>]/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])); }

/* Defensive de-duplication (case-insensitive by slug or title) */
function dedupe(items){
  const seen = new Set();
  const out = [];
  for(const it of items){
    const key = ((it.slug || it.title || '').trim()).toLowerCase();
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function loadCatalog(){
  elSourceHint.textContent = `Source: ${CATALOG_URL}${window.CATALOG_OVERRIDE?' (override)':''}`;
  try{
    const res = await fetch(CATALOG_URL, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const items = Array.isArray(raw) ? raw : (raw.items || []);
    render(dedupe(items));
    setStatus(`Loaded ${items.length} item(s).`);
  }catch(e){
    setStatus(`Catalog error: ${e.message}`, true);
  }
}

function render(items){
  elCatalog.innerHTML = '';
  if(!items.length){ elCatalog.innerHTML = '<div class="muted">No items published yet.</div>'; return; }

  items.sort((a,b)=>(b.year||0)-(a.year||0)
                 || String(a.jurisdiction||'').localeCompare(String(b.jurisdiction||''))
                 || String(a.title||'').localeCompare(String(b.title||'')));

  for(const it of items){
    const div = document.createElement('div');
    div.className = 'item';

    const title = escapeHTML(it.title || it.slug || 'Untitled');
    const juris = escapeHTML((it.jurisdiction||'').toUpperCase());
    const by    = escapeHTML(it.reference || '');
    const year  = it.year ? ` • ${it.year}` : '';

    div.innerHTML = `
      <div class="title">${title}</div>
      <div class="meta">${juris}${year}${by ? ' • ' + by : ''}</div>
      <div class="pills"></div>
      <div class="slug">${escapeHTML(it.slug||'')}</div>
    `;

    const pills = div.querySelector('.pills');

    // TXT pill: use a real link so it works on iOS Safari
    if(it.txt){
      const a = document.createElement('a');
      a.className = 'pill';
      a.textContent = 'TXT';
      a.href = (LAW_INDEX ? `/${LAW_INDEX}` : '') + '/' + String(it.txt).replace(/^\/+/,'');
      a.target = '_blank'; a.rel = 'noopener';
      pills.appendChild(a);
    }

    // Page-map pill (optional)
    if(it.pageMap){
      const a = document.createElement('a');
      a.className = 'pill';
      a.textContent = 'Page-map';
      a.href = (LAW_INDEX ? `/${LAW_INDEX}` : '') + '/' + String(it.pageMap).replace(/^\/+/,'');
      a.target = '_blank'; a.rel = 'noopener';
      pills.appendChild(a);
    }

    elCatalog.appendChild(div);
  }
}

loadCatalog();
