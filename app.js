/* Law-Texts-ui — Catalog-only UI (safe, brand-consistent) */

// Where to read artifacts from (must end with a slash after normalization)
const LAW_INDEX = (String(window.LAW_INDEX_BASE || '')).replace(/\/?$/, '/');

// Primary and fallback catalogs
const PRIMARY_CATALOG  = LAW_INDEX + 'catalogs/ingest-catalog.json';
const FALLBACK_CATALOG = 'texts/catalog.json'; // local, for dev/bootstrap

// DOM
const elLib  = document.getElementById('library');
const elStat = document.getElementById('status');
const elSrc  = document.getElementById('sourcePath');

// Guard if HTML isn't in place
if (!elLib || !elStat || !elSrc) {
  console.error('Init error: required DOM nodes missing');
}

function status(msg, isError = false) {
  if (!elStat) return;
  elStat.textContent = msg || '';
  elStat.style.color = isError ? '#b91c1c' : 'var(--muted)';
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function normalizeItem(raw) {
  // Accept items from ingest (law-index) or local texts catalog
  const it = { ...raw };
  it.slug         = String(it.slug || '').trim();
  it.title        = String(it.title || '').trim();
  it.jurisdiction = String(it.jurisdiction || '').trim();
  it.reference    = String(it.reference || '').trim();
  it.kind         = String(it.kind || '').trim();
  it.year         = it.year ? Number(it.year) : undefined;
  it.txt          = it.txt ? String(it.txt) : '';
  it.pageMap      = it.pageMap ? String(it.pageMap) : (it['page-map'] || '');
  return it;
}

function dedupe(items) {
  // Prefer uniqueness by TXT path; fallback to slug; lastly title|year
  const map = new Map();
  for (const r of items) {
    const it  = normalizeItem(r);
    const key = it.txt || it.slug || `${it.title}|${it.year || ''}`;
    if (!key) continue;
    map.set(key.toLowerCase(), it); // last one wins
  }
  return Array.from(map.values());
}

function sortItems(items) {
  return items.sort((a, b) =>
    (b.year || 0) - (a.year || 0) ||
    String(a.jurisdiction).localeCompare(b.jurisdiction) ||
    String(a.title).localeCompare(b.title)
  );
}

function card(item) {
  const hasTxt = !!item.txt;
  const hasMap = !!item.pageMap;

  const wrap = document.createElement('article');
  wrap.className = 'card';

  const h = document.createElement('h3');
  h.textContent = item.title || '(untitled)';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const j = (item.jurisdiction || '').toUpperCase();
  const y = item.year ? ` · ${item.year}` : '';
  meta.textContent = `${j}${y}${item.reference ? ' · ' + item.reference : ''}`;

  const chips = document.createElement('div');
  chips.className = 'chips';

  // Slug chip (handy for quick diagnosis of duplicates)
  if (item.slug) {
    const slug = document.createElement('span');
    slug.className = 'chip soft';
    slug.textContent = item.slug;
    chips.appendChild(slug);
  }

  // TXT button
  if (hasTxt) {
    const a = document.createElement('a');
    a.className = 'chip';
    a.textContent = 'TXT';
    a.href = LAW_INDEX + item.txt.replace(/^\/+/, '');
    a.target = '_blank';
    a.rel = 'noopener';
    chips.appendChild(a);
  } else {
    const d = document.createElement('span');
    d.className = 'chip disabled';
    d.textContent = 'TXT';
    chips.appendChild(d);
  }

  // Page-map button (optional)
  if (hasMap) {
    const a = document.createElement('a');
    a.className = 'chip';
    a.textContent = 'Page-map';
    a.href = LAW_INDEX + item.pageMap.replace(/^\/+/, '');
    a.target = '_blank';
    a.rel = 'noopener';
    chips.appendChild(a);
  }

  wrap.appendChild(h);
  wrap.appendChild(meta);
  wrap.appendChild(chips);
  return wrap;
}

function render(items) {
  if (!elLib) return;
  elLib.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.textContent = 'No items published yet.';
    elLib.appendChild(p);
    return;
  }
  for (const it of sortItems(items)) {
    elLib.appendChild(card(it));
  }
}

async function load() {
  try {
    if (elSrc) elSrc.textContent = 'catalogs/ingest-catalog.json';
    status('Loading catalog…');

    let data = await fetchJSON(PRIMARY_CATALOG);

    // If primary is empty, try local fallback; else merge fallback (if present)
    if (!Array.isArray(data) || data.length === 0) {
      try {
        const local = await fetchJSON(FALLBACK_CATALOG);
        data = Array.isArray(local) ? local : [];
        if (elSrc) elSrc.textContent = 'texts/catalog.json (fallback)';
      } catch {
        // still empty
      }
    } else {
      try {
        const local = await fetchJSON(FALLBACK_CATALOG);
        if (Array.isArray(local) && local.length) {
          data = [...data, ...local];
          if (elSrc) elSrc.textContent = 'catalogs/ingest-catalog.json (+ local fallback)';
        }
      } catch { /* ignore */ }
    }

    const unique = dedupe(Array.isArray(data) ? data : []);
    render(unique);
    status(`Loaded ${unique.length} item(s).`);
  } catch (e) {
    render([]);
    status(`Catalog error: ${e.message}`, true);
  }
}

document.addEventListener('DOMContentLoaded', load);
