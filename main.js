/* ========= Law-Text-ui: PDF viewer with book↔PDF page calibration & text-anchored highlights ========= */

/** CONFIG **/
const CATALOG_JSON = 'data/law-texts/catalog.json'; // optional; if missing, UI still works (you can load one doc via URL hash)
const DEFAULT_OFFSET = -83; // pdfPage = bookPage + DEFAULT_OFFSET (will be overridden by one-tap calibration)
const STORAGE_PREFIX = 'lawtextui:';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/** STATE **/
let pdfDoc = null;
let currentPdfUrl = null;
let currentPageNumber = 1; // 1-indexed
let rendering = false;
let pendingPage = null;
let viewportScale = 1; // computed per document so canvas width == 14cm CSS width
let pageTextCache = new Map(); // page -> textContent
let notes = []; // {id, bookPage, snippet, createdAt}

/** DOM **/
const catalogList = document.getElementById('catalogList');
const pageLabel = document.getElementById('pageLabel');
const pdfContainer = document.getElementById('pdfContainer');
const pdfCanvas = document.getElementById('pdfCanvas');
const textLayerDiv = document.getElementById('textLayer');
const highlightLayerDiv = document.getElementById('highlightLayer');
const ctx = pdfCanvas.getContext('2d');

const bookPageInput = document.getElementById('bookPageInput');
document.getElementById('goBtn').addEventListener('click', () => {
  const p = parseInt(bookPageInput.value, 10);
  if (Number.isInteger(p)) goToBookPage(p);
});

document.getElementById('prevBtn').addEventListener('click', () => queueRenderPage(Math.max(1, currentPageNumber - 1)));
document.getElementById('nextBtn').addEventListener('click', () => queueRenderPage(Math.min(pdfDoc?.numPages || 1, currentPageNumber + 1)));

document.getElementById('calibrateBtn').addEventListener('click', calibrateOffset);
document.getElementById('addNoteBtn').addEventListener('click', addNoteFromSelection);

/** UTIL: storage keys */
function k(key){ return STORAGE_PREFIX + (currentPdfUrl || ''); }
function loadCalib(){ try { return JSON.parse(localStorage.getItem(k('calib'))) || {}; } catch { return {}; } }
function saveCalib(data){ localStorage.setItem(k('calib'), JSON.stringify(data)); }
function loadNotes(){ try { return JSON.parse(localStorage.getItem(k('notes'))) || []; } catch { return []; } }
function saveNotes(){ localStorage.setItem(k('notes'), JSON.stringify(notes)); }

/** Toast */
function toast(msg, ms=2200){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.hidden = true; }, ms);
}

/** Book ↔ PDF page mapping */
function pdfPageFromBookPage(bookPage){
  const calib = loadCalib();
  // anchor ranges
  if (Array.isArray(calib.anchors) && calib.anchors.length){
    const anchor = [...calib.anchors].filter(a => a.bookPageStart <= bookPage).sort((a,b)=>b.bookPageStart-a.bookPageStart)[0];
    if (anchor) return bookPage + anchor.offset;
  }
  // single offset
  const off = (typeof calib.offset === 'number') ? calib.offset : DEFAULT_OFFSET;
  return bookPage + off;
}
function bookPageFromPdfPage(pdfPage){
  const calib = loadCalib();
  if (Array.isArray(calib.anchors) && calib.anchors.length){
    const sorted = [...calib.anchors].sort((a,b)=>a.bookPageStart-b.bookPageStart);
    let chosen = sorted[0] || { bookPageStart: 1, offset: (typeof calib.offset==='number') ? calib.offset : DEFAULT_OFFSET };
    for (const a of sorted){
      const pivotPdfAtStart = a.bookPageStart + a.offset;
      if (pivotPdfAtStart <= pdfPage) chosen = a; else break;
    }
    return pdfPage - chosen.offset;
  }
  const off = (typeof calib.offset === 'number') ? calib.offset : DEFAULT_OFFSET;
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
  calib.offset = off;
  calib.anchors = calib.anchors || [];
  saveCalib(calib);
  toast(`Calibrated: Book p.${book} ↔ PDF p.${pdf} (offset ${off>=0?'+':''}${off})`);
  updateDualPageLabel();
}

