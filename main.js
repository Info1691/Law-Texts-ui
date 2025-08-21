// =====================
// Law-Texts-ui / main.js
// =====================

// ----- Registry (single source of truth) -----
const REGISTRY_CANDIDATES = ["textbooks.json"];

let registry = [];
let current = {
  book: null,
  isPdf: false,
  pdf: null,
  totalPages: 0,
  page: 1,             // currently rendered page
  scale: 1,            // computed per page to fit viewer width
  textIndex: {},       // page -> plain text
  hits: [],            // [{ page, snippet }]
  lastQuery: "",       // used for drawing highlights
  hitCursor: -1
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

// ----- Boot: load registry -----
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
  if (!registry.length){
    setStatus(`Error loading registry. ${lastErr || "No candidates worked."} Tried: ${REGISTRY_CANDIDATES.join(", ")}.`, true);
    return;
  }
  renderList(registry);
  wireEvents();
  setStatus("");
})();

// ----- Render book list -----
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
      // Build the pager surface (canvas + page counter)
      els.viewer.innerHTML = `
        <canvas id="pdfCanvas" style="display:block; width:100%; background:#fff;"></canvas>
        <div class="hint">Pages: <span id="pageInfo"></span> — Use Prev/Next to turn pages. Search highlights will be shown on the page.</div>
      `;
      await renderPage(current.page);
      setStatus(`PDF loaded (${current.totalPages} pages).`);
    } else {
      const res = await fetch(url, { cache:"no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      els.viewer.innerHTML = `<pre>${escHTML(text)}</pre>`;
      setStatus("Text loaded.");
    }
  } catch(err){
    els.viewer.innerHTML = `<div class="error">Failed to load: ${escHTML(url)}<br>${escHTML(err.message||String(err))}</div>`;
    setStatus("Load error.", true);
  }
}

// ----- PDF.js helpers (page-by-page; crisp; readable size) -----
async function openPdf(url){
  if (!window.pdfjsLib) throw new Error("PDF.js not available");
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  current.pdf = pdf;
  current.totalPages = pdf.numPages;
}

/**
 * Compute a scale that makes text readable (like body text),
 * by fitting to viewer width and nudging slightly larger.
 */
function computeScaleForPage(unscaledWidth){
  const viewerWidth = Math.max(els.viewer.clientWidth, 720); // ensure decent min
  const targetCssWidth = Math.min(viewerWidth - 24, 980);    // cap CSS width for comfy reading
  const scale = (targetCssWidth / unscaledWidth) * 1.10;     // 10% boost for readability
  return Math.min(scale, 3.0);                                // safety cap
}

async function renderPage(pageNum){
  if (!current.pdf) return;
  current.page = Math.min(Math.max(1, pageNum), current.totalPages);
  const page = await current.pdf.getPage(current.page);

  // work out scale for readable CSS width
  const unscaled = page.getViewport({ scale: 1 });
  current.scale = computeScaleForPage(unscaled.width);

  const viewportCSS = page.getViewport({ scale: current.scale });
  const canvas = document.getElementById("pdfCanvas");
  const ctx = canvas.getContext("2d");

  // crisp drawing at devicePixelRatio
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = Math.round(viewportCSS.width) + "px";
  canvas.style.height = Math.round(viewportCSS.height) + "px";
  canvas.width  = Math.floor(viewportCSS.width  * dpr);
  canvas.height = Math.floor(viewportCSS.height * dpr);

  // PDF.js transform for DPR
  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
  const viewportDevice = page.getViewport({ scale: current.scale, transform });

  // render page
  await page.render({ canvasContext: ctx, viewport: viewportDevice }).promise;

  // page counter
  const info = document.getElementById("pageInfo");
  if (info) info.textContent = `${current.page} / ${current.totalPages}`;

  // draw highlight for the current query, if any
  const q = clean(current.lastQuery);
  if (q) await highlightMatchesOnCanvas(page, ctx, viewportDevice, q, dpr);
}

async function getPageText(pageNumber){
  if (current.textIndex[pageNumber]) return current.textIndex[pageNumber];
  const page = await current.pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map(i => i.str).join(" ");
  current.textIndex[pageNumber] = text;
  return text;
}

