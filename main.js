/* textbooks-ui/main.js – single-file + chaptered books
   - registry fallbacks
   - sticky search with Prev/Next
   - highlight & safe escaping
   - clear 404/status messages
*/
(function () {
  // ---------- registry fallbacks ----------
  const REGISTRY_PATHS = [
    'data/books/textbooks.json',
    'data/textbooks.json',
    'textbooks.json'
  ];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    itemList: $('itemList'),
    listSearch: $('listSearch'),
    textSearch: $('textSearch'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    docText: $('docText'),
    status: $('status'),
    bookTitle: $('bookTitle'),
    chapterTitle: $('chapterTitle'),
    source: $('source'),
    reference: $('reference'),
    printBtn: $('printBtn'),
    exportBtn: $('exportBtn'),
  };

  // ---------- state ----------
  let registry = [];
  let items = [];        // flat list to render in sidebar
  let rawText = '';      // current file raw text
  let matches = [];      // NodeList of marks
  let matchIndex = -1;   // current match

  // ---------- helpers ----------
  const escapeHTML = (s) =>
    s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function status(msg) { els.status.textContent = msg || ''; }

  function normalizeEntry(e) {
    // supports:
    // 1) { title, jurisdiction, reference, chapters:[ {title, reference_url}, ... ] }
    // 2) { title, jurisdiction, reference, reference_url }  (single-file)
    const list = [];
    if (e.chapters && Array.isArray(e.chapters) && e.chapters.length) {
      e.chapters.forEach((ch, i) => {
        list.push({
          book: e.title,
          jurisdiction: e.jurisdiction || '',
          reference: e.reference || '',
          chapter: ch.title || `Chapter ${i+1}`,
          url: ch.reference_url
        });
      });
    } else if (e.reference_url) {
      list.push({
        book: e.title,
        jurisdiction: e.jurisdiction || '',
        reference: e.reference || '',
        chapter: '-',           // single file
        url: e.reference_url
      });
    }
    return list;
  }

  async function fetchJSONWithFallback(paths) {
    let lastErr;
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache:'no-store' });
        if (!res.ok) throw new Error(`${p} → ${res.status}`);
        const data = await res.json();
        status(`Loaded: ${p}`);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Failed to load registry.');
  }

  function renderList() {
    els.itemList.innerHTML = '';
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.innerHTML = `<div><strong>${escapeHTML(it.book)}</strong>${it.chapter && it.chapter !== '-' ? ` — ${escapeHTML(it.chapter)}` : ''}</div>
                      <div style="font-size:12px;color:#555">${escapeHTML(it.jurisdiction || '')}</div>`;
      li.tabIndex = 0;
      li.addEventListener('click', () => selectItem(idx));
      li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') selectItem(idx); });
      els.itemList.appendChild(li);
    });
  }

  function setActive(index) {
    [...els.itemList.children].forEach((li, i) => li.classList.toggle('active', i === index));
  }

  function applyHighlights(term) {
    if (!term) {
      els.docText.innerHTML = escapeHTML(rawText);
      matches = [];
      matchIndex = -1;
      return;
    }
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    // Escape first, then add marks
    const marked = escapeHTML(rawText).replace(rx, m => `<mark class="hl">${m}</mark>`);
    els.docText.innerHTML = marked;
    matches = els.docText.querySelectorAll('mark.hl');
    matchIndex = matches.length ? 0 : -1;
    updateMatchFocus();
  }

  function updateMatchFocus() {
    matches.forEach(m => m.classList.remove('hlcurr'));
    if (matchIndex >= 0 && matches[matchIndex]) {
      matches[matchIndex].classList.add('hlcurr');
      // scroll the <pre> container to the current match
      const container = els.docText;
      const el = matches[matchIndex];
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const offset = (eRect.top - cRect.top) + container.scrollTop - 40; // pad
      container.scrollTo({ top: offset, behavior: 'smooth' });
      status(`Match ${matchIndex + 1} of ${matches.length}`);
    } else {
      if (els.textSearch.value.trim()) status('No matches');
      else status('');
    }
  }

  function nextMatch(step) {
    if (!matches.length) return;
    matchIndex = (matchIndex + step + matches.length) % matches.length;
    updateMatchFocus();
  }

  async function selectItem(index) {
    const it = items[index];
    if (!it) return;
    setActive(index);
    els.bookTitle.textContent = it.book || '—';
    els.chapterTitle.textContent = it.chapter || '—';
    els.reference.textContent = it.reference || '—';
    els.source.textContent = it.url || '—';
    els.docText.textContent = 'Loading…';
    status('');

    try {
      const res = await fetch(it.url, { cache:'no-store' });
      if (!res.ok) throw new Error(`${it.url} → ${res.status}`);
      let txt = await res.text();

      // normalize bullets/squares and NBSPs (cosmetic)
      txt = txt.replace(/\u00A0/g, ' ')
               .replace(/[\u25A0\u25A1\u25AA\u25AB\u2022]/g, '•');

      rawText = txt;
      els.docText.textContent = rawText; // plain first load (no highlights)
      applyHighlights(els.textSearch.value.trim());
    } catch (e) {
      rawText = '';
      els.docText.textContent = '';
      status(`Error loading: ${e.message}`);
    }
  }

  function filterList(q) {
    const needle = q.trim().toLowerCase();
    [...els.itemList.children].forEach((li, i) => {
      const it = items[i];
      const hay = `${it.book} ${it.chapter} ${it.jurisdiction}`.toLowerCase();
      li.style.display = hay.includes(needle) ? '' : 'none';
    });
  }

  function exportCurrent() {
    const blob = new Blob([rawText || ''], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    const name = (els.bookTitle.textContent || 'book').replace(/[^\w\-]+/g, '_') +
                 (els.chapterTitle.textContent && els.chapterTitle.textContent !== '—' ? `_${els.chapterTitle.textContent.replace(/[^\w\-]+/g,'_')}` : '');
    a.href = URL.createObjectURL(blob);
    a.download = `${name || 'textbook'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printCurrent() {
    const w = window.open('', '_blank');
    if (!w) return;
    const safe = escapeHTML(rawText || '');
    w.document.write(`<pre style="white-space:pre-wrap;word-wrap:break-word;font:13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial">${safe}</pre>`);
    w.document.close();
    w.focus(); w.print();
  }

  // ---------- init ----------
  (async function init() {
    try {
      const reg = await fetchJSONWithFallback(REGISTRY_PATHS);
      registry = Array.isArray(reg) ? reg : [];
      // flatten to items[]
      items = registry.flatMap(normalizeEntry);
      if (!items.length) throw new Error('Registry loaded but no entries found.');
      renderList();
      // auto-load first visible
      selectItem(0);
    } catch (e) {
      status(`Error loading registry: ${e.message}`);
      els.docText.textContent = '—';
    }

    // events
    els.listSearch.addEventListener('input', () => filterList(els.listSearch.value));
    els.textSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        applyHighlights(els.textSearch.value.trim());
      }
    });
    els.prevBtn.addEventListener('click', () => nextMatch(-1));
    els.nextBtn.addEventListener('click', () => nextMatch(1));
    els.exportBtn.addEventListener('click', exportCurrent);
    els.printBtn.addEventListener('click', printCurrent);
  })();
})();
