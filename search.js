/* Law-Texts-ui /search.js
 * Full-text, multi-source search across:
 * - Textbooks (law-index public catalog)
 * - Laws (laws-ui)
 * - Rules (rules-ui)
 * Reads ENTIRE TXT files, AND-matches all query terms in a passage window,
 * returns many snippets per document (config below).
 */

const ENDPOINTS = {
  textbooks: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  laws     : 'https://info1691.github.io/laws-ui/laws.json',
  rules    : 'https://info1691.github.io/rules-ui/rules.json'
};

// ---------- TUNABLES ----------
const MAX_DOCS_PER_SECTION       = 50;   // how many different books per section
const MAX_SNIPPETS_PER_DOC_INIT  = 10;   // initial snippets per book shown
const LOAD_MORE_STEP             = 20;   // additional snippets shown per click
const PASSAGE_WINDOW_CHARS       = 320;  // size of the passage around a hit
const CASE_SENSITIVE             = false;
// --------------------------------

const qEl      = document.querySelector('#q');
const btnEl    = document.querySelector('#go');
const results  = {
  textbooks: document.querySelector('#results-textbooks'),
  laws:      document.querySelector('#results-laws'),
  rules:     document.querySelector('#results-rules')
};
const countsEl = document.querySelector('#counts');

btnEl.addEventListener('click', run);
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

function normalize(s) {
  return s
    .normalize('NFKC')
    .replace(/\u00ad/g, '')               // soft hyphen
    .replace(/[\u200b-\u200d\ufeff]/g, '')// zw chars
    .replace(/\u00a0/g, ' ')              // nbsp
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—‒―]/g, '-').replace(/\u2026/g, '...')
    .replace(/\r\n?/g, '\n');
}

function termsFromQuery(q) {
  const raw = q.trim();
  if (!raw) return [];
  // split on spaces or '+'
  let parts = raw.split(/[\s+]+/).filter(Boolean);
  if (!CASE_SENSITIVE) parts = parts.map(t => t.toLowerCase());
  return [...new Set(parts)]; // unique
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GET ${url} ${r.status}`);
  return r.json();
}

async function loadList(listURL) {
  const items = await fetchJSON(listURL);
  // Normalize objects to { id, title, jurisdiction, url_txt, source }
  // and resolve url_txt relative to listURL (works for ./data/.. paths)
  const base = new URL(listURL, listURL);
  return items
    .filter(Boolean)
    .map(x => ({
      id: x.id || x.reference || x.title || Math.random().toString(36).slice(2),
      title: x.title || x.reference || 'Untitled',
      jurisdiction: x.jurisdiction || '',
      url_txt: new URL(x.url_txt, base).href,
      source: listURL
    }));
}

async function loadCatalogs() {
  const [textbooks, laws, rules] = await Promise.all([
    loadList(ENDPOINTS.textbooks),
    loadList(ENDPOINTS.laws),
    loadList(ENDPOINTS.rules)
  ]);
  return { textbooks, laws, rules };
}

async function fetchTXT(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GET ${url} ${r.status}`);
  return normalize(await r.text());
}

// Find snippets where ALL terms occur within a PASSAGE_WINDOW_CHARS window.
// Returns array of {start,end,preview}
function findSnippets(full, terms) {
  const hay = CASE_SENSITIVE ? full : full.toLowerCase();
  const need = terms;
  if (need.length === 0) return [];

  const first = need[0];
  const snippets = [];
  let idx = 0;

  while (idx < hay.length) {
    const pos = hay.indexOf(first, idx);
    if (pos === -1) break;

    const half = Math.floor(PASSAGE_WINDOW_CHARS / 2);
    const winStart = Math.max(0, pos - half);
    const winEnd   = Math.min(hay.length, pos + half);

    const windowText = hay.slice(winStart, winEnd);
    // Check all terms present in this window
    let ok = true;
    for (let i = 1; i < need.length; i++) {
      if (windowText.indexOf(need[i]) === -1) { ok = false; break; }
    }
    if (ok) {
      // Build pretty preview from ORIGINAL text (preserve case)
      const previewRaw = full.slice(winStart, winEnd);
      const preview = highlight(previewRaw, terms);
      snippets.push({ start: winStart, end: winEnd, preview });
      // Move search window forward past this window to avoid duplicates
      idx = winEnd;
      continue;
    }
    // advance one char past current hit and keep looking
    idx = pos + first.length;
  }

  return snippets;
}

