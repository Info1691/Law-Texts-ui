<script>
/* Trust Law Textbooks — Reader (remote-catalog, deduped) */

/* Where the public artifacts live (law-index on gh-pages) */
const LAW_INDEX = (window.LAW_INDEX_BASE || 'https://info1691.github.io/law-index').replace(/\/+$/, '');
const CATALOG_URL = LAW_INDEX + '/catalogs/ingest-catalog.json';

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

async function loadCatalog(){
  try{
    const res = await fetch(CATALOG_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();

    // Defensive coercion
    const list = Array.isArray(raw) ? raw : [];
    // Dedupe by normalized slug; prefer the item that has a proper title/year/txt
    const keep = new Map();
    for(const it of list){
      const key =
        slugKey(it.slug) ||
        slugKey(it.title) ||
        slugKey(it.txt || it.reference || Math.random().toString(36).slice(2));

      const current = keep.get(key);
      const score = (x)=> (x?.title?1:0) + (x?.year?1:0) + (x?.txt?1:0);
      if(!current || score(it) >= score(current)) keep.set(key, it);
    }
    const items = Array.from(keep.values());
    renderLibrary(items);
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
  // Accept absolute URLs from catalog; otherwise treat as path within law-index
  let url = item.txt || '';
  if(!url){ elDoc.textContent = 'This item has no TXT artifact.'; setStatus(''); return; }
  if(!/^https?:\/\//i.test(url)) url = LAW_INDEX + '/' + url.replace(/^\/+/, '');
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
