// ===== Registry paths & state =====
const REGISTRY_CANDIDATES = [
  "data/books/textbooks.json",      // legacy fallback
  "data/textbooks/textbooks.json",  // preferred
  "textbooks.json"                  // root fallback (your current)
];

let registry = [];
let current = {
  book: null,            // selected book object from registry
  pdf: null,             // pdfjs document
  totalPages: 0,
  textIndex: {},         // { pageNumber: "full text of that page" }
  hits: [],              // [{page, idx, start, end, snippet}]
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
const isPDF = (url) => /\.pdf(\?|#|$)/i.test(url || "");
const clean = (s) => (s||"").toString().trim();
function setStatus(msg, isError=false) {
  els.status.textContent = msg || "";
  els.status.className = "status" + (isError ? " error" : "");
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ===== Load registry =====
(async function boot() {
  setStatus("Loading registry…");
  for (const path of REGISTRY_CANDIDATES) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (res.ok) {
        registry = await res.json();
        setStatus("");
        break;
      }
    } catch (e) { /* continue */ }
  }
  if (!Array.isArray(registry) || registry.length === 0) {
    setStatus("Error loading registry: The string did not match the expected pattern. Registry fallbacks: data/books/textbooks.json, data/textbooks/textbooks.json, textbooks.json. Chapters and single-file books supported. Text files live under /data/books/.", true);
    return;
  }
  renderList(registry);
  wireEvents();
})();

// ===== Render list & filter =====
function renderList(items) {
  els.list.innerHTML = "";
  items.forEach((b, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(b.title || "Untitled")}</strong><br>
      <small>${escapeHtml(b.jurisdiction || "")}${b.reference ? " — " + escapeHtml(b.reference) : ""}</small>`;
    li.addEventListener("click", () => selectBook(i, li));
    els.list.appendChild(li);
  });
}

els.filter.addEventListener("input", () => {
  const q = els.filter.value.toLowerCase();
  const filtered = registry.filter(b =>
    (b.title||"").toLowerCase().includes(q) ||
    (b.jurisdiction||"").toLowerCase().includes(q) ||
    (b.reference||"").toLowerCase().includes(q)
  );
  renderList(filtered);
});

// ===== Select book =====
async function selectBook(idx, liEl) {
  // Clear active state
  Array.from(els.list.children).forEach(li => li.classList.remove("active"));
  if (liEl) liEl.classList.add("active");

  // Find the book inside current rendered list
  const title = liEl?.querySelector("strong")?.textContent || "";
  const match = registry.find(b => (b.title||"") === title) || registry[idx];
  current.book = match || null;

  // Reset UI pieces
  els.viewer.innerHTML = `<div class="placeholder">Loading…</div>`;
  els.results.innerHTML = "";
  current.pdf = null;
  current.totalPages = 0;
  current.textIndex = {};
  current.hits = [];
  current.hitCursor = -1;

  // Meta
  els.metaBook.textContent = clean(current.book?.title) || "—";
  els.metaChapter.textContent = "—";
  els.metaSource.textContent = clean(current.book?.jurisdiction) || "—";
  els.metaRef.textContent = clean(current.book?.reference) || "—";

  const url = clean(current.book?.reference_url);
  if (!url) { setStatus("No reference_url for this entry.", true); return; }

  try {
    if (isPDF(url)) {
      // Show PDF in viewer (searchable via our search box + page links)
      els.viewer.innerHTML = `
        <iframe id="pdfFrame" src="${url}#toolbar=1&navpanes=0&view=FitH" title="${escapeHtml(current.book.title || 'PDF')}"></iframe>
        <div class="hint">Tip: Use this search box for precise matches. You can also use Safari’s “Find on Page”.</div>
      `;
      setStatus("Opening PDF…");
      await openPdf(url);
      setStatus(`PDF loaded (${current.totalPages} pages).`);
    } else {
      // Load as plain text
      const res = await fetch(url, { cache:"no-store" });
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

// ===== PDF.js open & page text cache =====
async function openPdf(url){
  if (!window.pdfjsLib) throw new Error("PDF.js not available");
  const pdf = await pdfjsLib.getDocument({ url, disableRange: false }).promise;
  current.pdf = pdf;
  current.totalPages = pdf.numPages;
  current.textIndex = {}; // lazy cache
}

// Fetch text of a page (cached)
async function getPageText(pageNumber) {
  if (current.textIndex[pageNumber]) return current.textIndex[pageNumber];
  const page = await current.pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const strings = content.items.map(i => i.str);
  const text = strings.join(" ");
  current.textIndex[pageNumber] = text;
  return text;
}

// ===== Search within (TXT or PDF) =====
async function runSearch() {
  const q = clean(els.search.value);
  els.results.innerHTML = "";
  current.hits = [];
  current.hitCursor = -1;

  const url = clean(current.book?.reference_url);
  if (!url || q.length === 0) { setStatus(""); return; }

  // TXT search (simple)
  if (!isPDF(url)) {
    const text = (els.viewer.querySelector("pre")?.textContent) || "";
    const ix = text.toLowerCase().indexOf(q.toLowerCase());
    if (ix === -1) { setStatus("No matches."); return; }
    // Scroll to approximate area
    setStatus("Match found (text page). Use native find for more navigation.");
    // highlight naive (small scope)
    const before = text.slice(Math.max(0, ix-120), ix);
    const hit = text.slice(ix, ix+q.length);
    const after = text.slice(ix+q.length, ix+q.length+120);
    els.results.innerHTML = `<div class="result">…${escapeHtml(before)}<em>${escapeHtml(hit)}</em>${escapeHtml(after)}…</div>`;
    return;
  }

  // PDF search (lazy, page by page). To protect iPad memory, scan in batches.
  setStatus("Searching PDF…");
  const maxResults = 50;   // cap for UI
  const batch = 20;        // pages per batch (tune for iPad)
  let pageStart = 1;

  while (pageStart <= current.totalPages && current.hits.length < maxResults) {
    const pageEnd = Math.min(current.totalPages, pageStart + batch - 1);
    const tasks = [];
    for (let p = pageStart; p <= pageEnd; p++) tasks.push(getPageText(p));
    const texts = await Promise.all(tasks);
    texts.forEach((t, idx) => {
      const pageNo = pageStart + idx;
      const lower = t.toLowerCase();
      let from = 0, pos;
      while ((pos = lower.indexOf(q.toLowerCase(), from)) !== -1) {
        const start = Math.max(0, pos - 80);
        const end = Math.min(t.length, pos + q.length + 80);
        const snippet = t.slice(start, end);
        current.hits.push({ page: pageNo, start: pos, end: pos+q.length, snippet });
        if (current.hits.length >= maxResults) break;
        from = pos + q.length;
      }
    });

    if (current.hits.length >= maxResults) break;
    pageStart = pageEnd + 1;
    // Yield UI
    await new Promise(r => setTimeout(r, 0));
  }

  if (current.hits.length === 0) {
    setStatus("No matches.");
    return;
  }

  // Render results
  const frag = document.createDocumentFragment();
  current.hits.forEach((h, i) => {
    const div = document.createElement("div");
    const safe = escapeHtml(h.snippet);
    // crude highlight
    const highlighted = safe.replace(new RegExp(escapeReg(clean(els.search.value)), "gi"), m => `<em>${escapeHtml(m)}</em>`);
    div.className = "result";
    div.innerHTML = `p.${h.page}: … ${highlighted} …`;
    div.addEventListener("click", () => gotoHit(i));
    frag.appendChild(div);
  });
  els.results.innerHTML = "";
  els.results.appendChild(frag);
  current.hitCursor = 0;
  gotoHit(0);
  setStatus(`Found ${current.hits.length} match(es).`);
}

function escapeReg(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Navigate to a specific hit (PDF)
function gotoHit(idx){
  if (!current.hits[idx]) return;
  current.hitCursor = idx;
  const page = current.hits[idx].page;
  // Scroll PDF iframe to page (via hash)
  const iframe = document.getElementById("pdfFrame");
  if (iframe) iframe.src = clean(current.book.reference_url) + `#page=${page}&view=FitH`;

  // focus selected result
  const nodes = els.results.querySelectorAll(".result");
  nodes.forEach(n => n.style.background = "");
  const node = nodes[idx];
  if (node) {
    node.style.background = "var(--light)";
    node.scrollIntoView({ block: "nearest" });
  }
}

// Prev/Next in hits
function navHit(step){
  if (current.hits.length === 0) return;
  let idx = current.hitCursor + step;
  if (idx < 0) idx = current.hits.length - 1;
  if (idx >= current.hits.length) idx = 0;
  gotoHit(idx);
}

// ===== Wire events =====
function wireEvents(){
  els.search.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
  els.prev.addEventListener("click", () => navHit(-1));
  els.next.addEventListener("click", () => navHit(1));

  els.printBtn.addEventListener("click", () => {
    // For PDFs: print iframe; for TXT: print the viewer
    const iframe = document.getElementById("pdfFrame");
    if (iframe && iframe.contentWindow) iframe.contentWindow.focus(), iframe.contentWindow.print();
    else window.print();
  });

  els.exportBtn.addEventListener("click", async () => {
    const url = clean(current.book?.reference_url);
    if (!url) return;
    if (isPDF(url)) {
      setStatus("Export TXT from PDF is not supported here. (Use the search results and print if needed.)");
      return;
    }
    try {
      const txt = els.viewer.querySelector("pre")?.textContent || "";
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (clean(current.book?.title) || "export") + ".txt";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch(e){
      setStatus("Export failed.", true);
    }
  });
}
