<script>
/* Law-Texts-ui — unified search across Textbooks + Laws + Rules
   - Exact AND matching for all tokens (space or + separated)
   - Simple inflection matching: each token matches token+\w*
   - In-browser normalization (fallback even if not pre-normalized)
   - Multi-snippet per doc with <mark> highlights
   - Safe CORS absolute URLs for all repos
*/

const TEXTBOOKS_CATALOG =
  'https://info1691.github.io/law-index/catalogs/ingest-catalog.json';
const LAWS_INDEX =
  'https://info1691.github.io/laws-ui/laws.json';
const RULES_INDEX =
  'https://info1691.github.io/rules-ui/rules.json';

// Bases to resolve relative url_txt in the laws/rules indexes
const LAWS_BASE = 'https://info1691.github.io/laws-ui/';
const RULES_BASE = 'https://info1691.github.io/rules-ui/';

// Tuning
const WINDOW_CHARS = 600;         // length of each snippet window
const MAX_SNIPPETS_PER_DOC = 3;   // how many windows per doc to show
const MAX_DOCS_PER_SECTION = 200; // keep high; UI will paginate naturally

// ---------- utils ----------
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function tokenize(raw){
  if(!raw) return [];
  // split by spaces or '+' and drop empties
  return raw.trim().toLowerCase().split(/[+\s]+/).filter(Boolean);
}

// simple content normalizer (fallback even if files are pre-normalized)
function normalize(txt){
  if(!txt) return '';
  return txt
    // common ligatures
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    // hyphenation at line breaks
    .replace(/-\s*\n\s*/g, '')
    // join wrapped lines
    .replace(/\r/g,'').replace(/\n{2,}/g, '\n\n').replace(/[ \t]+/g,' ')
    // non-breaking & odd spaces
    .replace(/\u00A0/g,' ')
    .trim();
}

async function fetchJSON(url){
  const r = await fetch(url, {mode:'cors', cache:'no-cache'});
  if(!r.ok) throw new Error(`Failed to fetch JSON: ${url}`);
  return r.json();
}

async function fetchText(url){
  const r = await fetch(url, {mode:'cors', cache:'no-cache'});
  if(!r.ok) throw new Error(`Failed to fetch TXT: ${url}`);
  return r.text();
}

function toAbs(base, maybeRel){
  try { return new URL(maybeRel, base).toString(); }
  catch { return maybeRel; }
}

// ---------- load catalogs ----------
async function loadTextbooks(){
  const cat = await fetchJSON(TEXTBOOKS_CATALOG);
  // expect array of items with url_txt absolute
  return cat.map(it => ({
    id: it.id || it.title,
    title: it.title || it.reference || it.id,
    source: 'textbooks',
    jurisdiction: it.jurisdiction || '',
    url: it.url_txt, // already absolute in public catalog
  }));
}

async function loadLaws(){
  const arr = await fetchJSON(LAWS_INDEX);
  return arr.map(it => ({
    id: it.id || it.title,
    title: it.title || it.reference || it.id,
    source: 'laws',
    jurisdiction: it.jurisdiction || '',
    url: toAbs(LAWS_BASE, it.url_txt),
  }));
}

async function loadRules(){
  const arr = await fetchJSON(RULES_INDEX);
  return arr.map(it => ({
    id: it.id || it.title,
    title: it.title || it.reference || it.id,
    source: 'rules',
    jurisdiction: it.jurisdiction || '',
    url: toAbs(RULES_BASE, it.url_txt),
  }));
}

async function loadAllDocs(){
  const [t, l, r] = await Promise.all([
    loadTextbooks().catch(()=>[]),
    loadLaws().catch(()=>[]),
    loadRules().catch(()=>[]),
  ]);
  return { textbooks: t, laws: l, rules: r };
}

// ---------- search engine ----------
function buildTokenRegexes(tokens){
  // e.g. "conflict" -> /\bconflict\w*/gi   (matches conflicts, conflicted)
  return tokens.map(t => new RegExp('\\b' + escapeRe(t) + '\\w*', 'gi'));
}

