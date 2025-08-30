/* ---------------------------------------------------------
   Trust Law Textbooks — Search (beta)
   Unified search over: Textbooks (public catalog) + Laws + Rules
   - AND with "+" or spaces (beneficiary+consent+litigation)
   - Phrases with "quotes" (e.g. "beddoe order")
   - Simple stemming & synonyms (conflict→conflicts/conflicted, etc.)
   - Finds passages where ALL terms occur in the same window
   - Shows quotable snippets with <mark> and link to TXT
   --------------------------------------------------------- */

const ENDPOINTS = {
  textbooksCatalog: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  lawsIndex:        'https://info1691.github.io/laws-ui/laws.json',
  rulesIndex:       'https://info1691.github.io/rules-ui/rules.json',
};

const WINDOW_CHARS = 1600;   // size of each snippet window
const MAX_SNIPPETS = 6;      // per source
const FETCH_TIMEOUT_MS = 30000;

const $ = (sel, root=document) => root.querySelector(sel);

// Basic helpers
const norm = s => (s||'').toLowerCase().normalize('NFKC');
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function withTimeout(p, ms=FETCH_TIMEOUT_MS){
  let t; const timeout = new Promise((_,rej)=>t=setTimeout(()=>rej(new Error('timeout')), ms));
  return Promise.race([p.finally(()=>clearTimeout(t)), timeout]);
}

