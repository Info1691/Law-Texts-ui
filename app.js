/* Law-Texts-ui — Safe Mode Reader (Rule 10 full file) */

/* ---------- configuration & elements ---------- */

// Robust base: prefer explicit, fall back to same-origin /law-index
const LAW_INDEX = (
  (window.LAW_INDEX_BASE || (location.origin + '/law-index'))
    .replace(/\/+$/, '') + '/'
);

// Fixed catalog path produced by ingest workflow
const CATALOG_URL = LAW_INDEX + 'catalogs/ingest-catalog.json';

// DOM hooks
const elLib   = document.getElementById('library');
const elDoc   = document.getElementById('doc');
const elStat  = document.getElementById('status');
const qInput  = document.getElementById('searchInput');
const btnPrev = document.getElementById('findPrev');
const btnNext = document.getElementById('findNext');

let currentText = '';
let hlMatches = [];
let hlIndex = -1;

/* ---------- helpers ---------- */

function setStatus(msg, isError = false) {
  elStat.textContent = msg || '';
  elStat.style.color = isError ? '#b91c1c' : 'var(--muted)';
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
}

/* ---------- catalog & library ---------- */

async function loadCatalog() {
  try {
    const res = await fetch(CATALOG_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // De-duplicate (e.g., "Litigating…" vs "litigating…") by a stable key
    const items = Array.isArray(data) ? data : [];
    const dedup = new Map(
      items.map(it => {
        const key =
          String(it.slug || `${it.title}|${it.jurisdiction}|${it.year}`)
            .toLowerCase();
        return [key, it];
      })
    );

    renderLibrary([...dedup.values()]);
  } catch (e) {
    elLib.textContent = 'Failed to load catalog.';
    setStatus(`Catalog error (${CATALOG_URL}): ${e.message}`, true);
  }
}

function renderLibrary(items) {
  elLib.innerHTML = '';
  if (!items.length) {
    elLib.textContent = 'No items published yet.';
    return;
  }

  items.sort(
    (a, b) =>
      (b.year || 0) - (a.year || 0) ||
      String(a.title).localeCompare(String(b.title))
  );

  for (const it of items) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'item';
    const juris = (it.jurisdiction || '').toUpperCase();
    const year = it.year ? ` · ${it.year}` : '';
    a.textContent = `${it.title} ${juris}${year}`;
    a.addEventListener('click', ev => {
      ev.preventDefault();
      openItem(it);
    });
    elLib.appendChild(a);
  }
}

/* ---------- open & show text ---------- */

async function openItem(item) {
  resetSearch();

  if (!item.txt) {
    elDoc.textContent = 'This item has no TXT artifact.';
    setStatus('No text artifact declared.');
    return;
  }

  const url = LAW_INDEX + String(item.txt).replace(/^\/+/, '');
  elDoc.textContent = 'Loading…';
  setStatus(`Fetching ${item.title}…`);

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    currentText = text;
    elDoc.textContent = text;
    setStatus(`Loaded: ${item.title}`);
    qInput.focus();
  } catch (e) {
    elDoc.textContent = 'Failed to load text for this item.';
    setStatus(`Load error (${url}): ${e.message}`, true);
  }
}

/* ---------- find-in-document (client-side) ---------- */

function resetSearch() {
  hlMatches = [];
  hlIndex = -1;
  qInput.value = '';
  elDoc.innerHTML = escapeHTML(currentText || '');
  setStatus('');
  updateFindCount();
}

function updateFindCount() {
  const c = document.getElementById('findCount');
  if (!c) return;
  c.textContent = hlMatches.length ? `${hlIndex + 1} / ${hlMatches.length}` : '';
}

function highlightAll(query) {
  if (!query || !currentText) {
    resetSearch();
    return;
  }

  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re  = new RegExp(esc, 'gi');

  const parts   = currentText.split(re);
  const matches = currentText.match(re) || [];

  let html = '';
  for (let i = 0; i < parts.length; i++) {
    html += escapeHTML(parts[i]);
    if (i < matches.length) {
      html += `<mark class="hl">${escapeHTML(matches[i])}</mark>`;
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

/* ---------- events ---------- */

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

/* ---------- boot ---------- */

loadCatalog();