/** Catalog loading (optional) */
async function loadCatalog(){
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
    // auto-open first item
    if (items.length) openPdf(items[0].url, catalogList.firstElementChild);
  }catch{
    // Catalog not present. If URL hash given (?pdf=...), use it; else show empty.
    const url = new URL(location.href);
    const pdf = url.searchParams.get('pdf');
    if (pdf) openPdf(pdf, null);
  }
}

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
  const loadingTask = pdfjsLib.getDocument(url);
  pdfDoc = await loadingTask.promise;

  // Compute scale so the canvas width equals the CSS 14cm width in device pixels
  const cssWidthPx = pdfContainer.clientWidth; // 14cm in CSS pixels
  const firstPage = await pdfDoc.getPage(1);
  const v = firstPage.getViewport({ scale: 1 });
  viewportScale = cssWidthPx / v.width;

  currentPageNumber = 1;
  await renderPage(currentPageNumber);
  toast('Loaded document');
}

/** Render page to canvas + build text layer */
async function renderPage(num){
  rendering = true;
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: viewportScale });

  pdfCanvas.height = Math.floor(viewport.height);
  pdfCanvas.width  = Math.floor(viewport.width);

  // Render canvas
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Build text layer (for selection + search)
  textLayerDiv.innerHTML = '';
  textLayerDiv.style.width = pdfCanvas.style.width = pdfCanvas.width + 'px';
  textLayerDiv.style.height = pdfCanvas.height + 'px';
  highlightLayerDiv.innerHTML = '';
  highlightLayerDiv.style.width = pdfCanvas.width + 'px';
  highlightLayerDiv.style.height = pdfCanvas.height + 'px';

  const textContent = await page.getTextContent();
  pageTextCache.set(num, textContent);

  // Position text spans (simplified PDF.js text layer)
  const styles = textContent.styles;
  for (const item of textContent.items){
    const span = document.createElement('span');
    span.textContent = item.str;
    const transform = pdfjsLib.Util.transform(
      pdfjsLib.Util.transform(viewport.transform, item.transform),
      [1,0,0,-1,0,0]
    );
    const [a,b,c,d,e,f] = transform;
    const fontSize = Math.hypot(a, b);
    span.style.position = 'absolute';
    span.style.left = e + 'px';
    span.style.top = f - fontSize + 'px';
    span.style.fontSize = fontSize + 'px';
    span.style.transformOrigin = 'left bottom';
    span.style.transform = `matrix(${a/fontSize}, ${b/fontSize}, ${c/fontSize}, ${d/fontSize}, 0, 0)`;
    textLayerDiv.appendChild(span);
  }

  rendering = false;
  if (pendingPage !== null){
    const p = pendingPage; pendingPage = null;
    renderPage(p);
    return;
  }
  updateDualPageLabel();
}
function queueRenderPage(num){
  num = Math.max(1, Math.min(pdfDoc.numPages, num));
  if (rendering){ pendingPage = num; return; }
  currentPageNumber = num;
  renderPage(num);
}

/** Update page label */
function updateDualPageLabel(){
  const pdfP = currentPageNumber;
  const bookP = bookPageFromPdfPage(pdfP);
  pageLabel.textContent = `Book p.${bookP} (PDF p.${pdfP})`;
}

/** Jump to Book page */
function goToBookPage(bookPage){
  if (!pdfDoc) return;
  const target = pdfPageFromBookPage(bookPage);
  const clamped = Math.max(1, Math.min(pdfDoc.numPages, target));
  currentPageNumber = clamped;
  queueRenderPage(clamped);
  toast(`Book p.${bookPage} → PDF p.${clamped}`);
}

