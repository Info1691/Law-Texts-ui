// =====================
// Law-Texts-ui / main.js
// =====================

// ----- Registry -----
const REGISTRY_CANDIDATES = ["textbooks.json"];

let registry = [];
let current = {
  book: null,
  isPdf: false,
  pdf: null,
  totalPages: 0,
  page: 1,
  scale: 1,
  textIndex: {},
  hits: [],
  hitCursor: -1,
  lastQuery: ""
};

// ----- DOM -----
const els = {
  list: document.getElementById("bookList"),
  filter: document.getElementById("filterInput"),
  search: document.getElementById("searchInput"),
  prev: document.getElementById("prevBtn"),
  next: document.getElementById("nextBtn"),
  viewer: document.getElementById("viewer"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  metaBook: document.getElementById("metaBook"),
  metaChapter: document.getElementById("metaChapter"),
  metaSource: document.getElementById("metaSource"),
  metaRef: document.getElementById("metaRef"),
  printBtn: document.getElementById("printBtn"),
  exportBtn: document.getElementById("exportBtn")
};

// ----- Utils -----
const isPDF = (url) => /\.pdf(\?|#|$)/i.test((url||"").trim());
const clean = (s) => (s||"").toString().trim();
const escHTML = (s) => (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const escReg = (s) => (s||"").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function setStatus(msg, isError=false){ els.status.textContent = msg || ""; els.status.className = "status" + (isError ? " error" : ""); }

// ----- Boot -----
(async function boot(){
  setStatus("Loading registry…");
  let lastErr = null;
  for (const path of REGISTRY_CANDIDATES){
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) { lastErr = `HTTP ${res.status} for ${path}`; continue; }
      const raw = await res.text();
      try {
        const json = JSON.parse(raw);
        if (Array.isArray(json) && json.length){ registry = json; break; }
        lastErr = `Registry at ${path} is empty or not an array.`;
      } catch(e){ lastErr = `Invalid JSON at ${path}: ${e.message}`; }
    } catch(e){ lastErr = `Fetch failed: ${e.message}`; }
  }
  if (!registry.length){ setStatus(`Error loading registry. ${lastErr || "No candidates worked."} Tried: ${REGISTRY_CANDIDATES.join(", ")}.`, true); return; }
  renderList(registry);
  wireEvents();
  setStatus("");
})();

// ----- List -----
function renderList(items){
  els.list.innerHTML = "";
  items.forEach((b) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `<strong>${escHTML(b.title||"Untitled")}</strong><br>
      <small>${escHTML(b.jurisdiction||"")}${b.reference ? " — " + escHTML(b.reference) : ""}</small>`;
    li.addEventListener("click", () => selectBook(b, li));
    els.list.appendChild(li);
  });
}

