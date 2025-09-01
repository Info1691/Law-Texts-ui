// ------- Catalogs (absolute URLs so the page works from anywhere) -----------
const CATALOGS = {
  textbooks: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  laws:      'https://info1691.github.io/law-index/laws.json',
  rules:     'https://info1691.github.io/law-index/rules.json',
};

// search tuning
const MAX_SNIPPETS_PER_DOC = 3;
const SNIPPET_RADIUS = 220;

// ------- tiny helpers --------------------------------------------------------
const $ = s => document.querySelector(s);
const esc = s => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseQ() {
  const q = new URLSearchParams(location.search).get('q') || '';
  $('#q').value = q;
  return q.trim();
}
function setCounts({t=0,l=0,r=0}) {
  $('#counts').textContent = `Matches — Textbooks: ${t} · Laws: ${l} · Rules: ${r}`;
}
function absolutizeLawIndexPath(urlish) {
  if (!urlish) return null;
  if (/^https?:\/\//i.test(urlish)) return urlish;
  return `https://info1691.github.io/law-index/${urlish.replace(/^\.\//,'')}`;
}
async function fetchJSON(url) {
  const res = await fetch(url, {mode:'cors'});
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.items || []);
}
async function fetchTXT(url) {
  for (let i=0;i<2;i++){
    const r = await fetch(url, {mode:'cors'});
    if (r.ok) return r.text();
    await sleep(120);
  }
  throw new Error(`TXT fetch failed: ${url}`);
}
const words = q => q.split(/[+\s]+/).map(s=>s.trim()).filter(Boolean);

// AND-window snippets
function makeSnippets(text, terms){
  if (!terms.length) return [];
  const L = text.toLowerCase();
  const needles = terms.map(t=>t.toLowerCase());
  const hits = [];
  let from = 0;
  while (hits.length < MAX_SNIPPETS_PER_DOC){
    const p = L.indexOf(needles[0], from);
    if (p === -1) break;
    const s = Math.max(0, p - SNIPPET_RADIUS);
    const e = Math.min(text.length, p + needles[0].length + SNIPPET_RADIUS);
    const win = L.slice(s, e);
    if (needles.every(n => win.indexOf(n) !== -1)){
      let snip = text.slice(s, e);
      needles.forEach(n=>{
        const re = new RegExp(`(${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'ig');
        snip = snip.replace(re,'<mark>$1</mark>');
      });
      snip = (s>0?'…':'') + esc(snip) + (e<text.length?'…':'');
      snip = snip.replace(/&lt;mark&gt;/g,'<mark>').replace(/&lt;\/mark&gt;/g,'</mark>');
      hits.push(snip);
      from = e;
    } else {
      from = p + needles[0].length;
    }
  }
  return hits;
}
function card(where, item, snippets, kind){
  const el = document.createElement('article');
  el.className = 'card';
  const open = item.url_txt;
  const meta = `${(item.jurisdiction||'').toString().toUpperCase()} · ${(item.year||'') } · ${kind}`;
  el.innerHTML = `
    <div class="row">
      <div>
        <h3><a href="${esc(open)}" target="_blank" rel="noopener">${esc(item.title||'Untitled')}</a></h3>
        <div class="meta">${esc(meta)}</div>
      </div>
      <a class="pill" href="${esc(open)}" target="_blank" rel="noopener">¶ open TXT</a>
    </div>
    ${snippets.map(s=>`<p>${s}</p>`).join('')}
  `;
  where.appendChild(el);
}

// ------- main ---------------------------------------------------------------
async function run(){
  const q = parseQ();
  const terms = words(q);
  const boxT = $('#textbooks'), boxL = $('#laws'), boxR = $('#rules');
  boxT.innerHTML = boxL.innerHTML = boxR.innerHTML = '';
  let counts = {t:0,l:0,r:0}; setCounts(counts);
  if (!terms.length) return;

  // 1) catalogs
  let textbooks=[], laws=[], rules=[];
  try{
    textbooks = (await fetchJSON(CATALOGS.textbooks)).map(b=>({
      id:b.id, title:b.title||b.name||'Untitled',
      jurisdiction:(b.jurisdiction||b.jurisdiction_tag||'').toString(),
      year:b.year||'',
      url_txt:absolutizeLawIndexPath(b.url_txt||b.txt||b.href)
    })).filter(x=>!!x.url_txt);
  }catch(e){
    const p=document.createElement('p'); p.className='bad';
    p.textContent=`Textbooks catalog error: ${e.message}`; boxT.appendChild(p);
  }
  try{
    laws = (await fetchJSON(CATALOGS.laws)).map(x=>({
      id:x.id,title:x.title,jurisdiction:x.jurisdiction,year:x.year,url_txt:absolutizeLawIndexPath(x.url_txt)
    })).filter(x=>!!x.url_txt);
  }catch(e){
    const p=document.createElement('p'); p.className='bad';
    p.textContent=`Laws catalog error: ${e.message}`; boxL.appendChild(p);
  }
  try{
    rules = (await fetchJSON(CATALOGS.rules)).map(x=>({
      id:x.id,title:x.title,jurisdiction:x.jurisdiction,year:x.year,url_txt:absolutizeLawIndexPath(x.url_txt)
    })).filter(x=>!!x.url_txt);
  }catch(e){
    const p=document.createElement('p'); p.className='bad';
    p.textContent=`Rules catalog error: ${e.message}`; boxR.appendChild(p);
  }

  // 2) scan
  async function scan(items, out, label){
    let found = 0;
    for (const it of items){
      try{
        const txt = await fetchTXT(it.url_txt);
        const snips = makeSnippets(txt, terms);
        if (snips.length){ card(out, it, snips, label); found++; }
      }catch(_){ /* ignore */ }
    }
    return found;
  }

  counts.t = await scan(textbooks, boxT, 'textbooks');
  counts.l = await scan(laws,      boxL, 'laws');
  counts.r = await scan(rules,     boxR, 'rules');
  setCounts(counts);
}

// submit → ?q=
document.getElementById('qform').addEventListener('submit', e=>{
  e.preventDefault();
  const q = $('#q').value.trim();
  const u = new URL(location.href);
  if(q) u.searchParams.set('q',q); else u.searchParams.delete('q');
  location.href = u.toString();
});

run();
