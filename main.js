// ---------- CONFIG ----------
const CATALOG_URL = 'data/texts/catalog.json'; // lock to single catalog

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

let catalog = [];
let currentBook = null;
let currentDoc = null;
let currentPage = 1;

// ---------- LOAD CATALOG ----------
async function loadCatalog(){
  try {
    const resp = await fetch(CATALOG_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error("Cannot fetch catalog.json");
    const raw = await resp.json();
    catalog = raw;
    console.log("[catalog] loaded", catalog.length, "items");

    const list = document.getElementById("bookList");
    list.innerHTML = "";
    catalog.forEach((item, idx) => {
      const li = document.createElement("li");
      li.textContent = item.title;
      li.addEventListener("click", () => openBook(item));
      list.appendChild(li);
    });
  } catch(err){
    console.error("catalog load failed", err);
  }
}

// ---------- OPEN BOOK ----------
async function openBook(book){
  currentBook = book;
  currentPage = 1;
  document.getElementById("pdfViewer").innerHTML = "";

  if (!book.url) {
    console.warn("no url for", book.title);
    return;
  }

  if (book.url.toLowerCase().endsWith(".pdf")) {
    openPDF(book.url);
  } else if (book.url.toLowerCase().endsWith(".txt")) {
    openText(book.url);
  }
}

// ---------- OPEN PDF ----------
async function openPDF(url){
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    currentDoc = await loadingTask.promise;
    renderPage(currentPage);
  } catch(err){
    console.error("PDF load/render error:", err);
  }
}

async function renderPage(num){
  try {
    const page = await currentDoc.getPage(num);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    document.getElementById("pdfViewer").innerHTML = "";
    document.getElementById("pdfViewer").appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch(err){
    console.error("render page failed:", err);
  }
}

// ---------- OPEN TXT ----------
async function openText(url){
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    const txt = await resp.text();
    const div = document.createElement("div");
    div.className = "text-doc";
    div.textContent = txt;
    document.getElementById("pdfViewer").innerHTML = "";
    document.getElementById("pdfViewer").appendChild(div);
  } catch(err){
    console.error("text load error:", err);
  }
}

// ---------- CONTROLS ----------
document.getElementById("prevBtn").addEventListener("click", () => {
  if (!currentDoc) return;
  if (currentPage <= 1) return;
  currentPage--;
  renderPage(currentPage);
});

document.getElementById("nextBtn").addEventListener("click", () => {
  if (!currentDoc) return;
  if (currentPage >= currentDoc.numPages) return;
  currentPage++;
  renderPage(currentPage);
});

document.getElementById("goBtn").addEventListener("click", () => {
  if (!currentDoc) return;
  const p = parseInt(document.getElementById("pageInput").value, 10);
  if (p >= 1 && p <= currentDoc.numPages) {
    currentPage = p;
    renderPage(currentPage);
  }
});

document.getElementById("printBtn").addEventListener("click", () => {
  window.print();
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  if (currentBook && currentBook.url.endsWith(".txt")) {
    const resp = await fetch(currentBook.url);
    const txt = await resp.text();
    const blob = new Blob([txt], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = currentBook.title.replace(/\s+/g,"_") + ".txt";
    a.click();
  } else {
    alert("Export works for .txt books only.");
  }
});

// ---------- INIT ----------
window.addEventListener("DOMContentLoaded", loadCatalog);
