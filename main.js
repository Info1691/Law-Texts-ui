/* textbooks-ui/main.js — complete build
   - Registry fallbacks (fixes 404s)
   - Single-file and chaptered books
   - Sticky search toolbar + Prev/Next (scrolls inside text panel)
   - Gentle glyph normalization (smart quotes, NBSP → space)
   - Print & Export
*/
(function () {
  // ---------- Registry locations (checked in order) ----------
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

  // ---------- State ----------
  let registry = [];     // normalized [{id,title,jurisdiction,reference,source,chapters:[{title,text_file}]}]
  let flatList = [];     // flattened list for the sidebar
  let currentIndex = -1; // index into flatList
  let searchHits = [];
  let hitIndex = -1;

  // ---------- Helpers ----------
  const normText = (s='') =>
    s.replace(/\u00A0/g, ' ')               // NBSP -> space
     .replace(/[\u2018\u2019]/g, "'")       // smart single quotes
     .replace(/[\u201C\u201D]/g, '"')       // smart double quotes
     .replace(/\u2026/g, '...');            // ellipsis

  const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

  const fetchJsonFirst = async (paths) => {
    for (const p of paths) {
      try {
        const r = await fetch(p, { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (e) { /* continue */ }
    }
    throw new Error('No registry found at fallback paths.');
  };

  const toArray = (x) => Array.isArray(x) ? x : (x ? [x] : []);

  const normalizeRegistry = (raw) => {
    // Accept either {books:[...]} or [...]
    const books = Array.isArray(raw) ? raw : (Array.isArray(raw.books) ? raw.books : []);
    return books.map(b => {
      const chapters = toArray(b.chapters).map(ch => ({
        title: ch.title || ch.name || 'Untitled chapter',
        text_file: ch.text_file || ch.file || ''
      }));
      // Single-file book? allow `text_file` at book level
      if (!chapters.length && b.text_file) {
        chapters.push({ title: b.title || 'Text', text_file: b.text_file });
      }
      return {
        id: b.id || (b.title || 'book').toLowerCase().replace(/\W+/g,'-'),
        title: b.title || 'Untitled',
        jurisdiction: b.jurisdiction || '',
        reference: b.reference || '',
        source: b.source || '',
        chapters
      };
    }).filter(b => b.chapters && b.chapters.length);
  };

  const buildFlatList = () => {
    flatList = [];
    registry.forEach((b, bi) => {
      b.chapters.forEach((ch, ci) => {
        flatList.push({
          key: `${b.id}:${ci}`,
          bookIndex: bi,
          chapterIndex: ci,
          label: `${b.title}${b.chapters.length>1 ? ' — ' + ch.title : ''}`,
          book: b, chapter: ch
        });
      });
    });
  };

  const renderSidebar = (items) => {
    els.itemList.innerHTML = '';
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.textContent = it.label;
      li.setAttribute('role','option');
      li.addEventListener('click', () => selectByKey(it.key));
      if (currentIndex === idx) li.classList.add('active');
      els.itemList.appendChild(li);
    });
  };

  const applyListFilter = () => {
    const q = (els.listSearch.value || '').toLowerCase().trim();
    const filtered = q
      ? flatList.filter(it => it.label.toLowerCase().includes(q))
      : flatList.slice();
    renderSidebar(filtered);
  };

  const setMeta = (b, ch) => {
    els.bookTitle.textContent = b?.title || '—';
    els.chapterTitle.textContent = ch ? (ch.title || '—') : (b?.chapters?.[0]?.title || '—');
    els.reference.textContent = b?.reference || '—';
    els.source.innerHTML = b?.source
      ? `<a href="${b.source}" target="_blank" rel="noopener">${host(b.source) || b.source}</a>`
      : '—';
  };

  const loadText = async (url) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return normText(await r.text());
  };

  const selectByKey = async (key) => {
    // find index inside current *filtered* sidebar (so keyboard / clicks map correctly)
    const q = (els.listSearch.value || '').toLowerCase().trim();
    const filtered = q
      ? flatList.filter(it => it.label.toLowerCase().includes(q))
      : flatList.slice();

    const idx = filtered.findIndex(it => it.key === key);
    if (idx === -1) return;

    // map filtered index back to global index
    const globalIndex = flatList.findIndex(it => it.key === key);
    currentIndex = globalIndex;

    // visual active state
    renderSidebar(filtered);

    const it = flatList[currentIndex];
    setMeta(it.book, it.chapter);
    els.status.textContent = `Loading: ${it.chapter.text_file}`;
    els.docText.textContent = 'Loading…';
    try {
      const txt = await loadText(it.chapter.text_file);
      els.docText.textContent = txt;
      els.status.textContent = `Loaded: ${it.chapter.text_file}`;
      clearHighlights();
      searchHits = [];
      hitIndex = -1;
    } catch (e) {
      els.docText.textContent = `Error loading: ${it.chapter.text_file}\n${e.message}`;
      els.status.textContent = `Error: ${e.message}`;
    }
  };

  // ---------- Search / highlight ----------
  const clearHighlights = () => {
    // replace <mark> by text; simplest reset is reassigning textContent
    els.docText.textContent = els.docText.textContent;
  };

  const highlightAll = (needle) => {
    clearHighlights();
    if (!needle) { searchHits = []; hitIndex = -1; return; }

    const text = els.docText.textContent;
    const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
    let m, parts = [], last = 0, hits = [];
    while ((m = rx.exec(text)) !== null) {
      parts.push(text.slice(last, m.index));
      parts.push(`<mark>${m[0]}</mark>`);
      hits.push(m.index);
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    els.docText.innerHTML = parts.join('');
    searchHits = hits;
    hitIndex = hits.length ? 0 : -1;
    scrollToHit();
  };

  const scrollToHit = () => {
    if (hitIndex < 0) return;
    const marks = els.docText.querySelectorAll('mark');
    const m = marks[hitIndex];
    if (m) {
      const parent = els.docText;
      const top = m.offsetTop - parent.clientHeight * 0.2; // show a bit above
      parent.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const nextHit = () => {
    if (!searchHits.length) return;
    hitIndex = (hitIndex + 1) % searchHits.length;
    scrollToHit();
  };

  const prevHit = () => {
    if (!searchHits.length) return;
    hitIndex = (hitIndex - 1 + searchHits.length) % searchHits.length;
    scrollToHit();
  };

  // ---------- Buttons ----------
  els.textSearch.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim();
    highlightAll(q);
  });
  els.nextBtn.addEventListener('click', nextHit);
  els.prevBtn.addEventListener('click', prevHit);

  els.printBtn.addEventListener('click', () => window.print());

  els.exportBtn.addEventListener('click', () => {
    const blob = new Blob([els.docText.textContent || ''], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(els.bookTitle.textContent || 'book').replace(/\W+/g,'-')}` +
                 `${els.chapterTitle.textContent !== '—' ? '-' + els.chapterTitle.textContent.replace(/\W+/g,'-') : ''}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // ---------- Init ----------
  (async function init() {
    try {
      els.status.textContent = 'Loading registry…';
      const raw = await fetchJsonFirst(REGISTRY_PATHS);
      registry = normalizeRegistry(raw);
      buildFlatList();

      // Populate sidebar, wire filter
      renderSidebar(flatList);
      els.listSearch.addEventListener('input', applyListFilter);

      // Auto-select first item
      if (flatList.length) selectByKey(flatList[0].key);
      els.status.textContent = `Loaded registry (${flatList.length} entries)`;
    } catch (e) {
      els.docText.textContent = `Error loading textbooks registry.\n${e.message}`;
      els.status.textContent = e.message;
    }
  })();
})();
