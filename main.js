// ===== Trust Law Textbooks — calibrated PDF viewer with search + notes =====
document.addEventListener('DOMContentLoaded', () => {
  // PDF.js worker for iPad/GitHub Pages
  if (!window.pdfjsLib) {
    alert('PDF.js failed to load'); return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // ---- CONFIG ----
  const CATALOG_JSON = 'data/texts/catalog.json'; // <-- your list of books
  const DEFAULT_OFFSET = -83;                     // overridden by one-tap calibration
  const STORAGE_PREFIX = 'lawtexts:';

  // ---- STATE ----
  let pdfDoc = null;
  let currentPdfUrl = null;
  let currentPage = 1; // 1-indexed
  let rendering = false, pendingPage = null;
  let viewportScale = 1;
  const pageTextCache = new Map();
  let notes = [];
  let searchQuery = '';
  let searchHits = []; // [{page, startIdx, endIdx}]
  let searchCursor = -1;

  // ---- DOM ----
  const $ = (s) => document.querySelector(s);
  const pdfContainer = $('#pdfContainer');
  const pdfCanvas = $('#pdfCanvas');
  const ctx = pdfCanvas.getContext('2d');
  const textLayer = $('#textLayer');
  const hlLayer = $('#highlightLayer');
  const catalogList = $('#catalogList');

  // header controls
  $('#calibrateBtn').addEventListener('click', calibrateOffset);
  $('#goBtn').addEventListener('click', () => {
    const n = parseInt($('#bookPageInput').value, 10);
    if (Number.isInteger(n)) goToBookPage(n);
  });
  $('#findNextBtn').addEventListener('click', () => doFind('next'));
  $('#findPrevBtn').addEventListener('click', () => doFind('prev'));
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFind('next');
  });
  $('#prevBtn').addEventListener('click', () => queueRender(Math.max(1, currentPage-1)));
  $('#nextBtn').addEventListener('click', () => queueRender(Math.min(pdfDoc?.numPages||1, currentPage+1)));
  $('#addNoteBtn').addEventListener('click', addNoteFromSelection);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#exportTxtBtn').addEventListener('click', exportVisibleText);

  $('#listFilter').addEventListener('input', filterCatalog);

  // ---- Storage helpers (per-document) ----
  const key = (s) => STORAGE_PREFIX + (currentPdfUrl || '') + ':' + s;
  const loadCalib = () => JSON.parse(localStorage.getItem(key('calib')) || '{}');
  const saveCalib = (o) => localStorage.setItem(key('calib'), JSON.stringify(o));
  const loadNotes = () => JSON.parse(localStorage.getItem(key('notes')) || '[]');
  const saveNotes = () => localStorage.setItem(key('notes'), JSON.stringify(notes));
  const toast = (m, ms=2200) => {
    const t = $('#toast'); t.textContent = m; t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(()=>t.hidden=true, ms);
  };
  const escapeHTML = s => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

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
    const book = parseInt(ans, 10);
    if (!Number.isInteger(book)) return;
    const off = currentPage - book;
    const c = loadCalib(); c.offset = off; c.anchors = c.anchors||[];
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

  // ---- Catalog ----
  (async function init(){
    await loadCatalog();
    // Fallback: open ?pdf=... if provided
    const u = new URL(location.href);
    const direct = u.searchParams.get('pdf');
    if (direct) openPdf(direct, null);
  })();

  async function loadCatalog(){
    try{
      const res = await fetch(CATALOG_JSON, {cache:'no-store'});
      if (!res.ok) throw 0;
      const items = await res.json(); // [{title, subtitle, url}]
      catalogList.innerHTML = '';
      for (const it of items){
        const li = document.createElement('li');
        li.dataset.title = (it.title||'').toLowerCase();
        li.innerHTML = `<strong>${it.title||''}</strong>${it.subtitle?`<br><small>${it.subtitle}</small>`:''}`;
        li.addEventListener('click', ()=> openPdf(it.url, li));
        catalogList.appendChild(li);
      }
      if (items.length) openPdf(items[0].url, catalogList.firstElementChild);
    }catch{
      catalogList.innerHTML = '<li><em>catalog.json not found</em></li>';
    }
  }
  function filterCatalog(e){
    const q = e.target.value.toLowerCase();
    [...catalogList.children].forEach(li => {
      const show = li.dataset.title?.includes(q);
      li.style.display = show ? '' : 'none';
    });
  }

  // ---- Open & render PDF ----
  async function openPdf(url, li){
    currentPdfUrl = url;
    notes = loadNotes(); renderNotes();
    pageTextCache.clear(); searchHits = []; searchCursor = -1; $('#searchInput').value='';

    if (li){
      [...catalogList.children].forEach(n=>n.classList.remove('active'));
      li.classList.add('active');
    }

    const task = pdfjsLib.getDocument({ url });
    pdfDoc = await task.promise;

    // scale to exactly 14cm container
    const cssWidth = pdfContainer.clientWidth;
    const first = await pdfDoc.getPage(1);
    const v = first.getViewport({ scale:1 });
    viewportScale = cssWidth / v.width;

    currentPage = 1;
    await render(currentPage);
    $('#tip').textContent = `PDF loaded (${pdfDoc.numPages} pages).`;
  }

  async function render(num){
    rendering = true;
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: viewportScale });

    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.width  = Math.floor(viewport.width);
    await page.render({ canvasContext: ctx, viewport }).promise;

    textLayer.innerHTML = '';
    hlLayer.innerHTML = '';
    textLayer.style.width = hlLayer.style.width = pdfCanvas.width + 'px';
    textLayer.style.height = hlLayer.style.height = pdfCanvas.height + 'px';

    const textContent = await page.getTextContent();
    pageTextCache.set(num, textContent);

    // naive text layer (position each span)
    for (const item of textContent.items){
      const span = document.createElement('span');
      span.textContent = item.str;
      const transform = pdfjsLib.Util.transform(
        pdfjsLib.Util.transform(viewport.transform, item.transform),
        [1,0,0,-1,0,0]
      );
      const [a,b,c,d,e,f] = transform;
      const fs = Math.hypot(a,b);
      span.style.position = 'absolute';
      span.style.left = e+'px';
      span.style.top = (f - fs)+'px';
      span.style.fontSize = fs+'px';
      span.style.transformOrigin = 'left bottom';
      span.style.transform = `matrix(${a/fs},${b/fs},${c/fs},${d/fs},0,0)`;
      textLayer.appendChild(span);
    }

    rendering = false; updateLabel();
    if (pendingPage !== null){ const p = pendingPage; pendingPage=null; render(p); }
  }
  function queueRender(num){
    if (!pdfDoc) return;
    num = Math.max(1, Math.min(pdfDoc.numPages, num));
    if (rendering){ pendingPage = num; return; }
    currentPage = num; render(num);
  }

  // ---- Search (simple but effective) ----
  async function doFind(direction){
    const q = $('#searchInput').value.trim();
    if (!q){ searchHits=[]; searchCursor=-1; hlLayer.innerHTML=''; return; }
    if (q !== searchQuery){ // new query ⇒ rebuild hits (current page only for speed)
      searchQuery = q; searchHits=[]; searchCursor=-1; hlLayer.innerHTML='';
      await buildHitsForPage(currentPage, q);
    }
    if (!searchHits.length){
      toast('No matches on this page'); return;
    }
    if (direction === 'next') searchCursor = (searchCursor + 1) % searchHits.length;
    else if (direction === 'prev') searchCursor = (searchCursor - 1 + searchHits.length) % searchHits.length;
    drawSearchHit(searchHits[searchCursor]);
  }

  async function buildHitsForPage(pageNo, q){
    const tc = pageTextCache.get(pageNo) || await pdfDoc.getPage(pageNo).then(p=>p.getTextContent());
    if (!pageTextCache.has(pageNo)) pageTextCache.set(pageNo, tc);
    const items = tc.items.map(it => it.str).join(' ').toLowerCase();
    const needle = q.toLowerCase().replace(/\s+/g,' ').trim();
    // collect simple char-index hits
    searchHits = [];
    let idx = items.indexOf(needle), step = needle.length;
    while (idx !== -1){ searchHits.push({ page: pageNo, startIdx: idx, endIdx: idx+step }); idx = items.indexOf(needle, idx+step); }
  }

  async function drawSearchHit(hit){
    // Reuse snippet highlighter logic over the same “joined text” approach
    const ok = await highlightSnippetOnCurrentPage($('#searchInput').value);
    if (ok) toast('Match highlighted');
  }

  // ---- Notes (snippet-anchored) ----
  function renderNotes(){
    const ul = $('#notesList'); ul.innerHTML='';
    if (!notes.length){
      const d = document.createElement('div'); d.style.opacity=.7; d.textContent='No notes yet.'; ul.appendChild(d); return;
    }
    for (const n of notes){
      const li = document.createElement('li');
      li.className='note';
      li.innerHTML = `<div><strong>p.${n.bookPage}</strong></div><div>${escapeHTML(n.snippet)}</div><small>${new Date(n.createdAt).toLocaleString()}</small>`;
      li.addEventListener('click', ()=> openNote(n));
      ul.appendChild(li);
    }
  }
  async function openNote(note){
    goToBookPage(note.bookPage);
    await new Promise(r=>setTimeout(r,200));
    const ok = await highlightSnippetOnCurrentPage(note.snippet);
    toast(ok ? `Found snippet on Book p.${note.bookPage} (PDF p.${currentPage})`
             : `Opened Book p.${note.bookPage} (PDF p.${currentPage}) — snippet not auto-matched`);
  }
  function addNoteFromSelection(){
    const selection = String(window.getSelection()).trim();
    let snippet = selection || prompt('Enter a short snippet to anchor this note (8–25 words):');
    if (!snippet) return;
    snippet = snippet.split(/\s+/).slice(0,25).join(' ');
    const note = { id: crypto.randomUUID(), bookPage: bookFromPdf(currentPage), snippet, createdAt: Date.now() };
    notes.unshift(note); saveNotes(); renderNotes();
    toast(`Saved note at Book p.${note.bookPage}`);
  }

  // ---- Highlight a snippet on current page ----
  async function highlightSnippetOnCurrentPage(snippet){
    if (!pdfDoc) return false;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);

    const itemsFull = tc.items.map(i=>i.str);
    const joined = itemsFull.join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const startIdx = joined.indexOf(needle);
    if (startIdx === -1){ hlLayer.innerHTML=''; return false; }

    // Map char window back to item ranges
    let acc=0, startItem=0, startChar=0;
    for (let i=0;i<itemsFull.length;i++){
      const s = itemsFull[i]; if (acc + s.length + 1 > startIdx){ startItem=i; startChar=startIdx-acc; break; }
      acc += s.length +
