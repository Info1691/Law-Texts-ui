/* Law-Texts-ui — minimal, robust */
(function(){
  const LAW = (window.LAW_INDEX_BASE || '').replace(/\/+$/, '') + '/';
  const INGEST = LAW + 'catalogs/ingest-catalog.json';
  const FALLBACK_LOCAL = 'texts/catalog.json'; // optional placeholders you maintain

  const elRepos = document.getElementById('repos');
  const elSource = document.getElementById('sourceNote');
  const elStatus = document.getElementById('status');
  const elList = document.getElementById('library');
  const elFind = document.getElementById('find');
  const tpl = document.getElementById('item-tpl');

  let items = [];
  let filtered = [];

  // Sidebar links
  (function renderRepos(){
    const links = window.REPO_LINKS || {};
    elRepos.innerHTML = '';
    Object.entries(links).forEach(([label,href])=>{
      const a = document.createElement('a');
      a.href = href; a.textContent = label; a.className = 'chiplink';
      const wrap = document.createElement('div'); wrap.appendChild(a);
      elRepos.appendChild(wrap);
    });
  })();

  // Load catalog with graceful fallback
  (async function init(){
    try{
      const a = await fetchJSON(INGEST);
      elSource.textContent = 'Source: law-index/catalogs/ingest-catalog.json';
      items = normalize(a);
    }catch(e){
      warn('Primary catalog not available; using local fallback catalog.json');
      elSource.textContent = 'Source: texts/catalog.json (fallback)';
      try{
        const b = await fetchJSON(FALLBACK_LOCAL);
        items = normalize(b);
      }catch(e2){
        error('Failed to load any catalog: '+e2.message);
        return;
      }
    }
    // De-dupe by (jurisdiction + title lower + txt url lower)
    const seen = new Set();
    items = items.filter(it=>{
      const key = [it.jurisdiction||'', it.title.toLowerCase(), (it.txt||'').toLowerCase()].join('|');
      if(seen.has(key)) return false; seen.add(key); return true;
    });
    render(items);
  })();

  // Search/filter
  elFind.addEventListener('input', ()=>{
    const q = elFind.value.trim().toLowerCase();
    if(!q){ render(items); return; }
    const bits = q.split(/\s+/);
    filtered = items.filter(it=>{
      const hay = [it.title, it.reference, it.jurisdiction, it.slug].join(' ').toLowerCase();
      return bits.every(b=>hay.includes(b));
    });
    render(filtered);
  });

  function render(arr){
    elList.innerHTML = '';
    if(!arr.length){ elList.textContent = 'No items.'; return; }
    arr.forEach(it=>{
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.item-title').textContent = it.title || '(untitled)';
      node.querySelector('.item-meta').textContent =
        `${(it.jurisdiction||'').toUpperCase()}${it.year? ' · '+it.year:''}  ${it.reference? ' · '+it.reference:''}`;

      const btnTxt = node.querySelector('.btn-txt');
      if(it.txt){
        btnTxt.addEventListener('click', () => openTXT(it));
      }else{
        btnTxt.disabled = true; btnTxt.title = 'No TXT available';
      }

      const aMap = node.querySelector('.btn-pmap');
      if(it.pageMap){
        aMap.href = it.pageMap;
      }else{
        aMap.style.display = 'none';
      }

      elList.appendChild(node);
    });
    ok(`Loaded ${arr.length} item(s).`);
  }

  function openTXT(it){
    // Ingest format uses relative 'txt' like 'texts/uk/Breach-of-Trust-Birks-Pretto.txt'
    const path = String(it.txt || '').replace(/^\/+/, '');
    const url = path.startsWith('http') ? path : (LAW + path);
    window.open(url, '_blank', 'noopener');
  }

  function normalize(raw){
    // Accept either ingest-catalog array or our own lightweight array
    const list = Array.isArray(raw) ? raw : [];
    return list.map(it=>{
      // Robust mapping of fields
      const jurisdiction = it.jurisdiction || it.juris || '';
      const title = it.title || it.name || it.slug || '(untitled)';
      const ref = it.reference || it.ref || '';
      const year = it.year || '';
      // page-map: allow 'pageMap' absolute/relative
      let pageMap = it['page-map'] || it.page_map || it.pageMap || '';
      if(pageMap && !/^(https?:)?\/\//.test(pageMap)){
        pageMap = LAW + String(pageMap).replace(/^\/+/, '');
      }
      return {
        slug: it.slug || slugify(title),
        title, reference: ref, jurisdiction, year,
        txt: it.txt || it.url_txt || '',
        pageMap
      };
    });
  }

  async function fetchJSON(url){
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

  function ok(msg){ elStatus.style.color='#166534'; elStatus.textContent=msg; }
  function warn(msg){ elStatus.style.color='#92400e'; elStatus.textContent=msg; }
  function error(msg){ elStatus.style.color='#991b1b'; elStatus.textContent=msg; }
})();
