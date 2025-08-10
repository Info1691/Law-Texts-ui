const PATHS = { JSON: 'textbooks.json' };

const $ = (id) => document.getElementById(id);
const els = {
  bookSelect: $('bookSelect'),
  chapterSelect: $('chapterSelect'),
  jur: $('jurisdiction'),
  ref: $('reference'),
  src: $('sourceFile'),
  text: $('chapterText'),
  status: $('status'),
  printBtn: $('printBtn'),
  exportBtn: $('exportBtn')
};

let books = [];
let activeBook = null;
let activeChapter = null;

// ---- fetch helpers ----
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return res.json();
}
async function fetchTextStrict(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  const txt = await res.text();
  if (/<!doctype html/i.test(txt) && /page not found/i.test(txt)) {
    throw new Error(`${path} → 404 (file not found)`);
  }
  return txt;
}

// ---- rendering ----
function renderBookSelect() {
  els.bookSelect.innerHTML = '';
  books.forEach((b, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = b.title || `Book ${i+1}`;
    els.bookSelect.appendChild(o);
  });
}
function renderChapterSelect(book) {
  els.chapterSelect.innerHTML = '';
  if (!Array.isArray(book.chapters) || !book.chapters.length) {
    els.chapterSelect.disabled = true;
    const o = document.createElement('option');
    o.textContent = '—';
    els.chapterSelect.appendChild(o);
    return;
  }
  book.chapters.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = c.title || `Chapter ${i+1}`;
    els.chapterSelect.appendChild(o);
  });
  els.chapterSelect.disabled = false;
}
function updateMeta(book, chapter) {
  els.jur.textContent = book.jurisdiction || '—';
  els.ref.textContent = book.reference || '—';
  els.src.textContent = chapter?.reference_url || '—';
}

// ---- selection ----
async function selectBookByIndex(idx) {
  activeBook = books[idx] || null;
  activeChapter = null;
  if (!activeBook) return;

  renderChapterSelect(activeBook);
  els.chapterSelect.value = '0';

  if (Array.isArray(activeBook.chapters) && activeBook.chapters[0]) {
    await selectChapterByIndex(0);
  } else {
    updateMeta(activeBook, null);
    els.text.textContent = 'No chapters listed for this book.';
    els.status.textContent = '';
  }
}
async function selectChapterByIndex(idx) {
  if (!activeBook) return;
  activeChapter = activeBook.chapters[idx] || null;
  updateMeta(activeBook, activeChapter);

  if (!activeChapter?.reference_url) {
    els.text.textContent = 'Chapter has no reference_url.';
    els.status.textContent = '';
    return;
  }

  els.text.textContent = 'Loading…';
  els.status.textContent = '';
  try {
    const content = await fetchTextStrict(activeChapter.reference_url);
    els.text.textContent = content || '(empty file)';
    els.status.textContent = `Loaded: ${activeChapter.reference_url}`;
  } catch (e) {
    els.text.textContent = `Error loading: ${activeChapter.reference_url}\n${e.message}`;
    els.status.textContent = '';
  }
}

// ---- actions ----
function exportToTxt() {
  const nameSafe = (s) => (s || 'chapter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fileName = `${nameSafe(activeBook?.reference)}-${nameSafe(activeChapter?.title)}.txt`;
  const blob = new Blob([els.text.textContent || ''], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
}

// ---- init ----
function bindEvents() {
  els.bookSelect.addEventListener('change', async () => {
    const i = Number(els.bookSelect.value);
    await selectBookByIndex(i);
  });
  els.chapterSelect.addEventListener('change', async () => {
    const i = Number(els.chapterSelect.value);
    await selectChapterByIndex(i);
  });
  els.printBtn.addEventListener('click', () => window.print());
  els.exportBtn.addEventListener('click', exportToTxt);
}
async function init() {
  try {
    const data = await fetchJSON(PATHS.JSON);
    books = Array.isArray(data) ? data : (Array.isArray(data?.books) ? data.books : []);
    if (!books.length) throw new Error('textbooks.json must be an array or { "books": [...] }');
    renderBookSelect();
    bindEvents();
    els.bookSelect.value = '0';
    await selectBookByIndex(0);
  } catch (e) {
    els.text.textContent = `Failed to load textbooks.json\n${e.message}`;
  }
}
document.addEventListener('DOMContentLoaded', init);
