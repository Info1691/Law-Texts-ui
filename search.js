/* ---------- CONFIG: absolute catalogs (works from anywhere) ---------- */
const CATALOGS = {
  textbooks: "https://info1691.github.io/law-index/catalogs/ingest-catalog.json",
  laws:      "https://info1691.github.io/laws-ui/laws.json",
  rules:     "https://info1691.github.io/rules-ui/rules.json",
};

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const norm = (s='') => s.normalize('NFKD').toLowerCase();
const words = (q) => norm(q).split(/[\s+]+/).filter(Boolean);

/* highlight and snippet around first hit while checking that
   ALL query terms occur within a local window (~400 chars) */
function makeSnippet(txt, terms, window=400) {
  const L = norm(txt);
  // anchor on the earliest occurrence among query terms
  let pos = Infinity;
  for (const t of terms) {
    const p = L.indexOf(t);
    if (p >= 0 && p < pos) pos = p;
  }
  if (!isFinite(pos)) return null;

  // ensure every term appears within a window around anchor
  const start = Math.max(0, pos - Math.floor(window/2));
  const end   = Math.min(txt.length, start + window);
  const raw   = txt.slice(start, end);

  const sliceL = norm(raw);
  for (const t of terms) {
    if (!sliceL.includes(t)) return null; // fail local AND window
  }

  // highlight
  let html = raw;
  for (const t of terms.sort((a,b)=>b.length-a.length)) {
    if (!t) continue;
    const rx = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');
    html = html.replace(rx, '<mark>$1</mark>');
  }
  return (start>0 ? '…' : '') + html + (end<txt.length ? '…' : '');
}

function elResult(item, snippet, pillar) {
  const wrap = document.createElement('div');
  wrap.className = 'result';
  const meta = `
    <div class="meta">
      ${item.jurisdiction ? `<span class="badge">${item.jurisdiction.toUpperCase()}</span>`:''}
      ${item.year ? `<span class="badge">${item.year}</span>`:''}
      <span class="badge">${pillar}</span>
    </div>`;
  wrap.innerHTML = `
    <div class="rowtop">
      <a href="${item.url_txt}" class="title"><strong>${item.title || item.id || 'Untitled'}</strong></a>
      <a class="open" href="${item.url_txt}">open TXT</a>
    </div>
    ${meta}
    <div class="snippet">${snippet}</div>
  `;
  return wrap;
}

/* ---------- fetchers ---------- */
async function fetchJSON(url) {
  const r = await fetch(url, {mode:'cors'});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}
async function fetchTXT(url) {
  const r = await fetch(url, {mode:'cors'});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.text();
}

/* ---------- search logic ---------- */
async function loadCatalog(kind, url) {
  try {
    const arr = await fetchJSON(url);
    // expect objects that include: id, title, jurisdiction, year, url_txt
    return arr.filter(x => x && (x.url_txt || x.url || x.href)).map(x => ({
      id: x.id,
      title: x.title,
      jurisdiction: x.jurisdiction,
      year: x.year,
      url_txt: x.url_txt || x.url || x.href
    }));
  } catch (e) {
    const line = document.createElement('div');
    line.className = 'err';
    line.textContent = `${kind} catalog error: ${e.message}`;
    $(`sec-${kind}`).appendChild(line);
    return [];
  }
}

async function searchOnePillar(kind, items, terms) {
  const out = $(`sec-${kind}`);
  out.innerHTML = '';
  let hits = 0;

  // small collections: fetch sequentially for simplicity
  for (const item of items) {
    if (!item.url_txt) continue;
    try {
      const txt = await fetchTXT(item.url_txt);
      const snippet = makeSnippet(txt, terms);
      if (snippet) {
        out.appendChild(elResult(item, snippet, kind));
        hits++;
      }
    } catch (e) {
      const warn = document.createElement('div');
      warn.className = 'err';
      warn.textContent = `Fetch failed: ${item.title || item.id} (${item.url_txt})`;
      out.appendChild(warn);
    }
  }
  return hits;
}

async function runSearch(q) {
  const t = words(q);
  if (t.length === 0) {
    $('counts').textContent = 'Matches — Textbooks: 0 · Laws: 0 · Rules: 0';
    ['textbooks','laws','rules'].forEach(k => $(`sec-${k}`).innerHTML='');
    return;
  }

  // load catalogs (absolute URLs so this works from /search.html anywhere)
  const [textbooks, laws, rules] = await Promise.all([
    loadCatalog('textbooks', CATALOGS.textbooks),
    loadCatalog('laws',      CATALOGS.laws),
    loadCatalog('rules',     CATALOGS.rules),
  ]);

  const [hT, hL, hR] = await Promise.all([
    searchOnePillar('textbooks', textbooks, t),
    searchOnePillar('laws',      laws,      t),
    searchOnePillar('rules',     rules,     t),
  ]);

  $('counts').textContent = `Matches — Textbooks: ${hT} · Laws: ${hL} · Rules: ${hR}`;
}

/* ---------- wire up UI ---------- */
(function init(){
  const params = new URLSearchParams(location.search);
  const q0 = params.get('q') || '';
  $('q').value = q0;
  $('form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const q = $('q').value.trim();
    const p = new URLSearchParams(location.search);
    if (q) p.set('q', q); else p.delete('q');
    const next = `${location.pathname}?${p.toString()}`;
    history.replaceState({}, '', next);
    runSearch(q);
  });
  if (q0) runSearch(q0);
})();
