// --- Config ---------------------------------------------------------------
const CFG = {
  TEXTBOOKS_JSON: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  LAWS_JSON:      'https://info1691.github.io/laws-ui/laws.json',
  RULES_JSON:     'https://info1691.github.io/rules-ui/rules.json',
  WINDOW_WORDS: 160,          // co-occurrence window for AND queries
  MAX_BYTES: 0,               // 0 = read whole file (do not skim)
  LIMIT_PER_BUCKET: 10
};

// --- Utilities ------------------------------------------------------------
const $ = sel => document.querySelector(sel);
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Normalise PDF-ish text so search works reliably (no “hard-wiring”).
function normalizeText(raw){
  let t = raw;

  // 0) Unicode compatibility (helps with odd forms), then strip combining marks
  t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');

  // 1) expand common Latin ligatures (PDFs often use these)
  //    \ufb00.. \ufb06 = ﬀ, ﬁ, ﬂ, ﬃ, ﬄ, ﬅ, ﬆ
  t = t
    .replace(/\ufb00/g,'ff')
    .replace(/\ufb01/g,'fi')
    .replace(/\ufb02/g,'fl')
    .replace(/\ufb03/g,'ffi')
    .replace(/\ufb04/g,'ffl')
    .replace(/\ufb05/g,'ft')
    .replace(/\ufb06/g,'st');

  // 2) remove soft hyphens
  t = t.replace(/\u00AD/g, '');

  // 3) join words split by hyphen + newline: foo- \n bar -> foobar
  t = t.replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2');

  // 4) join inline hyphens between letters: re-formulation => reformulation
  //    also handles hyphen variants used as dashes.
  t = t.replace(/([A-Za-z])[\-\u2010\u2011\u2012\u2013]([A-Za-z])/g, '$1$2');

  // 5) collapse newlines to spaces, tidy quotes, collapse whitespace
  t = t.replace(/\r?\n+/g, ' ')
       .replace(/[\u2018\u2019]/g,"'")
       .replace(/[\u201C\u201D]/g,'"')
       .replace(/\s+/g,' ')
       .trim();

  return t;
}