// ----- Highlighter (covers same-item and split-across-two-items) -----
async function highlightMatchesOnCanvas(page, ctx, viewport, q, dpr){
  try {
    const content = await page.getTextContent();
    const needle = q.toLowerCase();

    const items = content.items.map((it) => {
      const m = pdfjsLib.Util.transform(viewport.transform, it.transform);
      const x = m[4];
      const yTop = m[5];
      const fontHeight = Math.hypot(m[2], m[3]);
      const widthPx = it.width * viewport.scale; // CSS px
      const text = it.str || "";
      return {
        text,
        lower: text.toLowerCase(),
        x, yTop, fontHeight, widthPx,
        avgChar: widthPx / Math.max(1, text.length)
      };
    });

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffeb3b";
    const fillBox = (x, yTop, w, h) => {
      const pad = Math.max(1, h * 0.15);
      const yy = yTop - h - pad;
      ctx.fillRect(x * dpr, yy * dpr, Math.max(2, w) * dpr, (h + pad * 2) * dpr);
    };

    for (let i = 0; i < items.length; i++){
      const a = items[i];
      if (!a.text) continue;

      // inside one item
      let from = 0, pos;
      while ((pos = a.lower.indexOf(needle, from)) !== -1){
        const x = a.x + pos * a.avgChar;
        const w = a.avgChar * needle.length;
        fillBox(x, a.yTop, w, a.fontHeight);
        from = pos + needle.length;
      }

      // across a and b
      if (i + 1 < items.length){
        const b = items[i+1];
        const joined = a.lower + b.lower;
        const jpos = joined.indexOf(needle);
        if (jpos !== -1){
          const aChars = Math.min(a.text.length, Math.max(0, jpos + needle.length) - jpos);
          const bChars = Math.max(0, needle.length - aChars);

          if (aChars > 0){
            const xa = a.x + jpos * a.avgChar;
            const wa = a.avgChar * aChars;
            fillBox(xa, a.yTop, wa, a.fontHeight);
          }
          if (bChars > 0){
            const xb = b.x;
            const wb = b.avgChar * bChars;
            fillBox(xb, b.yTop, wb, b.fontHeight);
          }
        }
      }
    }
    ctx.restore();
  } catch {
    // fail-quietly: if metrics are missing we just skip highlight
  }
}

// ----- Search (TXT or PDF) -----
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
  const maxResults = 100;
  for (let p=1; p<=current.totalPages && current.hits.length<maxResults; p++){
    const t = await getPageText(p);
    const lower = t.toLowerCase();
    let from = 0, pos;
    const needle = q.toLowerCase();
    while ((pos = lower.indexOf(needle, from)) !== -1){
      const snippet = t.slice(Math.max(0, pos-80), Math.min(t.length, pos+needle.length+80));
      current.hits.push({ page: p, snippet });
      if (current.hits.length >= maxResults) break;
      from = pos + needle.length;
    }
    await new Promise(r => setTimeout(r, 0)); // yield to UI
  }

  if (!current.hits.length){ setStatus("No matches."); await renderPage(current.page); return; }

  const frag = document.createDocumentFragment();
  const rx = new RegExp(escReg(q), "gi");
  current.hits.forEach((h,i) => {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `p.${h.page}: … ${escHTML(h.snippet).replace(rx, m => `<em>${escHTML(m)}</em>`)} …`;
    div.addEventListener("click", () => gotoHit(i));
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
  await renderPage(current.hits[idx].page); // draws highlight for current.lastQuery

  // focus selected result row
  const rows = els.results.querySelectorAll(".result");
  rows.forEach(n => n.style.background = "");
  const row = rows[idx];
  if (row){ row.style.background = "var(--light)"; row.scrollIntoView({ block: "nearest" }); }
}

// ----- Prev/Next: ALWAYS page navigation (simple & predictable) -----
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

  // Prev/Next = page navigation (always)
  els.prev.addEventListener("click", () => navPage(-1));
  els.next.addEventListener("click", () => navPage(1));

  // Arrow keys for page nav
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

  // Keep readable fit on rotation/resize
  window.addEventListener("resize", async () => {
    if (!current.isPdf || !current.pdf) return;
    await renderPage(current.page);
  }, { passive:true });
}
