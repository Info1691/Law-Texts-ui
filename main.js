// ===== Trust Law Textbooks: textbooks UI + LEFT drawer as Repo Hub =====
document.addEventListener('DOMContentLoaded', () => {
  if (!window.pdfjsLib) { alert('PDF.js failed to load'); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // ---- CONFIG ----
  const CATALOG_JSON = 'data/texts/catalog.json'; // your books list
  const REPOS_JSON   = 'data/repos.json';         // repo links for drawer
  const DEFAULT_OFFSET = -83;
  const STORAGE_PREFIX = 'lawtexts:';
  const MAX_MATCHES = 200;

  // ---- STATE ----
  let pdfDoc = null, currentPdfUrl = null, currentPage = 1;
  let rendering = false, pendingPage = null, viewportScale = 1;
  const pageTextCache = new Map();
  let matches = [];
  let searchTerm = '';

  // ---- DOM ----
  const $ = (s) => document.querySelector(s);
  const pdfContainer = $('#pdfContainer');
  const pdfCanvas = $('#pdfCanvas'); const ctx = pdfCanvas.getContext('2d');
  const textLayer = $('#textLayer'); const hlLayer = $('#highlightLayer');
  const catalogList = $('#catalogList');

  // Header / controls
  $('#printBtn').addEventListener('click', () => window.print());
  $('#exportTxtBtn').addEventListener('click', exportVisibleText);
  $('#findNextBtn').addEventListener('click', () => handleFind('next'));
  $('#findPrevBtn').addEventListener('click', () => handleFind('prev'));
  $('#searchInput').addEventListener('keydown', (e)=>{ if (e.key==='Enter') handleFind('new'); });

  $('#prevBtn').addEventListener('click', ()=> queueRender(Math.max(1, currentPage-1)));
  $('#nextBtn').addEventListener('click', ()=> queueRender(Math.min(pdfDoc?.numPages||1, currentPage+1)));

  // Book p. + Calibrate (kept inline in header)
  $('#goBtn').addEventListener('click', ()=> {
    const n = parseInt($('#bookPageInput').value, 10);
    if (Number.isInteger(n)) goToBookPage(n);
  });
  $('#calibrateBtn').addEventListener('click', calibrateOffset);

  // Drawer (repo hub)
  const drawer = $('#drawer');
  $('#drawerToggle').addEventListener('click', ()=> drawer.classList.toggle('open'));
  $('#drawerClose').addEventListener('click', ()=> drawer.classList.remove('open'));
  $('#repoFilter').addEventListener('input', filterRepos);

  // Left book list filter
  $('#listFilter').addEventListener('input', filterCatalog);

  // ---- Storage helpers (per-document) ----
  const key = (s) => STORAGE_PREFIX + (currentPdfUrl || '') + ':' + s;
  const loadCalib = () => JSON.parse(localStorage.getItem(key('calib')) || '{}');
  const saveCalib = (o) => localStorage.setItem(key('calib'), JSON.stringify(o));
  const toast = (m, ms=2000) => { const t=$('#toast'); t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };

  // ---- Init ----
  (async function init(){
    await loadRepos();   // drawer content
    await loadCatalog(); // books
    const u = new URL(location.href);
    const direct = u.searchParams.get('pdf');
    if (direct) openPdf(direct, null);
  })();

  // ---- Drawer: repos ----
  async function loadRepos(){
    try{
      const res = await fetch(REPOS_JSON, {cache:'no-store'});
      const items = await res.json(); // [{name,desc,url}]
      const ul = $('#repoList'); ul.innerHTML='';
      for (const r of items){
        const li = document.createElement('li');
        li.className='repo-item';
        li.dataset.name = (r.name||'').toLowerCase();
        li.innerHTML = `
          <div class="meta">
            <strong>${r.name||''}</strong>
            ${r.desc?`<small>${r.desc}</small>`:''}
            ${r.url?`<small>${r.url}</small>`:''}
          </div>
          <div class="repo-actions">
            <a class="btn" href="${r.url}" target="_blank" rel="noopener">Open</a>
          </div>`;
        ul.appendChild(li);
      }
    }catch{
      const ul = $('#repoList'); ul.innerHTML = '<li class="repo-item"><div class="meta"><small>data/repos.json not found</small></div></li>';
    }
  }
  function filterRepos(e){
    const q = e.target.value.toLowerCase();
    [...document.querySelectorAll('.repo-item')].forEach(li=>{
      const show = li.dataset.name?.includes(q);
      li.style.display = show ? '' : 'none';
    });
  }

  // ---- Catalog (books) ----
  async function loadCatalog(){
    try{
      const res = await fetch(CATALOG_JSON, {cache:'no-store'});
      const items = await res.json(); // [{title, subtitle, url}]
      catalogList.innerHTML='';
      for (const it of items){
        const li = document.createElement('li');
        li.dataset.title = (it.title||'').toLowerCase();
        li.innerHTML = `<strong>${it.title||''}</strong>${it.subtitle?`<br><small>${it.subtitle}</small>`:''}`;
        li.addEventListener('click', ()=> openPdf(it.url, li));
        catalogList.appendChild(li);
      }
      if (items.length) openPdf(items[0].url, catalogList.firstElementChild);
    }catch{
      catalogList.innerHTML = '<li><em>data/texts/catalog.json not found</em></li>';
    }
  }
  function filterCatalog(e){
    const q = e.target.value.toLowerCase();
    [...catalogList.children].forEach(li => li.style.display = li.dataset.title?.includes(q) ? '' : 'none');
  }

  // ---- Open & render PDF ----
  async function openPdf(url, li){
    currentPdfUrl = url;
    pageTextCache.clear(); matches=[]; $('#matchesList').innerHTML=''; $('#matchCount').textContent='';
    $('#searchInput').value=''; searchTerm='';

    if (li){ [...catalogList.children].forEach(n=>n.classList.remove('active')); li.classList.add('active'); }

    const task = pdfjsLib.getDocument({ url });
    pdfDoc = await task.promise;

    // scale to 14cm container
    const cssWidth = pdfContainer.clientWidth;
    const pg1 = await pdfDoc.getPage(1);
    const v = pg1.getViewport({ scale:1 });
    viewportScale = cssWidth / v.width;

    currentPage = 1;
    await render(currentPage);
  }

  async function render(num){
    rendering = true;
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: viewportScale });

    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.width  = Math.floor(viewport.width);
    await page.render({ canvasContext: ctx, viewport }).promise;

    textLayer.innerHTML=''; hlLayer.innerHTML='';
    textLayer.style.width = hlLayer.style.width = pdfCanvas.width + 'px';
    textLayer.style.height = hlLayer.style.height = pdfCanvas.height + 'px';

    const textContent = await page.getTextContent();
    pageTextCache.set(num, textContent);

    for (const item of textContent.items){
      const span = document.createElement('span');
      span.textContent = item.str;
      const tr = pdfjsLib.Util.transform(
        pdfjsLib.Util.transform(viewport.transform, item.transform),
        [1,0,0,-1,0,0]
      );
      const [a,b,c,d,e,f] = tr; const fs = Math.hypot(a,b);
      span.style.position='absolute'; span.style.left=e+'px'; span.style.top=(f-fs)+'px';
      span.style.fontSize=fs+'px'; span.style.transformOrigin='left bottom';
      span.style.transform=`matrix(${a/fs},${b/fs},${c/fs},${d/fs},0,0)`;
      textLayer.appendChild(span);
    }

    rendering=false; updateLabel();
    if (pendingPage !== null){ const p=pendingPage; pendingPage=null; render(p); }
  }
  function queueRender(num){
    if (!pdfDoc) return;
    num = Math.max(1, Math.min(pdfDoc.numPages, num));
    if (rendering){ pendingPage = num; return; }
    currentPage = num; render(num);
  }

  // ---- Book ↔ PDF page mapping ----
  function pdfFromBook(book){
    const c = loadCalib();
    if (Array.isArray(c.anchors) && c.anchors.length){
      const a = [...c.anchors].filter(x=>x.bookPageStart<=book).sort((x,y)=>y.bookPageStart-x.bookPageStart)[0];
      if (a) return book + a.offset;
    }
    const off = (typeof c.offset==='number') ? c.offset : DEFAULT_OFFSET;
    return book + off;
  }
  function bookFromPdf(pdf){
    const c = loadCalib();
    if (Array.isArray(c.anchors) && c.anchors.length){
      const sorted = [...c.anchors].sort((x,y)=>x.bookPageStart-y.bookPageStart);
      let chosen = sorted[0] || { bookPageStart:1, offset:(typeof c.offset==='number')?c.offset:DEFAULT_OFFSET };
      for (const a of sorted){
        const pivot = a.bookPageStart + a.offset;
        if (pivot <= pdf) chosen = a; else break;
      }
      return pdf - chosen.offset;
    }
    const off = (typeof c.offset==='number') ? c.offset : DEFAULT_OFFSET;
    return pdf - off;
  }
  function updateLabel(){
    $('#pageLabel').textContent = `Book p.${bookFromPdf(currentPage)} (PDF p.${currentPage})`;
  }
  async function calibrateOffset(){
    if (!pdfDoc) return;
    const ans = prompt(`Calibration\nThis is PDF page ${currentPage}.\nEnter the BOOK page printed on this page:`);
    const book = parseInt(ans,10);
    if (!Number.isInteger(book)) return;
    const off = currentPage - book;
    const c = loadCalib(); c.offset = off; c.anchors = c.anchors || [];
    saveCalib(c);
    toast(`Calibrated: Book p.${book} ↔ PDF p.${currentPage} (offset ${off>=0?'+':''}${off})`);
    updateLabel();
  }
  function goToBookPage(book){
    if (!pdfDoc) return;
    const target = Math.max(1, Math.min(pdfDoc.numPages, pdfFromBook(book)));
    queueRender(target);
    toast(`Book p.${book} → PDF p.${target}`);
  }

  // ---- Search + Matches panel ----
  async function handleFind(mode){
    if (!pdfDoc) return;
    const q = $('#searchInput').value.trim();
    if (!q){ $('#matchesList').innerHTML=''; $('#matchCount').textContent=''; return; }

    if (mode === 'new' || q !== searchTerm){
      searchTerm = q; matches = [];
      $('#matchesList').innerHTML = '<li class="muted">Searching…</li>';
      for (let p=1; p<=pdfDoc.numPages; p++){
        const tc = pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg => pg.getTextContent());
        if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
        const items = tc.items.map(i=>i.str);
        const joined = items.join(' ');
        const idxs = findAll(joined.toLowerCase(), q.toLowerCase());
        for (const idx of idxs){
          const start = Math.max(0, idx - 60);
          const end   = Math.min(joined.length, idx + q.length + 60);
          const snippet = joined.slice(start, end).replace(/\s+/g,' ').trim();
          matches.push({ page:p, snippet, bookPage: bookFromPdf(p) });
          if (matches.length >= MAX_MATCHES) break;
        }
        if (matches.length >= MAX_MATCHES) break;
      }
      renderMatches();
      if (matches.length){
        queueRender(matches[0].page);
        await new Promise(r=>setTimeout(r,200));
        await highlightSnippetOnCurrentPage(q);
      }
      return;
    }

    // cycle results
    if (!matches.length) return;
    const currIndex = matches.findIndex(m => m.page === currentPage);
    const nextIndex = (mode === 'next')
      ? (currIndex + 1) % matches.length
      : (currIndex - 1 + matches.length) % matches.length;
    const m = matches[nextIndex];
    queueRender(m.page);
    await new Promise(r=>setTimeout(r,200));
    await highlightSnippetOnCurrentPage(searchTerm);
  }
  function findAll(hay, needle){ const out=[]; let i=hay.indexOf(needle);
    while(i!==-1){ out.push(i); i=hay.indexOf(needle, i+needle.length); } return out; }
  function renderMatches(){
    const ul = $('#matchesList'); ul.innerHTML='';
    $('#matchCount').textContent = matches.length ? `${matches.length} result(s)` : 'No results';
    for (const m of matches){
      const li = document.createElement('li');
      li.className='match';
      li.innerHTML = `<div class="meta">p.${m.bookPage}</div><div>${escapeHTML(m.snippet)}</div>`;
      li.addEventListener('click', async ()=>{ queueRender(m.page); await new Promise(r=>setTimeout(r,200)); await highlightSnippetOnCurrentPage(searchTerm); });
      ul.appendChild(li);
    }
  }
  const escapeHTML = s => s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // ---- Highlight snippet on current page ----
  async function highlightSnippetOnCurrentPage(snippet){
    if (!pdfDoc) return false;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);

    const items = tc.items.map(i=>i.str);
    const joined = items.join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const startIdx = joined.indexOf(needle);
    if (startIdx === -1){ hlLayer.innerHTML=''; return false; }

    // map window back to item ranges
    let acc=0, startItem=0, startChar=0;
    for (let i=0;i<items.length;i++){
      const s=items[i]; if (acc + s.length + 1 > startIdx){ startItem=i; startChar=startIdx-acc; break; }
      acc += s.length + 1;
    }
    const endIdx = startIdx + needle.length;
    let endItem=startItem, endChar=endIdx-acc;
    for (let i=startItem;i<items.length;i++){
      const s=items[i], spanEnd=acc+s.length+1;
      if (spanEnd>=endIdx){ endItem=i; endChar=endIdx-acc; break; }
      acc = spanEnd;
    }

    hlLayer.innerHTML='';
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: viewportScale });

    for (let i=startItem;i<=endItem;i++){
      const it = tc.items[i];
      const tr = pdfjsLib.Util.transform(pdfjsLib.Util.transform(viewport.transform, it.transform), [1,0,0,-1,0,0]);
      const [a,b,c,d,e,f] = tr; const fs = Math.hypot(a,b);
      const widthPerChar = (it.width ? (it.width * viewportScale) : Math.abs(a)) / Math.max(1, it.str.length);
      let left=e, top=f - fs, wChars=it.str.length;
      if (i===startItem){ left += widthPerChar * startChar; wChars -= startChar; }
      if (i===endItem){ wChars = (i===startItem ? (endChar-startChar) : endChar); }
      const box=document.createElement('div');
      box.className='highlight';
      box.style.left=left+'px'; box.style.top=top+'px';
      box.style.width=Math.max(2, widthPerChar * Math.max(0,wChars))+'px';
      box.style.height=Math.max(2, fs*1.1)+'px';
      hlLayer.appendChild(box);
    }
    return true;
  }

  // ---- Export visible page text ----
  async function exportVisibleText(){
    if (!pdfDoc) return;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    const text = tc.items.map(i=>i.str).join('\n');
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `book-p${bookFromPdf(currentPage)}-pdf-p${currentPage}.txt`;
    a.click(); URL.revokeObjectURL(a.href);
  }
});
