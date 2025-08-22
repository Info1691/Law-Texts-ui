// Trust Law Textbooks — stable viewer (PDF + TXT), page turning, search, repo drawer,
// locked catalog, Safari-friendly worker behaviour. No HTML edits required beyond index.html.
document.addEventListener('DOMContentLoaded', () => {
  // ===== CONFIG =====
  const CATALOG_URL = 'data/texts/catalog.json'; // single source of truth
  const DEFAULT_OFFSET = -83;                     // book↔pdf default offset
  const STORAGE_PREFIX = 'lawtexts:';             // per-doc localStorage key
  const MAX_MATCHES = 200;

  // ===== STATE =====
  let pdfDoc = null, currentDocUrl = null, currentPage = 1;
  let rendering = false, pendingPage = null, viewportScale = 1;
  const pageTextCache = new Map();
  let searchTerm = '', matches = [];
  let isTextDoc = false, textDocContent = '', activeTextMark = null;

  // ===== DOM =====
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const catalogList = $('#catalogList');
  const viewerScroll = $('#viewerScroll');
  const matchesList = $('#matchesList');

  // Toolbar
  $('#printBtn').addEventListener('click', () => window.print());
  $('#exportTxtBtn').addEventListener('click', exportVisibleText);
  $('#findNextBtn').addEventListener('click', () => handleFind('next'));
  $('#findPrevBtn').addEventListener('click', () => handleFind('prev'));
  $('#searchInput').addEventListener('keydown', (e)=>{ if (e.key === 'Enter') handleFind('new'); });
  $('#goBtn').addEventListener('click', () => {
    const n = parseInt($('#bookPageInput').value, 10);
    if (Number.isInteger(n)) goToBookPage(n);
  });
  $('#calibrateBtn').addEventListener('click', calibrateOffset);
  $('#prevBtn').addEventListener('click', () => { if (!isTextDoc) queueRender(Math.max(1, currentPage-1)); });
  $('#nextBtn').addEventListener('click', () => { if (!isTextDoc) queueRender(Math.min(pdfDoc?.numPages || 1, currentPage+1)); });
  $('#listFilter').addEventListener('input', filterCatalog);

  // Drawer
  const drawer = $('#drawer');
  $('#reposBtn').addEventListener('click', () => drawer.classList.add('open'));
  $('#drawerClose').addEventListener('click', () => drawer.classList.remove('open'));
  $('#repoFilter').addEventListener('input', filterRepos);

  // ===== Utils =====
  const isPdf = u => /\.pdf(?:[#?].*)?$/i.test(u || '');
  const isTxt = u => /\.txt(?:[#?].*)?$/i.test(u || '');
  const key = s => STORAGE_PREFIX + (currentDocUrl || '') + ':' + s;
  const loadCalib = () => JSON.parse(localStorage.getItem(key('calib')) || '{}');
  const saveCalib = o => localStorage.setItem(key('calib'), JSON.stringify(o));
  const toast = (m, ms=2200) => { const t=$('#toast'); t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };
  const escapeHTML = s => s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const delay = ms => new Promise(r=>setTimeout(r, ms));

  // ===== PDF.js worker (Safari-friendly) =====
  (async function setupPdfjs(){
    if (!window.pdfjsLib) { alert('PDF.js failed to load'); return; }
    try {
      const local = './vendor/pdf.worker.min.js';
      const r = await fetch(local, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = local;
        console.log('[pdfjs] using local worker');
        return;
      }
    } catch {}
    if (typeof pdfjsLib.disableWorker !== 'undefined') {
      pdfjsLib.disableWorker = true;            // v2 API
      console.log('[pdfjs] worker disabled (v2 API)');
    } else {
      console.log('[pdfjs] running on main thread (v3)');
    }
  })();

  // ===== Boot =====
  (async function init(){
    await loadRepos();
    await loadCatalog(); // locked to one JSON
  })();

  // ===== Repos drawer =====
  async function loadRepos(){
    try{
      const r = await fetch('data/repos.json', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const ul = $('#repoList'); ul.innerHTML = '';
      for (const d of data){
        const li = document.createElement('li');
        li.className = 'list-item repo-item';
        li.dataset.name = (d.name||'').toLowerCase();
        li.innerHTML = `
          <div><strong>${d.name||''}</strong><br/>
          ${d.desc?`<small>${d.desc}</small><br/>`:''}
          ${d.url?`<small>${d.url}</small>`:''}</div>`;
        li.addEventListener('click', () => { if (d.url) window.open(d.url, '_blank'); });
        ul.appendChild(li);
      }
    }catch{}
  }
  function filterRepos(e){
    const q = (e.target.value||'').toLowerCase();
    $$('.repo-item').forEach(li => li.style.display = (li.dataset.name||'').includes(q) ? '' : 'none');
  }

  // ===== Catalog =====
  async function loadCatalog(){
    try{
      const resp = await fetch(CATALOG_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error('catalog not found');
      const items = await resp.json();
      console.log('[catalog] using', CATALOG_URL, 'items:', Array.isArray(items)?items.length:0);

      catalogList.innerHTML = '';
      items.forEach(it => {
        const li = document.createElement('li');
        li.innerHTML = `<div><strong>${it.title||''}</strong>${it.subtitle?`<div class="muted">${it.subtitle}</div>`:''}</div>`;
        li.dataset.title = (it.title||'').toLowerCase();
        li.dataset.url = it.url || '';
        if (it.url) li.addEventListener('click', () => openDocument(it.url, li));
        else { li.style.opacity='.6'; li.style.cursor='not-allowed'; }
        catalogList.appendChild(li);
      });

      // auto-open first item
      const first = Array.from(catalogList.children).find(li => li.dataset.url);
      if (first) openDocument(first.dataset.url, first);
    }catch(e){
      console.error('catalog load error:', e);
      toast('catalog.json error');
    }
  }
  function filterCatalog(e){
    const q = (e.target.value||'').toLowerCase();
    Array.from(catalogList.children).forEach(li => li.style.display = (li.dataset.title||'').includes(q) ? '' : 'none');
  }

  // ===== Ensure PDF layers in viewer =====
  function ensurePdfLayers() {
    let shell = $('#pdfLayerShell');
    if (!shell){
      shell = document.createElement('div');
      shell.id = 'pdfLayerShell';
      viewerScroll.innerHTML = '';
      viewerScroll.appendChild(shell);
    }
    let canvas = $('#pdfCanvas');
    if (!canvas){
      canvas = document.createElement('canvas');
      canvas.id = 'pdfCanvas';
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      shell.appendChild(canvas);
    }
    let textLayer = $('#textLayer');
    if (!textLayer){
      textLayer = document.createElement('div'); textLayer.id = 'textLayer';
      shell.appendChild(textLayer);
    }
    let hlLayer = $('#highlightLayer');
    if (!hlLayer){
      hlLayer = document.createElement('div'); hlLayer.id = 'highlightLayer';
      shell.appendChild(hlLayer);
    }
    return { shell, canvas, textLayer, hlLayer };
  }

  // ===== Open doc (PDF or TXT) =====
  async function openDocument(url, li){
    try{
      currentDocUrl = url;
      pageTextCache.clear(); matches = [];
      matchesList.innerHTML = ''; $('#matchCount').textContent = '';
      $('#searchInput').value = ''; searchTerm = '';
      textDocContent=''; isTextDoc=false; clearTextViewer(); showPdfLayers(true);

      // activate selected
      Array.from(catalogList.children).forEach(n => n.classList.remove('active'));
      if (li) li.classList.add('active');

      const safe = encodeURI(url);
      console.log('[openDocument] type:', isPdf(safe)?'PDF':(isTxt(safe)?'TXT':'UNKNOWN'), '\n"url="', safe, '"');

      if (isPdf(safe)) return openPdf(safe);
      if (isTxt(safe) || !/\.[a-z0-9]+$/i.test(safe)) return openText(safe);
      toast('Unsupported file: ' + safe);
    }catch(err){
      console.error('Document load error:', err);
      toast('Error loading document');
    }
  }

  // ===== TXT =====
  async function openText(url){
    try{
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      textDocContent = await resp.text();
      isTextDoc = true;
      const viewer = ensureTextViewer();
      viewer.textContent = textDocContent;
      showPdfLayers(false);
      $('#pageLabel').textContent = url.split('/').pop();
      toast('Loaded text file');
    }catch(e){
      console.error('Text load error:', e);
      toast('Error loading text file');
    }
  }
  function ensureTextViewer(){
    let viewer = $('#textViewer');
    if (!viewer){
      viewer = document.createElement('pre');
      viewer.id = 'textViewer';
      viewer.style.whiteSpace = 'pre-wrap';
      viewer.style.wordBreak = 'break-word';
      viewer.style.padding = '12px';
      viewer.style.fontFamily = 'serif';
      viewer.style.margin = '0 auto';
      viewer.style.width = '100%';
      viewerScroll.innerHTML = '';
      viewerScroll.appendChild(viewer);

      if (!$('style[data-text-hl]')) {
        const st = document.createElement('style'); st.setAttribute('data-text-hl','1');
        st.textContent = `.highlight-text{ background:#ffd54d66; box-shadow:0 0 0 2px #ffd54d66 inset; }`;
        document.head.appendChild(st);
      }
    }
    viewer.style.display = 'block';
    return viewer;
  }
  function clearTextViewer(){ const v = $('#textViewer'); if (v) { v.textContent=''; v.style.display='none'; } if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; } }
  function showPdfLayers(show){
    const { canvas, textLayer, hlLayer } = ensurePdfLayers();
    canvas.style.display = show ? 'block' : 'none';
    textLayer.style.display = show ? 'block' : 'none';
    hlLayer.style.display = show ? 'block' : 'none';
  }

  // ===== PDF =====
  async function openPdf(url){
    try{
      let source;
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        const ab = await resp.arrayBuffer();
        source = { data: ab };
        console.log('Loaded via ArrayBuffer:', url, ab.byteLength, 'bytes');
      } catch(e) {
        console.warn('ArrayBuffer fetch failed, URL mode:', e);
        source = { url };
      }

      const task = pdfjsLib.getDocument(source);
      pdfDoc = await task.promise;

      // scale to fit viewer width
      const cssWidth = Math.max(420, viewerScroll.clientWidth || 820);
      const first = await pdfDoc.getPage(1);
      const v = first.getViewport({ scale: 1 });
      viewportScale = cssWidth / v.width;

      isTextDoc = false;
      currentPage = 1;
      showPdfLayers(true);
      await render(currentPage);
      toast(`Loaded PDF (${pdfDoc.numPages} pages)`);
    }catch(e){
      console.error('PDF load/render error:', e);
      toast('Error loading PDF');
    }
  }

  async function render(num){
    rendering = true;
    try{
      const { canvas, textLayer, hlLayer } = ensurePdfLayers();
      const ctx = canvas.getContext('2d');
      const page = await pdfDoc.getPage(num);
      const viewport = page.getViewport({ scale: viewportScale });

      canvas.width  = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      textLayer.innerHTML=''; hlLayer.innerHTML='';
      textLayer.style.width = hlLayer.style.width = canvas.width + 'px';
      textLayer.style.height= hlLayer.style.height= canvas.height + 'px';
      textLayer.style.position = hlLayer.style.position = 'absolute';
      $('#pdfLayerShell').style.width = canvas.width + 'px';
      $('#pdfLayerShell').style.height = canvas.height + 'px';

      const textContent = await page.getTextContent();
      pageTextCache.set(num, textContent);
      for (const item of textContent.items){
        const span = document.createElement('span'); span.textContent = item.str;
        const tr = pdfjsLib.Util.transform(
          pdfjsLib.Util.transform(viewport.transform, item.transform),
          [1,0,0,-1,0,0]
        );
        const [a,b,c,d,e,f] = tr; const fs = Math.hypot(a,b);
        span.style.left = e+'px'; span.style.top = (f - fs)+'px'; span.style.fontSize = fs+'px';
        span.style.transform = `matrix(${a/fs},${b/fs},${c/fs},${d/fs},0,0)`;
        textLayer.appendChild(span);
      }
    }catch(e){
      console.error('Render error:', e);
      toast('Render error');
    }finally{
      rendering=false; updateLabel();
      if (pendingPage !== null){ const p=pendingPage; pendingPage=null; render(p); }
    }
  }
  function queueRender(num){
    if (!pdfDoc || isTextDoc) return;
    num = Math.max(1, Math.min(pdfDoc.numPages, num));
    if (rendering){ pendingPage = num; return; }
    currentPage = num; render(num);
  }

  // ===== Book↔PDF mapping & calibration =====
  function pdfFromBook(book){
    const c = loadCalib();
    if (Array.isArray(c.anchors) && c.anchors.length){
      const a = c.anchors.filter(x=>x.bookPageStart<=book).sort((x,y)=>y.bookPageStart-x.bookPageStart)[0];
      if (a) return book + a.offset;
    }
    const off = (typeof c.offset==='number') ? c.offset : DEFAULT_OFFSET;
    return book + off;
  }
  function bookFromPdf(pdf){
    const c = loadCalib();
    if (Array.isArray(c.anchors) && c.anchors.length){
      const sorted=[...c.anchors].sort((x,y)=>x.bookPageStart-y.bookPageStart);
      let chosen = sorted[0] || { bookPageStart:1, offset:(typeof c.offset==='number')?c.offset:DEFAULT_OFFSET };
      for (const a of sorted){ const pivot=a.bookPageStart + a.offset; if (pivot<=pdf) chosen=a; else break; }
      return pdf - chosen.offset;
    }
    const off = (typeof c.offset==='number') ? c.offset : DEFAULT_OFFSET;
    return pdf - off;
  }
  function updateLabel(){
    if (isTextDoc){
      $('#pageLabel').textContent = currentDocUrl ? currentDocUrl.split('/').pop() : 'Text';
    }else{
      $('#pageLabel').textContent = `Book p.${bookFromPdf(currentPage)} (PDF p.${currentPage})`;
    }
  }
  async function calibrateOffset(){
    if (isTextDoc || !pdfDoc) { toast('Calibration is for PDFs'); return; }
    const ans = prompt(`Calibration\nThis is PDF page ${currentPage}.\nEnter the BOOK page printed on this page:`);
    const book = parseInt(ans||'',10); if (!Number.isInteger(book)) return;
    const off = currentPage - book;
    const c = loadCalib(); c.offset = off; c.anchors = c.anchors || []; saveCalib(c);
    toast(`Calibrated: Book p.${book} ↔ PDF p.${currentPage} (offset ${off>=0?'+':''}${off})`);
    updateLabel();
  }
  function goToBookPage(book){
    if (isTextDoc || !pdfDoc) { toast('Book page jump works for PDFs'); return; }
    const t = Math.max(1, Math.min(pdfDoc.numPages, pdfFromBook(book)));
    queueRender(t); toast(`Book p.${book} → PDF p.${t}`);
  }

  // ===== Search (PDF + TXT) =====
  async function handleFind(mode){
    const q = $('#searchInput').value.trim();
    if (!q){ matchesList.innerHTML=''; $('#matchCount').textContent=''; return; }
    if (isTextDoc) return handleFindText(q, mode);
    return handleFindPdf(q, mode);
  }

  async function handleFindPdf(q, mode){
    if (!pdfDoc) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; matchesList.innerHTML='<li class="muted">Searching…</li>';
      try{
        for (let p=1;p<=pdfDoc.numPages;p++){
          const tc = pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
          if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
          const joined = tc.items.map(i=>i.str).join(' ');
          for (const idx of findAll(joined.toLowerCase(), q.toLowerCase())){
            const s=Math.max(0, idx-60), e=Math.min(joined.length, idx+q.length+60);
            matches.push({ page:p, snippet:joined.slice(s,e).replace(/\s+/g,' ').trim(), bookPage:bookFromPdf(p) });
            if (matches.length>=MAX_MATCHES) break;
          }
          if (matches.length>=MAX_MATCHES) break;
        }
      }catch(e){ console.error('Search error:', e); toast('Search error'); }
      renderMatches(() => highlightSnippetOnCurrentPage(searchTerm));
      if (matches.length){ queueRender(matches[0].page); await delay(150); await highlightSnippetOnCurrentPage(q); }
      return;
    }
    if (!matches.length) return;
    const i = matches.findIndex(m=>m.page===currentPage);
    const next = (mode==='next') ? (i+1)%matches.length : (i-1+matches.length)%matches.length;
    const m = matches[next]; queueRender(m.page); await delay(150); await highlightSnippetOnCurrentPage(searchTerm);
  }

  async function handleFindText(q, mode){
    if (!textDocContent) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; matchesList.innerHTML='<li class="muted">Searching…</li>';
      const hay = textDocContent.toLowerCase(); const needle=q.toLowerCase();
      let idx = hay.indexOf(needle);
      while (idx !== -1 && matches.length < MAX_MATCHES){
        const s=Math.max(0, idx-60), e=Math.min(textDocContent.length, idx+q.length+60);
        matches.push({ pos:idx, len:q.length, snippet:textDocContent.slice(s,e).replace(/\s+/g,' ').trim(), page:null, bookPage:null });
        idx = hay.indexOf(needle, idx + q.length);
      }
      renderMatches(() => { if (matches.length){ const m=matches[0]; highlightInTextViewer(m.pos, m.len);} });
      if (matches.length){ const m=matches[0]; highlightInTextViewer(m.pos, m.len); }
      return;
    }
    if (!matches.length) return;
    let i = 0;
    if (activeTextMark){
      const viewer = $('#textViewer');
      const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, null);
      let offset=0, n; while ((n = walker.nextNode())){ if (n === activeTextMark.firstChild) break; offset += n.nodeValue.length; }
      i = matches.findIndex(m => m.pos >= offset); if (i === -1) i = 0;
    }
    const next = (mode==='next') ? (i+1)%matches.length : (i-1+matches.length)%matches.length;
    const m = matches[next]; highlightInTextViewer(m.pos, m.len);
  }

  function findAll(h, n){ const out=[]; let i=h.indexOf(n); while(i!==-1){ out.push(i); i=h.indexOf(n, i+n.length);} return out; }
  function renderMatches(onClickHighlight){
    matchesList.innerHTML='';
    $('#matchCount').textContent = matches.length ? `${matches.length} result(s)` : 'No results';
    for (const m of matches){
      const li=document.createElement('li'); li.className='match';
      const label = (m.bookPage!=null) ? `p.${m.bookPage}` : 'match';
      li.innerHTML = `<div class="meta">${label}</div><div>${escapeHTML(m.snippet)}</div>`;
      li.addEventListener('click', async ()=>{
        if (isTextDoc){ highlightInTextViewer(m.pos, m.len); }
        else { queueRender(m.page); await delay(150); await onClickHighlight(); }
      });
      li.classList.add('match');
      matchesList.appendChild(li);
    }
  }

  async function highlightSnippetOnCurrentPage(snippet){
    if (!pdfDoc) return false;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);
    const items = tc.items.map(i=>i.str); const joined = items.join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const startIdx = joined.indexOf(needle);
    if (startIdx === -1){ $('#highlightLayer').innerHTML=''; return false; }

    let acc=0, startItem=0, startChar=0;
    for (let i=0;i<items.length;i++){ const s=items[i]; if (acc+s.length+1>startIdx){ startItem=i; startChar=startIdx-acc; break; } acc+=s.length+1; }
    const endIdx = startIdx + needle.length; let endItem=startItem, endChar=endIdx-acc;
    for (let i=startItem;i<items.length;i++){ const s=items[i], end=acc+s.length+1; if (end>=endIdx){ endItem=i; endChar=endIdx-acc; break; } acc=end; }

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: viewportScale });
    const hl = $('#highlightLayer'); hl.innerHTML='';
    for (let i=startItem;i<=endItem;i++){
      const it = tc.items[i];
      const tr = pdfjsLib.Util.transform(pdfjsLib.Util.transform(viewport.transform, it.transform), [1,0,0,-1,0,0]);
      const [a,b,c,d,e,f] = tr; const fs = Math.hypot(a,b);
      const widthPerChar = (it.width ? (it.width*viewportScale) : Math.abs(a)) / Math.max(1, it.str.length);
      let left=e, top=f-fs, wChars=it.str.length;
      if (i===startItem){ left+=widthPerChar*startChar; wChars-=startChar; }
      if (i===endItem){ wChars=(i===startItem ? (endChar-startChar) : endChar); }
      const box=document.createElement('div'); box.className='highlight';
      box.style.left=left+'px'; box.style.top=top+'px';
      box.style.width=Math.max(2, widthPerChar*Math.max(0,wChars))+'px';
      box.style.height=Math.max(2, fs*1.1)+'px';
      hl.appendChild(box);
    }
    return true;
  }

  // ===== Export =====
  async function exportVisibleText(){
    if (isTextDoc){
      if (!textDocContent) return;
      const blob = new Blob([textDocContent], {type:'text/plain'});
      const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
      const name = (currentDocUrl||'text').split('/').pop().replace(/\.[^.]+$/,'') || 'text';
      a.download = `${name}.txt`; a.click(); URL.revokeObjectURL(a.href);
      return;
    }
    if (!pdfDoc) return;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    const text = tc.items.map(i=>i.str).join('\n');
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`book-p${bookFromPdf(currentPage)}-pdf-p${currentPage}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }
});
