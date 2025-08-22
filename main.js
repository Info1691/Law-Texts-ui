// Trust Law Textbooks — robust viewer (PDF + TXT), auto-creates canvas/layers,
// locked catalog, search/matches, calibration, Safari-friendly worker setup.
document.addEventListener('DOMContentLoaded', () => {
  // ===== CONFIG =====
  const CATALOG_URL = 'data/texts/catalog.json';   // single source of truth
  const DEFAULT_OFFSET = -83;                      // book↔pdf default offset
  const STORAGE_PREFIX = 'lawtexts:';              // per-doc localStorage key
  const MAX_MATCHES = 200;

  // ===== STATE =====
  let pdfDoc = null, currentDocUrl = null, currentPage = 1;
  let rendering = false, pendingPage = null, viewportScale = 1;
  const pageTextCache = new Map();
  let searchTerm = '', matches = [];
  let isTextDoc = false, textDocContent = '', activeTextMark = null;

  // ===== DOM helpers =====
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // try to find your existing containers; fallback to sensible defaults
  const viewerHost =
    $('#pdfContainer') || $('#pdfViewer') || $('.viewer') || document.body;

  // Toolbar wiring (ids expected in your UI)
  bindBtn('#printBtn', () => window.print());
  bindBtn('#exportTxtBtn', exportVisibleText);
  bindBtn('#findNextBtn', () => handleFind('next'));
  bindBtn('#findPrevBtn', () => handleFind('prev'));
  const searchInput = $('#searchInput'); if (searchInput) {
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleFind('new'); });
  }
  bindBtn('#goBtn', () => {
    const n = parseInt($('#bookPageInput')?.value || '', 10);
    if (Number.isInteger(n)) goToBookPage(n);
  });
  bindBtn('#calibrateBtn', calibrateOffset);
  bindBtn('#prevBtn', () => { if (!isTextDoc) queueRender(Math.max(1, currentPage - 1)); });
  bindBtn('#nextBtn', () => { if (!isTextDoc) queueRender(Math.min(pdfDoc?.numPages || 1, currentPage + 1)); });
  $('#listFilter')?.addEventListener('input', filterCatalog);

  // Drawer (optional)
  const drawer = $('#drawer');
  $('#drawerToggle')?.addEventListener('click', () => drawer?.classList.toggle('open'));
  $('#repoFilter')?.addEventListener('input', filterRepos);
  $('#drawerClose')?.addEventListener('click', () => drawer?.classList.remove('open'));

  // ===== Utils =====
  const isPdf = u => /\.pdf(?:[#?].*)?$/i.test(u || '');
  const isTxt = u => /\.txt(?:[#?].*)?$/i.test(u || '');
  function bindBtn(sel, fn){ const el=$(sel); if (el) el.addEventListener('click', fn); }
  const key = s => STORAGE_PREFIX + (currentDocUrl || '') + ':' + s;
  const loadCalib = () => JSON.parse(localStorage.getItem(key('calib')) || '{}');
  const saveCalib = o => localStorage.setItem(key('calib'), JSON.stringify(o));
  const toast = (m, ms=2000) => { const t=$('#toast'); if (!t) return; t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };
  const escapeHTML = s => s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ===== Auto-create PDF layers when needed =====
  function ensurePdfLayers() {
    let shell = $('#pdfLayerShell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'pdfLayerShell';
      shell.style.position = 'relative';
      shell.style.margin = '0 auto';
      shell.style.maxWidth = '100%';
      viewerHost.innerHTML = '';
      viewerHost.appendChild(shell);
    }

    let canvas = $('#pdfCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'pdfCanvas';
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      shell.appendChild(canvas);
    }

    let textLayer = $('#textLayer');
    if (!textLayer) {
      textLayer = document.createElement('div');
      textLayer.id = 'textLayer';
      Object.assign(textLayer.style, layerCSS());
      shell.appendChild(textLayer);
    }

    let hlLayer = $('#highlightLayer');
    if (!hlLayer) {
      hlLayer = document.createElement('div');
      hlLayer.id = 'highlightLayer';
      Object.assign(hlLayer.style, layerCSS(true));
      shell.appendChild(hlLayer);
    }

    // style helpers
    function layerCSS(highlight=false){
      return {
        position: 'absolute', left: '0', top: '0',
        pointerEvents: highlight ? 'none' : 'auto'
      };
    }

    // add highlight box css once
    if (!$('style[data-hl]')) {
      const st = document.createElement('style'); st.setAttribute('data-hl','1');
      st.textContent = `
        #highlightLayer .highlight{ position:absolute; background:rgba(255,213,77,0.35); border-radius:2px; }
        #textLayer span{ position:absolute; white-space:pre; transform-origin:left bottom; }
      `;
      document.head.appendChild(st);
    }
    return { shell, canvas, textLayer: $('#textLayer'), hlLayer: $('#highlightLayer') };
  }

  // Text viewer ensure
  function ensureTextViewer(){
    let viewer = $('#textViewer');
    if (!viewer){
      viewer = document.createElement('pre');
      viewer.id = 'textViewer';
      viewer.style.whiteSpace = 'pre-wrap';
      viewer.style.wordBreak = 'break-word';
      viewer.style.padding = '1em';
      viewer.style.fontFamily = 'serif';
      viewer.style.maxHeight = '78vh';
      viewer.style.overflowY = 'auto';
      viewerHost.innerHTML = '';
      viewerHost.appendChild(viewer);

      if (!$('style[data-text-hl]')) {
        const st = document.createElement('style'); st.setAttribute('data-text-hl','1');
        st.textContent = `.highlight-text{ background:#ffd54d66; box-shadow:0 0 0 2px #ffd54d66 inset; }`;
        document.head.appendChild(st);
      }
    }
    viewer.style.display = 'block';
    return viewer;
  }
  function clearTextViewer(){
    const v = $('#textViewer'); if (v){ v.textContent=''; v.style.display='none'; }
    if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; }
  }
  function showPdfLayers(show){
    const { canvas, textLayer, hlLayer } = ensurePdfLayers();
    canvas.style.display = show ? 'block' : 'none';
    textLayer.style.display = show ? 'block' : 'none';
    hlLayer.style.display = show ? 'block' : 'none';
  }

  // ===== PDF.js worker (Safari-friendly) =====
  async function setupPdfjs() {
    if (!window.pdfjsLib) { alert('PDF.js failed to load'); return; }
    try {
      const local = './vendor/pdf.worker.min.js';
      const r = await fetch(local, { method:'HEAD', cache:'no-store' });
      if (r.ok) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = local;
        console.log('[pdfjs] using local worker');
        return;
      }
    } catch {}
    // fallback: disable worker mode to silence Safari console
    if (typeof pdfjsLib.disableWorker !== 'undefined') {
      pdfjsLib.disableWorker = true;
      console.log('[pdfjs] worker disabled (v2 API)');
    } else {
      console.log('[pdfjs] running without worker (v3 main thread)');
    }
  }

  // ===== Boot =====
  (async function init(){
    await setupPdfjs();
    await loadRepos();
    await loadCatalog();
  })();

  // ===== Drawer repos =====
  async function loadRepos(){
    try{
      const r = await fetch('data/repos.json', {cache:'no-store'});
      if (!r.ok) return;
      const data = await r.json();
      const ul = $('#repoList'); if (!ul) return;
      ul.innerHTML='';
      for (const d of data){
        const li = document.createElement('li');
        li.className='repo-item'; li.dataset.name=(d.name||'').toLowerCase();
        li.innerHTML = `
          <div class="meta">
            <strong>${d.name||''}</strong>
            ${d.desc?`<small>${d.desc}</small>`:''}
            ${d.url?`<small>${d.url}</small>`:''}
          </div>
          <div class="repo-actions"><a class="btn btn-lite" href="${d.url}" target="_blank" rel="noopener">Open</a></div>`;
        ul.appendChild(li);
      }
    }catch{}
  }
  function filterRepos(e){
    const q = (e.target.value||'').toLowerCase();
    $$('.repo-item').forEach(li => { li.style.display = (li.dataset.name||'').includes(q) ? '' : 'none'; });
  }

  // ===== Catalog (locked) =====
  async function loadCatalog(){
    try{
      const resp = await fetch(CATALOG_URL, { cache:'no-store' });
      if (!resp.ok) throw new Error('catalog not found');
      const items = await resp.json();
      console.log('[catalog] using', CATALOG_URL, 'items:', Array.isArray(items)?items.length:0);

      const list = $('#catalogList') || $('#bookList') || createCatalogList();
      list.innerHTML = '';
      for (const it of items){
        const li = document.createElement('li');
        li.dataset.title = (it.title||'').toLowerCase();
        li.dataset.url = it.url || '';
        li.innerHTML = `<strong>${it.title||''}</strong>${it.subtitle?`<br><small>${it.subtitle}</small>`:''}`;
        if (it.url) li.addEventListener('click', () => openDocument(it.url, li));
        else { li.style.opacity='.6'; li.style.cursor='not-allowed'; }
        list.appendChild(li);
      }
      // auto-open first
      const first = Array.from(list.children).find(li => li.dataset.url);
      if (first) openDocument(first.dataset.url, first);
    }catch(e){
      console.error('catalog load error:', e);
      toast('catalog.json error');
    }
  }
  function createCatalogList(){
    // fallback if index didn’t include a list
    const aside = document.createElement('aside');
    aside.className = 'sidebar';
    const filter = document.createElement('input'); filter.id='listFilter'; filter.placeholder='Filter list…';
    const ul = document.createElement('ul'); ul.id='catalogList';
    aside.appendChild(filter); aside.appendChild(ul);
    viewerHost.parentElement?.insertBefore(aside, viewerHost);
    filter.addEventListener('input', filterCatalog);
    return ul;
  }
  function filterCatalog(e){
    const q = (e.target.value||'').toLowerCase();
    const list = $('#catalogList') || $('#bookList'); if (!list) return;
    Array.from(list.children).forEach(li => li.style.display = (li.dataset.title||'').includes(q) ? '' : 'none');
  }

  // ===== Open doc (PDF or TXT) =====
  async function openDocument(url, li){
    try{
      currentDocUrl = url;
      pageTextCache.clear(); matches=[]; $('#matchesList')?.replaceChildren(); $('#matchCount') && ($('#matchCount').textContent='');
      if (searchInput) searchInput.value = ''; searchTerm='';
      textDocContent=''; isTextDoc=false; clearTextViewer(); showPdfLayers(true);
      if (li){ (li.parentElement? Array.from(li.parentElement.children):[]).forEach(n=>n.classList.remove('active')); li.classList.add('active'); }

      const safe = encodeURI(url);
      console.log('[openDocument] type:', isPdf(safe)?'PDF':(isTxt(safe)?'TXT':'UNKNOWN'), '\n"url="', safe, '"');

      if (isPdf(safe)) return openPdf(safe);
      if (isTxt(safe) || !/\.[a-z0-9]+$/i.test(safe)) return openText(safe); // default TXT if no ext
      toast('Unsupported file: '+safe);
    }catch(err){
      console.error('Document load error:', err);
      toast('Error loading document');
    }
  }

  // ===== TXT =====
  async function openText(url){
    try{
      const resp = await fetch(url, { cache:'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      textDocContent = await resp.text();
      isTextDoc = true;
      const viewer = ensureTextViewer();
      viewer.textContent = textDocContent;
      showPdfLayers(false);
      $('#pageLabel') && ($('#pageLabel').textContent = url.split('/').pop());
      toast('Loaded text file');
    }catch(e){
      console.error('Text load error:', e);
      toast('Error loading text file');
    }
  }
  function highlightInTextViewer(index, length){
    const viewer = ensureTextViewer();
    if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; }
    const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, null);
    let offset=0, startNode=null, startOffset=0, endNode=null, endOffset=0, n;
    while ((n = walker.nextNode())){
      const next = offset + n.nodeValue.length;
      if (!startNode && index >= offset && index <= next){ startNode=n; startOffset=index-offset; }
      if (startNode && (index+length) >= offset && (index+length) <= next){ endNode=n; endOffset=(index+length)-offset; break; }
      offset = next;
    }
    if (!startNode){ viewer.scrollTop = 0; return; }
    if (!endNode){ endNode=startNode; endOffset=startNode.nodeValue.length; }
    const range = document.createRange(); range.setStart(startNode,startOffset); range.setEnd(endNode,endOffset);
    const span = document.createElement('span'); span.className='highlight-text'; range.surroundContents(span);
    activeTextMark = span;
    const rect = span.getBoundingClientRect(), parentRect = viewer.getBoundingClientRect();
    viewer.scrollTop += (rect.top - parentRect.top) - parentRect.height/3;
  }

  // ===== PDF =====
  async function openPdf(url){
    try{
      // Use ArrayBuffer when possible; worker is local/disabled already
      let source;
      try{
        const resp = await fetch(url, { cache:'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        const ab = await resp.arrayBuffer();
        source = { data: ab };
        console.log('Loaded via ArrayBuffer:', url, ab.byteLength, 'bytes');
      }catch(e){
        console.warn('ArrayBuffer fetch failed, URL mode:', e);
        source = { url };
      }
      const task = pdfjsLib.getDocument(source);
      pdfDoc = await task.promise;

      // fit to container width
      const cssWidth = viewerHost.clientWidth || 820;
      const p1 = await pdfDoc.getPage(1);
      const v = p1.getViewport({ scale: 1 });
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

      canvas.height = Math.floor(viewport.height);
      canvas.width  = Math.floor(viewport.width);
      await page.render({ canvasContext: ctx, viewport }).promise;

      // rebuild text & highlight layers
      textLayer.innerHTML=''; hlLayer.innerHTML='';
      textLayer.style.width = hlLayer.style.width = canvas.width + 'px';
      textLayer.style.height= hlLayer.style.height= canvas.height + 'px';

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
    const label = $('#pageLabel'); if (!label) return;
    if (isTextDoc) label.textContent = currentDocUrl ? currentDocUrl.split('/').pop() : 'Text';
    else           label.textContent = `Book p.${bookFromPdf(currentPage)} (PDF p.${currentPage})`;
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
    const q = (searchInput?.value || '').trim();
    if (!q){ $('#matchesList')?.replaceChildren(); $('#matchCount') && ($('#matchCount').textContent=''); return; }
    if (isTextDoc) return handleFindText(q, mode);
    return handleFindPdf(q, mode);
  }

  // PDF search
  async function handleFindPdf(q, mode){
    if (!pdfDoc) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; const list=$('#matchesList'); if (list) list.innerHTML='<li class="muted">Searching…</li>';
      try{
        for (let p=1;p<=pdfDoc.numPages;p++){
          const tc = pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
          if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
          const joined = tc.items.map(i=>i.str).join(' ');
          const idxs = findAll(joined.toLowerCase(), q.toLowerCase());
          for (const idx of idxs){
            const s=Math.max(0, idx-60), e=Math.min(joined.length, idx+q.length+60);
            matches.push({ page:p, snippet:joined.slice(s,e).replace(/\s+/g,' ').trim(), bookPage:bookFromPdf(p) });
            if (matches.length>=MAX_MATCHES) break;
          }
          if (matches.length>=MAX_MATCHES) break;
        }
      }catch(e){ console.error('Search error:', e); toast('Search error'); }
      renderMatches(() => highlightSnippetOnCurrentPage(searchTerm));
      if (matches.length){ queueRender(matches[0].page); await delay(160); await highlightSnippetOnCurrentPage(q); }
      return;
    }
    if (!matches.length) return;
    const i = matches.findIndex(m=>m.page===currentPage);
    const next = (mode==='next') ? (i+1)%matches.length : (i-1+matches.length)%matches.length;
    const m = matches[next]; queueRender(m.page); await delay(160); await highlightSnippetOnCurrentPage(searchTerm);
  }

  // TXT search
  async function handleFindText(q, mode){
    if (!textDocContent) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; $('#matchesList') && ($('#matchesList').innerHTML='<li class="muted">Searching…</li>');
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
    const ul = $('#matchesList'); if (!ul) return; ul.innerHTML='';
    $('#matchCount') && ($('#matchCount').textContent = matches.length ? `${matches.length} result(s)` : 'No results');
    for (const m of matches){
      const li=document.createElement('li'); li.className='match';
      const label = (m.bookPage!=null) ? `p.${m.bookPage}` : 'match';
      li.innerHTML = `<div class="meta">${label}</div><div>${escapeHTML(m.snippet)}</div>`;
      li.addEventListener('click', async ()=>{
        if (isTextDoc){ highlightInTextViewer(m.pos, m.len); }
        else { queueRender(m.page); await delay(160); await onClickHighlight(); }
      });
      ul.appendChild(li);
    }
  }

  async function highlightSnippetOnCurrentPage(snippet){
    if (!pdfDoc) return false;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);
    const items = tc.items.map(i=>i.str); const joined = items.join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const startIdx = joined.indexOf(needle);
    if (startIdx === -1){ $('#highlightLayer') && ($('#highlightLayer').innerHTML=''); return false; }

    let acc=0, startItem=0, startChar=0;
    for (let i=0;i<items.length;i++){ const s=items[i]; if (acc+s.length+1>startIdx){ startItem=i; startChar=startIdx-acc; break; } acc+=s.length+1; }
    const endIdx = startIdx + needle.length; let endItem=startItem, endChar=endIdx-acc;
    for (let i=startItem;i<items.length;i++){ const s=items[i], spanEnd=acc+s.length+1; if (spanEnd>=endIdx){ endItem=i; endChar=endIdx-acc; break; } acc=spanEnd; }

    const { hlLayer } = ensurePdfLayers(); hlLayer.innerHTML='';
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: viewportScale });

    for (let i=startItem;i<=endItem;i++){
      const it = tc.items[i];
      const tr = pdfjsLib.Util.transform(pdfjsLib.Util.transform(viewport.transform, it.transform), [1,0,0,-1,0,0]);
      const [a,b,c,d,e,f]=tr; const fs=Math.hypot(a,b);
      const widthPerChar = (it.width ? (it.width * viewportScale) : Math.abs(a)) / Math.max(1, it.str.length);
      let left=e, top=f - fs, wChars=it.str.length;
      if (i===startItem){ left+=widthPerChar*startChar; wChars-=startChar; }
      if (i===endItem){ wChars=(i===startItem ? (endChar-startChar) : endChar); }
      const box=document.createElement('div'); box.className='highlight';
      box.style.left=left+'px'; box.style.top=top+'px';
      box.style.width=Math.max(2, widthPerChar*Math.max(0,wChars))+'px';
      box.style.height=Math.max(2, fs*1.1)+'px';
      hlLayer.appendChild(box);
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
