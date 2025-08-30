/* Law-Texts-ui / search.js
 * Unified search over: Textbooks (public catalog), Laws (laws-ui), Rules (rules-ui).
 * - Accepts spaces OR '+' between words (AND semantics by default).
 * - Case-insensitive, punctuation-insensitive.
 * - Larger snippet window and more matches per document.
 * - If strict AND finds nothing, auto-fallback to ANY (OR) so you still see signal.
 */

const ENDPOINTS = {
  // Public textbooks catalog produced by lex-ingest-local
  textbooksCatalog: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  // Laws & rules small indices with url_txt fields
  lawsIndex:        'https://info1691.github.io/laws-ui/laws.json',
  rulesIndex:       'https://info1691.github.io/rules-ui/rules.json',
};

const UI = {
  q: document.querySelector('#q'),
  go: document.querySelector('#go'),
  out: document.querySelector('#out'),
  meta: document.querySelector('#meta'),
};

const CACHE = new Map(); // url_txt -> string

const SNIPPET = { // tuneable
  windowChars: 380,      // half-window shown either side of a hit cluster
  maxPassagesPerDoc: 6,  // how many per document
  maxDocsPerSection: 50, // safety cap per section
};

function norm(s) {
  // lowercase + strip diacritics
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}+/gu, '');
}

function tokenize(qRaw) {
  // treat any non-alphanumeric as a separator, including '+'
  const terms = norm(qRaw)
    .split(/[^a-z0-9]+/gi)
    .filter(t => t && t.length >= 2); // ignore 1-char noise
  return terms;
}

