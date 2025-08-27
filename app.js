/* Law-Texts-ui — Catalog reader (remote-only) */
const BASE = (window.LAW_INDEX_BASE || '').replace(/\/+$/, '');
const CATALOG_URL = `${BASE}/catalogs/ingest-catalog.json`;

const elCat   = document.getElementById('catalog');
const elStat  = document.getElementById('status');
const elSrc   = document.getElementById('sourcePath');

function say(msg, isErr=false){
  elStat.textContent = msg || '';
  elStat.style.color = isErr ? '#b91c1c' : 'var(--muted)';
}

function card(item){
  const el = document.createElement('div');
  el.className = 'card-item';

  const title = document.createElement('div');
  title.className = 'item-title';
  title.textContent = item.title || item.slug;
  el.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'item-meta';
  meta.innerHTML = [
    (item.jurisdiction || '').toUpperCase(),
    item.year ? String(item.year) : '',
    item.reference ? item.reference : ''
  ].filter(Boolean).join(' · ');
  el.appendChild(meta);

  const btns = document.createElement('div'); btns.className = 'badges';
  if (item.txt) {
    const a = document.createElement('a');
    a.className = 'badge';
    a.textContent = 'TXT';
    a.href = `${BASE}/${item.txt.replace(/^\/+/, '')}`;
    a.target = '_blank';
    btns.appendChild(a);
  }
  if (item.pageMap) {
    const a = document.createElement('a');
    a.className = 'badge';
    a.textContent = 'Page-map';
    a.href = `${BASE}/${item.pageMap.replace(/^\/+/, '')}`;
    a.target = '_blank';
    btns.appendChild(a);
  }
  el.appendChild(btns);
  return el;
}

async function boot(){
  try{
    elSrc.textContent = new URL(CATALOG_URL).pathname.replace(/^\//,'');
    say('Loading catalog…');
    const res = await fetch(CATALOG_URL, { cache:'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    // Defensive: only arrays
    const list = Array.isArray(items) ? items : [];
    // Sort by year desc then title
    list.sort((a,b)=>(b.year||0)-(a.year||0) || String(a.title).localeCompare(b.title));

    elCat.innerHTML = '';
    if(!list.length){
      elCat.innerHTML = '<div class="muted">No items published yet.</div>';
    } else {
      for(const it of list) elCat.appendChild(card(it));
    }
    say(`Loaded ${list.length} item(s).`);
  }catch(e){
    elCat.innerHTML = '';
    say(`Catalog error: ${e.message}`, true);
  }
}
boot();