// ----- Select book -----
async function selectBook(book, liEl){
  Array.from(els.list.children).forEach(li => li.classList.remove("active"));
  if (liEl) liEl.classList.add("active");

  current.book = book;
  current.isPdf = isPDF(book.reference_url);
  current.pdf = null; current.totalPages = 0; current.page = 1;
  current.textIndex = {}; current.hits = []; current.hitCursor = -1; current.lastQuery = "";

  els.results.innerHTML = "";
  els.viewer.innerHTML = `<div class="placeholder">Loading…</div>`;
  els.metaBook.textContent = clean(book.title) || "—";
  els.metaChapter.textContent = "—";
  els.metaSource.textContent = clean(book.jurisdiction) || "—";
  els.metaRef.textContent = clean(book.reference) || "—";

  const url = clean(book.reference_url);
  if (!url){ setStatus("No reference_url for this entry.", true); return; }

  try {
    if (current.isPdf){
      await openPdf(url);
      // Viewer surface: canvas + positioned text layer for precise highlights
      els.viewer.innerHTML = `
        <div id="pageWrap" style="position:relative; width:100%; height:100%; display:flex; justify-content:center; align-items:flex-start;">
          <canvas id="pdfCanvas" style="display:block; width:100%; height:auto; background:#fff;"></canvas>
          <div id="textLayer" class="textLayer"></div>
        </div>
        <div class="hint" style="margin:6px 0 0 0;">Pages: <span id="pageInfo"></span> — Prev/Next turns pages. Click a match on the right to jump.</div>
      `;
      await renderPage(current.page);
      setStatus(`PDF loaded (${current.totalPages} pages).`);
    } else {
      const res = await fetch(url, { cache:"no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      els.viewer.innerHTML = `<pre style="margin:0; padding:12px;">${escHTML(text)}</pre>`;
      setStatus("Text loaded.");
    }
  } catch(err){
    els.viewer.innerHTML = `<div class="error">Failed to load: ${escHTML(url)}<br>${escHTML(err.message||String(err))}</div>`;
    setStatus("Load error.", true);
  }
}

// ----- PDF helpers -----
async function openPdf(url){
  if (!window.pdfjsLib) throw new Error("PDF.js not available");
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  current.pdf = pdf;
  current.totalPages = pdf.numPages;
}

// fit portrait width without cutting sides, readable
function computeScaleForPage(unscaledWidth){
  const wrap = document.getElementById("pageWrap");
  const wrapWidth = Math.max((wrap?.clientWidth) || (els.viewer.clientWidth), 760);
  const targetCssWidth = Math.min(wrapWidth - 24, 1100);
  return Math.min((targetCssWidth / unscaledWidth) * 1.10, 3.0);
}

async function renderPage(pageNum){
  if (!current.pdf) return;
  current.page = Math.min(Math.max(1, pageNum), current.totalPages);
  const page = await current.pdf.getPage(current.page);

  // compute readable scale
  const unscaled = page.getViewport({ scale: 1 });
  current.scale = computeScaleForPage(unscaled.width);

  const viewportCSS = page.getViewport({ scale: current.scale });

  const canvas = document.getElementById("pdfCanvas");
  const textLayer = document.getElementById("textLayer");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  // size canvas (CSS & device pixels)
  canvas.style.width  = Math.round(viewportCSS.width) + "px";
  canvas.style.height = Math.round(viewportCSS.height) + "px";
  canvas.width  = Math.floor(viewportCSS.width  * dpr);
  canvas.height = Math.floor(viewportCSS.height * dpr);

  // text layer same CSS size & positioned on top
  textLayer.style.width  = canvas.style.width;
  textLayer.style.height = canvas.style.height;

  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
  const viewportDevice = page.getViewport({ scale: current.scale, transform });

  // draw page
  await page.render({ canvasContext: ctx, viewport: viewportDevice }).promise;

  // rebuild text layer for accurate on-page highlight
  await renderTextLayer(page, viewportCSS);

  // page counter
  const info = document.getElementById("pageInfo");
  if (info) info.textContent = `${current.page} / ${current.totalPages}`;

  // apply highlight if query present
  const q = clean(current.lastQuery);
  if (q) highlightTextLayer(q);

  // if there are hits, auto-select the first on this page in the side panel
  syncHitSelectionForCurrentPage();
}

async function renderTextLayer(page, viewportCSS){
  const textLayerDiv = document.getElementById("textLayer");
  if (!textLayerDiv) return;
  textLayerDiv.innerHTML = "";

  const textContent = await page.getTextContent();
  await pdfjsLib.renderTextLayer({
    textContent,
    container: textLayerDiv,
    viewport: viewportCSS,
    textDivs: []
  }).promise;

  // Make overlay text invisible—only our highlights will show
  textLayerDiv.style.color = "transparent";
}

function highlightTextLayer(q){
  const tl = document.getElementById("textLayer");
  if (!tl) return;
  const needle = q.toLowerCase();
  const rx = new RegExp(escReg(needle), "gi");

  // unwrap previous marks (if any)
  tl.querySelectorAll("mark.hl").forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent), m);
  });

  // wrap matches inside textLayer
  const nodes = Array.from(tl.querySelectorAll("span,div"));
  nodes.forEach(n => {
    if (!n.firstChild || n.childNodes.length !== 1 || n.firstChild.nodeType !== 3) return;
    const txt = n.textContent || "";
    if (txt.toLowerCase().indexOf(needle) === -1) return;
    n.innerHTML = txt.replace(rx, m => `<mark class="hl">${m}</mark>`);
  });
}

async function getPageText(pageNumber){
  if (current.textIndex[pageNumber]) return current.textIndex[pageNumber];
  const page = await current.pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map(i => i.str).join(" ");
  current.textIndex[pageNumber] = text;
  return text;
}

