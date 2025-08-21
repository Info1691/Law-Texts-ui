/* ========= Law-Text-ui (PDF.js) with book↔PDF page calibration ========= */

document.addEventListener('DOMContentLoaded', () => {
  /** PDF.js worker (must be set AFTER pdf.min.js loads) */
  if (!window.pdfjsLib) {
    console.error('PDF.js failed to load');
    alert('PDF.js failed to load. Check network/CDN.');
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  /** CONFIG **/
  const CATALOG_JSON = 'data/law-texts/catalog.json'; // optional
  const DEFAULT_OFFSET = -83;                          // will be overridden by calibration
  const STORAGE_PREFIX = 'lawtextui:';

  /** STATE **/
  let pdfDoc = null;
  let currentPdfUrl = null;
  let currentPageNumber = 1; // 1-indexed
  let rendering = false;
  let pendingPage = null;
  let viewportScale = 1;
  const pageTextCache = new Map();
  let notes = [];

  /** DOM **/
  const catalogList = qs('#catalogList');
  const pageLabel = qs('#pageLabel');
  const pdfContainer = qs('#pdfContainer');
  const pdfCanvas = qs('#pdfCanvas');
  const textLayerDiv = qs('#textLayer');
  const highlightLayerDiv = qs('#highlightLayer');
  const ctx = pdfCanvas.getContext('2d');

  on('#goBtn', 'click', () => {
    const p = parseInt(qs('#bookPageInput').value, 10);
    if (Number.isInteger(p)) goToBookPage(p);
  });
  on('#prevBtn', 'click', () => queueRenderPage(Math.max(1, currentPageNumber - 1)));
  on('#nextBtn', 'click', () => queueRenderPage(Math.min(pdfDoc?.numPages || 1, currentPageNumber + 1)));
  on('#calibrateBtn', 'click', calibrateOffset);
  on('#addNoteBtn', 'click', addNoteFromSelection);

  /** Helpers */
  function qs(s){ return document.querySelector(s); }
  function on(sel, ev, fn){ document.querySelector(sel).addEventListener(ev, fn); }
  function k(s){ return STORAGE_PREFIX + (currentPdfUrl || '') + ':' + s; }
  function loadCalib(){ try { return JSON.parse(localStorage.getItem(k('calib'))) || {}; } catch { return {}; } }
  function saveCalib(data){ localStorage.setItem(k('calib'), JSON.stringify(data)); }
  function loadNotes(){ try { return JSON.parse(localStorage.getItem(k('notes'))) || []; } catch { return []; } }
  function saveNotes(){ localStorage.setItem(k('notes'), JSON.stringify(notes)); }
  function toast(msg, ms=2200){
    const t = qs('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(()=>t.hidden=true, ms);
  }
  function escapeHTML(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  /** Mapping */
  function pdfPageFromBookPage(bookPage){
    const calib = loadCalib();
    if (Array.isArray(calib.anchors) && calib.anchors.length){
      const a = [...calib.anchors].filter(x=>x.bookPageStart<=bookPage).sort((x,y)=>y.bookPageStart-x.bookPageStart)[0];
      if (a) return bookPage + a.offset;
    }
    const off = (typeof calib.offset==='number') ? calib.offset : DEFAULT_OFFSET;
    return bookPage + off;
  }
  function bookPageFromPdfPage(pdfPage){
    const calib = loadCalib();
    if (Array.isArray(calib.anchors) && calib.anchors.length){
      const sorted = [...calib.anchors].sort((x,y)=>x.bookPageStart-y.bookPageStart);
      let chosen = sorted[0] || { bookPageStart:1, offset:(typeof calib.offset==='number')?calib.offset:DEFAULT_OFFSET };
      for (const a of sorted){
        const pivotPdfAtStart = a.bookPageStart + a.offset;
        if (pivotPdfAtStart <= pdfPage) chosen = a; else break;
      }
      return pdfPage - chosen.offset;
    }
    const off = (typeof calib.offset==='number') ? calib.offset : DEFAULT_OFFSET;
    return pdfPage - off;
  }

  async function calibrateOffset(){
    if (!pdfDoc) return;
    const pdf = currentPageNumber;
    const answer = prompt(`Calibration\nThis is PDF page ${pdf}.\nEnter the BOOK page number printed on this page:`);
    const book = parseInt(answer, 10);
    if (!Number.isInteger(book)) return;
    const off = pdf - book;
    const calib = loadCalib();
    calib.offset = off; calib.anchors = calib.anchors || [];
    saveCalib(calib);
    toast(`Calibrated: Book p.${book} ↔ PDF p.${pdf} (offset ${off>=0?'+':''}${off})`);
    updateDualPageLabel();
  }

  /** Catalog (optional) */
  (async function loadCatalog(){
    try{
      const res = await fetch(CATALOG_JSON, {cache:'no-store'});
      if (!res.ok) throw new Error('no catalog');
      const items = await res.json(); // [{title, subtitle, url}]
      catalogList.innerHTML = '';
      for (const x of items){
        const li = document.createElement('li');
        li.innerHTML = `<strong>${x.title}</strong>${x.subtitle?`<br><small>${x.subtitle}</small>`:''}`;
        li.addEventListener('click', ()=> openPdf(x.url, li));
        catalogList.appendChild(li);
      }
      if (items.length) openPdf(items[0].url, catalogList.firstElementChild);
    }catch{
      const url = new URL(location.href);
      const pdf = url.searchParams.get('pdf');
      if (pdf) openPdf(pdf, null);
    }
  })();

  /** Open PDF */
  async function openPdf(url, li){
    currentPdfUrl = url;
    pageTextCache.clear();
    notes = loadNotes();
    renderNotesList();

    if (catalogList && li){
      [...catalogList.children].forEach(n => n.classList.remove('active'));
      li.classList.add('active');
    }

    const task = pdfjsLib.getDocument({ url });
    pdfDoc = await task.promise;

    // scale to 14cm container
    const cssWidthPx = pdfContainer.clientWidth;
    const firstPage = await pdfDoc.getPage(1);
    const v = firstPage.getViewport({ scale: 1 });
    viewportScale = cssWidthPx / v.width;

    currentPageNumber = 1;
    await renderPage(currentPageNumber);
    toast('Loaded document');
  }

  /** Render */
  async function renderPage(num){
    rendering = true;
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: viewportScale });

    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.width  = Math.floor(viewport.width);

    await page.render({ canvasContext: ctx, viewport }).promise;

    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = pdfCanvas.width + 'px';
    textLayerDiv.style.height = pdfCanvas.height + 'px';
    highlightLayerDiv.innerHTML = '';
    highlightLayerDiv.style.width = pdfCanvas.width + 'px';
    highlightLayerDiv.style.height = pdfCanvas.height + 'px';

    const textContent = await page.getTextContent();
    pageTextCache.set(num, textContent);

    for (const item of textContent.items){
      const span = document.createElement('span');
      span.textContent = item.str;
      const transform = pdfjsLib.Util.transform(
        pdfjsLib.Util.transform(viewport.transform, item.transform),
        [1,0,0,-1,0,0]
      );
      const [a,b,c,d,e,f] = transform;
      const fontSize = Math.hypot(a,b);
      span.style.position = 'absolute';
      span.style.left = e + 'px';
      span.style.top = (f - fontSize) + 'px';
      span.style.fontSize = fontSize + 'px';
      span.style.transformOrigin = 'left bottom';
      span.style.transform = `matrix(${a/fontSize}, ${b/fontSize}, ${c/fontSize}, ${d/fontSize}, 0, 0)`;
      textLayerDiv.appendChild(span);
    }

    rendering = false;
    if (pendingPage !== null){ const p = pendingPage; pendingPage = null; return renderPage(p); }
    updateDualPageLabel();
  }
  function queueRenderPage(num){
    num = Math.max(1, Math.min(pdfDoc.numPages, num));
    if (rendering){ pendingPage = num; return; }
    currentPageNumber = num; renderPage(num);
  }
  function updateDualPageLabel(){
    const pdfP = currentPageNumber;
    const bookP = bookPageFromPdfPage(pdfP);
    pageLabel.textContent = `Book p.${bookP} (PDF p.${pdfP})`;
  }
  function goToBookPage(bookPage){
    if (!pdfDoc) return;
    const target = pdfPageFromBookPage(bookPage);
    const clamped = Math.max(1, Math.min(pdfDoc.numPages, target));
    currentPageNumber = clamped;
    queueRenderPage(clamped);
    toast(`Book p.${bookPage} → PDF p.${clamped}`);
  }

  /** Notes */
  function renderNotesList(){
    const ul = qs('#notesList');
    ul.innerHTML = '';
    if (!notes.length){
      const empty = document.createElement('div');
      empty.style.opacity = .7; empty.style.padding = '6px';
      empty.textContent = 'No notes yet.'; ul.appendChild(empty); return;
    }
    for (const n of notes){
      const li = document.createElement('li');
      li.className = 'note';
      li.innerHTML = `<div><strong>p.${n.bookPage}</strong></div><div>${escapeHTML(n.snippet)}</div><small>${new Date(n.createdAt).toLocaleString()}</small>`;
      li.addEventListener('click', ()=> openNote(n));
      ul.appendChild(li);
    }
  }
  async function openNote(note){
    goToBookPage(note.bookPage);
    await new Promise(r=>setTimeout(r,200));
    const ok = await highlightSnippetOnCurrentPage(note.snippet);
    toast(ok ? `Found snippet on Book p.${note.bookPage} (PDF p.${currentPageNumber})`
             : `Opened Book p.${note.bookPage} (PDF p.${currentPageNumber}) — snippet not auto-matched`);
  }
  function addNoteFromSelection(){
    const selection = String(window.getSelection()).trim();
    let snippet = selection || prompt('Enter a short snippet to anchor this note (8–25 words):');
    if (!snippet) return;
    snippet = snippet.split(/\s+/).slice(0,25).join(' ');
    const bookP = bookPageFromPdfPage(currentPageNumber);
    const note = { id: crypto.randomUUID(), bookPage: bookP, snippet, createdAt: Date.now() };
    notes.unshift(note); saveNotes(); renderNotesList();
    toast(`Saved note at Book p.${bookP}`);
  }

  /** Snippet highlighter */
  async function highlightSnippetOnCurrentPage(snippet){
    if (!pdfDoc) return false;
    const textContent = pageTextCache.get(currentPageNumber) || await pdfDoc.getPage(currentPageNumber).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPageNumber)) pageTextCache.set(currentPageNumber, textContent);

    const items = textContent.items.map((it, idx)=>({ str: it.str, idx, tr: it.transform }));
    const joined = items.map(i=>i.str).join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const startIdx = joined.indexOf(needle);
    if (startIdx === -1){ highlightLayerDiv.innerHTML=''; return false; }

    let acc=0, startItem=0, startCharInItem=0;
    for (let i=0;i<items.length;i++){
      const s=items[i].str;
      if (acc + s.length + 1 > startIdx){ startItem=i; startCharInItem=startIdx-acc; break; }
      acc += s.length + 1;
    }
    const endIdx = startIdx + needle.length;
    let endItem=startItem, endCharInItem=endIdx-acc;
    for (let i=startItem;i<items.length;i++){
      const s=items[i].str, spanEnd=acc+s.length+1;
      if (spanEnd>=endIdx){ endItem=i; endCharInItem=endIdx-acc; break; }
      acc = spanEnd;
    }

    highlightLayerDiv.innerHTML='';
    const page = await pdfDoc.getPage(currentPageNumber);
    const viewport = page.getViewport({ scale: viewportScale });

    for (let i=startItem;i<=endItem;i++){
      const it = textContent.items[i];
      const transform = pdfjsLib.Util.transform(
        pdfjsLib.Util.transform(viewport.transform, it.transform),
        [1,0,0,-1,0,0]
      );
      const [a,b,c,d,e,f] = transform;
      const fontSize = Math.hypot(a,b);
      const widthPerChar = (it.width ? (it.width * viewportScale) : Math.abs(a)) / Math.max(1, it.str.length);

      let left=e, top=f - fontSize, wChars=it.str.length;
      if (i===startItem){ left += widthPerChar * startCharInItem; wChars -= startCharInItem; }
      if (i===endItem){ wChars = (i===startItem ? (endCharInItem - startCharInItem) : endCharInItem); }

      const rect = document.createElement('div');
      rect.className='highlight';
      rect.style.left = left+'px';
      rect.style.top  = top+'px';
      rect.style.width = Math.max(2, widthPerChar * Math.max(0,wChars))+'px';
      rect.style.height = Math.max(2, fontSize*1.1)+'px';
      highlightLayerDiv.appendChild(rect);
    }
    return true;
  }
});
