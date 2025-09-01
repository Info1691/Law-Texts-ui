// Catalog locations
const CATALOGS = {
  // TEXTBOOKS: use this repo's local catalog that points into data/textbooks/...
  textbooks: './texts/catalog.json',
  // LAWS/RULES: read their published catalogs
  laws:  'https://info1691.github.io/laws-ui/laws.json',
  rules: 'https://info1691.github.io/rules-ui/rules.json'
};

// ---------- tiny DOM helpers ----------
const $  = (s, el=document) => el.querySelector(s);
const sec = (n) => $(`[data-section="${n}"]`);

// ---------- fetch helpers ----------
async function getJSON(url){
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getTXT(url){
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
// Resolve item.url_txt relative to its catalog URL; encode spaces and () for GitHub Pages
function resolveUrl(itemUrl, catalogUrl){
  const abs = new URL(itemUrl, catalogUrl).href;
  return abs.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// ---------- search + render ----------
function findSnippets(text, terms, windowChars = 480){
  const hay = text.toLowerCase();
  const idx = terms.map(t => hay.indexOf(t));
  if (idx.some(i => i < 0)) return [];
  const start = Math.max(0, Math.min(...idx) - Math.floor(windowChars/3));
  const end   = Math.min(text.length, Math.max(...idx) + Math.floor(windowChars*2/3));
  return [ text.slice(start, end) ];
}
function highlight(html, terms){
  let out = html;
  terms.sort((a,b)=>b.length-a.length).forEach(t=>{
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')})`,'gi');
    out = out.replace(re,'<mark>$1</mark>');
  });
  return out;
}
function card({ title, meta, url, snippet }){
  return `<article class="card">
    <h3>${title}</h3>
    <div class="meta">${meta}</div>
    ${snippet ? `<p class="snippet">…${snippet}…</p>` : ''}
    <a class="pill" href="${url}" target="_blank" rel="noopener">open TXT</a>
  </article>`;
}

async function searchOne(kind, q, catalogUrl){
  const host = sec(kind);
  host.innerHTML = '';
  let count = 0;

  try{
    const items = await getJSON(catalogUrl);
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

    for(const it of items){
      if(!it.url_txt) continue;
      const txtUrl = resolveUrl(it.url_txt, catalogUrl);

      try{
        const txt = await getTXT(txtUrl);
        const snippets = findSnippets(txt, terms, 520);
        if (snippets.length){
          count++;
          host.insertAdjacentHTML('beforeend', card({
            title: it.title || it.id || 'Untitled',
            meta: `${(it.jurisdiction||'').toUpperCase()}${it.year ? ` · ${it.year}` : ''}`,
            url: txtUrl,
            snippet: highlight(snippets[0], terms)
          }));
        }
      }catch(e){
        // show which TXT failed so missing paths are obvious
        host.insertAdjacentHTML('beforeend',
          `<p class="error">Fetch failed: ${(it.title||it.id)} (<code>${txtUrl}</code>)</p>`);
      }
    }
  }catch(e){
    host.insertAdjacentHTML('beforeend', `<p class="error">Catalog error: ${e.message}</p>`);
  }

  return count;
}

async function searchAll(q){
  const [t, l, r] = await Promise.all([
    searchOne('textbooks', q, CATALOGS.textbooks),
    searchOne('laws',      q, CATALOGS.laws),
    searchOne('rules',     q, CATALOGS.rules)
  ]);
  $('[data-counts]').textContent = `Matches — Textbooks: ${t} · Laws: ${l} · Rules: ${r}`;
}

// ---------- init ----------
(function(){
  const form = $('[data-form]');
  const box  = $('[data-q]');
  const q0 = new URLSearchParams(location.search).get('q') || '';
  if (q0) box.value = q0;

  form.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    const q = box.value.trim();
    if(!q) return;
    history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
    searchAll(q);
  });

  if (box.value.trim()) searchAll(box.value);
})();
