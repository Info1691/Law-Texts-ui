// Minimal diagnostic-friendly search. HTML must have #qform and #q.

const EL = {
  form:  document.getElementById('qform'),
  q:     document.getElementById('q'),
  meter: document.getElementById('meter'),
  tb:    document.querySelector('#results-textbooks .results'),
  la:    document.querySelector('#results-laws .results'),
  ru:    document.querySelector('#results-rules .results')
};

// Stop if HTML ids don’t exist (most common cause of a “dead” button)
if (!EL.form || !EL.q) {
  if (EL.meter) EL.meter.textContent = 'Error: search page HTML does not match JS (missing #qform/#q).';
  throw new Error('search: missing #qform/#q');
}

// Catalog endpoints (public, CORS OK)
const URLS = {
  TEXTBOOKS: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  LAWS:      'https://info1691.github.io/laws-ui/laws.json',
  RULES:     'https://info1691.github.io/rules-ui/rules.json',
};

const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const words = q => (q||'').toLowerCase().split(/[\s+]+/).map(s=>s.trim()).filter(Boolean);
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const mark = (t, terms) => terms.reduce((m,w)=>m.replace(new RegExp(`(\\b${reEscape(w)}\\b)`,'gi'),'<mark>$1</mark>'), t);
const resolve = (base, rel)=>{ try{ return new URL(rel, base).href; }catch{ return rel; } };
const fetchJSON = u => fetch(u,{cache:'no-store'}).then(r=>{ if(!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); });
const fetchTXT  = u => fetch(u,{cache:'no-store'}).then(r=>{ if(!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); });

function snippetsAND(text, terms, win=900, max=18) {
  const low = text.toLowerCase();
  const anchor = [...terms].sort((a,b)=> (low.split(a).length)-(low.split(b).length))[0] || '';
  if (!anchor) return [];
  const idxs = []; let i=0; while((i=low.indexOf(anchor,i))!==-1){ idxs.push(i); i+=anchor.length; }
  const out = [];
  for (const a of idxs){
    const start = Math.max(0, a - Math.floor(win/2));
    const end   = Math.min(text.length, start + win);
    const slice = low.slice(start, end);
    if (terms.every(t => slice.includes(t))) {
      out.push(text.slice(start,end).replace(/\s+/g,' ').trim());
      if (out.length>=max) break;
    }
  }
  return out;
}

function card(doc, snips, terms){
  const href = doc.url_resolved || doc.url_txt || '#';
  const meta = `${(doc.jurisdiction||'').toUpperCase()}${doc.year?' · '+doc.year:''}${doc.reference?' · '+esc(doc.reference):''}`;
  return `
    <article class="card">
      <header>
        <a class="list-link" href="${href}" target="_blank" rel="noopener">${esc(doc.title||doc.id||'Document')}</a>
        <span class="badge">${doc._bucket}</span>
      </header>
      <div class="meta small">${meta}</div>
      ${snips.map(s=>`<div class="snippet">${mark(esc(s),terms)}</div>`).join('')}
      <footer><a class="open" href="${href}" target="_blank" rel="noopener">open TXT</a></footer>
    </article>
  `;
}

async function loadCatalogs(){
  const [tb, la, ru] = await Promise.all([
    fetchJSON(URLS.TEXTBOOKS), fetchJSON(URLS.LAWS), fetchJSON(URLS.RULES)
  ]);
  const TB = tb.map(x=>({_bucket:'Textbooks', ...x, url_resolved: resolve(URLS.TEXTBOOKS, x.url_txt)}));
  const LA = la.map(x=>({_bucket:'Laws',      ...x, url_resolved: resolve(URLS.LAWS,      x.url_txt)}));
  const RU = ru.map(x=>({_bucket:'Rules',     ...x, url_resolved: resolve(URLS.RULES,     x.url_txt)}));
  EL.meter.textContent = `Loaded — Textbooks: ${TB.length} · Laws: ${LA.length} · Rules: ${RU.length}`;
  return {TB,LA,RU};
}

async function searchBucket(list, terms, box){ 
  let hits=0;
  box.innerHTML='';
  for (const d of list){
    try{
      const body = await fetchTXT(d.url_resolved);
      const snips = snippetsAND(body, terms, 900, 18);
      if (snips.length){ box.insertAdjacentHTML('beforeend', card(d,snips,terms)); hits++; }
    }catch(e){
      box.insertAdjacentHTML('beforeend', `<div class="small muted">Fetch failed: ${esc(d.title||d.id)} (${esc(d.url_resolved)})</div>`);
    }
    await 0;
  }
  return hits;
}

(async function boot(){
  let catalogs;
  try {
    catalogs = await loadCatalogs();
  } catch (e) {
    EL.meter.textContent = `Error loading catalogs: ${e.message}`;
    return;
  }

  const params = new URLSearchParams(location.search);
  const initial = params.get('q') || '';
  EL.q.value = initial;

  async function run(q){
    const terms = words(q);
    EL.tb.innerHTML = EL.la.innerHTML = EL.ru.innerHTML = '';
    if (!terms.length){ EL.meter.textContent = 'Enter terms, then Search.'; return; }
    EL.meter.textContent = 'Searching…';

    const [tHits, lHits, rHits] = await Promise.all([
      searchBucket(catalogs.TB, terms, EL.tb),
      searchBucket(catalogs.LA, terms, EL.la),
      searchBucket(catalogs.RU, terms, EL.ru),
    ]);
    EL.meter.textContent = `Matches — Textbooks: ${tHits} · Laws: ${lHits} · Rules: ${rHits}`;
  }

  EL.form.addEventListener('submit', e=>{
    e.preventDefault();
    const q = EL.q.value.trim();
    const u = new URL(location.href);
    if (q) u.searchParams.set('q', q); else u.searchParams.delete('q');
    history.replaceState(null,'', u.toString());
    run(q);
  });

  EL.meter.textContent = 'Ready.';
  if (initial) run(initial);
})();