// ----- Search -----
async function runSearch(){
  const q = clean(els.search.value);
  els.results.innerHTML = ""; current.hits = []; current.hitCursor = -1;
  current.lastQuery = q;

  if (!q){ setStatus(""); await renderPage(current.page); return; }
  const url = clean(current.book?.reference_url);
  if (!url){ setStatus("No book selected."); return; }

  if (!current.isPdf){
    const text = (els.viewer.querySelector("pre")?.textContent) || "";
    const ix = text.toLowerCase().indexOf(q.toLowerCase());
    if (ix === -1){ setStatus("No matches."); return; }
    const before = text.slice(Math.max(0, ix-120), ix);
    const hit = text.slice(ix, ix+q.length);
    const after = text.slice(ix+q.length, ix+q.length+120);
    els.results.innerHTML = `<div class="result">…${escHTML(before)}<em>${escHTML(hit)}</em>${escHTML(after)}…</div>`;
    setStatus("Match found in text.");
    return;
  }

  setStatus("Searching PDF…");
  const maxResults = 150;
  for (let p=1; p<=current.totalPages && current.hits.length<maxResults; p++){
    const t = await getPageText(p);
    const lower = t.toLowerCase();
    const needle = q.toLowerCase();
    let from = 0, pos;
    while ((pos = lower.indexOf(needle, from)) !== -1){
      const snippet = t.slice(Math.max(0, pos-80), Math.min(t.length, pos+needle.length+80));
      current.hits.push({ page: p, snippet });
      if (current.hits.length >= maxResults) break;
      from = pos + needle.length;
    }
    await new Promise(r => setTimeout(r, 0));
  }

  if (!current.hits.length){ setStatus("No matches."); await renderPage(current.page); return; }

  // render the side results list (right pane)
  const frag = document.createDocumentFragment();
  const rx = new RegExp(escReg(q), "gi");
  current.hits.forEach((h,i) => {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `p.${h.page}: … ${escHTML(h.snippet).replace(rx, m => `<em>${escHTML(m)}</em>`)} …`;
    div.addEventListener("click", () => gotoHit(i));
    frag.appendChild(div);
  });
  els.results.innerHTML = "";
  els.results.appendChild(frag);

  current.hitCursor = 0;
  await gotoHit(0);
  setStatus(`Found ${current.hits.length} match(es).`);
}

async function gotoHit(idx){
  if (!current.hits[idx]) return;
  current.hitCursor = idx;
  await renderPage(current.hits[idx].page); // also applies highlight
  highlightActiveResultRow();
  scrollActiveResultIntoView();
}

function highlightActiveResultRow(){
  const rows = els.results.querySelectorAll(".result");
  rows.forEach(n => n.classList.remove("active"));
  const row = rows[current.hitCursor];
  if (row) row.classList.add("active");
}

function scrollActiveResultIntoView(){
  const row = els.results.querySelectorAll(".result")[current.hitCursor];
  if (row) row.scrollIntoView({ block: "nearest" });
}

function syncHitSelectionForCurrentPage(){
  if (!current.hits.length) return;
  const idx = current.hits.findIndex(h => h.page === current.page);
  if (idx !== -1){
    current.hitCursor = idx;
    highlightActiveResultRow();
    scrollActiveResultIntoView();
  }
}

// ----- Page navigation -----
function navPage(step){
  if (!current.isPdf || !current.pdf) return;
  const wanted = current.page + (step < 0 ? -1 : 1);
  if (wanted < 1 || wanted > current.totalPages) return;
  renderPage(wanted);
}

// ----- Events -----
function wireEvents(){
  els.filter.addEventListener("input", () => {
    const q = els.filter.value.toLowerCase();
    const filtered = registry.filter(b =>
      (b.title||"").toLowerCase().includes(q) ||
      (b.jurisdiction||"").toLowerCase().includes(q) ||
      (b.reference||"").toLowerCase().includes(q)
    );
    renderList(filtered);
  });

  els.search.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

  els.prev.addEventListener("click", () => navPage(-1));
  els.next.addEventListener("click", () => navPage(1));

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft")  navPage(-1);
    if (e.key === "ArrowRight") navPage(1);
  });

  els.printBtn.addEventListener("click", () => window.print());

  els.exportBtn.addEventListener("click", () => {
    const url = clean(current.book?.reference_url); if (!url) return;
    if (current.isPdf){ setStatus("Export to TXT from PDF not supported here."); return; }
    const txt = els.viewer.querySelector("pre")?.textContent || "";
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (clean(current.book?.title) || "export") + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Re-fit on rotation/resize
  window.addEventListener("resize", async () => {
    if (!current.isPdf || !current.pdf) return;
    await renderPage(current.page);
  }, { passive:true });
}
