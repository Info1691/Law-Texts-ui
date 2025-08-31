/* Search across Textbooks (public), Laws (local), Rules (local)
   - AND logic: every term must appear within the same window
   - Highlights matches and shows multiple snippets per doc
   - Robust to slight catalog shape differences (url_txt/url/href)
*/

const SECTIONS = [
  {
    key: 'textbooks',
    title: 'Textbooks',
    // Public catalog of ingested books
    catalog: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
    map: (it) => ({
      id: it.id || it.reference || it.title,
      title: it.title || it.reference || '(untitled)',
      href: it.url_txt || it.url || it.href || it.urlTxt || '',
      meta: [
        (it.jurisdiction || '').toUpperCase(),
        it.year ? String(it.year) : '',
        'textbooks'
      ].filter(Boolean).join(' · ')
    })
  },
  {
    key: 'laws',
    title: 'Laws',
    catalog: './laws.json',
    map: (it) => ({
      id: it.id || it.reference || it.title,
      title: it.title || it.reference || '(untitled)',
      href: it.url_txt || it.url || it.href || '',
      meta: [
        (it.jurisdiction || '').toUpperCase(),
        it.reference || '',
        'laws'
      ].filter(Boolean).join(' · ')
    })
  },
  {
    key: 'rules',
    title: 'Rules',
    catalog: './rules.json',
    map: (it) => ({
      id: it.id || it.reference || it.title,
      title: it.title || it.reference || '(untitled)',
      href: it.url_txt || it.url || it.href || '',
      meta: [
        (it.jurisdiction || '').toUpperCase(),
        it.reference || '',
        'rules'
      ].filter(Boolean).join(' · ')
    })
  }
];

const qs = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => [...el.querySelectorAll(sel)];

const countsEl   = qs('[data-counts]');
const inputEl    = qs('input[data-q]');
const formEl     = qs('form[data-form="search"]');

formEl.addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
window.addEventListener('DOMContentLoaded', () => {
  // allow ?q=term in URL
  const u = new URL(location.href);
  const pre = u.searchParams.get('q');
  if (pre) inputEl.value = pre;
  runSearch();
});

function termsFrom(q){
  return (q || '').toLowerCase()
    .replace(/[“”‘’]/g,'"')
    .split(/[\s+]+/)            // spaces or '+' act as AND
    .map(t => t.trim())
    .filter(Boolean);
}

async function runSearch(){
  const q = inputEl.value.trim();
  const terms = termsFrom(q);
  // clear old
  for (const s of SECTIONS) qs(`section[data-section="${s.key}"]`).innerHTML = '';
  updateCounts({textbooks:0, laws:0, rules:0});

  if (!q) return;

  // fetch catalogs in parallel
  const catalogs = await Promise.all(SECTIONS.map(loadCatalogSafe));
  const byKey = Object.fromEntries(SECTIONS.map((s,i) => [s.key, catalogs[i]]));

  // search each section
  for (const s of SECTIONS) {
    await searchSection(s.key, byKey[s.key], terms);
  }
}

function updateCounts(obj){
  countsEl.textContent = `Matches — Textbooks: ${obj.textbooks||0} · Laws: ${obj.laws||0} · Rules: ${obj.rules||0}`;
}

async function loadCatalogSafe(section){
  try{
    const res = await fetch(section.catalog, { cache: 'no-store' });
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json.items || []);
    const mapped = arr.map(section.map).filter(x => !!x.href);
    return mapped;
  }catch(err){
    console.warn('Catalog load failed:', section.title, err);
    return [];
  }
}

async function searchSection(key, items, terms){
  const container = qs(`section[data-section="${key}"]`);
  if (!items.length){
    container.insertAdjacentHTML('beforeend',
      `<div class="muted">No items found in ${key} catalog.</div>`);
    return;
  }

  let total = 0;

  // We’ll cap fetch concurrency a little to avoid mobile overload
  const chunk = 3;
  for (let i=0; i<items.length; i+=chunk){
    const slice = items.slice(i, i+chunk);
    const texts = await Promise.all(slice.map(getTextSafe));
    slice.forEach((item, idx) => {
      if (!texts[idx] || !texts[idx].ok){
        container.insertAdjacentHTML('beforeend',
          `<div class="muted">Fetch failed: ${escapeHTML(item.title)} (<a href="${escapeAttr(item.href)}" target="_blank" rel="noopener">${escapeHTML(item.href)}</a>)</div>`);
        return;
      }
      const txt = texts[idx].text;
      const snippets = findSnippets(txt, terms, 420, 6);
      if (snippets.length){
        total += snippets.length;
        const snippetHTML = snippets.map(s => `<p>${highlightTerms(s, terms)}</p>`).join('');
        container.insertAdjacentHTML('beforeend', `
          <article class="card">
            <div class="meta">${escapeHTML(item.meta || '')}</div>
            <h3><a href="${escapeAttr(item.href)}" target="_blank" rel="noopener">${escapeHTML(item.title)}</a></h3>
            ${snippetHTML}
            <p class="open"><a href="${escapeAttr(item.href)}" target="_blank" rel="noopener">open TXT</a></p>
          </article>
        `);
      }
    });
  }

  // bump counts
  const current = countsEl.textContent.match(/Textbooks:\s*(\d+).*Laws:\s*(\d+).*Rules:\s*(\d+)/);
  const now = { textbooks:0, laws:0, rules:0 };
  if (current) { now.textbooks = +current[1]; now.laws = +current[2]; now.rules = +current[3]; }
  now[key] = total;
  updateCounts(now);
}

async function getTextSafe(item){
  try{
    // Resolve relative paths safely
    const href = new URL(item.href, location.href).toString();
    const res = await fetch(href, { cache:'no-store' });
    if (!res.ok) return { ok:false };
    const text = await res.text();
    return { ok:true, text };
  }catch(e){
    return { ok:false };
  }
}

function findSnippets(text, terms, window=420, maxPerDoc=6){
  if (!terms.length) return [];
  const lower = text.toLowerCase();
  const needles = terms.slice();

  // choose the rarest term as anchor for efficiency
  let anchor = needles[0], minCount = Infinity;
  for (const t of needles){
    const c = countOccur(lower, t);
    if (c < minCount){ minCount=c; anchor=t; }
  }

  const out = [];
  let startIdx = 0;
  while (out.length < maxPerDoc){
    const idx = lower.indexOf(anchor, startIdx);
    if (idx === -1) break;
    const s = Math.max(0, idx - window);
    const e = Math.min(text.length, idx + anchor.length + window);
    const chunkLower = lower.slice(s, e);

    const ok = needles.every(t => chunkLower.indexOf(t) !== -1);
    if (ok){
      out.push(text.slice(s, e));
      startIdx = idx + anchor.length;
    } else {
      startIdx = idx + anchor.length;
    }
  }
  return out;
}

function highlightTerms(snippet, terms){
  // simple, case-insensitive highlight
  let html = escapeHTML(snippet);
  for (const t of [...terms].sort((a,b)=>b.length-a.length)){
    const re = new RegExp(`(${escapeReg(t)})`,'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

// helpers
function countOccur(s, needle){
  let c=0, i=0;
  while ((i = s.indexOf(needle, i)) !== -1){ c++; i += needle.length; }
  return c;
}
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escapeAttr(s){ return escapeHTML(s); }
function escapeReg(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
