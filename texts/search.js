/* /texts/search.js  — searches Textbooks + Laws + Rules (AND across terms) */

(() => {
  // ---- CONFIG: absolute catalogs that are already published on your Pages site
  const CATALOGS = {
    texts: 'https://info1691.github.io/law-index/catalogs/ingest-catalog.json',
    laws:  'https://info1691.github.io/laws.json',
    rules: 'https://info1691.github.io/rules.json'
  };
  const SITE_ROOT = 'https://info1691.github.io/'; // base for relative url_txt like "./data/...txt"

  // ---- DOM
  const input = document.querySelector('input[name="q"]') || document.querySelector('input[type="text"]');
  const form  = document.querySelector('form[data-form="search"]') || document.querySelector('form');
  const secTexts = document.querySelector('section[data-section="textbooks"]');
  const secLaws  = document.querySelector('section[data-section="laws"]');
  const secRules = document.querySelector('section[data-section="rules"]');
  const countsEl = document.querySelector('[data-counts]');

  // ---- helpers
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normal = s =>
    s.toLowerCase()
     .normalize('NFKD')
     .replace(/[“”‘’]/g, '"')
     .replace(/[^\w\s\-]/g, ' ');

  const setCounts = (t=0,l=0,r=0) =>
    countsEl && (countsEl.textContent = `Matches — Textbooks: ${t} · Laws: ${l} · Rules: ${r}`);

  const absoluteTxt = href => {
    if (!href) return '';
    try {
      if (/^https?:\/\//i.test(href)) return href;
      return new URL(href, SITE_ROOT).href;
    } catch { return ''; }
  };

  const fetchJSON = async url => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Fetch failed ${url}: ${r.status}`);
    return r.json();
  };

  const loadTextsCatalog = async () => {
    const cat = await fetchJSON(CATALOGS.texts);
    // support either array or {items:[...]}
    return Array.isArray(cat) ? cat : (cat.items || []);
  };

  const clearSections = () => {
    [secTexts, secLaws, secRules].forEach(s => s && (s.innerHTML = ''));
    setCounts(0,0,0);
  };

  const addFetchFail = (sec, title, url) => {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = `Fetch failed: ${title} (${url})`;
    sec.appendChild(p);
  };

  const highlight = (s, terms) => {
    let out = s;
    for (const t of [...terms].sort((a,b)=>b.length-a.length)) {
      out = out.replace(new RegExp(`(${esc(t)})`, 'gi'), '<mark>$1</mark>');
    }
    return out;
  };

  const makeSnippets = (text, terms, max = 3) => {
    const lo = text.toLowerCase();
    const hits = [];
    let cursor = 0;

    while (hits.length < max) {
      const i = lo.indexOf(terms[0], cursor);
      if (i < 0) break;
      const a = Math.max(0, i - 140);
      const b = Math.min(text.length, i + 300);
      const winLo = lo.slice(a, b);

      if (terms.every(t => winLo.includes(t))) {
        hits.push('…' + highlight(text.slice(a, b), terms) + '…');
      }
      cursor = i + terms[0].length;
    }
    return hits;
  };

  const renderCard = (sec, item, url, snippets) => {
    const card = document.createElement('article');
    card.className = 'card';

    const h = document.createElement('h3');
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.title || item.reference || item.id || '(untitled)';
    h.appendChild(a);
    card.appendChild(h);

    snippets.forEach(sn => {
      const p = document.createElement('p');
      p.innerHTML = sn;
      card.appendChild(p);
    });

    const meta = document.createElement('p');
    meta.className = 'muted';
    const open = document.createElement('a');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'open TXT';
    meta.appendChild(open);
    card.appendChild(meta);

    sec.appendChild(card);
  };

  const searchList = async (sec, items, terms) => {
    if (!sec) return 0;
    let found = 0;

    for (const it of items) {
      const url = absoluteTxt(it.url_txt);
      if (!url) continue;

      let text;
      try {
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) { addFetchFail(sec, it.title || it.reference || it.id, url); continue; }
        text = await r.text();
      } catch {
        addFetchFail(sec, it.title || it.reference || it.id, url);
        continue;
      }

      const norm = normal(text);
      if (terms.every(t => norm.includes(t))) {
        renderCard(sec, it, url, makeSnippets(text, terms, 3));
        found++;
      }
    }
    return found;
  };

  const run = async q => {
    clearSections();
    const terms = q.toLowerCase().split(/[+\s]+/).filter(Boolean);
    if (!terms.length) return;

    // Load catalogs
    let texts=[], laws=[], rules=[];
    try { texts = await loadTextsCatalog(); } catch(e){ addFetchFail(secTexts, 'Textbooks catalog', CATALOGS.texts); }
    try { laws  = await fetchJSON(CATALOGS.laws); }  catch(e){ addFetchFail(secLaws,  'Laws catalog',  CATALOGS.laws); }
    try { rules = await fetchJSON(CATALOGS.rules); } catch(e){ addFetchFail(secRules, 'Rules catalog', CATALOGS.rules); }

    // Search
    const [t, l, r] = await Promise.all([
      searchList(secTexts, texts, terms),
      searchList(secLaws,  laws,  terms),
      searchList(secRules, rules, terms),
    ]);

    setCounts(t, l, r);
  };

  // wire up
  const qs = new URLSearchParams(location.search);
  const initial = (qs.get('q') || '').trim();
  if (input) input.value = initial;
  if (form) {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const q = (input.value || '').trim();
      history.replaceState({}, '', `?q=${encodeURIComponent(q)}`);
      run(q);
    });
  }
  if (initial) run(initial);
})();
