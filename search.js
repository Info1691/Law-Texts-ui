/* Cross-repo text search (Textbooks + Laws + Rules) with AND semantics */

const EL = {
  form: document.getElementById('qform'),
  q: document.getElementById('q'),
  meter: document.getElementById('meter'),
  boxTB: document.querySelector('#results-textbooks .results'),
  boxLA: document.querySelector('#results-laws .results'),
  boxRU: document.querySelector('#results-rules .results')
};

const URLS = {
  TEXTBOOKS: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  LAWS:      'https://info1691.github.io/laws-ui/laws.json',
  RULES:     'https://info1691.github.io/rules-ui/rules.json'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const termsFrom = q => (q||'').toLowerCase().split(/[\s+]+/).map(s=>s.trim()).filter(Boolean);

function highlight(snippet, terms){
  let out = snippet;
  for (const t of terms){
    const re = new RegExp(`(\\b${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b)`,'gi');
    out = out.replace(re,'<mark>$1</mark>');
  }
  return out;
}

function findWindows(text, terms, windowSize=400, maxSnippets=8){
  const low = text.toLowerCase();
  if (!terms.length) return [];
  const first = terms[0];
  const anchors = [];
  let i = 0;
  while((i = low.indexOf(first, i)) !== -1){ anchors.push(i); i += first.length; }
  const hits = [];
  for (const a of anchors){
    const start = Math.max(0, a - Math.floor(windowSize/2));
    const end   = Math.min(text.length, start + windowSize);
    const slice = low.slice(start, end);
    if (terms.every(t => slice.includes(t))){
      const raw = text.slice(start, end).replace(/\s+/g,' ').trim();
      hits.push(raw);
      if (hits.length >= maxSnippets) break;
    }
  }
  return hits;
}

function renderDocCard(doc, snippets){
  const meta = `${(doc.jurisdiction||'').toUpperCase()}${doc.year ? ' · '+doc.year : ''}`;
  const ref  = doc.reference ? ' · ' + doc.reference.replaceAll('-', ' ') : '';
  const title = escapeHtml(doc.title || doc.id || 'Document');
  const href = doc.url_resolved || doc.url_txt || '#';
  return `
    <article class="card">
      <header>
        <a class="list-link" href="${href}" target="_blank" rel="noopener">${title}</a>
        <span class="badge">${doc._bucket}</span>
      </header>
      <div class="meta small">${meta}${ref}</div>
      ${snippets.map(s=>`<div class="snippet">${highlight(escapeHtml(s), termsFrom(EL.q.value))}</div>`).join('') || '<div class="snippet muted">No snippet.</div>'}
      <footer><a class="open" href="${href}" target="_blank" rel="noopener">open TXT</a></footer>
    </article>
  `;
}

async function fetchJSON(u){ const r = await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.json(); }
async function fetchText(u){ const r = await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); }
const resolveUrl = (base, rel) => { try { return new URL(rel, base).href; } catch { return rel; } };

async function loadCatalogs(){
  const [tb, la, ru] = await Promise.all([fetchJSON(URLS.TEXTBOOKS), fetchJSON(URLS.LAWS), fetchJSON(URLS.RULES)]);
  const TB = tb.map(x=>({_bucket:'Textbooks', ...x, url_resolved: x.url_txt}));
  const LA = la.map(x=>({_bucket:'Laws',       ...x, url_resolved: resolveUrl(URLS.LAWS, x.url_txt)}));
  const RU = ru.map(x=>({_bucket:'Rules',      ...x, url_resolved: resolveUrl(URLS.RULES, x.url_txt)}));
  return {TB, LA, RU};
}

async function searchDocs(docs, terms, box, tally){
  let count = 0;
  box.innerHTML = '';
  for (const d of docs){
    try{
      const txt = await fetchText(d.url_resolved);
      const snips = findWindows(txt, terms);
      if (snips.length){
        box.insertAdjacentHTML('beforeend', renderDocCard(d, snips));
        count++;
      }
      await sleep(0);
    }catch{}
  }
  tally(count);
}

(async function init(){
  const params = new URLSearchParams(location.search);
  const q0 = params.get('q') || '';
  EL.q.value = q0;

  const cats = await loadCatalogs();

  async function run(q){
    const terms = termsFrom(q);
    EL.boxTB.innerHTML = EL.boxLA.innerHTML = EL.boxRU.innerHTML = '';
    EL.meter.textContent = `Matches — Textbooks: 0 · Laws: 0 · Rules: 0`;
    if (!terms.length) return;

    let tb=0, la=0, ru=0;
    await Promise.all([
      searchDocs(cats.TB, terms, EL.boxTB, v=>tb=v),
      searchDocs(cats.LA, terms, EL.boxLA, v=>la=v),
      searchDocs(cats.RU, terms, EL.boxRU, v=>ru=v),
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
