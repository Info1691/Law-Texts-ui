// ===== Registry paths & state ===== 
const REGISTRY_CANDIDATES = [
  "textbooks.json",                 // your actual file in repo root
  "data/textbooks/textbooks.json"   // optional future location
];

let registry = [];
let current = { book:null, pdf:null, totalPages:0, textIndex:{}, hits:[], hitCursor:-1 };

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
  let lastErr = null;

  for (const path of REGISTRY_CANDIDATES) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) { lastErr = `HTTP ${res.status} for ${path}`; continue; }

      const raw = await res.text();
      try {
        const json = JSON.parse(raw);
        if (Array.isArray(json) && json.length) {
          registry = json;
          setStatus("");
          break;
        } else {
          lastErr = `Registry at ${path} is not an array or is empty.`;
        }
      } catch (e) {
        lastErr = `Invalid JSON at ${path}: ${e.message}`;
      }
    } catch (e) {
      lastErr = `Fetch failed for ${path}: ${e.message}`;
    }
  }

  if (!Array.isArray(registry) || registry.length === 0) {
    setStatus(
      `Error loading registry. ${lastErr || "No candidates worked."} Tried: ${REGISTRY_CANDIDATES.join(", ")}.`,
      true
    );
    return;
  }

  renderList(registry);
  wireEvents();
})();

// ===== Render book list =====
function renderList(items) {
  els.list.innerHTML = "";
  items.forEach((b, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(b.title || "Untitled")}</strong><br>
      <small>${escapeHtml(b.jurisdiction || "")}${b.reference ? " — " + escapeHtml(b.reference) : ""}</small>`;
    li.addEventListener("click", () => selectBook(b, li));
    els.list.appendChild(li);
  });
}

// ===== Select book =====
async function selectBook(book, liEl) {
  Array.from(els.list.children).forEach(li => li.classList.remove("active"));
  if (liEl) liEl.classList.add("active");

  current.book = book;
  els.viewer.innerHTML = `<div class="placeholder">Loading…</div>`;
  els.results.innerHTML = "";
  current.pdf = null; current.totalPages = 0; current.textIndex={}; current.hits=[]; current.hitCursor=-1;

  els.metaBook.textContent = clean(book.title);
  els.metaChapter.textContent = "—";
  els.metaSource.textContent = clean(book.jurisdiction);
  els.metaRef.textContent = clean(book.reference);

  const url = clean(book.reference_url);
  if (!url) { setStatus("No reference_url for this entry.", true); return; }

  try {
    if (isPDF(url)) {
      els.viewer.innerHTML = `
        <iframe id="pdfFrame" src="${url}#toolbar=1&navpanes=0&view=FitH"></iframe>
        <div class="hint">Tip: Use search box or Safari’s “Find on Page”.</div>
      `;
      setStatus("Opening PDF…");
      await openPdf(url);
      setStatus(`PDF loaded (${current.totalPages} pages).`);
    } else {
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

// ===== PDF helpers =====
async function openPdf(url){
  if (!window.pdfjsLib) throw new Error("PDF.js not available");
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  current.pdf = pdf;
  current.totalPages = pdf.numPages;
  current.textIndex = {};
}

async function getPageText(pageNumber) {
  if (current.textIndex[pageNumber]) return current.textIndex[pageNumber];
  const page = await current.pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const strings = content.items.map(i => i.str);
  const text = strings.join(" ");
  current.textIndex[pageNumber] = text;
  return text;
}

// ===== Search =====
async function runSearch() {
  const q = clean(els.search.value);
  els.results.innerHTML = ""; current.hits=[]; current.hitCursor=-1;
  const url = clean(current.book?.reference_url);
  if (!url || q.length===0) return;

  if (!isPDF(url)) {
    const text = (els.viewer.querySelector("pre")?.textContent)||"";
    const ix = text.toLowerCase().indexOf(q.toLowerCase());
    if (ix===-1) { setStatus("No matches."); return; }
    setStatus("Match found in text file.");
    els.results.innerHTML = `<div class="result">…${escapeHtml(text.slice(ix-80,ix))}<em>${escapeHtml(text.slice(ix,ix+q.length))}</em>${escapeHtml(text.slice(ix+q.length,ix+q.length+80))}…</div>`;
    return;
  }

  setStatus("Searching PDF…");
  for (let p=1;p<=current.totalPages;p++) {
    const t = await getPageText(p);
    const lower = t.toLowerCase(); let pos=0;
    while ((pos = lower.indexOf(q.toLowerCase(), pos))!==-1) {
      const snippet = t.slice(Math.max(0,pos-60),pos+q.length+60);
      current.hits.push({page:p,snippet});
      pos+=q.length;
    }
  }

  if (!current.hits.length) { setStatus("No matches."); return; }
  const frag = document.createDocumentFragment();
  current.hits.forEach((h,i)=>{
    const div=document.createElement("div");
    div.className="result";
    div.innerHTML=`p.${h.page}: … ${escapeHtml(h.snippet).replace(new RegExp(q,"gi"),m=>`<em>${escapeHtml(m)}</em>`)} …`;
    div.addEventListener("click",()=>gotoHit(i));
    frag.appendChild(div);
  });
  els.results.appendChild(frag);
  gotoHit(0);
  setStatus(`Found ${current.hits.length} match(es).`);
}

function gotoHit(idx){
  if (!current.hits[idx]) return;
  current.hitCursor=idx;
  const page=current.hits[idx].page;
  const iframe=document.getElementById("pdfFrame");
  if (iframe) iframe.src=current.book.reference_url+`#page=${page}&view=FitH`;
}

function navHit(step){
  if (!current.hits.length) return;
  let idx=current.hitCursor+step;
  if (idx<0) idx=current.hits.length-1;
  if (idx>=current.hits.length) idx=0;
  gotoHit(idx);
}

// ===== Wire events =====
function wireEvents(){
  els.search.addEventListener("keydown", e=>{ if (e.key==="Enter") runSearch(); });
  els.prev.addEventListener("click", ()=>navHit(-1));
  els.next.addEventListener("click", ()=>navHit(1));
  els.printBtn.addEventListener("click", ()=>window.print());
  els.exportBtn.addEventListener("click", ()=>{
    const url=clean(current.book?.reference_url); if (!url) return;
    if (isPDF(url)) { setStatus("Export TXT from PDF not supported here."); return; }
    const txt=els.viewer.querySelector("pre")?.textContent||"";
    const blob=new Blob([txt],{type:"text/plain"}); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=(current.book?.title||"export")+".txt"; a.click();
  });
}
