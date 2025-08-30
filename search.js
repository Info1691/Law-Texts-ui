/* ---------------------------------------------------------
   Trust Law Textbooks — Search (beta)  (v1.1)
   Unified search over: Textbooks (public catalog) + Laws + Rules
   - AND with "+" or spaces (beneficiary+consent+litigation)
   - Phrases with "quotes" (e.g. "beddoe order")
   - Variants & key phrases (conflict/conflicts/conflicted/conflicting,
     conflict-of-interest, beneficiaries/beneficiary, consent/consented…)
   - Matches when ALL terms occur in the SAME passage window
   - Searches ENTIRE TXT files and shows marked snippets
   --------------------------------------------------------- */

const ENDPOINTS = {
  textbooksCatalog: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  lawsIndex:        'https://info1691.github.io/laws-ui/laws.json',
  rulesIndex:       'https://info1691.github.io/rules-ui/rules.json',
};

const WINDOW_CHARS = 1600;
const MAX_SNIPPETS = 6;
const FETCH_TIMEOUT_MS = 30000;

const $ = (s,r=document)=>r.querySelector(s);
const norm = s => (s||'').toLowerCase().normalize('NFKC');
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function withTimeout(p, ms=FETCH_TIMEOUT_MS){
  let t; const timeout = new Promise((_,rej)=>t=setTimeout(()=>rej(new Error('timeout')), ms));
  return Promise.race([p.finally(()=>clearTimeout(t)), timeout]);
}
async function getJSON(url){ const r=await withTimeout(fetch(url,{cache:'no-store'})); if(!r.ok) throw new Error(`${url} → ${r.status}`); return r.json(); }
async function getTXT(url){ const r=await withTimeout(fetch(url,{cache:'force-cache'})); if(!r.ok) throw new Error(`${url} → ${r.status}`); return r.text(); }

/* ------------------ Query parsing ------------------ */
// Core variant dictionary + phrases
const SYN = {
  trust:        ['trust','trusts','trustee','trustees'],
  trustee:      ['trustee','trustees'],
  beneficiary:  ['beneficiary','beneficiaries'],
  consent:      ['consent','consented','consenting','consents'],
  litigation:   ['litigation','litigate','litigated','litigating'],
  cost:         ['cost','costs','costing','costed'],
  beddoe:       ['beddoe'],
  conflict:     ['conflict','conflicts','conflicted','conflicting'],
};
// phrases we should match as a whole (allow hyphen OR space between words)
const PHRASES = [
  'conflict-of-interest',
  'conflicts-of-interest',
];

function hyOrSpaceRx(words){
  // turn "conflict-of-interest" → /conflict(?:-| )of(?:-| )interest/i
  const parts = words.split('-').map(escapeRx);
  return new RegExp(String.raw`\b${parts.join('(?:-|\\s+)')}\b`, 'i');
}

function expandTerm(t){
  const x = norm(t);
  const bag = new Set([x]);
  if(SYN[x]) SYN[x].forEach(v=>bag.add(v));
  if(!SYN[x]) ['s','es','ed','ing'].forEach(s=>bag.add(x+s));
  return [...bag];
}

function parseQuery(q){
  q = norm(q).trim();
  const phraseLits = [];
  q = q.replace(/"([^"]+)"/g, (_,m)=>{ phraseLits.push(m.trim()); return ' '; });

  const parts = (q.includes('+') ? q.split('+') : q.split(/\s+/))
                .map(s=>s.trim()).filter(Boolean);

  const groups = parts.map(p => expandTerm(p).map(v=>new RegExp(`\\b${escapeRx(v)}\\b`,'i')));

  // include built-in phrases + quoted phrases
  const phraseRx = [
    ...PHRASES.map(hyOrSpaceRx),
    ...phraseLits.map(s=>new RegExp(`\\b${escapeRx(s)}\\b`,'i')),
  ];
  return {groups, phraseRx};
}

function windowHasAll(text, groups, phraseRx){
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
  return `${base.replace(/\/$/,'')}/${rel.replace(/^\.\//,'')}`;
}
async function loadTextbooks(){
  const cat = await getJSON(ENDPOINTS.textbooksCatalog);
  return cat.map(it=>({
    type:'textbook',
    title: it.title || it.id,
    jurisdiction: it.jurisdiction || '',
    year: it.year || '',
    reference: it.reference || '',
    url: it.url_txt,
    isPlaceholder: /placeholder/i.test(it.title||'') || /demo/i.test(it.id||''),
  }));
}
async function loadLaws(){
  const base='https://info1691.github.io/laws-ui';
  const arr = await getJSON(ENDPOINTS.lawsIndex);
  return arr.map(it=>({type:'laws', title:it.title||it.id, jurisdiction:it.jurisdiction||'', year:it.year||'', reference:it.reference||'', url:abs(base, it.url_txt)}));
}
async function loadRules(){
  const base='https://info1691.github.io/rules-ui';
  const arr = await getJSON(ENDPOINTS.rulesIndex);
  return arr.map(it=>({type:'rules', title:it.title||it.id, jurisdiction:it.jurisdiction||'', year:it.year||'', reference:it.reference||'', url:abs(base, it.url_txt)}));
}

