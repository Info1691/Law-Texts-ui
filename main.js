// Trust Law Textbooks — PDF + TXT viewer, nested-chapter catalog support,
// fixed 3-column layout, Repo drawer, search/matches, calibration
document.addEventListener('DOMContentLoaded', () => {
  // ---------- PDF.js worker ----------
  if (!window.pdfjsLib) { alert('PDF.js failed to load'); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // ---------- CONFIG ----------
  const CATALOG_CANDIDATES = [
    'data/textbooks/catalog.json',      // your structure
    'data/texts/catalog.json',
    'texts/catalog.json',
    'data/law-texts/catalog.json'
  ];
  const REPOS_CANDIDATES = ['data/repos.json', 'repos.json'];
  const DEFAULT_OFFSET = -83;
  const STORAGE_PREFIX = 'lawtexts:';
  const MAX_MATCHES = 200;

  // ---------- STATE ----------
  let pdfDoc = null, currentDocUrl = null, currentPage = 1;
  let rendering = false, pendingPage = null, viewportScale = 1;
  const pageTextCache = new Map();
  let searchTerm = '', matches = [];
  // TXT state
  let isTextDoc = false;
  let textDocContent = '';
  let activeTextMark = null;

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const pdfContainer = $('#pdfContainer');
  const pdfCanvas = $('#pdfCanvas'); const ctx = pdfCanvas.getContext('2d');
  const textLayer = $('#textLayer'); const hlLayer = $('#highlightLayer');
  const catalogList = $('#catalogList');

  // Header
  $('#printBtn').addEventListener('click', () => window.print());
  $('#exportTxtBtn').addEventListener('click', exportVisibleText);
  $('#findNextBtn').addEventListener('click', () => handleFind('next'));
  $('#findPrevBtn').addEventListener('click', () => handleFind('prev'));
  $('#searchInput').addEventListener('keydown', (e)=>{ if (e.key==='Enter') handleFind('new'); });
  $('#goBtn').addEventListener('click', ()=> {
    const n = parseInt($('#bookPageInput').value, 10);
    if (Number.isInteger(n)) goToBookPage(n);
  });
  $('#calibrateBtn').addEventListener('click', calibrateOffset);
  $('#prevBtn').addEventListener('click', ()=> { if (!isTextDoc) queueRender(Math.max(1, currentPage-1)); });
  $('#nextBtn').addEventListener('click', ()=> { if (!isTextDoc) queueRender(Math.min(pdfDoc?.numPages||1, currentPage+1)); });
  $('#listFilter').addEventListener('input', filterCatalog);

  // Drawer (Repo Hub)
  const drawer = $('#drawer');
  $('#drawerToggle').addEventListener('click', ()=> drawer.classList.toggle('open'));
  $('#drawerClose').addEventListener('click', ()=> drawer.classList.remove('open'));
  $('#repoFilter').addEventListener('input', filterRepos);

  // ---------- Storage / utils ----------
  const key = (s) => STORAGE_PREFIX + (currentDocUrl || '') + ':' + s;
  const loadCalib = () => JSON.parse(localStorage.getItem(key('calib')) || '{}');
  const saveCalib = (o) => localStorage.setItem(key('calib'), JSON.stringify(o));
  const toast = (m, ms=2300) => { const t=$('#toast'); t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };
  const escapeHTML = s => s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const delay = (ms) => new Promise(r=>setTimeout(r, ms));
  const isPdf = u => /\.pdf(?:[#?].*)?$/i.test(u);
  const isTxt = u => /\.txt(?:[#?].*)?$/i.test(u);

  // ---------- Init ----------
  (async function init(){
    await loadRepos();
    await loadCatalog();
    const u = new URL(location.href);
    const direct = u.searchParams.get('doc') || u.searchParams.get('pdf');
    if (direct) openDocument(direct, null);
  })();

  // ---------- helpers ----------
  async function fetchFirst(paths){
    for (const p of paths){
      try{ const r = await fetch(p, {cache:'no-store'}); if (r.ok) return await r.json(); }catch{}
    }
    return null;
  }
  function prettySubtitle(item){
    const j = item.jurisdiction ? item.jurisdiction : '';
    const ref = item.reference ? item.reference : '';
    const parts = [];
    if (j) parts.push(j);
    if (ref) parts.push(ref);
    return parts.length ? parts.join(' — ') : '';
  }
  function pickUrl(node){
    // prefer reference_url (your schema), then url
    const u = node?.reference_url || node?.url || '';
    return u;
  }

  // ---------- Repos ----------
  async function loadRepos(){
    const data = await fetchFirst(REPOS_CANDIDATES);
    const ul = $('#repoList'); ul.innerHTML = '';
    if (!data){ ul.innerHTML = '<li class="repo-item"><div class="meta"><small>No repos.json found</small></div></li>'; return; }
    for (const r of data){
      const li = document.createElement('li');
      li.className = 'repo-item';
      li.dataset.name = (r.name||'').toLowerCase();
      li.innerHTML = `
        <div class="meta">
          <strong>${r.name||''}</strong>
          ${r.desc?`<small>${r.desc}</small>`:''}
          ${r.url ?`<small>${r.url}</small>`:''}
        </div>
        <div class="repo-actions"><a class="btn btn-lite" href="${r.url}" target="_blank" rel="noopener">Open</a></div>`;
      ul.appendChild(li);
    }
  }
  function filterRepos(e){
    const q = e.target.value.toLowerCase();
    [...document.querySelectorAll('.repo-item')].forEach(li=>{
      li.style.display = li.dataset.name?.includes(q) ? '' : 'none';
    });
  }

  // ---------- Catalog (reference_url + chapters[]) ----------
  async function loadCatalog(){
    const raw = await fetchFirst(CATALOG_CANDIDATES);
    if (!raw){
      catalogList.innerHTML = '<li><em>catalog.json not found (tried multiple locations)</em></li>';
      toast('catalog.json not found');
      return;
    }

    // Build a flat list with parent/child (chapters)
    const items = [];
    raw.forEach((book, idx) => {
      items.push({
        title: book.title || `Book ${idx+1}`,
        subtitle: prettySubtitle(book),
        url: pickUrl(book),
        isChild: false
      });
      if (Array.isArray(book.chapters)){
        book.chapters.forEach((ch, cidx) => {
          items.push({
            title: `• ${ch.title || `Chapter ${cidx+1}`}`,
            subtitle: '',
            url: pickUrl(ch),
            isChild: true
          });
        });
      }
    });

    // Render list
    catalogList.innerHTML = '';
    for (const it of items){
      const li = document.createElement('li');
      li.dataset.title = (it.title||'').toLowerCase();
      li.dataset.url = it.url || '';
      li.className = it.isChild ? 'child' : '';
      li.innerHTML = `<strong>${it.title||''}</strong>${it.subtitle?`<br><small>${it.subtitle}</small>`:''}`;
      if (it.url){
        li.addEventListener('click', ()=> openDocument(it.url, li));
      }else{
        li.style.opacity = '.6';
        li.style.cursor = 'not-allowed';
        li.title = 'No file linked';
      }
      catalogList.appendChild(li);
    }

    // Auto-open first item that has a URL
    const firstWithUrl = items.find(i => i.url);
    if (firstWithUrl){
      const node = [...catalogList.children].find(li => li.dataset.url === firstWithUrl.url);
      openDocument(firstWithUrl.url, node || null);
    }
  }

  function filterCatalog(e){
    const q = e.target.value.toLowerCase();
    [...catalogList.children].forEach(li => li.style.display = li.dataset.title?.includes(q) ? '' : 'none');
  }

  // ========================= OPEN ANY DOCUMENT =========================
  async function openDocument(url, li){
    try{
      currentDocUrl = url;
      // reset state
      pageTextCache.clear(); matches=[]; $('#matchesList').innerHTML=''; $('#matchCount').textContent='';
      $('#searchInput').value=''; searchTerm='';
      textDocContent=''; isTextDoc=false; clearTextViewer();
      showPdfLayers(true);

      if (li){ [...catalogList.children].forEach(n=>n.classList.remove('active')); li.classList.add('active'); }

      const safeUrl = encodeURI(url);
      console.log('[openDocument] url =', safeUrl);

      if (isPdf(safeUrl)) {
        await openPdf(safeUrl);
      } else if (isTxt(safeUrl)) {
        await openText(safeUrl);
      } else {
        // default: treat as TXT if no extension (so we never assume PDF)
        if (!/\.[a-z0-9]+$/i.test(safeUrl)) {
          await openText(safeUrl);
        } else {
          toast('Unsupported file type: ' + safeUrl);
        }
      }
    }catch(e){
      console.error('Document load error:', e);
      toast('Error loading document');
    }
  }

  // ============================== TXT ==============================
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
    let viewer = document.getElementById('textViewer');
    if (!viewer){
      viewer = document.createElement('pre');
      viewer.id = 'textViewer';
      viewer.style.whiteSpace = 'pre-wrap';
      viewer.style.wordBreak = 'break-word';
      viewer.style.padding = '1em';
      viewer.style.fontFamily = 'serif';
      viewer.style.maxHeight = '80vh';
      viewer.style.overflowY = 'auto';
      const style = document.createElement('style');
      style.textContent = '.highlight-text{background:#ffd54d66; box-shadow:0 0 0 2px #ffd54d66 inset;}';
      document.head.appendChild(style);
      pdfContainer.appendChild(viewer);
    }
    viewer.style.display = 'block';
    return viewer;
  }
  function clearTextViewer(){
    const viewer = document.getElementById('textViewer');
    if (viewer){ viewer.textContent=''; viewer.style.display='none'; }
    if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; }
  }
  function showPdfLayers(show){
    pdfCanvas.style.display = show ? 'block' : 'none';
    textLayer.style.display  = show ? 'block' : 'none';
    hlLayer.style.display    = show ? 'block' : 'none';
  }
  function highlightInTextViewer(index, length){
    const viewer = ensureTextViewer();
    if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; }
    const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, null);
    let offset = 0, startNode=null, startOffset=0, endNode=null, endOffset=0, n;
    while ((n = walker.nextNode())){
      const next = offset + n.nodeValue.length;
      if (!startNode && index >= offset && index <= next){ startNode = n; startOffset = index - offset; }
      if (startNode && (index+length) >= offset && (index+length) <= next){ endNode = n; endOffset = (index + length) - offset; break; }
      offset = next;
    }
    if (!startNode){ viewer.scrollTop = 0; return; }
    if (!endNode){ endNode = startNode; endOffset = startNode.nodeValue.length; }
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const span = document.createElement('span'); span.className='highlight-text';
    range.surroundContents(span);
    activeTextMark = span;
    const rect = span.getBoundingClientRect();
    const parentRect = viewer.getBoundingClientRect();
    viewer.scrollTop += (rect.top - parentRect.top) - parentRect.height/3;
  }

  // ============================== PDF ==============================
  async function openPdf(url){
    try{
      // Prefer fetch → ArrayBuffer → {data} (works on iPad/Safari + GH Pages)
      let source;
      try{
        const resp = await fetch(url, { cache:'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        const ab = await resp.arrayBuffer();
        source = { data: ab };
        console.log('Loaded via ArrayBuffer:', url, ab.byteLength, 'bytes');
      }catch(e){
        console.warn('ArrayBuffer fetch failed, falling back to URL mode:', e);
        source = { url };
      }

      const task = pdfjsLib.getDocument(source);
      pdfDoc = await task.promise;

      // Fit to 14cm container
      const cssWidth = pdfContainer.clientWidth;
      const pg1 = await pdfDoc.getPage(1);
      const v = pg1.getViewport({ scale: 1 });
      viewportScale = cssWidth / v.width;

      isTextDoc = false;
      currentPage = 1;
      showPdfLayers(true);
      await render(currentPage);
      toast(`Loaded PDF (${pdfDoc.numPages} pages)`);
    }catch(e){
      console.error('PDF load/render error:', e);
      toast('Error loading PDF (see console)');
    }
  }

  async function render(num){
    rendering = true;
    try{
      const page = await pdfDoc.getPage(num);
      const viewport = page.getViewport({ scale: viewportScale });

      pdfCanvas.height = Math.floor(viewport.height);
      pdfCanvas.width  = Math.floor(viewport.width);
      await page.render({ canvasContext: ctx, viewport }).promise;

      textLayer.innerHTML=''; hlLayer.innerHTML='';
      textLayer.style.width = hlLayer.style.width = pdfCanvas.width + 'px';
      textLayer.style.height= hlLayer.style.height= pdfCanvas.height + 'px';

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
        span.style.position='absolute';
        span.style.left = e+'px';
        span.style.top  = (f - fs)+'px';
        span.style.fontSize = fs+'px';
        span.style.transformOrigin='left bottom';
        span.style.transform=`matrix(${a/fs},${b/fs},${c/fs},${d/fs},0,0)`;
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

  // ---------- Book ↔ PDF mapping ----------
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
      const sorted=[...c.anchors].sort((x,y)=>x.bookPageStart-y.bookPageStart);
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
    if (isTextDoc){
      $('#pageLabel').textContent = currentDocUrl ? currentDocUrl.split('/').pop() : 'Text';
    }else{
      $('#pageLabel').textContent = `Book p.${bookFromPdf(currentPage)} (PDF p.${currentPage})`;
    }
  }
  async function calibrateOffset(){
    if (isTextDoc){ toast('Calibration not applicable to text files'); return; }
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
    if (isTextDoc || !pdfDoc) { toast('Book page jump only works for PDFs'); return; }
    const target = Math.max(1, Math.min(pdfDoc.numPages, pdfFromBook(book)));
    queueRender(target);
    toast(`Book p.${book} → PDF p.${target}`);
  }

  // ========================= SEARCH & MATCHES =========================
  async function handleFind(mode){
    const q = $('#searchInput').value.trim();
    if (!q){ $('#matchesList').innerHTML=''; $('#matchCount').textContent=''; return; }
    if (isTextDoc){ await handleFindText(q, mode); } else { await handleFindPdf(q, mode); }
  }

  // ------ PDF search ------
  async function handleFindPdf(q, mode){
    if (!pdfDoc) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; $('#matchesList').innerHTML='<li class="muted">Searching…</li>';
      try{
        for (let p=1;p<=pdfDoc.numPages;p++){
          const tc = pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
          if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
          const items = tc.items.map(i=>i.str);
          const joined = items.join(' ');
          const idxs = findAll(joined.toLowerCase(), q.toLowerCase());
          for (const idx of idxs){
            const start=Math.max(0, idx-60), end=Math.min(joined.length, idx+q.length+60);
            const snippet = joined.slice(start,end).replace(/\s+/g,' ').trim();
            matches.push({ page:p, snippet, bookPage:bookFromPdf(p) });
            if (matches.length>=MAX_MATCHES) break;
          }
          if (matches.length>=MAX_MATCHES) break;
        }
      }catch(e){ console.error('Search error:', e); toast('Search error'); }
      renderMatches(() => highlightSnippetOnCurrentPage(searchTerm));
      if (matches.length){ queueRender(matches[0].page); await delay(180); await highlightSnippetOnCurrentPage(q); }
      return;
    }
    if (!matches.length) return;
    const i = matches.findIndex(m=>m.page===currentPage);
    const next = (mode==='next') ? (i+1)%matches.length : (i-1+matches.length)%matches.length;
    const m = matches[next];
    queueRender(m.page); await delay(180); await highlightSnippetOnCurrentPage(searchTerm);
  }

  // ------ TXT search ------
  async function handleFindText(q, mode){
    if (!textDocContent) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; $('#matchesList').innerHTML='<li class="muted">Searching…</li>';
      const hay = textDocContent.toLowerCase();
      const needle = q.toLowerCase();
      let idx = hay.indexOf(needle);
      while (idx !== -1 && matches.length < MAX_MATCHES){
        const start = Math.max(0, idx - 60);
        const end   = Math.min(textDocContent.length, idx + q.length + 60);
        const snippet = textDocContent.slice(start, end).replace(/\s+/g,' ').trim();
        matches.push({ pos: idx, len: q.length, snippet, bookPage: null, page: null });
        idx = hay.indexOf(needle, idx + q.length);
      }
      renderMatches(() => { if (matches.length){ const m=matches[0]; highlightInTextViewer(m.pos, m.len);} });
      if (matches.length){ const m=matches[0]; highlightInTextViewer(m.pos, m.len); }
      return;
    }
    if (!matches.length) return;
    let i = 0;
    if (activeTextMark){
      const viewer = document.getElementById('textViewer');
      const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, null);
      let offset=0, n;
      while ((n = walker.nextNode())){
        if (n === activeTextMark.firstChild){ break; }
        offset += n.nodeValue.length;
      }
      i = matches.findIndex(m => m.pos >= offset);
      if (i === -1) i = 0;
    }
    const next = (mode==='next') ? (i+1)%matches.length : (i-1+matches.length)%matches.length;
    const m = matches[next]; highlightInTextViewer(m.pos, m.len);
  }

  function findAll(hay, needle){ const out=[]; let i=hay.indexOf(needle); while(i!==-1){ out.push(i); i=hay.indexOf(needle, i+needle.length);} return out; }
  function renderMatches(onClickHighlight){
    const ul = $('#matchesList'); ul.innerHTML='';
    $('#matchCount').textContent = matches.length ? `${matches.length} result(s)` : 'No results';
    for (const m of matches){
      const li=document.createElement('li'); li.className='match';
      const label = (m.bookPage!=null) ? `p.${m.bookPage}` : 'match';
      li.innerHTML = `<div class="meta">${label}</div><div>${escapeHTML(m.snippet)}</div>`;
      li.addEventListener('click', async ()=>{
        if (isTextDoc){ highlightInTextViewer(m.pos, m.len); }
        else { queueRender(m.page); await delay(180); await onClickHighlight(); }
      });
      ul.appendChild(li);
    }
  }

  // ---------- PDF snippet highlight ----------
  async function highlightSnippetOnCurrentPage(snippet){
    if (!pdfDoc) return false;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);

    const items = tc.items.map(i=>i.str);
    const joined = items.join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const startIdx = joined.indexOf(needle);
    if (startIdx === -1){ hlLayer.innerHTML=''; return false; }

    let acc=0, startItem=0, startChar=0;
    for (let i=0;i<items.length;i++){
      const s=items[i]; if (acc + s.length + 1 > startIdx){ startItem=i; startChar=startIdx-acc; break; }
      acc += s.length + 1;
    }
    const endIdx = startIdx + needle.length;
    let endItem=startItem, endChar=endIdx-acc;
    for (let i=startItem;i<items.length;i++){
      const s=items[i], spanEnd=acc+s.length+1;
      if (spanEnd >= endIdx){ endItem=i; endChar=endIdx-acc; break; }
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
      box.style.width=Math.max(2, widthPerChar*Math.max(0,wChars))+'px';
      box.style.height=Math.max(2, fs*1.1)+'px';
      hlLayer.appendChild(box);
    }
    return true;
  }

  // ---------- Export current content ----------
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