/** Notes (snippet-anchored) */
function renderNotesList(){
  const ul = document.getElementById('notesList');
  ul.innerHTML = '';
  if (!notes.length){
    const empty = document.createElement('div');
    empty.style.opacity = .7;
    empty.style.padding = '6px';
    empty.textContent = 'No notes yet.';
    ul.appendChild(empty);
    return;
  }
  for (const n of notes){
    const li = document.createElement('li');
    li.className = 'note';
    li.innerHTML = `<div><strong>p.${n.bookPage}</strong></div><div>${escapeHTML(n.snippet)}</div><small>${new Date(n.createdAt).toLocaleString()}</small>`;
    li.addEventListener('click', ()=> openNote(n));
    ul.appendChild(li);
  }
}
function escapeHTML(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

async function openNote(note){
  goToBookPage(note.bookPage);
  // wait for render
  const wait = () => new Promise(r => setTimeout(r, 150));
  await wait(); await wait();

  const ok = await highlightSnippetOnCurrentPage(note.snippet);
  if (ok) toast(`Found snippet on Book p.${note.bookPage} (PDF p.${currentPageNumber})`);
  else toast(`Opened Book p.${note.bookPage} (PDF p.${currentPageNumber}) — snippet not auto-matched`);
}

/** Add note from current selection (or prompt for snippet) */
function addNoteFromSelection(){
  const selection = window.getSelection().toString().trim();
  let snippet = selection;
  if (!snippet){
    const manual = prompt('Enter a short snippet to anchor this note (8–25 words):');
    if (!manual) return;
    snippet = manual.trim();
  }
  // normalize snippet length
  const words = snippet.split(/\s+/).slice(0, 25);
  snippet = words.join(' ');
  const bookP = bookPageFromPdfPage(currentPageNumber);
  const note = { id: crypto.randomUUID(), bookPage: bookP, snippet, createdAt: Date.now() };
  notes.unshift(note);
  saveNotes();
  renderNotesList();
  toast(`Saved note at Book p.${bookP}`);
}

/** Snippet highlighter: approximate but reliable */
async function highlightSnippetOnCurrentPage(snippet){
  if (!pdfDoc) return false;
  const textContent = pageTextCache.get(currentPageNumber) || await pdfDoc.getPage(currentPageNumber).then(p=>p.getTextContent());
  if (!pageTextCache.has(currentPageNumber)) pageTextCache.set(currentPageNumber, textContent);

  // Build a flat token list with positions
  const items = textContent.items.map((it, idx) => ({
    str: it.str,
    idx,
    tr: it.transform
  }));

  const joined = items.map(i=>i.str).join(' ').toLowerCase();
  const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
  const startIdx = joined.indexOf(needle);
  if (startIdx === -1){
    highlightLayerDiv.innerHTML = '';
    return false;
  }

  // Map the character window back to item indices
  let acc = 0, startItem = 0, startCharInItem = 0;
  for (let i=0;i<items.length;i++){
    const s = items[i].str;
    if (acc + s.length + 1 > startIdx){ // +1 for space joiner
      startItem = i;
      startCharInItem = startIdx - acc;
      break;
    }
    acc += s.length + 1;
  }
  const endIdx = startIdx + needle.length;
  let endItem = startItem, endCharInItem = endIdx - acc;
  for (let i=startItem;i<items.length;i++){
    const s = items[i].str;
    const spanEnd = acc + s.length + 1;
    if (spanEnd >= endIdx){ endItem = i; endCharInItem = endIdx - acc; break; }
    acc = spanEnd;
  }

  // Clear previous
  highlightLayerDiv.innerHTML = '';

  // Build viewport to compute positions
  const page = await pdfDoc.getPage(currentPageNumber);
  const viewport = page.getViewport({ scale: viewportScale });

  // Draw highlight boxes across involved items
  for (let i = startItem; i <= endItem; i++){
    const it = textContent.items[i];
    const transform = pdfjsLib.Util.transform(
      pdfjsLib.Util.transform(viewport.transform, it.transform),
      [1,0,0,-1,0,0]
    );
    const [a,b,c,d,e,f] = transform;
    const fontSize = Math.hypot(a,b);
    const widthPerChar = (it.width ? (it.width * viewportScale) : (Math.abs(a))) / Math.max(1, it.str.length);

    let left = e;
    let top  = f - fontSize;
    let wChars = it.str.length;

    // Trim first/last spans
    if (i === startItem) { left += widthPerChar * startCharInItem; wChars -= startCharInItem; }
    if (i === endItem)   { wChars = (i === startItem ? (endCharInItem - startCharInItem) : endCharInItem); }

    const rect = document.createElement('div');
    rect.className = 'highlight';
    rect.style.left = left + 'px';
    rect.style.top  = top + 'px';
    rect.style.width = Math.max(2, widthPerChar * Math.max(0, wChars)) + 'px';
    rect.style.height = Math.max(2, fontSize * 1.1) + 'px';
    highlightLayerDiv.appendChild(rect);
  }
  return true;
}

/** Init */
loadCatalog();
