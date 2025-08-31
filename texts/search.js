/* Cross-repo search with AND semantics and robust URL resolution */

const EL = {
  form:  document.getElementById('qform'),
  q:     document.getElementById('q'),
  meter: document.getElementById('meter'),
  boxTB: document.querySelector('#results-textbooks .results'),
  boxLA: document.querySelector('#results-laws .results'),
  boxRU: document.querySelector('#results-rules .results')
};

// Catalog endpoints
const URLS = {
  TEXTBOOKS: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  LAWS:      'https://info1691.github.io/laws-ui/laws.json',
  RULES:     'https://info1691.github.io/rules-ui/rules.json'
};

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const words = q => (q||'').toLowerCase().split(/[\s+]+/).map(s=>s.trim()).filter(Boolean);
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const markUp = (txt, terms) => terms.reduce(
  (t, w) => t.replace(new RegExp(`(\\b${reEscape(w)}\\b)`,'gi'), '<mark>$1</mark>'),
  txt
);
const resolve = (base, rel) => { try { return new URL(rel, base).href; } catch { return rel; } };

// Extract up to N windows that contain *all* terms (AND)
function windowsAND(text, terms, windowSize=900, maxSnips=18){
  if (!terms.length) return [];
  const low = text.toLowerCase();
  const sorted = [...terms].sort((a,b)=> (low.split(a).length) - (low.split(b).length));
  const anchor = sorted[0];
  const anchors = [];
  let i = 0;
  while((i = low.indexOf(anchor, i)) !== -1){ anchors.push(i); i += anchor.length; }
  const hit = [];
  for (const a of anchors){
    const start = Math.max(0, a - Math.floor(windowSize/2));
    const end   = Math.min(text.length, start + windowSize);
    const slice = low.slice(start, end);
    if (sorted.every(t => slice.indexOf(t) !== -1)){
      const raw = text.slice(start, end).replace(/\s+/g,' ').trim();
      hit.push(raw);
      if (hit.length >= maxSnips) break;
    }
  }
  return hit;
}

function card(doc, snippets, queryTerms){
  const title = esc(doc.title || doc.id || 'Document');
  const meta  = `${(doc.jurisdiction||'').toUpperCase()}${doc.year ? ' · '+doc.year : ''}${
    doc.reference ? ' · '+esc(doc.reference) : ''}`;
  const href  = doc.url_resolved || doc.url_txt || '#';
  const snipHTML = snippets.length
    ? snippets.map(s => `<div class="snippet">${markUp(esc(s), queryTerms)}</div>`).join('')
    : `<div class="snippet muted">No snippet.</div>`;
  return `
    <article class="card">
      <header>
        <a class="list-link" href="${href}" target="_blank" rel="noopener">${title}</a>
        <span class="badge">${doc._bucket}</span>
      </header>
      <div class="meta small">${meta}</div>
      ${snipHTML}
      <footer><a class="open" href="${href}" target="_blank" rel="noopener">open TXT</a></footer>
    </article>
  `;
}

async function j(u){ const r = await fetch(u, {cache:'no-store'}); if(!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); }
async function t(u){ const r = await fetch(u, {cache:'no-store'}); if(!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); }

// Load catalogs and resolve URL fields (including *textbooks*)
async function load(){
  const [tb, la, ru] = await Promise.all([
    j(URLS.TEXTBOOKS), j(URLS.LAWS), j(URLS.RULES)
  ]);

  const TB = tb.map(x => ({
    _bucket:'Textbooks',
    ...x,
    url_resolved: resolve(URLS.TEXTBOOKS, x.url_txt)   // resolve relative textbook URLs
  }));

  const LA = la.map(x => ({
    _bucket:'Laws',
    ...x,
    url_resolved: resolve(URLS.LAWS, x.url_txt)
  }));

  const RU = ru.map(x => ({
    _bucket:'Rules',
    ...x,
    url_resolved: resolve(URLS.RULES, x.url_txt)
  }));

  console.info('[search] catalogs:', { textbooks: TB.length, laws: LA.length, rules: RU.length });
  return {TB, LA, RU};
}

async function searchBucket(docs, qTerms, box, setCount){
  let count = 0;
  box.innerHTML = '';
  for (const d of docs){
    try{
      const body = await t(d.url_resolved);
      const snips = windowsAND(body, qTerms, 900, 18);
      if (snips.length){
        box.insertAdjacentHTML('beforeend', card(d, snips, qTerms));
        count++;
      }
    }catch(err){
      console.warn('[search] fetch failed:', d.title || d.id, d.url_resolved, err.message);
    }
    await sleep(0);
  }
  setCount(count);
}

(async function init(){
  const params = new URLSearchParams(location.search);
  const q0 = params.get('q') || '';
  EL.q.value = q0;

  const cats = await load();

  async function run(q){
    const terms = words(q);
    EL.boxTB.innerHTML = EL.boxLA.innerHTML = EL.boxRU.innerHTML = '';
    EL.meter.textContent = `Matches — Textbooks: 0 · Laws: 0 · Rules: 0`;
    if (!terms.length) return;

    let tb=0, la=0, ru=0;
    await Promise.all([
      searchBucket(cats.TB, terms, EL.boxTB, v=>tb=v),
      searchBucket(cats.LA, terms, EL.boxLA, v=>la=v),
      searchBucket(cats.RU, terms, EL.boxRU, v=>ru=v),
    ]);
    EL.meter.textContent = `Matches — Textbooks: ${tb} · Laws: ${la} · Rules: ${ru}`;
  }

  EL.form.addEventListener('submit', e=>{
    e.preventDefault();
    const q = EL.q.value.trim();
    const u = new URL(location.href);
    if (q) u.searchParams.set('q', q); else u.searchParams.delete('q');
    history.replaceState(null,'',u.toString());
    run(q);
  });

  if (q0) run(q0);
})();
