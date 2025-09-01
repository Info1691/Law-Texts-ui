// Catalog locations — DO NOT point at local ./data unless the TXT actually lives here
const CATALOGS = {
  textbooks: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
  laws:      'https://info1691.github.io/laws-ui/laws.json',
  rules:     'https://info1691.github.io/rules-ui/rules.json'
};

// --- helpers ---
const $ = (s, el=document) => el.querySelector(s);
const sec = n => $(`[data-section="${n}"]`);

async function getJSON(url){
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getTXT(absUrl){
  const r = await fetch(absUrl, {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${absUrl}`);
  return r.text();
}
// resolve item.url_txt relative to its catalog file and encode spaces/()
function resolveUrl(itemUrl, catalogUrl){
  // new URL handles absolute or relative correctly; it also resolves .. segments
  const abs = new URL(itemUrl, catalogUrl).href;
  // encode only characters that break GH Pages when present (space, parentheses)
  return abs.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// Simple AND-in-window snippet finder
function findSnippets(text, terms, win=420){
  const hay = text.toLowerCase();
  const hits = terms.map(t => hay.indexOf(t));
  if(hits.some(i => i<0)) return [];
  const start = Math.max(0, Math.min(...hits) - Math.floor(win/3));
  const end   = Math.min(text.length, Math.max(...hits) + Math.floor(win*2/3));
  return [text.slice(start, end)];
}
function mark(snippet, terms){
  let html = snippet;
  terms.sort((a,b)=>b.length-a.length).forEach(t=>{
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')})`,'gi');
    html = html.replace(re,'<mark>$1</mark>');
  });
  return html;
}
function card({title, meta, url, snippet}){
  return `<article class="card">
    <header><h3>${title}</h3><div class="meta">${meta}</div></header>
    ${snippet ? `<p class="snippet">…${snippet}…</p>` : `<p class="muted">No snippet</p>`}
    <p class="actions"><a class="pill" href="${url}" target="_blank" rel="noopener">open TXT</a></p>
  </article>`;
}

async function searchOne(kind, q, catalogUrl){
  const out = sec(kind); out.innerHTML = '';
  let count = 0;
  try{
    const items = await getJSON(catalogUrl);
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for(const it of items){
      if(!it.url_txt) continue;
      const txtUrl = resolveUrl(it.url_txt, catalogUrl);
      try{
        const txt = await getTXT(txtUrl);
        const snippets = findSnippets(txt, terms, 480);
        if(snippets.length){
          count++;
          out.insertAdjacentHTML('beforeend', card({
            title: it.title || it.id || 'Untitled',
            meta: `${(it.jurisdiction||'').toUpperCase()}${it.year?` · ${it.year}`:''}`,
            url: txtUrl,
            snippet: mark(snippets[0], terms)
          }));
        }
      }catch(e){
        // If a single TXT is missing, skip it silently (catalog might mix sources)
        // Uncomment next line to show per-item failures:
        // out.insertAdjacentHTML('beforeend', `<p class="error">TXT missing: ${txtUrl}</p>`);
      }
    }
  }catch(e){
    out.insertAdjacentHTML('beforeend', `<p class="error">Catalog error: ${e.message}</p>`);
  }
  return count;
}

async function searchAll(q){
  const [t,l,r] = await Promise.all([
    searchOne('textbooks', q, CATALOGS.textbooks),
    searchOne('laws',      q, CATALOGS.laws),
    searchOne('rules',     q, CATALOGS.rules)
  ]);
  $('[data-counts]').textContent = `Matches — Textbooks: ${t} · Laws: ${l} · Rules: ${r}`;
}

// wire up
(function(){
  const form = $('[data-form]');
  const box  = $('[data-q]');
  const q0 = new URLSearchParams(location.search).get('q') || '';
  if(q0) box.value = q0;

  form.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    const q = box.value.trim();
    if(!q) return;
    history.replaceState(null,'',`?q=${encodeURIComponent(q)}`);
    searchAll(q);
  });

  if(box.value.trim()) searchAll(box.value);
})();
