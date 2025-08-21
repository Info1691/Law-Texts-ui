// ===== Registry paths & state =====
const REGISTRY_CANDIDATES = ["textbooks.json"]; // single source of truth

let registry = [];
let current = {
  book: null,
  isPdf: false,
  pdf: null,          // pdfjs document
  totalPages: 0,
  page: 1,            // current rendered page
  scale: 1.2,         // rendering scale (auto-adjusted on load)
  textIndex: {},      // { pageNumber: "text of page" }
  hits: [],           // [{page, snippet}]
  hitCursor: -1
};

// ===== DOM =====
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

// ===== Utils =====
const isPDF = (url) => /\.pdf(\?|#|$)/i.test((url||"").trim());
const clean = (s) => (s||"").toString().trim();
function setStatus(msg, isError=false) {
  els.status.textContent = msg || "";
  els.status.className = "status" + (isError ? " error" : "");
}
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeReg(s){ return (s||"").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ===== Boot: load registry =====
(async function boot() {
  setStatus("Loading registry…");
  let lastErr = null;

  for (const path of REGISTRY_CANDIDATES) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) { lastErr = `HTTP ${res.status} for ${path}`; continue; }
      const raw = await res.text();
      try {
        const json = JSON.parse(raw);
        if (Array.isArray(json) && json.length) { registry = json; break; }
        lastErr = `Registry at ${path} is empty or not an array.`;
      } catch(e){ lastErr = `Invalid JSON at ${path}: ${e.message}`; }
    } catch(e){ lastErr = `Fetch failed: ${e.message}`; }
  }

  if (!registry.length) {
    setStatus(`Error loading registry. ${lastErr || "No candidates worked."} Tried: ${REGISTRY_CANDIDATES.join(", ")}.`, true);
    return;
  }

  renderList(registry);
  wireEvents();
  setStatus("");
})();

