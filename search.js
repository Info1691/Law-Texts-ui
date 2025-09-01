(() => {
  const CATALOGS = {
    textbooks: '/texts/catalog.json',
    laws: '/laws.json',
    rules: '/rules.json'
  };

  // --- Helpers ---------------------------------------------------------------
  const qs = sel => document.querySelector(sel);
  const out = {
    textbooks: qs('[data-section="textbooks"]'),
    laws: qs('[data-section="laws"]'),
    rules: qs('[data-section="rules"]'),
    counts: qs('[data-counts]'),
    form: qs('[data-form]'),
    q: qs('[data-q]')
  };

  const urlParamQ = new URLSearchParams(location.search).get('q') || '';
  if (urlParamQ) out.q.value = urlParamQ;

  function termsFromQuery(q) {
    return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function highlight(s, terms) {
    if (!terms.length) return s;
    const re = new RegExp('(' + terms.map(esc).join('|') + ')', 'gi');
    return s.replace(re, '<mark>$1</mark>');
  }
  function absoluteTxt(url) {
    return new URL(url, location.origin).href;
  }

  async function fetchJSON(path) {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  }
  async function fetchTXT(path) {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.text();
  }

  function findSnippets(txt, terms, windowSize = 900, maxSnips = 3) {
    const lo = txt.toLowerCase();
    const snips = [];
    let from = 0;

    outer: while (snips.length < maxSnips) {
      // find all terms from current 'from'
      const hits = terms.map(t => lo.indexOf(t, from));
      if (hits.some(h => h === -1)) break;

      const start = Math.max(0, Math.min(...hits) - Math.floor(windowSize / 2));
      let end = Math.min(txt.length, start + windowSize);

      // ensure ALL terms occur within [start, end]
      for (const t of terms) {
        const p = lo.indexOf(t, start);
        if (p === -1 || p > end) {
          from = Math.max(...hits) + 1;
          continue outer;
        }
      }
      const slice = txt.slice(start, end).replace(/\s+/g, ' ').trim();
      snips.push('…' + slice + '…');
      from = Math.max(...hits) + 1;
    }
    return snips;
  }

  function cardHTML(item, snippets, badge) {
    const txtUrl = absoluteTxt(item.url_txt);
    const meta = `${(item.jurisdiction || '').toUpperCase()} · ${item.reference || ''}${item.year ? ' · ' + item.year : ''}`;
    return `
      <article class="card">
        <div class="meta">
          <span class="chip">${badge}</span>
          <span>${meta}</span>
          <a class="open topright" href="${txtUrl}" target="_blank" rel="noopener">open TXT</a>
        </div>
        <h3><a class="open" href="${txtUrl}" target="_blank" rel="noopener">${item.title}</a></h3>
        <div class="snip">${snippets.map(s => `<p>${s}</p>`).join('')}</div>
      </article>`;
  }

  function renderError(where, msg) {
    out[where].innerHTML = `<div class="err">${msg}</div>`;
  }

  function updateCounts(c) {
    out.counts.textContent = `Matches — Textbooks: ${c.textbooks} · Laws: ${c.laws} · Rules: ${c.rules}`;
  }

  // --- Search pipeline -------------------------------------------------------
  async function searchAll(q) {
    const terms = termsFromQuery(q);
    const counts = { textbooks: 0, laws: 0, rules: 0 };

    // clear
    out.textbooks.innerHTML = '';
    out.laws.innerHTML = '';
    out.rules.innerHTML = '';
    updateCounts(counts);

    if (!terms.length) return;

    // Fetch all catalogs (local)
    let catTB = [], catLaws = [], catRules = [];
    try { catTB = await fetchJSON(CATALOGS.textbooks); }
    catch (e) { renderError('textbooks', `Textbooks catalog error: ${e.message}`); }

    try { catLaws = await fetchJSON(CATALOGS.laws); }
    catch (e) { renderError('laws', `Laws catalog error: ${e.message}`); }

    try { catRules = await fetchJSON(CATALOGS.rules); }
    catch (e) { renderError('rules', `Rules catalog error: ${e.message}`); }

    // helper to process a list with small concurrency
    async function processList(items, where, badge) {
      const bucket = out[where];
      const queue = items.slice(); // copy
      const MAX = 4; // small concurrency
      const workers = new Array(MAX).fill(0).map(async () => {
        while (queue.length) {
          const item = queue.shift();
          try {
            const url = absoluteTxt(item.url_txt);
            const txt = await fetchTXT(url);
            const snips = findSnippets(txt, terms, 1000, 3);
            if (snips.length) {
              counts[where] += 1;
              const html = cardHTML(item, snips.map(s => highlight(s, terms)), badge);
              bucket.insertAdjacentHTML('beforeend', html);
              updateCounts(counts);
            }
          } catch (err) {
            // if the TXT fetch fails, show a one-line error so we can fix paths
            const rel = item.url_txt || '';
            bucket.insertAdjacentHTML('beforeend',
              `<div class="err">Fetch failed: ${item.title} (${rel})</div>`);
          }
        }
      });
      await Promise.all(workers);
    }

    await Promise.all([
      processList(catTB, 'textbooks', 'textbooks'),
      processList(catLaws, 'laws', 'laws'),
      processList(catRules, 'rules', 'rules')
    ]);

    updateCounts(counts);
  }

  // --- Wire up form & initial load ------------------------------------------
  out.form.addEventListener('submit', ev => {
    ev.preventDefault();
    const q = out.q.value.trim();
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState({}, '', url);
    searchAll(q);
  });

  // initial run
  searchAll(out.q.value.trim());
})();