/* ------------------ Search engine ------------------ */
async function findInDoc(meta, qMatchers){
  let hay;
  try { hay = await getTXT(meta.url); }
  catch { return []; }

  const anyTokens = [...qMatchers.phraseRx, ...qMatchers.groups.flat()];
  if(!anyTokens.length) return [];

  const seed = new RegExp(anyTokens.map(rx=>rx.source).join('|'), 'gi');

  const hits=[];
  let m;
  while((m = seed.exec(hay)) && hits.length < MAX_SNIPPETS){
    const idx = m.index;
    const start = Math.max(0, idx - Math.floor(WINDOW_CHARS/2));
    const end   = Math.min(hay.length, start + WINDOW_CHARS);
    const win   = hay.slice(start, end);

    if(windowHasAll(win, qMatchers.groups, qMatchers.phraseRx)){
      const snippet = highlight(
        (start>0?'…':'') + win + (end<hay.length?'…':''),
        qMatchers.groups, qMatchers.phraseRx
      );
      hits.push({ meta, snippet, paragraph: approxParagraphNumber(hay, start) });
    }
  }
  return hits;
}

function approxParagraphNumber(text, offset){
  return text.slice(0, offset).split(/\n/).length;
}

/* ------------------ UI ------------------ */
function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function renderHeaderCounts({tb=0,laws=0,rules=0}={}){ const el=$('#counts'); if(el) el.textContent=`Matches — Textbooks: ${tb} · Laws: ${laws} · Rules: ${rules}`; }

function card(hit){
  const {meta, snippet} = hit;
  const badge = meta.type==='textbook'?'Textbooks':(meta.type==='laws'?'Laws':'Rules');
  const sub = [meta.jurisdiction?.toUpperCase(), meta.year, badge].filter(Boolean).join(' · ');
  const warn = meta.isPlaceholder ? ' <span class="pill pill-warn">placeholder</span>' : '';
  return `
  <article class="result">
    <h3 class="title"><a href="${meta.url}" target="_blank" rel="noopener">${escapeHTML(meta.title)}</a>${warn}</h3>
    <div class="subtle">${escapeHTML(sub)}</div>
    <p class="snippet">${snippet}</p>
    <div class="actions"><a class="open" href="${meta.url}" target="_blank" rel="noopener">¶ open TXT</a></div>
  </article>`;
}
function section(id){ const root=$(id).nextElementSibling; return {clear(){root.innerHTML='';}, add(h){root.insertAdjacentHTML('beforeend', card(h));}}; }

async function runSearch(q){
  const qStr = (q||'').trim(); if(!qStr) return;

  renderHeaderCounts({tb:0,laws:0,rules:0});
  const tb = section('#sec-textbooks'), lw = section('#sec-laws'), rl = section('#sec-rules');
  tb.clear(); lw.clear(); rl.clear();

  const [textbooks, laws, rules] = await Promise.all([loadTextbooks(), loadLaws(), loadRules()]);
  const matchers = parseQuery(qStr);

  async function searchList(list){
    const out=[]; const pool=4; let i=0;
    async function worker(){ while(i<list.length){ const meta=list[i++]; const hits=await findInDoc(meta, matchers); hits.forEach(h=>out.push(h)); } }
    await Promise.all(Array.from({length:pool}, worker));
    return out;
  }

  const [tbHits, lawHits, ruleHits] = await Promise.all([searchList(textbooks), searchList(laws), searchList(rules)]);

  renderHeaderCounts({tb:tbHits.length, laws:lawHits.length, rules:ruleHits.length});
  tbHits.forEach(h=>tb.add(h));
  lawHits.forEach(h=>lw.add(h));
  ruleHits.forEach(h=>rl.add(h));
}

/* ------------------ Bootstrap ------------------ */
function wire(){
  const form = $('#qform'), input = $('#q');
  const counts = document.createElement('div'); counts.id='counts'; counts.className='counts';
  const intro = $('.intro'); if(intro) intro.insertAdjacentElement('afterend', counts);

  form?.addEventListener('submit', e=>{ e.preventDefault(); runSearch(input.value); });

  // run if q= present (also bust cache by appending ?v=)
  const params = new URLSearchParams(location.search);
  const q = params.get('q') || '';
  if(q){ input.value=q; runSearch(q); }
}
document.addEventListener('DOMContentLoaded', wire);