async function getJSON(url){
  const res = await withTimeout(fetch(url, {cache:'no-store'}));
  if(!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}
async function getTXT(url){
  const res = await withTimeout(fetch(url, {cache:'force-cache'}));
  if(!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

/* ------------------ Query parsing ------------------ */
// tiny synonym/variant map
const SYN = {
  trust: ['trust','trusts','trustee','trustees'],
  trustee: ['trustee','trustees'],
  beneficiary: ['beneficiary','beneficiaries'],
  consent: ['consent','consented','consenting','consents'],
  conflict: ['conflict','conflicts','conflicted','conflicting'],
  litigation: ['litigation','litigate','litigated','litigating'],
  cost: ['cost','costs','costing','costed'],
  beddoe: ['beddoe'],
};

function expandTerm(t){
  const x = norm(t);
  const bag = new Set([x]);
  if(SYN[x]) SYN[x].forEach(v=>bag.add(v));
  // light suffixing for unknowns
  if(!SYN[x]) ['s','es','ed','ing'].forEach(s=>bag.add(x+s));
  return [...bag];
}

function parseQuery(q){
  q = norm(q).trim();
  const phrases = [];
  q = q.replace(/"([^"]+)"/g, (_,m)=>{ phrases.push(m.trim()); return ' '; });
  const parts = (q.includes('+') ? q.split('+') : q.split(/\s+/))
                .map(s=>s.trim()).filter(Boolean);
  const groups = parts.map(p => expandTerm(p).map(v=>new RegExp(`\\b${escapeRx(v)}\\b`, 'i')));
  const phraseRx = phrases.map(p=>new RegExp(`\\b${escapeRx(p)}\\b`, 'i'));
  return {groups, phraseRx};
}

function windowHasAll(text, groups, phraseRx){
  // AND across groups; each group is OR of its variants
  for(const rx of phraseRx){ if(!rx.test(text)) return false; }
  return groups.every(g => g.some(rx => rx.test(text)));
}

function highlight(text, groups, phraseRx){
  const rxs = [...phraseRx, ...groups.flat()];
  return rxs.reduce((acc, rx)=>acc.replace(rx, m=>`<mark>${m}</mark>`), text);
}

/* ------------------ Sources ------------------ */
function abs(base, rel){
  if(/^https?:\/\//i.test(rel)) return rel;
  // strip leading "./"
  const path = rel.replace(/^\.\//,'');
  return `${base.replace(/\/$/,'')}/${path}`;
}

async function loadTextbooks(){
  const catalog = await getJSON(ENDPOINTS.textbooksCatalog);
  // catalog expected: [{ title, jurisdiction, url_txt, id, year, reference }]
  return catalog.map(it => ({
    type: 'textbook',
    title: it.title || it.id,
    jurisdiction: it.jurisdiction || '',
    year: it.year || '',
    reference: it.reference || '',
    url: it.url_txt,
  }));
}

async function loadLaws(){
  const base = 'https://info1691.github.io/laws-ui';
  const arr = await getJSON(ENDPOINTS.lawsIndex);
  // laws.json: [{title, jurisdiction, year, id, url_txt:'./data/laws/jersey/JTL-1984.txt'}]
  return arr.map(it=>({
    type: 'laws',
    title: it.title || it.id,
    jurisdiction: it.jurisdiction || '',
    year: it.year || '',
    reference: it.reference || '',
    url: abs(base, it.url_txt),
  }));
}

async function loadRules(){
  const base = 'https://info1691.github.io/rules-ui';
  const arr = await getJSON(ENDPOINTS.rulesIndex);
  return arr.map(it=>({
    type: 'rules',
    title: it.title || it.id,
    jurisdiction: it.jurisdiction || '',
    year: it.year || '',
    reference: it.reference || '',
    url: abs(base, it.url_txt),
  }));
}

/* ------------------ Search engine ------------------ */
async function findInDoc(meta, qMatchers){
  let text;
  try { text = await getTXT(meta.url); }
  catch { return []; }

  const hay = text;               // full-file search (no truncation)
  const hits = [];

  // Build a “seed” regex that hits any variant (for fast scanning)
  const anyTokens = [...qMatchers.phraseRx, ...qMatchers.groups.flat()];
  // If nothing to match, bail.
  if(!anyTokens.length) return [];

  // crude “find seeds” by taking every base variant pattern
  const seed = new RegExp(anyTokens.map(rx=>rx.source).join('|'), 'gi');
  let m;
  while((m = seed.exec(hay)) && hits.length < MAX_SNIPPETS){
    const idx = m.index;
    const start = Math.max(0, idx - Math.floor(WINDOW_CHARS/2));
    const end = Math.min(hay.length, start + WINDOW_CHARS);
    const win = hay.slice(start, end);

    if(windowHasAll(win, qMatchers.groups, qMatchers.phraseRx)){
      const snippet = highlight(
        (start>0?'…':'') + win + (end<hay.length?'…':''),
        qMatchers.groups,
        qMatchers.phraseRx
      );
      hits.push({
        meta,
        snippet,
        paragraph: approxParagraphNumber(hay, start),
      });
    }
  }
  return hits;
}

function approxParagraphNumber(text, offset){
  // Lightweight: count newlines before offset
  const head = text.slice(0, offset);
  const lines = head.split(/\n/).length;
  return lines; // “¶ open TXT” will open file top; number is indicative only
}

/* ------------------ UI ------------------ */
function renderHeaderCounts(counts){
  const {tb=0, laws=0, rules=0} = counts;
  const hdr = $(`#counts`);
  if(hdr) hdr.textContent = `Matches — Textbooks: ${tb} · Laws: ${laws} · Rules: ${rules}`;
}

function cardHTML(hit){
  const {meta, snippet, paragraph} = hit;
  const badge = meta.type === 'textbook' ? 'Textbooks' : (meta.type === 'laws' ? 'Laws' : 'Rules');
  const sub = [meta.jurisdiction?.toUpperCase(), meta.year, badge].filter(Boolean).join(' · ');
  return `
  <article class="result">
    <h3 class="title"><a href="${meta.url}" target="_blank" rel="noopener">${escapeHTML(meta.title)}</a></h3>
    <div class="subtle">${escapeHTML(sub)}</div>
    <p class="snippet">${snippet}</p>
    <div class="actions">
      <a class="open" href="${meta.url}" target="_blank" rel="noopener">¶ open TXT</a>
    </div>
  </article>`;
}

function escapeHTML(s){ return (s||'').replace(/[&<>"']/g,c=>({&:'&amp;',<:'&lt;',>:'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function section(selTitle){
  return {
    root: $(selTitle).nextElementSibling,
    clear(){ this.root.innerHTML = ''; },
    add(hit){ this.root.insertAdjacentHTML('beforeend', cardHTML(hit)); }
  };
}

async function runSearch(q){
  const qStr = q.trim();
  if(!qStr) return;

  // UI state
  renderHeaderCounts({tb:0,laws:0,rules:0});
  const tbSec = section('#sec-textbooks');
  const lawSec = section('#sec-laws');
  const rulSec = section('#sec-rules');
  tbSec.clear(); lawSec.clear(); rulSec.clear();

  // Load sources in parallel
  let [tbs, laws, rules] = await Promise.all([
    loadTextbooks(), loadLaws(), loadRules()
  ]);

  const matchers = parseQuery(qStr);

  // Search each corpus (limit concurrency to avoid hammering)
  async function searchList(list){
    const results = [];
    // small concurrency pool
    const poolSize = 4;
    let i = 0;
    async function worker(){
      while(i < list.length){
        const meta = list[i++];
        const hits = await findInDoc(meta, matchers);
        hits.forEach(h=>results.push(h));
      }
    }
    await Promise.all(Array.from({length:poolSize}, worker));
    return results;
  }

  const [tbHits, lawHits, ruleHits] = await Promise.all([
    searchList(tbs), searchList(laws), searchList(rules)
  ]);

  renderHeaderCounts({tb: tbHits.length, laws: lawHits.length, rules: ruleHits.length});
  tbHits.forEach(h=>tbSec.add(h));
  lawHits.forEach(h=>lawSec.add(h));
  ruleHits.forEach(h=>rulSec.add(h));
}

/* ------------------ Bootstrap ------------------ */
function wire(){
  const form = $('#qform');
  const input = $('#q');
  const counts = document.createElement('div');
  counts.id = 'counts';
  counts.className = 'counts';
  const bar = $('.intro');
  if(bar) bar.insertAdjacentElement('afterend', counts);

  form?.addEventListener('submit', (e)=>{
    e.preventDefault();
    runSearch(input.value);
  });

  // If q= in URL, run once
  const params = new URLSearchParams(location.search);
  const q = params.get('q') || '';
  if(q){
    input.value = q;
    runSearch(q);
  }
}
document.addEventListener('DOMContentLoaded', wire);