function containsAND(span, terms) {
  const s = norm(span);
  return terms.every(t => s.includes(t));
}
function containsANY(span, terms) {
  const s = norm(span);
  return terms.some(t => s.includes(t));
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Fetch failed ${url} ${r.status}`);
  return r.json();
}

async function fetchTXT(url) {
  if (CACHE.has(url)) return CACHE.get(url);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`TXT fetch failed ${url} ${r.status}`);
  const t = await r.text();
  CACHE.set(url, t);
  return t;
}

function pickPassages(txt, terms, requireAND) {
  // scan the whole text; collect windows around matches
  const hits = [];
  const T = norm(txt);
  // quick fast-path: single term -> find indices fast
  const selectors = terms.length ? terms : [];
  const win = SNIPPET.windowChars;

  // Collect candidate offsets by the *first* term (or all if ANY)
  let anchorOffsets = [];
  if (selectors.length) {
    const first = selectors[0];
    let idx = 0;
    while ((idx = T.indexOf(first, idx)) !== -1) {
      anchorOffsets.push(idx);
      idx += first.length;
      if (anchorOffsets.length > 2000) break; // safety
    }
    // If we’re in ANY mode and first term is rare, also seed with others
    if (!requireAND && anchorOffsets.length < 8) {
      for (let i = 1; i < selectors.length; i++) {
        let j = 0;
        while ((j = T.indexOf(selectors[i], j)) !== -1) {
          anchorOffsets.push(j);
          j += selectors[i].length;
          if (anchorOffsets.length > 2000) break;
        }
      }
      anchorOffsets.sort((a,b)=>a-b);
    }
  } else {
    // no terms — nothing to do
    return [];
  }

  const taken = [];
  for (const off of anchorOffsets) {
    if (hits.length >= SNIPPET.maxPassagesPerDoc) break;
    // skip if this area already covered
    if (taken.some(([a,b]) => off >= a && off <= b)) continue;

    const start = Math.max(0, off - win);
    const end   = Math.min(T.length, off + win);
    const slice = txt.slice(start, end); // use original-case for nicer snippets

    const ok = requireAND ? containsAND(slice, terms) : containsANY(slice, terms);
    if (!ok) continue;

    // record and reserve this window
    hits.push({ start, end, snippet: slice });
    taken.push([start - win/2, end + win/2]);
  }

  // Highlight
  const hi = (s) => {
    let out = s;
    for (const t of terms) {
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    }
    return out;
  };
  return hits.map(h => ({ ...h, snippet: hi(h.snippet) }));
}

function renderSection(title, items, icon) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('h3');
  h.textContent = title;
  frag.appendChild(h);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No matches.';
    frag.appendChild(empty);
    return frag;
  }

  for (const it of items.slice(0, SNIPPET.maxDocsPerSection)) {
    const card = document.createElement('article');
    card.className = 'result-card';

    const head = document.createElement('div');
    head.className = 'result-head';
    head.innerHTML = `
      <div class="pill">${icon}</div>
      <a class="title" href="${it.url_txt}" target="_blank" rel="noopener">${it.title}</a>
      <span class="meta">${it.meta}</span>
    `;
    card.appendChild(head);

    for (const p of it.passages) {
      const snip = document.createElement('p');
      snip.className = 'snippet';
      snip.innerHTML = `…${p.snippet}… <a class="open" href="${it.url_txt}" target="_blank" rel="noopener">open TXT</a>`;
      card.appendChild(snip);
    }
    frag.appendChild(card);
  }
  return frag;
}

function setMeta(line) {
  if (UI.meta) UI.meta.textContent = line;
}

async function run() {
  const rawQ = UI.q.value || '';
  const terms = tokenize(rawQ);
  UI.out.innerHTML = '';
  setMeta('');

  if (!terms.length) {
    setMeta('Type at least one word (use spaces or + between words).');
    return;
  }

  // Load catalogs
  const [booksCat, lawsIdx, rulesIdx] = await Promise.all([
    fetchJSON(ENDPOINTS.textbooksCatalog).catch(()=>({ textbooks: [] })),
    fetchJSON(ENDPOINTS.lawsIndex).catch(()=>([])),
    fetchJSON(ENDPOINTS.rulesIndex).catch(()=>([])),
  ]);

  // Normalize each entry to {title, url_txt, meta}
  const textbooks = (booksCat.textbooks || [])
    .filter(x => x.url_txt)
    .map(x => ({ title: x.title, url_txt: x.url_txt, meta: `${x.jurisdiction?.toUpperCase() || ''} · ${x.year || ''} · Textbook` }));

  const laws = (lawsIdx || [])
    .filter(x => x.url_txt)
    .map(x => ({ title: x.title, url_txt: x.url_txt, meta: `${(x.jurisdiction||'').toUpperCase()} · ${x.year || ''} · Law` }));

  const rules = (rulesIdx || [])
    .filter(x => x.url_txt)
    .map(x => ({ title: x.title, url_txt: x.url_txt, meta: `${(x.jurisdiction||'').toUpperCase()} · ${x.year || ''} · Rules` }));

  async function searchDocs(docs, icon, requireAND) {
    const out = [];
    for (const d of docs) {
      try {
        const txt = await fetchTXT(d.url_txt);
        const passages = pickPassages(txt, terms, requireAND);
        if (passages.length) out.push({ ...d, passages });
      } catch (e) {
        // ignore fetch failures per-doc; keep going
      }
    }
    return out;
  }

  // First pass: AND
  let [bookHits, lawHits, ruleHits] = await Promise.all([
    searchDocs(textbooks, 'TXT', true),
    searchDocs(laws, 'laws', true),
    searchDocs(rules, 'rules', true),
  ]);

  // If nothing anywhere, fallback to ANY (OR)
  if (!bookHits.length && !lawHits.length && !ruleHits.length) {
    [bookHits, lawHits, ruleHits] = await Promise.all([
      searchDocs(textbooks, 'TXT', false),
      searchDocs(laws, 'laws', false),
      searchDocs(rules, 'rules', false),
    ]);
    setMeta(`Matches — Textbooks: ${bookHits.length} · Laws: ${lawHits.length} · Rules: ${ruleHits.length} (fallback: ANY of the terms)`);
  } else {
    setMeta(`Matches — Textbooks: ${bookHits.length} · Laws: ${lawHits.length} · Rules: ${ruleHits.length}`);
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(renderSection('Textbooks', bookHits, 'TXT'));
  frag.appendChild(renderSection('Laws', lawHits, 'laws'));
  frag.appendChild(renderSection('Rules', ruleHits, 'rules'));
  UI.out.appendChild(frag);
}

// Wire up
if (UI.go) UI.go.addEventListener('click', (e) => { e.preventDefault(); run(); });
if (UI.q) UI.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); }});

// Optional: run if a ?q= param exists
const params = new URLSearchParams(location.search);
if (params.get('q')) {
  UI.q.value = params.get('q');
  run();
}
