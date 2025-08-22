// Law-Texts-ui — Phase 1 (fit-to-width PDF/TXT, min 14cm)
// Prev/Next doubles as find next/prev when search box has text.
// No right pane. Repos drawer. Calibration (single offset). Safari-safe worker.

document.addEventListener('DOMContentLoaded', () => {
  // ----- CONFIG -----
  const CATALOG_URL = 'data/texts/catalog.json';
  const REPOS_URL   = 'data/repos.json';
  const DEFAULT_OFF = -83;     // book ↔ pdf default offset
  const MAX_MATCHES = 300;
  const MIN_CM      = 14;
  const STORAGE_NS  = 'lawtexts:';

  // ----- STATE -----
  let pdfDoc = null, currentUrl = null, currentPage = 1;
  let rendering = false, pendingPage = null, scale = 1;
  let isText = false, textContent = '';
  const pageTextCache = new Map(); // page -> textContent
  let searchTerm = '', matches = [], matchIdx = -1;

  // ----- DOM -----
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const key = s => STORAGE_NS + (currentUrl || '') + ':' + s;
  const toast = (m,ms=1800)=>{ const t=$('#toast'); t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const cmToPx = cm => cm*37.7952755906;

  // Toolbar
  const searchInput = $('#searchInput');
  bind('#printBtn', () => window.print());
  bind('#exportTxtBtn', exportVisibleText);
  bind('#goBtn', () => { const n=parseInt($('#bookPageInput')?.value||'',10); if (Number.isInteger(n)) jumpBookPage(n); });
  bind('#calibrateBtn', calibrate);
  bind('#prevBtn', prevAction);
  bind('#nextBtn', nextAction);
  bind('#pagerPrev', prevAction);
  bind('#pagerNext', nextAction);
  $('#listFilter')?.addEventListener('input', e=>filterCatalog(e.target.value));
  searchInput?.addEventListener('keydown', e=>{ if (e.key==='Enter') startSearch('new'); });

  // Drawer
  const drawer = $('#drawer');
  $('#reposBtn')?.addEventListener('click', ()=> drawer.classList.add('open'));
  $('#repoClose')?.addEventListener('click', ()=> drawer.classList.remove('open'));
  $('#repoFilter')?.addEventListener('input', e=>filterRepos(e.target.value));

  // Viewer mounts
  const scroll = $('#lt-viewer-scroll');
  const shell  = $('#pdfLayerShell');
  const canvas = $('#pdfCanvas');
  const textLayer = $('#textLayer');
  const hlLayer   = $('#highlightLayer');
  const label = $('#pageLabel');

  // Ensure min width
  scroll.style.minWidth = `${MIN_CM}cm`;

  // Resize: refit current page
  new ResizeObserver(()=>{ if (pdfDoc && !isText) { fitScaleToWidth().then(()=>render(currentPage)); } }).observe(scroll);

  // PDF.js worker: explicit CDN (quiet on Safari)
  if (window.pdfjsLib){
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  } else {
    alert('PDF.js failed to load');
  }

  // Boot
  (async function init(){
    await loadRepos();
    await loadCatalog();
  })();

  // --------- Catalog ----------
  async function loadCatalog(){
    try{
      const r = await fetch(CATALOG_URL, { cache:'no-store' });
      if (!r.ok) throw new Error('catalog not found');
      const items = await r.json();
      const list = $('#catalogList'); list.innerHTML='';

      for (const it of items){
        const li=document.createElement('li');
        li.innerHTML = `<div><strong>${esc(it.title||'')}</strong>${it.subtitle?`<div class="sub">${esc(it.subtitle)}</div>`:''}</div>`;
        li.dataset.title=(it.title||'').toLowerCase();
        li.dataset.url = it.url || '';
        if (it.url){
          li.addEventListener('click', ()=>{
            [...list.children].forEach(n=>n.classList.remove('active'));
            li.classList.add('active');
            openDocument(it.url);
          });
        } else {
          li.style.opacity='.6'; li.style.cursor='not-allowed';
        }
        list.appendChild(li);
      }

      // auto-open first
      const first = Array.from(list.children).find(n=>n.dataset.url);
      if (first){ first.classList.add('active'); openDocument(first.dataset.url); }
    }catch(e){ console.error(e); toast('catalog.json error'); }
  }
  function filterCatalog(q){
    const needle=(q||'').toLowerCase();
    [...$('#catalogList').children].forEach(li=>{
      li.style.display = (li.dataset.title||'').includes(needle) ? '' : 'none';
    });
  }

  // --------- Repos ----------
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
    $$('.repo-item').forEach(li=> li.style.display = (li.dataset.name||'').includes(n) ? '' : 'none');
  }

  // --------- Open document ----------
  function isPdf(u){ return /\.pdf(?:[#?].*)?$/i.test(u||''); }
  function isTxt(u){ return /\.txt(?:[#?].*)?$/i.test(u||''); }

  async function openDocument(url){
    currentUrl = url;
    resetSearchState();
    clearTextViewer();
    showPdfLayers(true);

    if (isPdf(url)) return openPdf(url);
    if (isTxt(url) || !/\.[a-z0-9]+$/i.test(url)) return openTxt(url);
    toast('Unsupported file: '+url);
  }

  // TXT mode
  async function openTxt(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      textContent = await r.text();
      isText = true;
      const v = ensureTextViewer();
      v.textContent = textContent;
      showPdfLayers(false);
      setLabel(url.split('/').pop() || 'Text');
      toast('Loaded text file');
    }catch(e){ console.error(e); toast('Error loading text file'); }
  }
  function ensureTextViewer(){
    let v = $('#textViewer');
    if (!v){ v=document.createElement('pre'); v.id='textViewer'; scroll.appendChild(v); }
    v.style.display='block';
    return v;
  }
  function clearTextViewer(){ const v=$('#textViewer'); if (v){ v.textContent=''; v.style.display='none'; } }

  // PDF mode
  async function fitScaleToWidth(){
    const cssW = Math.max(scroll.clientWidth || 820, cmToPx(MIN_CM));
    const p = await pdfDoc.getPage(1);
    const v = p.getViewport({ scale:1 });
    scale = cssW / v.width;
  }

  async function openPdf(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      const source = r.ok ? { data: await r.arrayBuffer() } : { url };
      pdfDoc = await pdfjsLib.getDocument(source).promise;

      await fitScaleToWidth();
      isText = false; currentPage = 1;
      await render(currentPage);
      toast(`Loaded PDF (${pdfDoc.numPages} pages)`);
    }catch(e){ console.error(e); toast('Error loading PDF'); }
  }

  async function render(num){
    rendering = true;
    try{
      const ctx = canvas.getContext('2d');
      const page = await pdfDoc.getPage(num);
      const view = page.getViewport({ scale });

      canvas.width  = Math.floor(view.width);
      canvas.height = Math.floor(view.height);

      await page.render({ canvasContext: ctx, viewport: view }).promise;

      shell.style.width  = canvas.width+'px';
      shell.style.height = canvas.height+'px';
      Object.assign(textLayer.style, { width:canvas.width+'px', height:canvas.height+'px' });
      Object.assign(hlLayer.style,   { width:canvas.width+'px', height:canvas.height+'px' });
      textLayer.innerHTML=''; hlLayer.innerHTML='';

      const tc = await page.getTextContent();
      pageTextCache.set(num, tc);
      for (const item of tc.items){
        const span = document.createElement('span'); span.textContent=item.str;
        const tr = pdfjsLib.Util.transform(pdfjsLib.Util.transform(view.transform, item.transform), [1,0,0,-1,0,0]);
        const [a,b,c,d,e,f] = tr; const fs = Math.hypot(a,b);
        span.style.left = e+'px'; span.style.top = (f - fs)+'px'; span.style.fontSize = fs+'px';
        span.style.transform = `matrix(${a/fs},${b/fs},${c/fs},${d/fs},0,0)`;
        textLayer.appendChild(span);
      }

      updateLabel();
      if (searchTerm) await highlightCurrentMatchIfOnThisPage();
    }catch(e){ console.error(e); toast('Render error'); }
    finally{
      rendering=false;
      if (pendingPage!==null){ const p=pendingPage; pendingPage=null; render(p); }
    }
  }

  function queueRender(n){
    if (!pdfDoc || isText) return;
    n = Math.max(1, Math.min(pdfDoc.numPages, n));
    if (rendering){ pendingPage = n; return; }
    currentPage = n; render(n);
  }

  function showPdfLayers(show){
    shell.style.display = show ? 'block' : 'none';
    const v = $('#textViewer'); if (v) v.style.display = show ? 'none' : 'block';
  }

  // --------- Prev/Next dual behavior ----------
  function nextAction(){
    const q=(searchInput?.value||'').trim();
    if (q) startSearch('next'); else if (!isText) queueRender(currentPage+1);
  }
  function prevAction(){
    const q=(searchInput?.value||'').trim();
    if (q) startSearch('prev'); else if (!isText) queueRender(currentPage-1);
  }

  // --------- Search & highlight ----------
  function resetSearchState(){ searchTerm=''; matches=[]; matchIdx=-1; hlLayer.innerHTML=''; pageTextCache.clear(); }

  async function startSearch(mode){
    const q=(searchInput?.value||'').trim();
    if (!q){ resetSearchState(); return; }

    if (q !== searchTerm){
      searchTerm=q; matches=[]; matchIdx=-1;
      if (isText){
        const hay=textContent.toLowerCase(), needle=q.toLowerCase();
        let idx=hay.indexOf(needle);
        while (idx!==-1 && matches.length<MAX_MATCHES){
          matches.push({ kind:'txt', pos:idx, len:q.length });
          idx=hay.indexOf(needle, idx+q.length);
        }
        if (!matches.length){ toast('No matches'); return; }
        matchIdx=0; highlightTxt(matches[0]); return;
      } else {
        for (let p=1;p<=pdfDoc.numPages;p++){
          const tc=pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
          if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
          const joined=tc.items.map(i=>i.str).join(' ');
          const hay=joined.toLowerCase(), needle=q.toLowerCase();
          let idx=hay.indexOf(needle);
          while (idx!==-1 && matches.length<MAX_MATCHES){
            matches.push({ kind:'pdf', page:p, idx, len:q.length });
            idx=hay.indexOf(needle, idx+q.length);
          }
          if (matches.length>=MAX_MATCHES) break;
        }
        if (!matches.length){ toast('No matches'); hlLayer.innerHTML=''; return; }
        matchIdx=0; const m=matches[0]; if (currentPage!==m.page) queueRender(m.page); else highlightPdf(m);
        return;
      }
    } else {
      if (!matches.length){ toast('No matches'); return; }
      matchIdx = (mode==='prev') ? (matchIdx-1+matches.length)%matches.length : (matchIdx+1)%matches.length;
      const m=matches[matchIdx];
      if (m.kind==='txt') highlightTxt(m); else { if (currentPage!==m.page) queueRender(m.page); else highlightPdf(m); }
    }
  }

  function highlightTxt(m){
    const v = ensureTextViewer();
    v.innerHTML='';
    const before=textContent.slice(0,m.pos);
    const mid=textContent.slice(m.pos,m.pos+m.len);
    const after=textContent.slice(m.pos+m.len);
    v.insertAdjacentText('beforeend', before);
    const span=document.createElement('span'); span.className='txt-hl'; span.textContent=mid; v.appendChild(span);
    v.insertAdjacentText('beforeend', after);
    const r=span.getBoundingClientRect(), pr=v.getBoundingClientRect();
    v.scrollTop += (r.top-pr.top) - pr.height/3;
  }

  async function highlightCurrentMatchIfOnThisPage(){
    const m=matches[matchIdx];
    if (!m || m.kind!=='pdf' || m.page!==currentPage) return;
    await highlightPdf(m);
  }

  async function highlightPdf(m){
    const tc=pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);
    const items=tc.items.map(i=>i.str);
    const start=m.idx, end=m.idx+m.len;

    let acc=0, sItem=0, sChar=0;
    for (let i=0;i<items.length;i++){ const s=items[i]; if (acc+s.length+1>start){ sItem=i; sChar=start-acc; break; } acc+=s.length+1; }
    let eItem=sItem, eChar=end-acc;
    for (let i=sItem;i<items.length;i++){ const s=items[i], spanEnd=acc+s.length+1; if (spanEnd>=end){ eItem=i; eChar=end-acc; break; } acc=spanEnd; }

    const page=await pdfDoc.getPage(currentPage);
    const view=page.getViewport({ scale });
    hlLayer.innerHTML='';

    for (let i=sItem;i<=eItem;i++){
      const it=tc.items[i];
      const tr=pdfjsLib.Util.transform(pdfjsLib.Util.transform(view.transform, it.transform), [1,0,0,-1,0,0]);
      const [a,b,c,d,e,f]=tr; const fs=Math.hypot(a,b);
      const wPerChar=(it.width?(it.width*scale):Math.abs(a))/Math.max(1,it.str.length);
      let left=e, top=f-fs, wChars=it.str.length;
      if (i===sItem){ left+=wPerChar*sChar; wChars-=sChar; }
      if (i===eItem){ wChars=(i===sItem?(eChar-sChar):eChar); }
      const box=document.createElement('div'); box.className='hl';
      box.style.left=left+'px'; box.style.top=top+'px';
      box.style.width=Math.max(2,wPerChar*Math.max(0,wChars))+'px';
      box.style.height=Math.max(2,fs*1.08)+'px';
      hlLayer.appendChild(box);
    }

    // scroll to view
    const first=hlLayer.firstChild;
    if (first){
      const r=first.getBoundingClientRect(), sc=scroll.getBoundingClientRect();
      if (r.top<sc.top || r.bottom>sc.bottom){
        scroll.scrollTop += (r.top - sc.top) - sc.height/3;
      }
    }
  }

  // --------- Mapping & calibration ----------
  function loadCal(){ return JSON.parse(localStorage.getItem(key('calib')) || '{}'); }
  function saveCal(o){ localStorage.setItem(key('calib'), JSON.stringify(o)); }
  function pdfFromBook(book){ const c=loadCal(); const off=(typeof c.offset==='number')?c.offset:DEFAULT_OFF; return book+off; }
  function bookFromPdf(pdf){ const c=loadCal(); const off=(typeof c.offset==='number')?c.offset:DEFAULT_OFF; return pdf-off; }
  function updateLabel(){ if (isText) setLabel(currentUrl?.split('/').pop()||'Text'); else setLabel(`Book p.${bookFromPdf(currentPage)} (PDF p.${currentPage})`); }
  function setLabel(s){ const el=label; if (el) el.textContent=s; }
  function calibrate(){
    if (isText || !pdfDoc){ toast('Calibration is for PDFs'); return; }
    const ans=prompt(`Calibration\nThis is PDF page ${currentPage}.\nEnter the BOOK page printed on this page:`); const book=parseInt(ans||'',10);
    if (!Number.isInteger(book)) return;
    const off=currentPage-book; const c=loadCal(); c.offset=off; saveCal(c);
    toast(`Calibrated: Book p.${book} ↔ PDF p.${currentPage} (offset ${off>=0?'+':''}${off})`); updateLabel();
  }
  function jumpBookPage(book){
    if (isText || !pdfDoc){ toast('Book page jump works for PDFs'); return; }
    const t=Math.max(1, Math.min(pdfDoc.numPages, pdfFromBook(book))); queueRender(t);
  }

  // --------- Export ----------
  async function exportVisibleText(){
    if (isText){
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([textContent],{type:'text/plain'}));
      a.download=(currentUrl?.split('/').pop()?.replace(/\.[^.]+$/,'')||'text')+'.txt'; a.click(); URL.revokeObjectURL(a.href); return;
    }
    if (!pdfDoc) return;
    const tc=pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    const txt=tc.items.map(i=>i.str).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));
    a.download=`book-p${bookFromPdf(currentPage)}-pdf-p${currentPage}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }

  // --------- helpers ----------
  function bind(sel, fn){ const el=$(sel); if (el) el.addEventListener('click', fn); }
});