// ===== Render book list =====
function renderList(items) {
  els.list.innerHTML = "";
  items.forEach((b) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(b.title||"Untitled")}</strong><br>
      <small>${escapeHtml(b.jurisdiction||"")}${b.reference ? " — " + escapeHtml(b.reference) : ""}</small>`;
    li.addEventListener("click", () => selectBook(b, li));
    els.list.appendChild(li);
  });
}

// ===== Select book =====
async function selectBook(book, liEl) {
  Array.from(els.list.children).forEach(li => li.classList.remove("active"));
  if (liEl) liEl.classList.add("active");

  current.book = book;
  current.isPdf = isPDF(book.reference_url);
  current.pdf = null;
  current.totalPages = 0;
  current.page = 1;
  current.textIndex = {};
  current.hits = [];
  current.hitCursor = -1;

  els.results.innerHTML = "";
  els.viewer.innerHTML = `<div class="placeholder">Loading…</div>`;
  els.metaBook.textContent = clean(book.title) || "—";
  els.metaChapter.textContent = "—";
  els.metaSource.textContent = clean(book.jurisdiction) || "—";
  els.metaRef.textContent = clean(book.reference) || "—";

  const url = clean(book.reference_url);
  if (!url) { setStatus("No reference_url for this entry.", true); return; }

  try {
    if (current.isPdf) {
      await openPdf(url);
      // Build a canvas-based viewer
      els.viewer.innerHTML = `
        <canvas id="pdfCanvas" style="display:block; width:100%; background:#fff;"></canvas>
        <div class="hint">Tip: Use the search box or Prev/Next. Pages: <span id="pageInfo"></span></div>
      `;
      autoScaleForWidth();
      await renderPage(current.page);
      setStatus(`PDF loaded (${current.totalPages} pages).`);
    } else {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      els.viewer.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
      setStatus("Text loaded.");
    }
  } catch (err) {
    els.viewer.innerHTML = `<div class="error">Failed to load: ${escapeHtml(url)}<br>${escapeHtml(err.message||String(err))}</div>`;
    setStatus("Load error.", true);
  }
}

// ===== PDF.js helpers (canvas viewer) =====
async function openPdf(url){
  if (!window.pdfjsLib) throw new Error("PDF.js not available");
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  current.pdf = pdf;
  current.totalPages = pdf.numPages;
}

function autoScaleForWidth(){
  const containerWidth = Math.max(els.viewer.clientWidth, 600);
  // assume 8.5in width at 96dpi ~ 816px; set scale so first page fits width.
  current.scale = containerWidth / 816; // adjusts to viewport
}

async function renderPage(pageNum){
  if (!current.pdf) return;
  current.page = Math.min(Math.max(1, pageNum), current.totalPages);
  const page = await current.pdf.getPage(current.page);

  const viewport = page.getViewport({ scale: current.scale });
  const canvas = document.getElementById("pdfCanvas");
  const ctx = canvas.getContext("2d");

  canvas.height = viewport.height;
  canvas.width  = viewport.width;

  await page.render({ canvasContext: ctx, viewport }).promise;

  const info = document.getElementById("pageInfo");
  if (info) info.textContent = `${current.page} / ${current.totalPages}`;
}

async function getPageText(pageNumber){
  if (current.textIndex[pageNumber]) return current.textIndex[pageNumber];
  const page = await current.pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const strings = content.items.map(i => i.str);
  const text = strings.join(" ");
  current.textIndex[pageNumber] = text;
  return text;
}

// ===== Search (TXT or PDF) =====
async function runSearch(){
  const q = clean(els.search.value);
  els.results.innerHTML = "";
  current.hits = [];
  current.hitCursor = -1;
  if (!q) { setStatus(""); return; }

  const url = clean(current.book?.reference_url);
  if (!url) { setStatus("No book selected."); return; }

  if (!current.isPdf) {
    const text = (els.viewer.querySelector("pre")?.textContent) || "";
    const ix = text.toLowerCase().indexOf(q.toLowerCase());
    if (ix === -1) { setStatus("No matches."); return; }
    const before = text.slice(Math.max(0, ix-120), ix);
    const hit = text.slice(ix, ix+q.length);
    const after = text.slice(ix+q.length, ix+q.length+120);
    els.results.innerHTML = `<div class="result">…${escapeHtml(before)}<em>${escapeHtml(hit)}</em>${escapeHtml(after)}…</div>`;
    setStatus("Match found in text.");
    return;
  }

  // PDF: lazy scan page-by-page, protect iPad memory
  setStatus("Searching PDF…");
  const maxResults = 100;
  for (let p=1; p<=current.totalPages && current.hits.length<maxResults; p++){
    const t = await getPageText(p);
    const lower = t.toLowerCase();
    let from = 0, pos;
    while ((pos = lower.indexOf(q.toLowerCase(), from)) !== -1) {
      const snippet = t.slice(Math.max(0,pos-80), Math.min(t.length,pos+q.length+80));
      current.hits.push({ page: p, snippet });
      if (current.hits.length >= maxResults) break;
      from = pos + q.length;
    }
    // yield to UI
    await new Promise(r => setTimeout(r, 0));
  }

  if (!current.hits.length) { setStatus("No matches."); return; }

  const frag = document.createDocumentFragment();
  const rx = new RegExp(escapeReg(q), "gi");
  current.hits.forEach((h,i)=>{
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `p.${h.page}: … ${escapeHtml(h.snippet).replace(rx, m=>`<em>${escapeHtml(m)}</em>`)} …`;
    div.addEventListener("click", ()=>gotoHit(i));
    frag.appendChild(div);
  });
  els.results.appendChild(frag);
  current.hitCursor = 0;
  await gotoHit(0);
  setStatus(`Found ${current.hits.length} match(es).`);
}

async function gotoHit(idx){
  if (!current.hits[idx]) return;
  current.hitCursor = idx;
  const page = current.hits[idx].page;
  await renderPage(page);
  // focus selected result row
  const rows = els.results.querySelectorAll(".result");
  rows.forEach(n=>n.style.background="");
  const row = rows[idx];
  if (row) { row.style.background = "var(--light)"; row.scrollIntoView({block:"nearest"}); }
}

function navHit(step){
  if (!current.hits.length) return;
  let idx = current.hitCursor + step;
  if (idx < 0) idx = current.hits.length - 1;
  if (idx >= current.hits.length) idx = 0;
  gotoHit(idx);
}

// ===== Events =====
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
  els.prev.addEventListener("click", () => navHit(-1));
  els.next.addEventListener("click", () => navHit(1));

  els.printBtn.addEventListener("click", () => {
    // Canvas print fallback (PDF frame removed); use browser print
    window.print();
  });

  els.exportBtn.addEventListener("click", async () => {
    const url = clean(current.book?.reference_url); if (!url) return;
    if (current.isPdf) { setStatus("Export to TXT from PDF not supported here."); return; }
    const txt = els.viewer.querySelector("pre")?.textContent || "";
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (clean(current.book?.title) || "export") + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Re-render page on resize to keep fit-to-width pleasant
  window.addEventListener("resize", async () => {
    if (!current.isPdf || !current.pdf) return;
    autoScaleForWidth();
    await renderPage(current.page);
  }, { passive:true });
}
