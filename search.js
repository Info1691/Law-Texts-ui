// -------- CONFIG (absolute, robust) -----------------------------------------
const CATALOGS = {
  // Public, normalized Textbooks catalog produced by Agent 1 -> published to law-index (GitHub Pages)
  // If you ever move the public catalog, update ONLY this line.
  textbooks: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',

  // Local (this repo) JSON indexes for Laws & Rules (Agent 1 also publishes these here).
  laws:  '/laws.json',
  rules: '/rules.json',
};

// How many snippets per document
const MAX_SNIPPETS_PER_DOC = 3;
// How wide each snippet window is (characters around the match)
const SNIPPET_RADIUS = 220;

// -------- UTILITIES ----------------------------------------------------------
const $ = sel => document.querySelector(sel);
const esc = s => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseQuery() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q') || '';
  $('#q').value = q;
  return q.trim();
}

function setCounts({t=0,l=0,r=0}) {
  $('#counts').textContent = `Matches — Textbooks: ${t} · Laws: ${l} · Rules: ${r}`;
}

// Turn a relative law-index path (e.g. "./data/texts/…") into an absolute URL
function absolutizeLawIndexPath(urlish) {
  if (!urlish) return null;
  if (/^https?:\/\//i.test(urlish)) return urlish;
  let path = urlish.replace(/^\.\//, ''); // drop leading ./ if present
  return `https://info1691.github.io/law-index/${path}`;
}

// Fetch JSON catalogs, tolerating either an array or {items:[…]}
async function fetchCatalog(url) {
  const res = await fetch(url, {mode:'cors'});
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.items || []);
}

// Fetch plain text (with small retry)
async function fetchText(url) {
  for (let i=0;i<2;i++){
    const res = await fetch(url, {mode:'cors'});
    if (res.ok) return res.text();
    await sleep(150);
  }
  throw new Error(`TXT fetch failed: ${url}`);
}

function tokenize(q) {
  // AND semantics: all terms must appear in a snippet window
  return q.split(/[+\s]+/).map(s => s.trim()).filter(Boolean);
}

function makeSnippets(text, terms) {
  if (!terms.length) return [];
  const lower = text.toLowerCase();
  const needles = terms.map(t => t.toLowerCase());
  const hits = [];

  // find candidate anchors by first term, then verify all terms are within window
  let idx = 0;
  while (hits.length < MAX_SNIPPETS_PER_DOC) {
    const pos = lower.indexOf(needles[0], idx);
    if (pos === -1) break;
    const start = Math.max(0, pos - SNIPPET_RADIUS);
    const end   = Math.min(text.length, pos + needles[0].length + SNIPPET_RADIUS);
    const slice = lower.slice(start, end);

    const ok = needles.every(n => slice.indexOf(n) !== -1);
    if (ok) {
      let snippet = text.slice(start, end);

      // highlight terms (basic, case-insensitive)
      needles.forEach(n => {
        const re = new RegExp(`(${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'ig');
        snippet = snippet.replace(re, '<mark>$1</mark>');
      });

      // tidy edges
      snippet = (start>0?'…':'') + esc(snippet) + (end<text.length?'…':'');
      // (we escaped first, then added <mark> — so unescape marks)
      snippet = snippet.replace(/&lt;mark&gt;/g,'<mark>').replace(/&lt;\/mark&gt;/g,'</mark>');
      hits.push(snippet);
      idx = end; // move forward
    } else {
      idx = pos + needles[0].length;
    }
  }
  return hits;
}

function renderCard(where, item, snippets, kindLabel) {
  const wrap = document.createElement('article');
  wrap.className = 'card';
  const open = item.url_txt;
  const metaLine = `${(item.jurisdiction||item.jurisdiction_tag||'').toUpperCase()} · ${(item.year||'').toString()} · ${kindLabel}`;
  wrap.innerHTML = `
    <div class="row">
      <div>
        <h3><a href="${esc(open)}" target="_blank" rel="noopener">${esc(item.title||item.name||'Untitled')}</a></h3>
        <div class="meta">${esc(metaLine.trim())}</div>
      </div>
      <a class="pill" href="${esc(open)}" target="_blank" rel="noopener">¶ open TXT</a>
    </div>
    ${snippets.map(s => `<p>${s}</p>`).join('')}
  `;
  where.appendChild(wrap);
}

// -------- SEARCH PIPELINE ----------------------------------------------------
async function run() {
  const q = parseQuery();
  const terms = tokenize(q);

  const boxTB  = $('#textbooks');
  const boxLaw = $('#laws');
  const boxRul = $('#rules');
  boxTB.innerHTML = boxLaw.innerHTML = boxRul.innerHTML = '';

  let counts = {t:0,l:0,r:0};
  setCounts(counts);

  if (!terms.length) return;

  // 1) Load catalogs
  let textbooks = [];
  let laws = [];
  let rules = [];

  try {
    textbooks = await fetchCatalog(CATALOGS.textbooks);
    // normalize item shape (id, title, url_txt, jurisdiction, year)
    textbooks = textbooks.map(b => ({
      id: b.id||b.ref||b.uid,
      title: b.title||b.name||'Untitled',
      jurisdiction: (b.jurisdiction||b.jurisdiction_tag||'').toString(),
      year: b.year||'',
      url_txt: absolutizeLawIndexPath(b.url_txt||b.txt||b.href)
    })).filter(b => !!b.url_txt);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'bad';
    p.textContent = `Textbooks catalog error: ${e.message}`;
    boxTB.appendChild(p);
  }

  try {
    laws = await fetchCatalog(CATALOGS.laws);
    laws = laws.map(x => ({
      id: x.id, title: x.title, jurisdiction: x.jurisdiction, year: x.year, url_txt: x.url_txt
    })).filter(x => !!x.url_txt);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'bad';
    p.textContent = `Laws catalog error: ${e.message}`;
    boxLaw.appendChild(p);
  }

  try {
    rules = await fetchCatalog(CATALOGS.rules);
    rules = rules.map(x => ({
      id: x.id, title: x.title, jurisdiction: x.jurisdiction, year: x.year, url_txt: x.url_txt
    })).filter(x => !!x.url_txt);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'bad';
    p.textContent = `Rules catalog error: ${e.message}`;
    boxRul.appendChild(p);
  }

  // 2) Search (simple full-text scan with AND-window logic)
  async function scanAndRender(items, outBox, kindLabel) {
    for (const it of items) {
      try {
        const txt = await fetchText(it.url_txt);
        const snippets = makeSnippets(txt, terms);
        if (snippets.length) {
          renderCard(outBox, it, snippets, kindLabel);
          return 1;
        }
      } catch (_) { /* skip on fetch errors */ }
    }
    return 0;
  }

  counts.t += await scanAndRender(textbooks, boxTB, 'textbooks');
  counts.l += await scanAndRender(laws,      boxLaw, 'laws');
  counts.r += await scanAndRender(rules,     boxRul, 'rules');
  setCounts(counts);
}

// bind form & deep-link ?q=
document.getElementById('qform').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  const url = new URL(location.href);
  if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
  location.href = url.toString();
});

run();