function escHTML(s) {
  return s.replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function highlight(preview, terms) {
  let out = escHTML(preview);
  // simple highlight: wrap each term (case-insensitive)
  for (const t of terms.slice().sort((a,b)=>b.length-a.length)) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), CASE_SENSITIVE ? 'g' : 'gi');
    out = out.replace(re, m => `<mark>${escHTML(m)}</mark>`);
  }
  // add ellipses at edges
  return (preview.startsWith('...') ? '' : '… ') + out + (preview.endsWith('...') ? '' : ' …');
}

function sectionHeader(title, count) {
  return `
    <div class="section-head">
      <h3>${escHTML(title)}</h3>
      <div class="muted">${count} ${count===1?'match':'matches'}</div>
    </div>
  `;
}

function docCard(item, snippets, showN, sectionKey) {
  const shown = snippets.slice(0, showN);
  const moreLeft = Math.max(0, snippets.length - shown.length);
  const id = `${sectionKey}-${item.id}`;
  const snipHTML = shown.map(s => `
    <div class="snippet">
      <div class="snippet-body">${s.preview}</div>
      <div class="snippet-foot"><a href="${item.url_txt}" target="_blank" rel="noopener">open TXT</a></div>
    </div>
  `).join('');

  const moreBtn = moreLeft ? `
    <button class="more-btn" data-doc="${id}" data-left="${moreLeft}">Load more (${moreLeft})</button>
  ` : '';

  return `
    <article class="doc-card" id="${id}">
      <header>
        <div class="doc-title">${escHTML(item.title)}</div>
        <div class="doc-meta">${escHTML(item.jurisdiction || '')}</div>
      </header>
      ${snipHTML || `<div class="muted">No quotable snippets in passage windows.</div>`}
      ${moreBtn}
    </article>
  `;
}

function wireMoreButtons(state) {
  document.querySelectorAll('button.more-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-doc');
      const [sectionKey, ...rest] = id.split('-');
      const docId = rest.join('-');
      const docState = state[sectionKey].find(d => d.item.id === docId);
      if (!docState) return;
      docState.shown += LOAD_MORE_STEP;
      render(state); // re-render that section
    });
  });
}

function render(state) {
  // counts
  const totals = {
    textbooks: state.textbooks.reduce((a,d)=>a + Math.min(d.snippets.length, d.shown), 0),
    laws:      state.laws     .reduce((a,d)=>a + Math.min(d.snippets.length, d.shown), 0),
    rules:     state.rules    .reduce((a,d)=>a + Math.min(d.snippets.length, d.shown), 0)
  };
  countsEl.textContent = `Loaded → Textbooks: ${totals.textbooks} · Laws: ${totals.laws} · Rules: ${totals.rules}`;

  for (const key of ['textbooks','laws','rules']) {
    const mount = results[key];
    const list  = state[key];
    if (!list.length) {
      mount.innerHTML = `<div class="muted">No matches.</div>`;
      continue;
    }
    const cards = list.slice(0, MAX_DOCS_PER_SECTION).map(d =>
      docCard(d.item, d.snippets, d.shown, key)
    ).join('');
    mount.innerHTML = sectionHeader(key[0].toUpperCase()+key.slice(1), list.reduce((a,d)=>a+d.snippets.length,0)) + cards;
  }

  wireMoreButtons(state);
}

async function run() {
  const terms = termsFromQuery(qEl.value);
  for (const k of Object.keys(results)) results[k].innerHTML = '';
  countsEl.textContent = 'Searching…';

  if (terms.length === 0) {
    countsEl.textContent = 'Enter one or more terms.';
    return;
  }

  let catalogs;
  try {
    catalogs = await loadCatalogs();
  } catch (e) {
    countsEl.textContent = `Failed to load catalogs: ${e.message}`;
    return;
  }

  // For each section, fetch each TXT and search it fully.
  const state = { textbooks: [], laws: [], rules: [] };

  for (const key of /** @type {const} */ (['textbooks','laws','rules'])) {
    const items = catalogs[key] || [];
    for (const item of items.slice(0, MAX_DOCS_PER_SECTION)) {
      try {
        const full = await fetchTXT(item.url_txt);
        const snips = findSnippets(full, CASE_SENSITIVE ? terms : terms.map(t=>t.toLowerCase()));
        if (snips.length) state[key].push({ item, snippets: snips, shown: MAX_SNIPPETS_PER_DOC_INIT });
      } catch (e) {
        // skip unreadable
        console.warn('skip', item.url_txt, e.message);
      }
    }
  }

  render(state);
}

// initial focus
qEl.focus();
