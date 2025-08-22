// Trust Law Textbooks — Continuous multipage PDF scrolling + search + calibration (iPad friendly)

document.addEventListener('DOMContentLoaded', () => {
  // ---- CONFIG ----
  const CATALOG_URL = 'data/texts/catalog.json';
  const REPOS_URL   = 'data/repos.json';
  const DEFAULT_OFF = -83;   // initial guess until first calibration
  const MIN_CM      = 14;
  const MAX_MATCHES = 400;

  // ---- STATE ----
  let pdfDoc = null, currentUrl = null;
  let scale = 1;
  let isText = false, textContent = '';
  let openedOnce = false;
  let io = null;                       // IntersectionObserver for lazy render
  const rendered = new Set();          // rendered page numbers
  const pageTextCache = new Map();     // page -> textContent
  let searchTerm = '', matches = [], matchIdx = -1;
  let pageHeights = [];                // px heights for quick scrolling
  let pageWidthCss = 0;

  // ---- DOM helpers ----
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const cmToPx = cm => cm*37.7952755906;
  const toast = (m,ms=1400)=>{ const t=$('#toast'); if(!t) return; t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };

  // DOM refs
  const scroll = $('#lt-viewer-scroll');
  const pages  = $('#pdfPages');
  const label  = $('#pageLabel');
  const searchInput = $('#searchInput');

  // UI binds
  bind('#reposBtn', ()=> $('#drawer').classList.add('open'));
  bind('#repoClose', ()=> $('#drawer').classList.remove('open'));
  bind('#printBtn', () => window.print());
  bind('#exportTxtBtn', exportVisibleText);
  bind('#prevBtn', prevAction);
  bind('#nextBtn', nextAction);
  bind('#pagerPrev', prevAction);
  bind('#pagerNext', nextAction);
  bind('#goBtn', () => {
    const v = parseInt($('#bookPageInput')?.value||'',10);
    if (Number.isInteger(v)) jumpBookPage(v);
  });
  bind('#calibrateBtn', calibrate);

  $('#repoFilter')?.addEventListener('input', e=>filterRepos(e.target.value));
  $('#listFilter')?.addEventListener('input', e=>filterCatalog(e.target.value));
  searchInput?.addEventListener('keydown', e=>{ if(e.key==='Enter') startSearch('new'); });

  scroll.style.minWidth = `${MIN_CM}cm`;

  // Worker (use local if present, else main thread)
  (async () => {
    try{
      const local = './vendor/pdf.worker.min.js';
      const h = await fetch(local, { method:'HEAD', cache:'no-store' });
      if (h.ok && window.pdfjsLib){ pdfjsLib.GlobalWorkerOptions.workerSrc = local; }
    }catch{}
  })();

  // Resize => recompute scale & rerender visible pages
  let roTm=null;
  new ResizeObserver(()=> {
    if (!pdfDoc || isText) return;
    clearTimeout(roTm);
    roTm = setTimeout(async ()=>{
      const old = scale;
      await setScaleToPaneWidth();
      if (Math.abs(old-scale) > 0.01){
        // reset canvases size & mark pages as not rendered to force redraw
        rendered.clear();
        $$('#pdfPages .page').forEach((el,i)=>{
          const h = Math.round(pageHeights[i] * (scale/old));
          el.style.width = `${pageWidthCss}px`;
          el.style.height = `${h}px`;
        });
        // trigger render for visible pages
        io && $$('#pdfPages .page').forEach(el => io.observe(el));
      }
    }, 100);
  }).observe(scroll);

  // Update label with current top-most page
  scroll.addEventListener('scroll', throttle(updateLabelFromScroll, 120), {passive:true});

  // Init
  (async function init(){
    await loadRepos();
    await loadCatalog();
  })();

  // ---------- Catalog ----------
  async function loadCatalog(){
    try{
      const r = await fetch(CATALOG_URL, { cache:'no-store' });
      const items = await r.json();
      const list = $('#catalogList'); list.innerHTML='';

      items.forEach(it => {
        const li=document.createElement('li');
        li.innerHTML = `<div><strong>${esc(it.title||'')}</strong>${it.subtitle?`<div class="sub">${esc(it.subtitle)}</div>`:''}</div>`;
        li.dataset.title=(it.title||'').toLowerCase();
        li.dataset.url=it.url || '';
        if (it.url){
          li.addEventListener('click', () => {
            if (li.classList.contains('active')) return;
            [...list.children].forEach(n=>n.classList.remove('active'));
            li.classList.add('active');
            openDocument(it.url);
          });
        } else { li.style.opacity='.6'; li.style.cursor='not-allowed'; }
        list.appendChild(li);
      });

      if (!openedOnce){
        const first = Array.from(list.children).find(n=>n.dataset.url);
        if (first){ first.classList.add('active'); openedOnce=true; openDocument(first.dataset.url); }
      }
    }catch(e){ console.error(e); toast('catalog.json error'); }
  }
  function filterCatalog(q){
    const n=(q||'').toLowerCase();
    [...$('#catalogList').children].forEach(li => li.style.display = (li.dataset.title||'').includes(n) ? '' : 'none');
  }

  // ---------- Repos drawer ----------
  async function loadRepos(){
    try{
      const r = await fetch(REPOS_URL, { cache:'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const ul = $('#repoList'); ul.innerHTML='';
      for (const d of data){
        const li=document.createElement('li'); li.className='repo-item'; li.dataset.name=(d.name||'').toLowerCase();
        li.innerHTML = `<div><strong>${esc(d.name||'')}</strong>${d.desc?`<div class="muted">${esc(d.desc)}</div>`:''}${d.url?`<div class="muted">${esc(d.url)}</div>`:''}</div>`;
        if (d.url) li.addEventListener('click', ()=>window.open(d.url,'_blank'));
        ul.appendChild(li);
      }
    }catch{}
  }
  function filterRepos(q){
    const n=(q||'').toLowerCase();
    $$('.repo-item').forEach(li => li.style.display = (li.dataset.name||'').includes(n) ? '' : 'none');
  }

  // ---------- Open doc ----------
  const isPdf = u => /\.pdf(?:[#?].*)?$/i.test(u||'');
  const isTxt = u => /\.txt(?:[#?].*)?$/i.test(u||'');
  const base  = u => (u||'').split('/').pop() || u || '';

  async function openDocument(url){
    // tear down any previous observer
    if (io){ io.disconnect(); io=null; }
    rendered.clear(); pageTextCache.clear();
    searchTerm=''; matches=[]; matchIdx=-1;
    pages.innerHTML=''; pages.hidden = true;
    clearTextViewer();
    currentUrl = url;

    if (isPdf(url)) await openPdf(url);
    else if (isTxt(url) || !/\.[a-z0-9]+$/i.test(url)) await openTxt(url);
    else toast('Unsupported file: '+url);
  }

  // ---------- TXT ----------
  async function openTxt(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      textContent = await r.text();
      isText = true;
      const v = ensureTextViewer();
      v.textContent = textContent;
      setLabel(base(url));
      toast('Loaded text file');
    }catch(e){ console.error(e); toast('Error loading text file'); }
  }
  function ensureTextViewer(){
    let v = $('#textViewer');
    if (!v){ v=document.createElement('pre'); v.id='textViewer'; scroll.appendChild(v); }
    v.style.display='block'; return v;
  }
  function clearTextViewer(){ const v=$('#textViewer'); if (v){ v.textContent=''; v.style.display='none'; } isText=false; }

  // ---------- PDF (continuous) ----------
  async function setScaleToPaneWidth(){
    const cssW = Math.max(scroll.clientWidth || 820, cmToPx(MIN_CM));
    const p1 = await pdfDoc.getPage(1);
    const v1 = p1.getViewport({ scale:1 });
    scale = cssW / v1.width;
    pageWidthCss = Math.floor(v1.width * scale);
  }

  async function openPdf(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      const source = r.ok ? { data: await r.arrayBuffer() } : { url };
      pdfDoc = await pdfjsLib.getDocument(source).promise;

      await setScaleToPaneWidth();

      // Pre-calc page heights (for placeholders)
      pageHeights = [];
      for (let i=1;i<=pdfDoc.numPages;i++){
        const p = await pdfDoc.getPage(i);
        const v = p.getViewport({ scale:1 });
        pageHeights.push(Math.floor(v.height * scale));
      }

      // Build placeholders
      pages.style.width = pageWidthCss+'px';
      pages.innerHTML='';
      for (let i=1;i<=pdfDoc.numPages;i++){
        const ph=document.createElement('div'); ph.className='page'; ph.dataset.page=i;
        ph.style.width = pageWidthCss+'px';
        ph.style.height = pageHeights[i-1]+'px';
        // inner layers lazily created on first render
        pages.appendChild(ph);
      }
      pages.hidden = false;
      scroll.scrollTop = 0;

      // Lazy render
      io = new IntersectionObserver(onIntersect, { root: scroll, rootMargin: '800px 0px 800px 0px' });
      $$('#pdfPages .page').forEach(el => io.observe(el));

      updateLabelFromScroll(); // show p.1 mapping in header
      toast(`Loaded PDF (${pdfDoc.numPages} pages)`);
    }catch(e){ console.error(e); toast('Error loading PDF'); }
  }

  async function onIntersect(entries){
    for (const entry of entries){
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const n = parseInt(el.dataset.page,10);
      if (!rendered.has(n)){
        await renderPage(n, el);
        rendered.add(n);
      }
    }
  }

  async function renderPage(n, el){
    try{
      const page = await pdfDoc.getPage(n);
      const view = page.getViewport({ scale });

      // Create layers
      if (!el._canvas){
        const c = document.createElement('canvas');
        c.width  = Math.floor(view.width);
        c.height = Math.floor(view.height);
        c.style.width = '100%';
        const hl = document.createElement('div'); hl.className='hl-layer';
        el.innerHTML=''; el.appendChild(c); el.appendChild(hl);
        el._canvas=c; el._hl=hl;
        // set exact height (avoid jump)
        el.style.height = c.height+'px';
      }else{
        // size update on resize
        el._canvas.width  = Math.floor(view.width);
        el._canvas.height = Math.floor(view.height);
        el.style.height    = el._canvas.height+'px';
      }

      await page.render({ canvasContext: el._canvas.getContext('2d'), viewport: view }).promise;

      // cache text content for search
      if (!pageTextCache.has(n)){
        const tc = await page.getTextContent();
        pageTextCache.set(n, tc);
      }

      // if current match sits on this page, paint it
      if (searchTerm && matches[matchIdx]?.page === n) highlightOnPage(n);
    }catch(e){ console.error('render error p'+n, e); }
  }

  // Label shows nearest page to top
  function updateLabelFromScroll(){
    if (!pdfDoc || isText) return;
    const tops = $$('#pdfPages .page').map(p => p.getBoundingClientRect().top);
    const rootTop = scroll.getBoundingClientRect().top;
    let best=1, bestDelta=Infinity;
    tops.forEach((t,i)=>{ const d=Math.abs(t-rootTop); if (d<bestDelta){ best=i+1; bestDelta=d; }});
    setLabel(`Book p.${bookFromPdf(best)} (PDF p.${best})`);
  }

  // Prev/Next (when search box empty) => snap to previous/next page top
  function nextAction(){
    const q=(searchInput?.value||'').trim();
    if (q) startSearch('next'); else snapBy(+1);
  }
  function prevAction(){
    const q=(searchInput?.value||'').trim();
    if (q) startSearch('prev'); else snapBy(-1);
  }
  function snapBy(dir){
    if (!pdfDoc || isText) return;
    const current = visibleTopPage();
    const target  = Math.min(pdfDoc.numPages, Math.max(1, current + dir));
    scrollToPage(target);
  }
  function visibleTopPage(){
    const rootTop = scroll.getBoundingClientRect().top;
    let best=1, bestDelta=Infinity;
    $$('#pdfPages .page').forEach((el,i)=>{
      const d=Math.abs(el.getBoundingClientRect().top-rootTop);
      if (d<bestDelta){ best=i+1; bestDelta=d; }
    });
    return best;
  }
  function scrollToPage(n){
    const el = $(`#pdfPages .page[data-page="${n}"]`);
    if (el) scroll.scrollTo({ top: el.offsetTop-8, behavior:'smooth' });
  }

  // ---------- Search ----------
  function resetSearch(){ searchTerm=''; matches=[]; matchIdx=-1; $$('.hl-layer').forEach(l=>l.innerHTML=''); }

  async function startSearch(mode){
    const q=(searchInput?.value||'').trim();
    if (!q){ resetSearch(); return; }

    if (q !== searchTerm){
      searchTerm=q; matches=[]; matchIdx=-1;
      // Build per-page matches (case-insensitive)
      for (let p=1;p<=pdfDoc.numPages;p++){
        const tc = pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
        if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
        const joined = tc.items.map(i=>i.str).join(' ');
        const hay = joined.toLowerCase(), needle=q.toLowerCase();
        let idx = hay.indexOf(needle);
        while (idx!==-1 && matches.length<MAX_MATCHES){
          matches.push({ page:p, idx, len:q.length });
          idx = hay.indexOf(needle, idx+q.length);
        }
        if (matches.length>=MAX_MATCHES) break;
      }
      if (!matches.length){ toast('No matches'); return; }
      matchIdx=0;
      const m=matches[0]; await ensureRendered(m.page); highlightOnPage(m.page); scrollToPage(m.page);
    }else{
      if (!matches.length){ toast('No matches'); return; }
      matchIdx = (mode==='prev') ? (matchIdx-1+matches.length)%matches.length : (matchIdx+1)%matches.length;
      const m=matches[matchIdx]; await ensureRendered(m.page); highlightOnPage(m.page); scrollToPage(m.page);
    }
  }

  async function ensureRendered(p){
    const el = $(`#pdfPages .page[data-page="${p}"]`);
    if (!rendered.has(p)) await renderPage(p, el);
  }

  async function highlightOnPage(p){
    const el = $(`#pdfPages .page[data-page="${p}"]`);
    if (!el) return;
    const tc = pageTextCache.get(p);
    if (!tc) return;
    const view = (await pdfDoc.getPage(p)).getViewport({ scale });
    const m = matches[matchIdx]; if (!m || m.page!==p) return;

    // Clear layer
    el._hl && (el._hl.innerHTML='');

    // map joined-string index -> spans
    const items = tc.items.map(i=>i.str);
    const start=m.idx, end=m.idx+m.len;

    let acc=0, sItem=0, sChar=0;
    for (let i=0;i<items.length;i++){ const s=items[i]; if (acc+s.length+1>start){ sItem=i; sChar=start-acc; break; } acc+=s.length+1; }
    let eItem=sItem, eChar=end-acc;
    for (let i=sItem;i<items.length;i++){ const s=items[i], spanEnd=acc+s.length+1; if (spanEnd>=end){ eItem=i; eChar=end-acc; break; } acc=spanEnd; }

    for (let i=sItem;i<=eItem;i++){
      const it=tc.items[i];
      const tr=pdfjsLib.Util.transform(pdfjsLib.Util.transform(view.transform, it.transform), [1,0,0,-1,0,0]);
      const [a,b,, ,e,f]=tr; const fs=Math.hypot(a,b);
      const perChar=(it.width?(it.width*scale):Math.abs(a))/Math.max(1,it.str.length);
      let left=e, top=f-fs, wChars=it.str.length;
      if (i===sItem){ left+=perChar*sChar; wChars-=sChar; }
      if (i===eItem){ wChars=(i===sItem?(eChar-sChar):eChar); }
      const box=document.createElement('div'); box.className='hl';
      box.style.left=left+'px'; box.style.top=top+'px';
      box.style.width=Math.max(2,perChar*Math.max(0,wChars))+'px';
      box.style.height=Math.max(2,fs*1.08)+'px';
      el._hl.appendChild(box);
    }
  }

  // ---------- Calibration & page math ----------
  const calibKey = () => 'lawtexts:calib:' + base(currentUrl||'');
  function getOffset(){
    try{
      const raw = localStorage.getItem(calibKey());
      if (!raw) return DEFAULT_OFF;
      const o = JSON.parse(raw); return (typeof o.offset==='number') ? o.offset : DEFAULT_OFF;
    }catch{ return DEFAULT_OFF; }
  }
  function setOffset(off){
    try{ localStorage.setItem(calibKey(), JSON.stringify({ offset: off })); }catch{}
  }
  const pdfFromBook = book => book + getOffset();
  const bookFromPdf = pdf  => pdf  - getOffset();
  function setLabel(s){ if (label) label.textContent=s; }

  function calibrate(){
    if (isText || !pdfDoc){ toast('Calibration is for PDFs'); return; }
    const current = visibleTopPage();
    const ans=prompt(`Calibration\nThis is PDF page ${current}.\nEnter the BOOK page printed on this page:`); const book=parseInt(ans||'',10);
    if (!Number.isInteger(book)) return;
    const off=current-book; setOffset(off);
    toast(`Saved calibration for ${base(currentUrl)} (offset ${off>=0?'+':''}${off})`);
    updateLabelFromScroll();
  }

  function jumpBookPage(book){
    if (isText || !pdfDoc){ toast('Book page jump works for PDFs'); return; }
    const t=Math.max(1, Math.min(pdfDoc.numPages, pdfFromBook(book)));
    scrollToPage(t);
  }

  // ---------- Export ----------
  async function exportVisibleText(){
    if (isText){
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([textContent],{type:'text/plain'}));
      a.download=(base(currentUrl).replace(/\.[^.]+$/,'')||'text')+'.txt'; a.click(); URL.revokeObjectURL(a.href); return;
    }
    if (!pdfDoc) return;
    const p = visibleTopPage();
    const tc=pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
    const txt=tc.items.map(i=>i.str).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));
    a.download=`book-p${bookFromPdf(p)}-pdf-p${p}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- utils ----------
  function throttle(fn,ms){ let t=0; return (...a)=>{ const n=Date.now(); if(n-t>ms){ t=n; fn(...a);} }; }
  function bind(sel, fn){ const el=$(sel); if (el) el.addEventListener('click', fn); }
});
