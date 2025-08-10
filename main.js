const PATHS = { JSON: 'textbooks.json' };

const els = {
  select: document.getElementById('bookSelect'),
  jur: document.getElementById('jurisdiction'),
  ref: document.getElementById('reference'),
  text: document.getElementById('chapterText'),
  status: document.getElementById('status'),
  printBtn: document.getElementById('printBtn'),
  exportBtn: document.getElementById('exportBtn')
};

let books = [];
let active = null;

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return res.json();
}
async function fetchTextStrict(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  const txt = await res.text();
  // Guard: don’t render GH Pages 404 HTML as content
  if (/<!doctype html/i.test(txt) && /Page not found/i.test(txt)) {
    throw new Error(`${path} → 404 (file not found)`);
  }
  return txt;
}

function renderSelect() {
  els.select.innerHTML = '';
  books.forEach((b, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = b.title || `Book ${i+1}`;
    els.select.appendChild(opt);
  });
}

async function loadBook(idx) {
  active = books[idx];
  els.jur.textContent = active.jurisdiction || '—';
  els.ref.textContent = active.reference || '—';
  els.text.textContent = 'Loading…';
  els.status.textContent = '';

  // choose first chapter if any; else show message
  const chapter = Array.isArray(active.chapters) && active.chapters[0];
  if (!chapter || !chapter.reference_url) {
    els.text.textContent = 'No chapters listed for this book.';
    return;
  }

  try {
    const content = await fetchTextStrict(chapter.reference_url);
    els.text.textContent = content || '(empty file)';
    els.status.textContent = `Loaded: ${chapter.reference_url}`;
  } catch (e) {
    els.text.textContent = `Error loading: ${chapter?.reference_url || '(none)'}\n${e.message}`;
    els.status.textContent = '';
  }
}

function exportToTxt() {
  const blob = new Blob([els.text.textContent || ''], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'chapter.txt' });
  document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
}

function initEvents() {
  els.select.addEventListener('change', () => {
    const idx = Number(els.select.value);
    loadBook(idx);
  });
  els.printBtn.addEventListener('click', () => window.print());
  els.exportBtn.addEventListener('click', exportToTxt);
}

async function init() {
  try {
    const data = await fetchJSON(PATHS.JSON);
    books = Array.isArray(data) ? data : (Array.isArray(data?.books) ? data.books : []);
    if (!books.length) throw new Error('textbooks.json must be an array or { "books": [...] }');
    renderSelect();
    initEvents();
    els.select.value = '0';
    loadBook(0);
  } catch (e) {
    els.text.textContent = `Failed to load textbooks.json\n${e.message}`;
  }
}
document.addEventListener('DOMContentLoaded', init);
