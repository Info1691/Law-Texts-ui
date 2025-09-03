<script>
/* fulltext-mode.js  —  add full-text search + robust queries on top of existing Search UI
   Works as a wrapper: keeps your current search but adds a “Full-text mode” toggle.
   © wwwbcb — lightweight, no deps
*/

(function () {
  // ---------- Config ----------
  const DEFAULT_CATALOGS = {
    textbooks: 'https://texts.wwwbcb.org/texts/catalog.json',
    laws:      'https://texts.wwwbcb.org/laws.json',
    rules:     'https://texts.wwwbcb.org/rules.json'
  };

  // Query behaviour
  const FALLBACK_OR_IF_ZERO = true;   // if strict match returns 0, retry as OR
  const MAX_DOCS = 9999;              // safety cap
  const SHOW_STATS = true;

  // Synonyms / expansions (add more over time)
  const SYN = {
    beddoe: [
      '"Beddoe order"',
      '"Re Beddoe"',
      '"trustee authorisation to litigate"',
      '"consent to litigation"',
      '"authorisation to commence proceedings"',
      '"trustee indemnity"',
      '"indemnity for litigation"'
    ],
    trustee: ['trustees'],
    trusts: ['trust']
  };

  // ---------- Utilities ----------
  const enc = new TextEncoder();

  function qs(name, fallback) {
    const u = new URL(location.href);
    return u.searchParams.get(name) || fallback;
  }

  function normalize(s) {
    return s.toLowerCase().normalize('NFKD');
  }

  function unique(arr) {
    return Array.from(new Set(arr));
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    const bytes = Array.from(new Uint8Array(buf));
    return bytes.map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function makeBadge(text) {
    const b = document.createElement('span');
    b.textContent = text;
    b.style.cssText = 'display:inline-block;margin-left:.5rem;font:600 12px/1.6 system-ui;padding:2px 6px;border-radius:6px;background:#e9eef7;color:#183153;';
    return b;
  }

  // ---------- Catalog load ----------
  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Fetch ${url} → ${r.status}`);
    return r.json();
  }

  function pickUrlTxt(entry) {
    // Law-Index uses url_txt; make this tolerant.
    return entry.url_txt || entry.url || entry.txt || null;
  }

  async function loadCatalogs() {
    const textbooksURL = qs('textbooks', DEFAULT_CATALOGS.textbooks);
    const lawsURL      = qs('laws',      DEFAULT_CATALOGS.laws);
    const rulesURL     = qs('rules',     DEFAULT_CATALOGS.rules);

    const [t, l, r] = await Promise.all([
      fetchJSON(textbooksURL).catch(()=>({items:[] })),
      fetchJSON(lawsURL).catch(()=>({items:[] })),
      fetchJSON(rulesURL).catch(()=>({items:[] }))
    ]);

    // Accept either {items:[...]} or raw arrays
    const toArr = x => Array.isArray(x) ? x : (Array.isArray(x.items)? x.items : []);
    return {
      textbooks: toArr(t).map(x => ({ kind:'Textbook', title:x.title || x.name || 'Untitled', url: pickUrlTxt(x)})).filter(d=>d.url),
      laws:      toArr(l).map(x => ({ kind:'Law',      title:x.title || x.name || 'Untitled', url: pickUrlTxt(x)})).filter(d=>d.url),
      rules:     toArr(r).map(x => ({ kind:'Rule',     title:x.title || x.name || 'Untitled', url: pickUrlTxt(x)})).filter(d=>d.url)
    };
  }

  // ---------- Query parsing (boolean + phrases + NOT + synonyms) ----------
  // Grammar (lucene-ish):
  // - quotes => phrases:  "proper law of a trust"
  // - NOT / -term        excludes
  // - OR                 explicit OR; default is AND
  // - ( ... )            grouping
  // - simple terms are case-insensitive; diacritics folded
  //
  // We compile to a predicate that tests a full document string.

  function tokenize(query) {
    // Keep quoted phrases intact
    const tokens = [];
    let i = 0, s = query;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        const j = s.indexOf('"', i+1);
        if (j === -1) { tokens.push({t:'TERM', v:normalize(s.slice(i+1))}); break; }
        tokens.push({t:'PHRASE', v:normalize(s.slice(i+1, j))});
        i = j+1; continue;
      }
      if (c === '(' || c === ')') { tokens.push({t:c}); i++; continue; }
      // read a word/operator
      let j = i;
      while (j < s.length && !/\s|\(|\)|"/.test(s[j])) j++;
      const w = s.slice(i, j);
      const W = w.toUpperCase();
      if (W === 'OR') tokens.push({t:'OR'});
      else if (W === 'NOT') tokens.push({t:'NOT'});
      else if (w[0] === '-') tokens.push({t:'NOTTERM', v:normalize(w.slice(1))});
      else tokens.push({t:'TERM', v:normalize(w)});
      i = j;
    }
    return tokens;
  }

  function expandSynonyms(parts) {
    const out = [];
    for (const p of parts) {
      if (p.t === 'TERM') {
        out.push(p);
        const syns = SYN[p.v];
        if (syns && syns.length) syns.forEach(s => out.push({t:'PHRASE', v:normalize(s.replace(/^"|"$/g,''))}));
      } else out.push(p);
    }
    return uniqueByJSON(out);
  }

  function uniqueByJSON(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = JSON.stringify(x);
      if (!seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
  }

  function buildPredicate(query, opts={ orMode:false }) {
    // Very small Pratt parser to handle AND/OR/NOT with parentheses.
    const toks0 = tokenize(query);
    const toks = expandSynonyms(toks0);
    let p = 0;

    function termNode() {
      const tk = toks[p++];
      if (!tk) return {type:'TRUE'};
      if (tk.t === '(') {
        const n = expr();
        if (toks[p] && toks[p].t === ')') p++;
        return n;
      }
      if (tk.t === 'NOT') return {type:'NOT', child: termNode()};
      if (tk.t === 'NOTTERM') return nodeForTerm(tk, true);
      if (tk.t === 'PHRASE' || tk.t === 'TERM') return nodeForTerm(tk, false);
      // Unexpected tokens treat as TRUE to be permissive
      return {type:'TRUE'};
    }

    function nodeForTerm(tk, isNot) {
      const node = (tk.t === 'PHRASE')
        ? { type:'PHRASE', q: tk.v }
        : { type:'TERM',   q: tk.v };
      return isNot ? {type:'NOT', child: node} : node;
    }

    function expr() {
      // left-assoc: AND binds tighter than OR; default AND
      let left = andExpr();
      while (toks[p] && toks[p].t === 'OR') {
        p++;
        const right = andExpr();
        left = {type:'OR', left, right};
      }
      return left;
    }

    function andExpr() {
      let left = termNode();
      while (toks[p] && toks[p].t !== ')' && toks[p].t !== 'OR') {
        const right = termNode();
        left = {type:'AND', left, right};
      }
      return left;
    }

    const ast = opts.orMode ? orAstFromTerms(toks) : expr();

    // compile to predicate over text
    function compile(node) {
      switch (node.type) {
        case 'TRUE':   return () => true;
        case 'TERM':   return (text) => text.includes(node.q);
        case 'PHRASE': return (text) => text.includes(node.q);
        case 'NOT': {
          const f = compile(node.child);
          return (text) => !f(text);
        }
        case 'AND': {
          const f = compile(node.left), g = compile(node.right);
          return (text) => f(text) && g(text);
        }
        case 'OR': {
          const f = compile(node.left), g = compile(node.right);
          return (text) => f(text) || g(text);
        }
        default: return () => true;
      }
    }
    return compile(ast);
  }

  function orAstFromTerms(toks) {
    // Build OR from all plain terms/phrases (ignore NOT/parentheses)
    const terms = toks.filter(t => t.t==='TERM' || t.t==='PHRASE');
    if (!terms.length) return {type:'TRUE'};
    let node = (terms[0].t==='PHRASE') ? {type:'PHRASE', q:terms[0].v} : {type:'TERM', q:terms[0].v};
    for (let i=1;i<terms.length;i++) {
      const n = (terms[i].t==='PHRASE') ? {type:'PHRASE', q:terms[i].v} : {type:'TERM', q:terms[i].v};
      node = {type:'OR', left: node, right: n};
    }
    return node;
  }

  // ---------- Full-text searcher ----------
  async function searchFullText(query, catalogs) {
    const predicateStrict = buildPredicate(query, { orMode:false });
    const predicateOR     = buildPredicate(query, { orMode:true });

    const all = [
      ...catalogs.textbooks,
      ...catalogs.laws,
      ...catalogs.rules
    ].slice(0, MAX_DOCS);

    const out = { textbooks:[], laws:[], rules:[], _stats:{ docs:0, bytes:0, hits:0 } };

    for (const doc of all) {
      let text;
      try {
        const r = await fetch(doc.url, { cache:'no-store' });
        if (!r.ok) continue;
        text = await r.text();
      } catch { continue; }

      out._stats.docs += 1;
      out._stats.bytes += text.length;

      const norm = normalize(text);
      let matched = predicateStrict(norm);

      if (!matched && FALLBACK_OR_IF_ZERO) {
        matched = predicateOR(norm);
      }
      if (!matched) continue;

      // Build snippets around each match (up to 6)
      const snippets = makeSnippets(norm, query, 240, 6);
      const hash = await sha256(text);
      const record = {
        title: doc.title,
        url: doc.url,
        hash,
        size: text.length,
        snippets
      };
      if (doc.kind === 'Textbook') out.textbooks.push(record);
      else if (doc.kind === 'Law') out.laws.push(record);
      else out.rules.push(record);

      out._stats.hits += 1;
    }
    return out;
  }

  function makeSnippets(text, query, window=240, max=6) {
    // Highlight each TERM/PHRASE occurrence; we’ll grab windows around first few hits
    const toks = expandSynonyms(tokenize(query));
    const needles = [];
    for (const t of toks) {
      if (t.t==='TERM' || t.t==='PHRASE') needles.push(t.v);
    }
    const hits = [];
    for (const n of unique(needles)) {
      let idx = 0;
      while (idx >= 0) {
        idx = text.indexOf(n, idx);
        if (idx === -1) break;
        hits.push({n, i:idx});
        idx = idx + n.length;
        if (hits.length > 200) break;
      }
    }
    hits.sort((a,b)=>a.i-b.i);
    const used = [];
    const out = [];
    for (const h of hits) {
      if (used.some(u => Math.abs(u - h.i) < window/2)) continue;
      used.push(h.i);
      const a = Math.max(0, h.i - Math.floor(window/2));
      const b = Math.min(text.length, a + window);
      out.push(ellipsis(text.slice(a,b)));
      if (out.length >= max) break;
    }
    return out;
  }

  function ellipsis(s) {
    const left = s.trimStart() === s ? s : '…'+s.trimStart();
    const right = left.trimEnd() === left ? left : left.trimEnd()+'…';
    return right.replace(/\s+/g,' ');
  }

  // ---------- Wire into page ----------
  function injectToggle() {
    const bar = document.querySelector('form, .searchbar, .toolbar, .controls') || document.body;
    const wrap = document.createElement('span');
    wrap.style.cssText = 'margin-left:8px;white-space:nowrap;';
    wrap.innerHTML = `
      <label style="font:600 12px/1.6 system-ui;display:inline-flex;gap:.4rem;align-items:center;cursor:pointer">
        <input id="fulltext_mode_toggle" type="checkbox"> Full-text mode
      </label>
    `;
    bar.appendChild(wrap);
  }

  function attachStatsAnchor() {
    let host = document.querySelector('#search-stats');
    if (!host) {
      host = document.createElement('div');
      host.id = 'search-stats';
      host.style.cssText = 'margin:6px 0 0 2px;font:500 12px/1.6 system-ui;color:#667;';
      document.body.prepend(host);
    }
    return host;
  }

  function showStats(host, stats) {
    if (!SHOW_STATS || !host) return;
    host.textContent = `Full-text scanned — docs: ${stats.docs}, bytes: ${stats.bytes.toLocaleString()} (≈${(stats.bytes/1024).toFixed(1)} KB), matched: ${stats.hits}`;
    host.appendChild(makeBadge('SHA-256 shown per hit'));
  }

  async function runFulltext(query) {
    const catalogs = await loadCatalogs();
    const result = await searchFullText(query, catalogs);
    const statsHost = attachStatsAnchor();
    showStats(statsHost, result._stats);

    // Hand results into your existing renderer if available; otherwise build a minimal one.
    if (window.Search && typeof window.Search.render === 'function') {
      window.Search.render(result);
    } else {
      // Minimal fallback renderer (keeps page usable if Search.render isn’t found)
      const root = document.querySelector('#results') || document.body;
      root.innerHTML = '';
      for (const [group, items] of [['Textbooks', result.textbooks], ['Laws', result.laws], ['Rules', result.rules]]) {
        const h = document.createElement('h3'); h.textContent = group; root.appendChild(h);
        items.forEach(item => {
          const card = document.createElement('div');
          card.style.cssText = 'border:1px solid #ddd;border-radius:8px;padding:10px;margin:8px 0;background:#fff';
          card.innerHTML = `
            <div style="font-weight:600">${escapeHtml(item.title)}</div>
            <div style="font:12px/1.6 system-ui;color:#555;word-break:break-all">
              <a href="${item.url}" target="_blank" rel="noopener">open TXT</a>
              <span style="margin-left:6px">size: ${item.size.toLocaleString()} bytes</span>
              <span style="margin-left:6px">sha256: <code>${item.hash.slice(0,12)}…</code></span>
            </div>
            ${item.snippets.map(s => `<p style="margin:.5rem 0;background:#fff8c5;padding:6px;border-radius:4px">${escapeHtml(s)}</p>`).join('')}
          `;
          root.appendChild(card);
        });
      }
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // Hook the existing Search.run
  function wrapExisting() {
    if (!window.Search || typeof window.Search.run !== 'function') return;

    const origRun = window.Search.run.bind(window.Search);
    injectToggle();

    document.getElementById('fulltext_mode_toggle').addEventListener('change', e => {
      localStorage.setItem('FULLTEXT_MODE', e.target.checked ? '1' : '0');
    });
    const preset = localStorage.getItem('FULLTEXT_MODE') === '1';
    document.getElementById('fulltext_mode_toggle').checked = preset;

    window.Search.run = async function (query, opts={}) {
      const full = document.getElementById('fulltext_mode_toggle')?.checked;
      if (full) return runFulltext(query);
      return origRun(query, opts);
    };
  }

  // Init once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wrapExisting);
  } else {
    wrapExisting();
  }
})();
</script>
