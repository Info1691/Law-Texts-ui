<script>
/* Trust Law Textbooks — Reader (resilient catalog fetch + dedupe) */

/* Preferred public base for artifacts (can be overridden by window.LAW_INDEX_BASE) */
const DEFAULT_BASE = 'https://info1691.github.io/law-index';
const LAW_INDEX = (window.LAW_INDEX_BASE || DEFAULT_BASE).replace(/\/+$/, '');

const elLib   = document.getElementById('library');
const elDoc   = document.getElementById('doc');
const elStat  = document.getElementById('status');
const qInput  = document.getElementById('searchInput');
const btnPrev = document.getElementById('findPrev');
const btnNext = document.getElementById('findNext');

let currentText = '';
let hlMatches = [];
let hlIndex = -1;

function setStatus(msg, isError=false){
  elStat.textContent = msg || '';
  elStat.style.color = isError ? '#b91c1c' : 'var(--muted)';
}

function slugKey(s){
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}

async function fetchFirstJSON(urls){
  for(const url of urls){
    try{
      const res = await fetch(url, { cache:'no-store' });
      if(res.ok){
        setStatus(`Catalog: ${new URL(url).pathname}`);
        return await res.json();
      }
    }catch(_){ /* keep trying */ }
  }
  throw new Error('404 on all candidate catalog URLs');
}

async function loadCatalog(){
  try{
    // Try the common placements (any one of these succeeding is enough)
    const candidates = [
      `${LAW_INDEX}/catalogs/ingest-catalog.json`,
      `${LAW_INDEX}/ingest-catalog.json`,
      `${LAW_INDEX}/law-index/catalogs/ingest-catalog.json`,
      `${LAW_INDEX}/law-index/ingest-catalog.json`,
      // absolute fallback if someone serves catalog alongside the UI
      `${location.origin}/texts/catalog.json`
    ];
    const raw = await fetchFirstJSON(candidates);
    const list = Array.isArray(raw) ? raw : [];

    // Dedupe by normalized slug/title; prefer the richer record
    const keep = new Map();
    const score = (x)=> (x?.title?1:0) + (x?.year?1:0) + (x?.txt?1:0);
    for(const it of list){
      const key =
        slugKey(it.slug) ||
        slugKey(it.title) ||
        slugKey(it.txt || it.reference || Math.random().toString(36).slice(2));
      const cur = keep.get(key);
      if(!cur || score(it) >= score(cur)) keep.set(key, it);
    }
    renderLibrary([...keep.values()]);
  }catch(e){
    elLib.textContent = 'Failed to load catalog.';
    setStatus(`Catalog error: ${e.message}`, true);
  }
}

function renderLibrary(items){
  elLib.innerHTML = '';
  if(!items.length){ elLib.textContent = 'No items published yet.'; return; }
  items.sort((a,b)=>(b.year||0)-(a.year||0)||String(a.title).localeCompare(b.title));
  for(const it of items){
    const a = document.createElement('a');
    a.href = '#'; a.className = 'item';
    const jur = (it.jurisdiction||'').toUpperCase();
    const yr  = it.year ? ` · ${it.year}` : '';
    a.textContent = `${it.title || it.slug} ${jur}${yr}`;
    a.addEventListener('click', ev => { ev.preventDefault(); openItem(it); });
    elLib.appendChild(a);
  }
}

async function openItem(item){
  resetSearch();
  let url = item.txt || '';
  if(!url){ elDoc.textContent = 'This item has no TXT artifact.'; setStatus(''); return; }
  if(!/^https?:\/\//i.test(url)) url = `${LAW_INDEX}/${url.replace(/^\/+/, '')}`;

  elDoc.textContent = 'Loading…';
  setStatus(`Fetching ${item.title || item.slug}…`);
  try{
    const res = await fetch(url, { cache:'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    currentText = text;
    elDoc.textContent = text;
    setStatus(`Loaded: ${item.title || item.slug}`);
    qInput.focus();
  }catch(e){
    elDoc.textContent = 'Failed to load text for this item.';
    setStatus(`Load error: ${e.message}`, true);
  }
}

function resetSearch(){
  hlMatches = []; hlIndex = -1; qInput.value = '';
  elDoc.innerHTML = (currentText||'').replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));
  setStatus(''); updateFindCount();
}

function updateFindCount(){
  const c = document.getElementById('findCount');
  c.textContent = hlMatches.length ? `${hlIndex+1} / ${hlMatches.length}` : '';
}

function highlightAll(query){
  if(!query || !currentText){ resetSearch(); return; }
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'gi');

  const parts = currentText.split(re);
  const matches = currentText.match(re) || [];
  let html = '';
  for(let i=0;i<parts.length;i++){
    html += parts[i].replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));
    if(i<matches.length){
      const m = matches[i];
      html += `<mark class="hl">${m.replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</mark>`;
    }
  }
  elDoc.innerHTML = html;
  hlMatches = Array.from(elDoc.querySelectorAll('mark.hl'));
  hlIndex = hlMatches.length ? 0 : -1;
  updateFindCount();
  if(hlIndex>=0) scrollToHL(hlIndex);
}

function scrollToHL(i){
  const node = hlMatches[i]; if(!node) return;
  node.scrollIntoView({ behavior:'smooth', block:'center' });
}

btnNext.addEventListener('click', ()=>{
  if(!hlMatches.length) return;
  hlIndex = (hlIndex + 1) % hlMatches.length;
  updateFindCount(); scrollToHL(hlIndex);
});
btnPrev.addEventListener('click', ()=>{
  if(!hlMatches.length) return;
  hlIndex = (hlIndex - 1 + hlMatches.length) % hlMatches.length;
  updateFindCount(); scrollToHL(hlIndex);
});
qInput.addEventListener('input', e => highlightAll(e.target.value.trim()));

loadCatalog();
</script>
