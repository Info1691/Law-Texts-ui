/* textbooks-ui/main.js — full build
   - Base-URL-safe registry with fallbacks (fixes 404 in workflow links)
   - Accepts array or {books:[...]} and single-file or chaptered books
   - Sticky search toolbar + Prev/Next; scrolls inside text panel
   - Gentle glyph normalization on render (□/� → •, NBSP → space)
   - Print & Export
*/

(function () {
  // ----- Registry locations (first that works) -----
  const REGISTRY_PATHS = [
    'data/books/textbooks.json',
    'data/textbooks.json',
    'textbooks.json'
  ];

  // ----- DOM -----
  const $ = (id) => document.getElementById(id);
  const els = {
    itemList: $('itemList') || $('itemlist'), // tolerate either id
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
    exportBtn: $('exportBtn')
  };
  const missing = Object.entries(els).filter(([,n]) => !n).map(([k])=>k);
  if (missing.length) throw new Error('Missing elements: ' + missing.join(', '));

  // ----- State -----
  let items = [];       // flattened: one row per chapter (or whole book)
  let current = null;   // { bookTitle, chapterTitle, path, source, reference }
  let plainText = '';
  let hits = [];
  let hitIndex = -1;
  let lastQuery = '';

  // ----- Utils -----
  const escapeHTML = (s='') => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const debounce = (fn, ms) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  // Resolve fetch relative to this script (base-URL safe across workflow paths/iframes)
  function getBaseUrl() {
    const script = document.currentScript || Array.from(document.scripts).find(s => /main\.js/.test(s.src));
    const u = new URL(script.src, location.href);
    u.pathname = u.pathname.replace(/[^/]*main\.js.*$/, '');
    return u.toString();
  }
  const BASE = getBaseUrl();
  const abs = (rel) => new URL(rel, BASE).toString();

  async function fetchFirstOk(paths) {
    let last = '';
    for (const p of paths) {
      const url = abs(p);
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) { last = `${url} → ${r.status}`; continue; }
        const json = await r.json();
        return { used: url, json };
      } catch (e) {
        last = `${url} → ${e.message || e}`;
      }
    }
    throw new Error('Could not load registry. ' + last);
  }

  // Accept:
  //  - Array of books
  //  - { books: [...] }
  // Each book may be single-file (reference_url/text_file/file) OR { chapters: [ {title, reference_url|text_file|file} ] }
  function flattenRegistry(reg) {
    const books = Array.isArray(reg) ? reg
                : (Array.isArray(reg?.books) ? reg.books : []);
    const out = [];
    books.forEach(b => {
      const bookTitle = b.title || b.book_title || 'Untitled';
      const source = b.source || '';
      const reference = b.reference || '';
      if (Array.isArray(b.chapters) && b.chapters.length) {
        b.chapters.forEach(ch => {
          const path = ch.reference_url || ch.text_file || ch.file || '';
          out.push({
            bookTitle,
            chapterTitle: ch.title || ch.chapter || 'Chapter',
            path,
            source,
            reference
          });
        });
      } else {
        const path = b.reference_url || b.text_file || b.file || '';
        out.push({
          bookTitle,
          chapterTitle: b.subtitle || 'Full book',
          path,
          source,
          reference
        });
      }
    });
    return out;
  }

  // ----- List rendering -----
  function renderList(list) {
    els.itemList.innerHTML = '';
    list.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = 'rule-list-item';
      li.innerHTML = `<div><strong>${escapeHTML(it.bookTitle)}</strong></div>
                      <div style="font-size:.85rem;color:#555">${escapeHTML(it.chapterTitle || '')}</div>`;
      li.addEventListener('click', () => selectItem(it, li));
      els.itemList.appendChild(li);
      if (idx === 0 && !current) selectItem(it, li);
    });
  }
  function markActive(liEl) {
    [...els.itemList.children].forEach(li => li.classList.remove('active'));
    if (liEl) liEl.classList.add('active');
  }

  // ----- Load text (with gentle glyph normalization) -----
  async function loadText(path) {
    els.docText.textContent = 'Loading…';
    setStatus('Loading…');
    try {
      const url = abs(path);
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      let txt = await r.text();

      // Guard against wrong path returning HTML
      if (/<!doctype\s*html/i.test(txt) || /<html/i.test(txt)) {
        throw new Error(`${url} → looks like HTML (check path/filename).`);
      }

      // Visual cleanup (does NOT change your source files)
      txt = txt
        .replace(/\u0000/g, '')
        .replace(/[\u25A0\u25A1\u25CF\u25CB\uF0B7\u2022\uFFFD]/g, '•')
        .replace(/\u00A0/g, ' ');

      plainText = txt;
      els.docText.innerHTML = escapeHTML(plainText);
      setStatus(`Loaded: ${path}`);

      const q = els.textSearch.value.trim();
      if (q) highlightMatches(q);
    } catch (e) {
      els.docText.textContent = `Error loading: ${path}\n${e.message || e}`;
      setStatus('Load error.');
    }
  }

  // ----- Selection -----
  function selectItem(it, liEl) {
    current = it;
    markActive(liEl);
    els.bookTitle.textContent = it.bookTitle || '—';
    els.chapterTitle.textContent = it.chapterTitle || '—';
    els.source.textContent = it.source || '—';
    els.reference.textContent = it.reference || '—';
    resetSearchState();
    loadText(it.path);
  }

  // ----- Search / highlight / navigation -----
  function resetSearchState() {
    hits = [];
    hitIndex = -1;
    lastQuery = '';
    els.prevBtn.disabled = true;
    els.nextBtn.disabled = true;
  }

  function highlightMatches(query) {
    const q = query.trim();
    if (!q) {
      els.docText.innerHTML = escapeHTML(plainText || '');
      resetSearchState();
      setStatus('Cleared search.');
      return;
    }
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let i = 0;
    const html = (plainText || '').replace(rx, m => `<mark data-hit="${i++}">${escapeHTML(m)}</mark>`);
    els.docText.innerHTML = html;
    hits = [...els.docText.querySelectorAll('mark[data-hit]')];
    lastQuery = q;

    if (!hits.length) {
      setStatus(`No results for “${q}”.`);
      els.prevBtn.disabled = true;
      els.nextBtn.disabled = true;
      hitIndex = -1;
      return;
    }
    els.prevBtn.disabled = false;
    els.nextBtn.disabled = false;
    hitIndex = 0;
    scrollToHit(hitIndex);
    updateStatus();
  }

  // Scroll INSIDE the text panel (center the match)
  function scrollToHit(i) {
    const el = hits[i];
    if (!el) return;
    const container = els.docText;
    const rect = el.getBoundingClientRect();
    const crect = container.getBoundingClientRect();
    const targetTop = (rect.top - crect.top) + container.scrollTop
                    - (container.clientHeight / 2) + (rect.height / 2);
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    hits.forEach(h => h.classList.remove('current'));
    el.classList.add('current');
  }
  function updateStatus() {
    if (hits.length) {
      els.status.textContent = `Matches: ${hits.length} — Viewing ${hitIndex + 1} of ${hits.length} — “${lastQuery}”`;
    } else {
      els.status.textContent = '';
    }
  }

  const onTextSearch = debounce(() => {
    highlightMatches(els.textSearch.value);
  }, 160);

  els.textSearch.addEventListener('input', onTextSearch);
  els.prevBtn.addEventListener('click', () => {
    if (!hits.length) return;
    hitIndex = (hitIndex - 1 + hits.length) % hits.length;
    scrollToHit(hitIndex);
    updateStatus();
  });
  els.nextBtn.addEventListener('click', () => {
    if (!hits.length) return;
    hitIndex = (hitIndex + 1) % hits.length;
    scrollToHit(hitIndex);
    updateStatus();
  });

  // ----- List filter -----
  els.listSearch.addEventListener('input', () => {
    const q = els.listSearch.value.trim().toLowerCase();
    const filtered = items.filter(it =>
      (it.bookTitle || '').toLowerCase().includes(q) ||
      (it.chapterTitle || '').toLowerCase().includes(q) ||
      (it.reference || '').toLowerCase().includes(q)
    );
    renderList(filtered);
  });

  // ----- Actions -----
  els.printBtn.addEventListener('click', () => window.print());
  els.exportBtn.addEventListener('click', () => {
    const name = ((current?.bookTitle + ' ' + (current?.chapterTitle||'')) || 'textbook')
      .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    const blob = new Blob([plainText || ''], { type:'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href:url, download:`${name}.txt` });
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
  });

  function setStatus(msg){ els.status.textContent = msg || ''; }

  // ----- Init -----
  (async function init() {
    try {
      setStatus('Loading registry…');
      const { used, json } = await fetchFirstOk(REGISTRY_PATHS);
      items = flattenRegistry(json);
      if (!items.length) throw new Error('Registry loaded, but no items found.');
      renderList(items);
      setStatus(`Loaded registry: ${used}`);
    } catch (e) {
      els.docText.textContent = `Error loading registry\n${e.message || e}`;
      setStatus('Error loading registry.');
    }
  })();
})();
