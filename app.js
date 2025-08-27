/* Law-Texts-ui — Safe Mode Reader
   Loads catalog from this repo: /texts/catalog.json
   and fetches TXT artifacts from /texts/... paths.
*/

const BASE = (window.UI_BASE || '').replace(/\/+$/, '') + '/';
const CATALOG_URL = BASE + 'texts/catalog.json';

const elLib   = document.getElementById('library');
const elDoc   = document.getElementById('doc');
const elStat  = document.getElementById('status');
const qInput  = document.getElementById('searchInput');
const btnPrev = document.getElementById('findPrev');
const btnNext = document.getElementById('findNext');

let currentText = '';
let hlMatches = [];
let hlIndex = -1;

function setStatus(msg, isError = false) {
  elStat.textContent = msg || '';
  elStat.style.color = isError ? '#b91c1c' : 'var(--muted)';
}

async function loadCatalog() {
  try {
    const res = await fetch(CATALOG_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderLibrary(Array.isArray(data) ? data : []);
  } catch (e) {
    elLib.textContent = 'Failed to load catalog.';
    setStatus(`Catalog error: ${e.message}`, true);
  }
}

function renderLibrary(items) {
  elLib.innerHTML = '';
  if (!items.length) {
    elLib.textContent = 'No items published yet.';
    return;
  }
  items.sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.title).localeCompare(b.title));
  for (const it of items) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'item';
    a.textContent = `${it.title} ${(it.jurisdiction || '').toUpperCase()}${it.year ? ' · ' + it.year : ''}`;
    a.addEventListener('click', ev => {
      ev.preventDefault();
      openItem(it);
    });
    elLib.appendChild(a);
  }
}

async function openItem(item) {
  resetSearch();
  if (!item.txt) {
    elDoc.textContent = 'This item has no TXT artifact.';
    setStatus('');
    return;
  }
  // If txt is absolute (http/https), use it; otherwise load from this repo.
  const href = /^https?:\/\//i.test(item.txt)
    ? item.txt
    : BASE + item.txt.replace(/^\/+/, '');

  elDoc.textContent = 'Loading…';
  setStatus(`Fetching ${item.title}…`);

  try {
    const res = await fetch(href, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    currentText = text;
    elDoc.textContent = text;  // CSS should use white-space: pre-wrap
    setStatus(`Loaded: ${item.title}`);
    qInput.focus();
  } catch (e) {
    elDoc.textContent = 'Failed to load text for this item.';
    setStatus(`Load error: ${e.message}`, true);
  }
}

function resetSearch() {
  hlMatches = [];
  hlIndex = -1;
  qInput.value = '';
  elDoc.innerHTML = (currentText || '').replace(/[&<>]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[s]));
  setStatus('');
  updateFindCount();
}

function updateFindCount() {
  const c = document.getElementById('findCount');
  c.textContent = hlMatches.length ? `${hlIndex + 1} / ${hlMatches.length}` : '';
}

function highlightAll(query) {
  if (!query || !currentText) {
    resetSearch();
    return;
  }
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'gi');

  const parts = currentText.split(re);
  const matches = currentText.match(re) || [];
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    html += parts[i].replace(/[&<>]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[s]));
    if (i < matches.length) {
      const m = matches[i];
      html += `<mark class="hl">${m.replace(/[&<>]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[s]))}</mark>`;
    }
  }
  elDoc.innerHTML = html;
  hlMatches = Array.from(elDoc.querySelectorAll('mark.hl'));
  hlIndex = hlMatches.length ? 0 : -1;
  updateFindCount();
  if (hlIndex >= 0) scrollToHL(hlIndex);
}

function scrollToHL(i) {
  const node = hlMatches[i];
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

btnNext.addEventListener('click', () => {
  if (!hlMatches.length) return;
  hlIndex = (hlIndex + 1) % hlMatches.length;
  updateFindCount();
  scrollToHL(hlIndex);
});

btnPrev.addEventListener('click', () => {
  if (!hlMatches.length) return;
  hlIndex = (hlIndex - 1 + hlMatches.length) % hlMatches.length;
  updateFindCount();
  scrollToHL(hlIndex);
});

qInput.addEventListener('input', e => highlightAll(e.target.value.trim()));

loadCatalog();