// split to tokens (lowercased)
function toWords(s){ return s.toLowerCase().match(/[a-z0-9']+/g) || []; }

// tiny stemmer for plurals/ed/ing
function stem(w){
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.replace(/ies$/,'y');
  if (/ing$/.test(w) && w.length > 5) return w.replace(/ing$/,'');
  if (/ed$/.test(w)  && w.length > 4) return w.replace(/ed$/,'');
  if (/es$/.test(w)  && w.length > 4) return w.replace(/es$/,'');
  if (/s$/.test(w)   && w.length > 4) return w.replace(/s$/,'');
  return w;
}

// Build regex for a term (supports wildcard: conflict*).
function termToRegex(term){
  const hasWC = term.endsWith('*');
  const base = stem(term.replace(/\*+$/,'').toLowerCase());
  if (!base) return null;
  return new RegExp(`\\b${base}${hasWC ? '[a-z]*' : '(?:s|es|ed|ing)?'}\\b`, 'i');
}

function parseQuery(q){
  q = (q||'').trim();
  if (!q) return {parts:[],mode:'AND'};
  const parts = [];
  const re = /"([^"]+)"|([^\s+|]+)/g; let m;
  while ((m=re.exec(q))){
    if (m[1]) parts.push({type:'phrase',value:m[1]});
    else parts.push({type:'term',value:m[2]});
  }
  const mode = q.includes('|') ? 'OR' : 'AND';
  return {parts,mode};
}

function buildMatchers(parts){
  return parts.map(p=>{
    if (p.type==='phrase'){
      const needle = normalizeText(p.value).toLowerCase();
      return {kind:'phrase', label:p.value, test:t=>normalizeText(t).toLowerCase().includes(needle)};
    } else {
      const rx = termToRegex(p.value);
      return {kind:'term', label:p.value, rx, test:w=>rx?rx.test(w):false};
    }
  });
}

function findPassages(text, words, matchers, mode, windowWords){
  const phraseM = matchers.filter(m=>m.kind==='phrase');
  const termM   = matchers.filter(m=>m.kind==='term');

  // phrase pre-check on full text
  if (phraseM.length){
    const ok = mode==='AND'
      ? phraseM.every(m=>m.test(text))
      : phraseM.some(m=>m.test(text));
    if (!ok) return [];
  }

  // map term hits per position
  const hitsAt = termM.map(()=>new Set());
  words.forEach((w,i)=>{
    for (let k=0;k<termM.length;k++){
      const m = termM[k];
      if (m.rx && m.rx.test(w)) hitsAt[k].add(i);
    }
  });

  const out = [];
  const N = words.length;
  const step = Math.max(1, Math.floor(windowWords/4));
  for (let start=0; start<N; start+=step){
    const end = Math.min(N-1, start+windowWords);
    const within = idx => idx>=start && idx<=end;

    let windowOK = (mode==='AND') ? true : false;
    if (termM.length){
      if (mode==='AND'){
        for (let k=0;k<termM.length;k++){
          let any=false; for (const pos of hitsAt[k]){ if (within(pos)){ any=true; break; } }
          if (!any){ windowOK=false; break; }
        }
      }else{
        for (let k=0;k<termM.length;k++){
          for (const pos of hitsAt[k]){ if (within(pos)){ windowOK=true; break; } }
          if (windowOK) break;
        }
      }
    }
    if (!windowOK) continue;

    // build ~64-word snippet centered in window with highlighting
    const mid = Math.floor((start+end)/2);
    const s = Math.max(0, mid-32), e = Math.min(N-1, s+64);
    const slice = words.slice(s, e+1).map(w=>{
      for (const m of termM){ if (m.rx && m.rx.test(w)) return `<mark>${esc(w)}</mark>`; }
      return esc(w);
    });
    out.push({snippet: slice.join(' ') + ' …'});
    if (out.length >= CFG.LIMIT_PER_BUCKET) break;
  }
  return out;
}

async function j(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw new Error(r.status); return r.json(); }
async function t(url){
  const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw new Error(r.status);
  const b=await r.blob(); if(CFG.MAX_BYTES && b.size>CFG.MAX_BYTES){ return await b.slice(0,CFG.MAX_BYTES).text(); }
  return await b.text();
}

// UI helpers
function renderCounts({t,l,r}){
  $('#counts').innerHTML =
    `Matches — Textbooks: <strong>${t}</strong> · Laws: <strong>${l}</strong> · Rules: <strong>${r}</strong>` +
    ((t|l|r)?'':` <span class="pill pill-warn">no matches</span>`);
}
function renderBucket(sectionEl, items){
  sectionEl.innerHTML = items.length ? '' : `<div class="empty">No matches.</div>`;
  for (const it of items){
    const art=document.createElement('article'); art.className='card';
    art.innerHTML = `
      <div class="card-title">
        <a href="${it.url_txt}" target="_blank" rel="noopener">${esc(it.title)}</a>
        <span class="muted pill">${esc(it.tag)}</span>
      </div>
      <div class="card-snips">${it.snippets.map(s=>`<p>${s}</p>`).join('')}</div>`;
    sectionEl.appendChild(art);
  }
}

// Search a bucket of items
async function searchBucket(list, matchers, mode){
  const out=[];
  for (const item of list){
    try{
      const raw = await t(item.url_txt);
      const norm = normalizeText(raw);
      const words = toWords(norm);
      const snips = findPassages(norm, words, matchers, mode, CFG.WINDOW_WORDS);
      if (snips.length){ out.push({...item, snippets: snips}); if (out.length>=CFG.LIMIT_PER_BUCKET) break; }
    }catch(e){ console.warn('Search error:', item.url_txt, e.message); }
  }
  return out;
}

// Main
async function runSearch(q){
  const {parts,mode} = parseQuery(q);
  const matchers = buildMatchers(parts);

  const [textbooks,laws,rules] = await Promise.all([ j(CFG.TEXTBOOKS_JSON), j(CFG.LAWS_JSON), j(CFG.RULES_JSON) ]);

  const T=(textbooks||[]).filter(x=>x.url_txt).map(x=>({title:x.title||x.reference||x.id,url_txt:x.url_txt,tag:(x.jurisdiction||'textbooks').toUpperCase()}));
  const L=(laws||[]).filter(x=>x.url_txt).map(x=>({title:x.title||x.reference||x.id,url_txt:x.url_txt,tag:'laws'}));
  const R=(rules||[]).filter(x=>x.url_txt).map(x=>({title:x.title||x.reference||x.id,url_txt:x.url_txt,tag:'rules'}));

  const [tRes,lRes,rRes] = await Promise.all([
    searchBucket(T, matchers, mode),
    searchBucket(L, matchers, mode),
    searchBucket(R, matchers, mode)
  ]);

  renderCounts({t:tRes.length,l:lRes.length,r:rRes.length});
  renderBucket(document.querySelector('#sec-textbooks + .results'), tRes);
  renderBucket(document.querySelector('#sec-laws + .results'),       lRes);
  renderBucket(document.querySelector('#sec-rules + .results'),      rRes);
}

// Wire up
window.addEventListener('DOMContentLoaded', ()=>{
  const form = $('#qform'), box = $('#q');
  const params = new URLSearchParams(location.search);
  if (params.get('q')) box.value = params.get('q');

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const q=(box.value||'').trim();
    const url=new URL(location.href); url.searchParams.set('q', q); history.replaceState(null,'',url);
    renderCounts({t:0,l:0,r:0}); document.querySelectorAll('.results').forEach(el=>el.innerHTML='');
    runSearch(q);
  });

  if (box.value.trim()) runSearch(box.value.trim());
});
