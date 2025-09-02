/* search.js — full, drop-in */

const CATALOGS = {
  textbooks: 'https://texts.wwwbcb.org/texts/catalog.json',
  laws:      'https://info1691.github.io/laws-ui/laws.json',
  rules:     'https://info1691.github.io/rules-ui/rules.json'
};

// --- tiny helpers -----------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));

// parse q into tokens; keep "quoted phrases" intact
function parseQuery(q){
  const out=[]; q=(q||'').trim();
  const rx=/"([^"]+)"|(\S+)/g; let m;
  while((m=rx.exec(q))) out.push((m[1]||m[2]).toLowerCase());
  return out;
}
function matchLine(hay, tokens, orMode){
  hay = hay.toLowerCase();
  if(orMode) return tokens.some(t=>hay.includes(t));
  return tokens.every(t=>hay.includes(t));
}
// highlight tokens
function hi(s, tokens){
  let out = esc(s);
  tokens.forEach(t=>{
    if(!t) return;
    const rx = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
    out = out.replace(rx, m=>`<mark>${esc(m)}</mark>`);
  });
  return out;
}
// cut window around first hit
function windowAround(text, tokens, win){
  const low=text.toLowerCase();
  let idx=-1;
  for(const t of tokens){
    const i = low.indexOf(t);
    if(i>=0 && (idx<0 || i<idx)) idx=i;
  }
  if(idx<0) idx=0;
  const start = Math.max(0, idx - Math.floor(win/2));
  const end = Math.min(text.length, start + win);
  const prefix = start>0 ? '…' : '';
  const suffix = end<text.length ? '…' : '';
  return prefix + text.slice(start,end) + suffix;
}

// fetch catalog then fetch each TXT and search
async function searchSource(kind, catalogUrl, tokens, orMode, win, perDoc){
  const container = {textbooks: '#tb', laws: '#lw', rules: '#rl'}[kind];
  const out = $(container); out.innerHTML = '';
  let count=0;

  let items=[];
  try{
    const r = await fetch(catalogUrl, {mode:'cors'});
    if(!r.ok) throw new Error(`${r.status}`);
    items = await r.json();
  }catch(e){
    out.innerHTML = `<p class="error">Catalog error: ${esc(catalogUrl)} — ${esc(e.message)}</p>`;
    return 0;
  }

  for(const it of items){
    const title = it.title || '(untitled)';
    const url = it.url_txt;
    if(!url){ continue; }

    let txt='';
    try{
      const r = await fetch(url, {mode:'cors'});
      if(!r.ok) throw new Error(`${r.status}`);
      txt = await r.text();
    }catch(e){
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="title">${esc(title)}</div>
        <div class="meta">${esc(it.jurisdiction||'')} ${esc(it.year||'')}</div>
        <div class="error">Fetch failed: ${esc(url)} — ${esc(e.message)}</div>`;
      out.appendChild(card);
      continue;
    }

    const lines = txt.split(/\r?\n/);
    const hits = [];
    for(let i=0;i<lines.length && hits.length<perDoc;i++){
      const line = lines[i];
      if(!line) continue;
      if(matchLine(line, tokens, orMode)){
        const snippet = windowAround(line, tokens, win);
        hits.push(snippet);
      }
    }
    if(hits.length){
      count += 1;
      const card = document.createElement('div');
      card.className = 'card';
      const chips = [
        it.jurisdiction ? `<span class="pill">${esc(it.jurisdiction)}</span>`:''
      ].join('');
      const first = hi(hits[0], tokens);
      const rest = hits.slice(1).map(h=>hi(h,tokens)).join('\n');
      card.innerHTML = `
        <div class="title">${esc(title)}</div>
        <div class="meta">${chips} ${esc(it.year||'')}</div>
        <div class="snippet">${first}${rest?'\n'+rest:''}</div>
        <a class="open" target="_blank" href="${esc(url)}">open TXT</a>`;
      out.appendChild(card);
    }
    // be polite to GH Pages
    await sleep(35);
  }
  return count;
}

async function runSearch(){
  const q = $('#q').value.trim();
  const tokens = parseQuery(q);
  const orMode = $('#orMode').checked;
  const win = Math.max(60, Math.min(1000, parseInt($('#win').value||240,10)));
  const perDoc = Math.max(1, Math.min(12, parseInt($('#lim').value||6,10)));

  if(!tokens.length){
    $('#tb').innerHTML=''; $('#lw').innerHTML=''; $('#rl').innerHTML='';
    $('#counts').textContent = 'Matches — Textbooks: 0 · Laws: 0 · Rules: 0';
    return;
  }

  const [t,l,r] = await Promise.all([
    searchSource('textbooks', CATALOGS.textbooks, tokens, orMode, win, perDoc),
    searchSource('laws',      CATALOGS.laws,      tokens, orMode, win, perDoc),
    searchSource('rules',     CATALOGS.rules,     tokens, orMode, win, perDoc)
  ]);

  $('#counts').textContent = `Matches — Textbooks: ${t} · Laws: ${l} · Rules: ${r}`;
}

// wire up
const form = $('#searchForm');
form.addEventListener('submit', (e)=>{ e.preventDefault(); runSearch(); });

// support ?q= in URL
(function initFromURL(){
  const u = new URL(location.href);
  const q = u.searchParams.get('q')||'';
  if(q){ $('#q').value = q; runSearch(); }
})();
