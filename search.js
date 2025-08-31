/* Cross-repo search — absolute catalogs + branding-safe
 * ONE copy only: keep this at repo root and link via /search.js
 */

const TEXTBOOKS_BASE = 'https://info1691.github.io/law-index/';
const LAWS_BASE      = 'https://info1691.github.io/laws-ui/';
const RULES_BASE     = 'https://info1691.github.io/rules-ui/';

const CATALOGS = {
  textbooks: new URL('catalogs/ingest-catalog.json', TEXTBOOKS_BASE).toString(),
  laws:      new URL('laws.json', LAWS_BASE).toString(),
  rules:     new URL('rules.json', RULES_BASE).toString(),
};

const BASE_FOR = {
  textbooks: TEXTBOOKS_BASE,
  laws:      LAWS_BASE,
  rules:     RULES_BASE,
};

const qs = (sel, el = document) => el.querySelector(sel);
const qsa = (sel, el = document) => [...el.querySelectorAll(sel)];

function readQuery() {
  const url = new URL(window.location.href);
  return (url.searchParams.get('q') || '').trim();
}

function writeQuery(q) {
  const url = new URL(window.location.href);
  if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
  history.replaceState(null, '', url.toString());
}

function tokenize(s) {
  // Split on +, comma, space. AND semantics across tokens.
  return s.toLowerCase().split(/[+\s,]+/).filter(Boolean);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function highlight(snippet, tokens) {
  let s = snippet;
  for (const t of tokens) {
    try {
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      s = s.replace(re, '<mark>$1</mark>');
    } catch {}
  }
  return s;
}

function firstWindowContainingAll(docLower, tokens, windowSize = 420) {
  // Try each occurrence of the first token and see if all tokens can be found inside a window around it.
  const first = tokens[0];
  let idx = -1;
  while ((idx = docLower.indexOf(first, idx + 1)) !== -1) {
    const start = Math.max(0, idx - Math.floor(windowSize / 2));
    const end = Math.min(docLower.length, idx + Math.floor(windowSize / 2));
    const win = docLower.slice(start, end);
    const ok = tokens.every(t => win.indexOf(t) !== -1);
    if (ok) return { start, end };
  }
  // fallback: entire doc has all tokens?
  const okAll = tokens.every(t => docLower.indexOf(t) !== -1);
  if (okAll) {
    const firstPos = tokens.reduce((p, t) => Math.min(p, docLower.indexOf(t)), Infinity);
    const start = Math.max(0, firstPos - Math.floor(windowSize / 2));
    const end = Math.min(docLower.length, start + windowSize);
    return { start, end };
  }
  return null;
}

function renderCard(sectionEl, item, absTxtURL, snippetHTML) {
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `
    <header class="card-h">
      <div class="card-title">
        <a href="${absTxtURL}" target="_blank" rel="noopener">${item.title || '(untitled)'}</a>
      </div>
      <div class="meta">
        ${item.jurisdiction ? item.jurisdiction.toUpperCase() + ' · ' : ''}${item.year || ''} ${item.reference ? '· ' + item.reference : ''}
      </div>
    </header>
    <div class="snippet">${snippetHTML}</div>
    <footer class="card-f">
      <a class="mini" href="${absTxtURL}" target="_blank" rel="noopener">¶ open TXT</a>
    </footer>
  `;
  sectionEl.appendChild(card);
}

function updateCounts(tb, lw, rl) {
  qs('#counts').textContent = `Matches — Textbooks: ${tb} · Laws: ${lw} · Rules: ${rl}`;
}

async function searchAll(q) {
  const tokens = tokenize(q);
  const resTB = qs('#results-textbooks'); resTB.innerHTML = '';
  const resLW = qs('#results-laws');      resLW.innerHTML = '';
  const resRL = qs('#results-rules');     resRL.innerHTML = '';
  let cTB = 0, cLW = 0, cRL = 0;

  if (!tokens.length) { updateCounts(0,0,0); return; }

  const sources = [
    { key: 'textbooks', catalogURL: CATALOGS.textbooks, sectionEl: resTB },
    { key: 'laws',      catalogURL: CATALOGS.laws,      sectionEl: resLW },
    { key: 'rules',     catalogURL: CATALOGS.rules,     sectionEl: resRL },
  ];

  for (const src of sources) {
    let catalog;
    try { catalog = await fetchJSON(src.catalogURL); }
    catch (e) {
      const warn = document.createElement('div');
      warn.className = 'muted small';
      warn.textContent = `Fetch failed: ${src.key} catalog (${src.catalogURL})`;
      src.sectionEl.appendChild(warn);
      continue;
    }

    // Each entry must provide a relative TXT URL in url_txt
    const base = BASE_FOR[src.key];

    // light cap to keep UI snappy; increase later
    const MAX_PER_SECTION = 24;

    for (const item of catalog) {
      if (!item.url_txt) continue;
      const absTxtURL = new URL(item.url_txt, base).toString();

      let doc;
      try { doc = await fetchText(absTxtURL); }
      catch { continue; }

      const lower = doc.toLowerCase();
      const window = firstWindowContainingAll(lower, tokens, 420);
      if (!window) continue;

      const rawSnippet = doc.slice(window.start, window.end).replace(/\s+/g, ' ').trim();
      const snippet = highlight(rawSnippet, tokens);

      renderCard(src.sectionEl, item, absTxtURL, snippet);

      if (src.key === 'textbooks') cTB++;
      if (src.key === 'laws')      cLW++;
      if (src.key === 'rules')     cRL++;

      if ((src.key === 'textbooks' && cTB >= MAX_PER_SECTION) ||
          (src.key === 'laws'      && cLW >= MAX_PER_SECTION) ||
          (src.key === 'rules'     && cRL >= MAX_PER_SECTION)) {
        const more = document.createElement('div');
        more.className = 'muted small';
        more.textContent = 'Showing first results… refine your query to narrow further.';
        src.sectionEl.appendChild(more);
        break;
      }
    }
  }

  updateCounts(cTB, cLW, cRL);
}

function boot() {
  const q = readQuery();
  const input = qs('#q');
  if (q) input.value = q;

  qs('#search-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const qv = input.value.trim();
    writeQuery(qv);
    searchAll(qv);
  });

  if (q) searchAll(q);
}
document.addEventListener('DOMContentLoaded', boot);
