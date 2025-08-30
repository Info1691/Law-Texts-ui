/* ---- Search (beta) — Textbooks + Laws + Rules -------------------------- */
const SOURCES = {
  textbooks: 'https://info1691.github.io/law-index/forensics/index.json',
  laws:      'https://info1691.github.io/laws-ui/laws.json',
  rules:     'https://info1691.github.io/rules-ui/rules.json',
};

const $form    = document.querySelector('#searchForm');
const $q       = document.querySelector('#q');
const $results = document.querySelector('#results');
const $counts  = document.querySelector('#counts');

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const dirOf = (url)=> new URL('.', url).toString();
const abs   = (base, rel)=> new URL(rel, base).toString();

function esc(s){ return s.replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function highlightSnippet(txt, tokens, radius=140){
  const hay = txt.toLowerCase();
  let pos = -1;
  for(const t of tokens){
    const p = hay.indexOf(t);
    if(p>=0 && (pos<0 || p<pos)) pos = p;
  }
  if(pos<0) return null;
  const start = Math.max(0, pos - radius);
  const end   = Math.min(txt.length, pos + radius);
  let snip = txt.slice(start, end);
  tokens.forEach(t=>{
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'ig');
    snip = snip.replace(re, '<mark>$1</mark>');
  });
  if(start>0) snip = '…' + snip;
  if(end<txt.length) snip = snip + '…';
  return snip;
}

function renderCard(item, snippet){
  const badge = item.kind;
  const meta  = (item.jurisdiction||'').toUpperCase();
  const href  = item.url_txt;
  return `
    <section class="hit">
      <div class="hit-hd">
        <span class="pill">${esc(badge)}</span>
        <a class="hit-title" href="${esc(href)}" target="_blank" rel="noopener">${esc(item.title)}</a>
      </div>
      ${snippet ? `<p class="hit-snippet">${snippet}</p>` : ''}
      <div class="hit-ft">
        ${meta ? `<span class="muted">${esc(meta)}</span>` : '<span></span>'}
        <a class="txt-link" href="${esc(href)}" target="_blank" rel="noopener">Open TXT</a>
      </div>
    </section>`;
}

async function loadCatalog(url, kind){
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  const json = await res.json();
  const base = dirOf(url);
  return json.map(x=>{
    const urlTxt = /^https?:\/\//.test(x.url_txt||'') ? x.url_txt : abs(base, x.url_txt||'');
    return {
      id:   x.id || x.slug || x.title,
      title: x.title || x.reference || x.id || '(untitled)',
      jurisdiction: x.jurisdiction || '',
      url_txt: urlTxt,
      kind,
    };
  });
}

async function loadAllCatalogs(){
  const [textbooks, laws, rules] = await Promise.all([
    loadCatalog(SOURCES.textbooks, 'Textbooks').catch(()=>[]),
    loadCatalog(SOURCES.laws,      'Laws').catch(()=>[]),
    loadCatalog(SOURCES.rules,     'Rules').catch(()=>[]),
  ]);
  if($counts){
    $counts.textContent = `Loaded → Textbooks: ${textbooks.length} · Laws: ${laws.length} · Rules: ${rules.length}`;
  }
  return {textbooks, laws, rules};
}

async function searchDoc(doc, tokens){
  try{
    const res = await fetch(doc.url_txt, {cache:'force-cache'});
    if(!res.ok) return null;
    const text = await res.text();
    const snippet = highlightSnippet(text, tokens);
    if(!snippet) return null;
    return {doc, snippet};
  }catch{ return null; }
}

async function runSearch(qstr){
  const q = (qstr ?? $q.value ?? '').trim();
  $results.innerHTML = '';
  if(!q) return;

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,6);

  const {textbooks, laws, rules} = await loadAllCatalogs();
  const all = [...textbooks, ...laws, ...rules];

  const out = [];
  for(const doc of all){
    await sleep(10); // gentle on the CDN
    const hit = await searchDoc(doc, tokens);
    if(hit) out.push(hit);
  }

  if(out.length === 0){
    $results.innerHTML = `<p class="muted">No matches in the loaded catalogs.</p>`;
    return;
  }

  const groups = {Laws:[], Rules:[], Textbooks:[]};
  out.forEach(h=>groups[h.doc.kind]?.push(h));

  const html = [];
  for(const kind of ['Laws','Rules','Textbooks']){
    if(groups[kind].length){
      html.push(`<h2>${kind}</h2>`);
      groups[kind].forEach(h=> html.push(renderCard(h.doc, h.snippet)) );
    }
  }
  $results.innerHTML = html.join('\n');
}

/* prevent form reload */
$form?.addEventListener('submit', (e)=>{ e.preventDefault(); runSearch(); });
$q?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); runSearch(); }});

/* support ?q=… */
const params = new URLSearchParams(location.search);
const preset = params.get('q');
if(preset){ $q.value = preset; runSearch(preset); }