function findWindows(content, tokenRes){
  const windows = [];
  if(tokenRes.length === 0) return windows;

  // index all matches for the FIRST token, then test the others around it
  const first = tokenRes[0];
  let m;
  while ((m = first.exec(content)) !== null){
    const center = m.index;
    const start = Math.max(0, center - Math.floor(WINDOW_CHARS/2));
    const end   = Math.min(content.length, start + WINDOW_CHARS);
    const slice = content.slice(start, end);

    // all other tokens must occur in this slice
    const ok = tokenRes.slice(1).every(re => re.test(slice));
    // reset lastIndex for all regexes (since we reuse them)
    tokenRes.forEach(re => { re.lastIndex = 0; });

    if(ok){
      windows.push({ start, end, slice });
      if (windows.length >= MAX_SNIPPETS_PER_DOC) break;
    }
  }
  return windows;
}

function highlight(slice, tokenRes){
  // wrap matches with <mark>
  let html = slice;
  tokenRes.forEach(re => {
    html = html.replace(re, m => `<mark>${m}</mark>`);
  });
  return html;
}

async function searchDocs(docs, tokens){
  const tokenRes = buildTokenRegexes(tokens);
  const results = [];

  for (const doc of docs.slice(0, MAX_DOCS_PER_SECTION)){
    let txt;
    try {
      txt = await fetchText(doc.url);
    } catch {
      continue;
    }
    const norm = normalize(txt);

    // quick AND check: all tokens must exist somewhere in doc
    const hasAll = tokenRes.every(re => re.test(norm));
    tokenRes.forEach(re => re.lastIndex = 0);
    if(!hasAll) continue;

    const wins = findWindows(norm, tokenRes);
    if(wins.length){
      results.push({
        ...doc,
        snippets: wins.map(w => ({
          html: '…' + highlight(w.slice, tokenRes) + '…'
        }))
      });
    }
  }
  return results;
}

// ---------- render ----------
function sectionEl(id){
  return document.querySelector(`[data-section="${id}"]`);
}
function clearSection(id){
  sectionEl(id).innerHTML = `<div class="muted">No matches.</div>`;
}
function renderSection(id, items){
  const host = sectionEl(id);
  if(!items.length){ clearSection(id); return; }

  host.innerHTML = items.map(item => {
    const tags = item.source === 'textbooks' ? 'UK · Textbooks'
              : item.source === 'laws'      ? 'JERSEY · laws'
              :                               'JERSEY · rules';
    const snips = item.snippets.map(s =>
      `<div class="snippet">${s.html}</div>`
    ).join('');
    return `
      <article class="card">
        <header>
          <h3>${item.title}</h3>
          <div class="meta">${tags}</div>
        </header>
        ${snips}
        <footer><a class="open" href="${item.url}" target="_blank" rel="noopener">↗ open TXT</a></footer>
      </article>
    `;
  }).join('');
}

function setCounts(t, l, r){
  document.querySelector('[data-counts]').textContent =
    `Matches — Textbooks: ${t.length} · Laws: ${l.length} · Rules: ${r.length}`;
}

// ---------- controller ----------
async function runSearch(){
  const q = document.querySelector('[data-q]').value;
  const tokens = tokenize(q);
  if(tokens.length === 0){
    // clear
    sectionEl('textbooks').innerHTML = '';
    sectionEl('laws').innerHTML = '';
    sectionEl('rules').innerHTML = '';
    setCounts([],[],[]);
    return;
  }

  document.body.classList.add('busy');

  try{
    const all = await loadAllDocs();

    const [t, l, r] = await Promise.all([
      searchDocs(all.textbooks, tokens),
      searchDocs(all.laws, tokens),
      searchDocs(all.rules, tokens),
    ]);

    renderSection('textbooks', t);
    renderSection('laws', l);
    renderSection('rules', r);
    setCounts(t,l,r);

  } catch (e){
    console.error(e);
    alert('Search error: ' + e.message);
  } finally {
    document.body.classList.remove('busy');
  }
}

// wire UI
window.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-form]');
  form.addEventListener('submit', (e)=>{ e.preventDefault(); runSearch(); });
  // support pressing Enter in the field too
  document.querySelector('[data-q]').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); runSearch(); }
  });
});
</script>
