// Law-Texts-ui — SAFE main.js (no page wipe-out)
// PDF + TXT viewer, page turning, search/matches, repo drawer
// Locked to data/texts/catalog.json; Safari-friendly PDF.js

document.addEventListener('DOMContentLoaded', () => {
  // ===== CONFIG =====
  const CATALOG_URL = 'data/texts/catalog.json';
  const DEFAULT_OFF = -83;
  const STORAGE_NS  = 'lawtexts:';
  const MAX_MATCHES = 200;

  // ===== STATE =====
  let pdfDoc = null, currentUrl = null, currentPage = 1;
  let rendering = false, pendingPage = null, scale = 1;
  let isText = false, textContent = '', activeTextMark = null;
  const pageTextCache = new Map();
  let searchTerm = '', matches = [];

  // ===== DOM helpers =====
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const key = s => STORAGE_NS + (currentUrl || '') + ':' + s;
  const toast = (m, ms=2000) => { const t=$('#toast'); if (!t) return; t.textContent=m; t.hidden=false; clearTimeout(t._tm); t._tm=setTimeout(()=>t.hidden=true,ms); };

  // ===== Controls (bind if present) =====
  const searchInput = $('#searchInput') || $$('input').find(i => (i.placeholder||'').toLowerCase().includes('search'));
  bind('#findPrevBtn',  () => handleFind('prev'));
  bind('#findNextBtn',  () => handleFind('next'));
  bind('#printBtn',     () => window.print());
  bind('#exportTxtBtn', exportVisibleText);
  bind('#goBtn',        () => {
    const n = parseInt($('#bookPageInput')?.value || '', 10);
    if (Number.isInteger(n)) jumpBookPage(n);
  });
  bind('#calibrateBtn', calibrate);
  bind('#prevBtn', () => pagePrev());
  bind('#nextBtn', () => pageNext());

  $('#listFilter')?.addEventListener('input', e => filterCatalog(e.target.value));

  // Drawer (Repos)
  const drawer = $('#drawer');
  const reposBtn = $('#reposBtn') || $$('button').find(b => (b.textContent||'').trim().toLowerCase()==='repos');
  reposBtn?.addEventListener('click', () => drawer?.classList.add('open'));
  $('#drawerClose')?.addEventListener('click', () => drawer?.classList.remove('open'));
  $('#repoFilter')?.addEventListener('input', e => filterRepos(e.target.value));

  // ===== Mounts (SAFE: never clear body) =====
  const mounts = ensureMounts(); // { mount, pager, matchesList, catalogList }

  // ===== PDF.js setup (Safari-friendly) =====
  (async () => {
    if (!window.pdfjsLib) { alert('PDF.js failed to load'); return; }
    try {
      const local = './vendor/pdf.worker.min.js';
      const head = await fetch(local, { method:'HEAD', cache:'no-store' });
      if (head.ok) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = local;
        console.log('[pdfjs] using local worker');
      } else {
        console.log('[pdfjs] running without worker (v3 main thread)');
      }
    } catch {
      console.log('[pdfjs] running without worker (v3 main thread)');
    }
  })();

  // ===== Boot =====
  (async function init(){
    await loadRepos();
    await loadCatalog();  // locked to catalog.json
  })();

  // ===== Ensure mounts (safe DOM insertion only inside our own nodes) =====
  function ensureMounts(){
    // Center host: prefer an existing center pane; never use <body> itself
    const center =
      document.querySelector('.pane.center') ||
      document.querySelector('#pdfContainer') ||
      document.querySelector('#pdfViewer') ||
      document.querySelector('#viewerScroll') ||
      document.querySelector('main .pane:nth-child(2)') ||
      document.querySelector('main') ||
      document.querySelector('#app') ||
      document.body; // fallback append, but we DO NOT clear it

    // Create/ensure our mount inside the center host
    let mount = $('#lt-viewer-mount');
    if (!mount){
      mount = document.createElement('div');
      mount.id = 'lt-viewer-mount';
      mount.style.display = 'flex';
      mount.style.flexDirection = 'column';
      mount.style.height = '100%';
      center.appendChild(mount);
    }

    // Scroll area for viewer
    let scroll = $('#lt-viewer-scroll');
    if (!scroll){
      scroll = document.createElement('div');
      scroll.id = 'lt-viewer-scroll';
      scroll.style.height = 'calc(100% - 46px)'; // leave space for pager
      scroll.style.overflow = 'auto';
      scroll.style.display = 'flex';
      scroll.style.justifyContent = 'center';
      scroll.style.alignItems = 'flex-start';
      mount.appendChild(scroll);
    }

    // PDF layer shell + layers
    let shell = $('#pdfLayerShell'); if (!shell){ shell = document.createElement('div'); shell.id='pdfLayerShell'; scroll.appendChild(shell); }
    if (!$('#pdfCanvas'))      { const c = document.createElement('canvas'); c.id='pdfCanvas'; c.style.display='block'; c.style.margin='0 auto'; shell.appendChild(c); }
    if (!$('#textLayer'))      { const tl = document.createElement('div'); tl.id='textLayer'; shell.appendChild(tl); }
    if (!$('#highlightLayer')) { const hl = document.createElement('div'); hl.id='highlightLayer'; shell.appendChild(hl); }

    // Bottom pager (always available)
    let pager = $('#lt-pager');
    if (!pager){
      pager = document.createElement('div'); pager.id='lt-pager';
      pager.style.display='flex'; pager.style.justifyContent='center'; pager.style.gap='8px'; pager.style.padding='8px';
      const prev=document.createElement('button'); prev.className='btn'; prev.textContent='Prev'; prev.addEventListener('click', pagePrev);
      const next=document.createElement('button'); next.className='btn'; next.textContent='Next'; next.addEventListener('click', pageNext);
      pager.append(prev,next);
      mount.appendChild(pager);
    }

    // Right matches list (ensure exists)
    let matchesList = $('#matchesList');
    if (!matchesList){
      const right = document.querySelector('.pane.right') || document.querySelector('aside:last-of-type');
      if (right){
        const head = document.createElement('div');
        head.innerHTML = `<strong>Matches</strong> <span id="matchCount" style="color:#6b7280"></span>`;
        right.appendChild(head);
        matchesList = document.createElement('ul'); matchesList.id='matchesList'; matchesList.style.listStyle='none'; matchesList.style.margin='0'; matchesList.style.padding='0';
        right.appendChild(matchesList);
      }
    }

    // Left catalog list (ensure exists)
    let catalogList = $('#catalogList') || $('#bookList');
    if (!catalogList){
      const left = document.querySelector('.pane.left') || document.querySelector('aside');
      if (left){
        if (!$('#listFilter')){
          const inp=document.createElement('input'); inp.id='listFilter'; inp.placeholder='Filter list…'; inp.className='input';
          inp.addEventListener('input', e => filterCatalog(e.target.value));
          left.insertBefore(inp, left.firstChild || null);
        }
        catalogList = document.createElement('ul'); catalogList.id='catalogList';
        catalogList.style.listStyle='none'; catalogList.style.margin='0'; catalogList.style.padding='0';
        left.appendChild(catalogList);
      }
    }

    // Minimal CSS for highlights (only once)
    if (!$('style[data-lt-hl]')){
      const st=document.createElement('style'); st.setAttribute('data-lt-hl','1');
      st.textContent = `
        #textLayer span{position:absolute;white-space:pre;transform-origin:left bottom}
        #highlightLayer .highlight{position:absolute;background:rgba(255,213,77,.35);border-radius:2px}
      `;
      document.head.appendChild(st);
    }

    return { mount, pager, matchesList, catalogList };
  }

  // ===== Catalog =====
  async function loadCatalog(){
    try{
      const r = await fetch(CATALOG_URL, { cache:'no-store' });
      if (!r.ok) throw new Error('catalog not found');
      const items = await r.json();

      const list = mounts.catalogList;
      if (!list) return;

      list.innerHTML = '';
      items.forEach(it => {
        const li = document.createElement('li');
        li.style.padding='10px 12px'; li.style.borderBottom='1px solid #f0f2f7'; li.style.cursor='pointer';
        li.innerHTML = `<div><strong>${esc(it.title||'')}</strong>${it.subtitle?`<div style="color:#6b7280">${esc(it.subtitle)}</div>`:''}</div>`;
        li.dataset.title=(it.title||'').toLowerCase();
        li.dataset.url = it.url || '';
        if (it.url){
          li.addEventListener('click', () => {
            [...list.children].forEach(n=>n.classList.remove('active'));
            li.classList.add('active');
            openDocument(it.url);
          });
        } else { li.style.opacity='.6'; li.style.cursor='not-allowed'; }
        list.appendChild(li);
      });

      // auto-open first
      const first = Array.from(list.children).find(n=>n.dataset.url);
      if (first){ first.classList.add('active'); openDocument(first.dataset.url); }
    }catch(e){
      console.error('catalog load error:', e);
      toast('catalog.json error');
    }
  }
  function filterCatalog(q){
    const needle=(q||'').toLowerCase();
    const list=mounts.catalogList; if (!list) return;
    [...list.children].forEach(li => li.style.display = (li.dataset.title||'').includes(needle) ? '' : 'none');
  }

  // ===== Open doc =====
  function isPdf(u){ return /\.pdf(?:[#?].*)?$/i.test(u||''); }
  function isTxt(u){ return /\.txt(?:[#?].*)?$/i.test(u||''); }

  async function openDocument(url){
    currentUrl = url; searchTerm=''; matches=[]; pageTextCache.clear();
    setMatchUI([], '');
    if (searchInput) searchInput.value='';
    clearTextViewer(); showPdfLayers(true);
    console.log('[openDocument] type:', isPdf(url)?'PDF':(isTxt(url)?'TXT':'UNKNOWN'), '\n"url="', url, '"');

    if (isPdf(url)) return openPdf(url);
    if (isTxt(url) || !/\.[a-z0-9]+$/i.test(url)) return openTxt(url); // default to TXT if no ext
    toast('Unsupported file: '+url);
  }

  // ===== TXT =====
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
    }catch(e){
      console.error('Text load error:', e);
      toast('Error loading text file');
    }
  }
  function ensureTextViewer(){
    const scroll = $('#lt-viewer-scroll') || mounts.mount;
    let v = $('#textViewer');
    if (!v){
      v = document.createElement('pre');
      v.id='textViewer';
      Object.assign(v.style, {whiteSpace:'pre-wrap',wordBreak:'break-word',padding:'12px',fontFamily:'serif',margin:'0 auto',width:'100%'});
      scroll.appendChild(v);
      if (!$('style[data-text-hl]')){ const st=document.createElement('style'); st.setAttribute('data-text-hl','1'); st.textContent='.highlight-text{background:#ffd54d66;box-shadow:0 0 0 2px #ffd54d66 inset}'; document.head.appendChild(st); }
    }
    v.style.display='block';
    return v;
  }
  function clearTextViewer(){ const v=$('#textViewer'); if (v){ v.textContent=''; v.style.display='none'; } if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; } }
  function highlightInTxt(pos,len){
    const v = ensureTextViewer();
    if (activeTextMark){ activeTextMark.remove(); activeTextMark=null; }
    const walker=document.createTreeWalker(v,NodeFilter.SHOW_TEXT,null);
    let offset=0,startNode=null,startOffset=0,endNode=null,endOffset=0,n;
    while ((n=walker.nextNode())){
      const next=offset+n.nodeValue.length;
      if (!startNode && pos>=offset && pos<=next){ startNode=n; startOffset=pos-offset; }
      if (startNode && (pos+len)>=offset && (pos+len)<=next){ endNode=n; endOffset=(pos+len)-offset; break; }
      offset=next;
    }
    if (!startNode){ v.scrollTop=0; return; }
    if (!endNode){ endNode=startNode; endOffset=startNode.nodeValue.length; }
    const range=document.createRange(); range.setStart(startNode,startOffset); range.setEnd(endNode,endOffset);
    const span=document.createElement('span'); span.className='highlight-text'; range.surroundContents(span);
    activeTextMark=span;
    const r=span.getBoundingClientRect(), pr=v.getBoundingClientRect();
    v.scrollTop += (r.top - pr.top) - pr.height/3;
  }

  // ===== PDF =====
  async function openPdf(url){
    try{
      let source;
      try {
        const r = await fetch(url, { cache:'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ab = await r.arrayBuffer();
        source = { data: ab };
        console.log('Loaded via ArrayBuffer:', url, ab.byteLength, 'bytes');
      } catch(e) {
        console.warn('ArrayBuffer failed; using URL mode'); source = { url };
      }
      const task = pdfjsLib.getDocument(source);
      pdfDoc = await task.promise;

      const scroll = $('#lt-viewer-scroll') || mounts.mount;
      const cssW = Math.max(420, scroll.clientWidth || 820);
      const p1   = await pdfDoc.getPage(1);
      const v    = p1.getViewport({ scale: 1 });
      scale      = cssW / v.width;

      isText = false; currentPage = 1;
      showPdfLayers(true);
      await render(currentPage);
      toast(`Loaded PDF (${pdfDoc.numPages} pages)`);
    }catch(e){
      console.error('PDF load/render error:', e);
      toast('Error loading PDF');
    }
  }

  async function render(num){
    rendering = true;
    try{
      const canvas = $('#pdfCanvas'), textLayer = $('#textLayer'), hlLayer = $('#highlightLayer');
      const ctx = canvas.getContext('2d');
      const page = await pdfDoc.getPage(num);
      const view = page.getViewport({ scale });

      canvas.width  = Math.floor(view.width);
      canvas.height = Math.floor(view.height);
      await page.render({ canvasContext: ctx, viewport: view }).promise;

      // build overlays
      textLayer.innerHTML=''; hlLayer.innerHTML='';
      Object.assign(textLayer.style, { position:'absolute', left:'0', top:'0', width:canvas.width+'px', height:canvas.height+'px' });
      Object.assign(hlLayer.style,   { position:'absolute', left:'0', top:'0', width:canvas.width+'px', height:canvas.height+'px' });
      const shell = $('#pdfLayerShell'); shell.style.width = canvas.width+'px'; shell.style.height = canvas.height+'px';

      const tc = await page.getTextContent();
      pageTextCache.set(num, tc);
      for (const item of tc.items){
        const span = document.createElement('span'); span.textContent=item.str;
        const tr = pdfjsLib.Util.transform(pdfjsLib.Util.transform(view.transform, item.transform), [1,0,0,-1,0,0]);
        const [a,b,c,d,e,f] = tr; const fs = Math.hypot(a,b);
        span.style.left = e+'px'; span.style.top = (f - fs)+'px'; span.style.fontSize = fs+'px';
        span.style.transformOrigin='left bottom';
        span.style.transform = `matrix(${a/fs},${b/fs},${c/fs},${d/fs},0,0)`;
        textLayer.appendChild(span);
      }
    }catch(e){
      console.error('render error:', e);
      toast('Render error');
    }finally{
      rendering=false; updateLabel();
      if (pendingPage !== null){ const p=pendingPage; pendingPage=null; render(p); }
    }
  }
  function pagePrev(){ if (!pdfDoc || isText) return; queueRender(Math.max(1, currentPage-1)); }
  function pageNext(){ if (!pdfDoc || isText) return; queueRender(Math.min(pdfDoc.numPages || 1, currentPage+1)); }
  function queueRender(n){
    if (!pdfDoc || isText) return;
    n = Math.max(1, Math.min(pdfDoc.numPages, n));
    if (rendering){ pendingPage = n; return; }
    currentPage = n; render(n);
  }

  // ===== Book/PDF mapping + calibrate =====
  function loadCal(){ return JSON.parse(localStorage.getItem(key('calib')) || '{}'); }
  function saveCal(o){ localStorage.setItem(key('calib'), JSON.stringify(o)); }
  function pdfFromBook(book){
    const c=loadCal();
    if (Array.isArray(c.anchors)&&c.anchors.length){
      const a=c.anchors.filter(x=>x.bookPageStart<=book).sort((x,y)=>y.bookPageStart-x.bookPageStart)[0];
      if (a) return book + a.offset;
    }
    const off=(typeof c.offset==='number')?c.offset:DEFAULT_OFF; return book+off;
  }
  function bookFromPdf(pdf){
    const c=loadCal();
    if (Array.isArray(c.anchors)&&c.anchors.length){
      const sorted=[...c.anchors].sort((x,y)=>x.bookPageStart-y.bookPageStart);
      let chosen=sorted[0]||{bookPageStart:1,offset:(typeof c.offset==='number')?c.offset:DEFAULT_OFF};
      for (const a of sorted){ const pivot=a.bookPageStart+a.offset; if (pivot<=pdf) chosen=a; else break; }
      return pdf - chosen.offset;
    }
    const off=(typeof c.offset==='number')?c.offset:DEFAULT_OFF; return pdf-off;
  }
  function calibrate(){
    if (isText || !pdfDoc){ toast('Calibration is for PDFs'); return; }
    const ans=prompt(`Calibration\nThis is PDF page ${currentPage}.\nEnter the BOOK page printed on this page:`); const book=parseInt(ans||'',10);
    if (!Number.isInteger(book)) return;
    const off=currentPage-book;
    const c=loadCal(); c.offset=off; c.anchors=c.anchors||[]; saveCal(c);
    toast(`Calibrated: Book p.${book} ↔ PDF p.${currentPage} (offset ${off>=0?'+':''}${off})`);
    updateLabel();
  }
  function jumpBookPage(book){
    if (isText || !pdfDoc){ toast('Book page jump works for PDFs'); return; }
    const t=Math.max(1, Math.min(pdfDoc.numPages, pdfFromBook(book))); queueRender(t); toast(`Book p.${book} → PDF p.${t}`);
  }
  function updateLabel(){
    if (isText) setLabel(currentUrl?.split('/').pop() || 'Text');
    else        setLabel(`Book p.${bookFromPdf(currentPage)} (PDF p.${currentPage})`);
  }
  function setLabel(s){ const el=$('#pageLabel'); if (el) el.textContent=s; }

  // ===== Search (PDF + TXT) =====
  searchInput?.addEventListener('keydown', e => { if (e.key==='Enter') handleFind('new'); });

  async function handleFind(mode){
    const q=(searchInput?.value||'').trim();
    if (!q){ setMatchUI([], ''); return; }
    if (isText) return findTxt(q, mode);
    return findPdf(q, mode);
  }

  async function findPdf(q, mode){
    if (!pdfDoc) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; setMatchUI([], 'Searching…');
      try{
        for (let p=1;p<=pdfDoc.numPages;p++){
          const tc=pageTextCache.get(p) || await pdfDoc.getPage(p).then(pg=>pg.getTextContent());
          if (!pageTextCache.has(p)) pageTextCache.set(p, tc);
          const joined=tc.items.map(i=>i.str).join(' ');
          for (const idx of findAll(joined.toLowerCase(), q.toLowerCase())){
            const s=Math.max(0, idx-60), e=Math.min(joined.length, idx+q.length+60);
            matches.push({ page:p, snippet:joined.slice(s,e).replace(/\s+/g,' ').trim(), bookPage:bookFromPdf(p) });
            if (matches.length>=MAX_MATCHES) break;
          }
          if (matches.length>=MAX_MATCHES) break;
        }
      }catch(e){ console.error('Search error', e); toast('Search error'); }
      setMatchUI(matches);
      if (matches.length){ queueRender(matches[0].page); await sleep(140); await highlightOnPage(q); }
      return;
    }
    if (!matches.length) return;
    const i=matches.findIndex(m=>m.page===currentPage);
    const next=(mode==='next') ? (i+1)%matches.length : (i-1+matches.length)%matches.length;
    const m=matches[next]; queueRender(m.page); await sleep(140); await highlightOnPage(searchTerm);
  }

  async function findTxt(q, mode){
    if (!textContent) return;
    if (mode==='new' || q!==searchTerm){
      searchTerm=q; matches=[]; setMatchUI([], 'Searching…');
      const hay=textContent.toLowerCase(), needle=q.toLowerCase();
      let idx=hay.indexOf(needle);
      while (idx!==-1 && matches.length<MAX_MATCHES){
        const s=Math.max(0, idx-60), e=Math.min(textContent.length, idx+q.length+60);
        matches.push({ pos:idx, len:q.length, snippet:textContent.slice(s,e).replace(/\s+/g,' ').trim() });
        idx=hay.indexOf(needle, idx+q.length);
      }
      setMatchUI(matches);
      if (matches.length){ const m=matches[0]; highlightInTxt(m.pos, m.len); }
      return;
    }
    if (!matches.length) return;
    let i=0;
    if (activeTextMark){
      const v=$('#textViewer'); const walker=document.createTreeWalker(v,NodeFilter.SHOW_TEXT,null);
      let offset=0, n; while((n=walker.nextNode())){ if (n===activeTextMark.firstChild) break; offset+=n.nodeValue.length; }
      i = matches.findIndex(m=>m.pos>=offset); if (i===-1) i=0;
    }
    const next=(mode==='next')?(i+1)%matches.length:(i-1+matches.length)%matches.length;
    const m=matches[next]; highlightInTxt(m.pos, m.len);
  }

  function findAll(h, n){ const out=[]; let i=h.indexOf(n); while(i!==-1){ out.push(i); i=h.indexOf(n, i+n.length);} return out; }

  function setMatchUI(list, placeholder){
    let ul = mounts.matchesList || $('#matchesList');
    if (!ul){
      const right = document.querySelector('.pane.right') || document.querySelector('aside:last-of-type') || document.body;
      ul = document.createElement('ul'); ul.id='matchesList'; right.appendChild(ul);
    }
    ul.innerHTML='';
    const mc = $('#matchCount'); if (mc) mc.textContent = placeholder || (list.length?`${list.length} result(s)`:'No results');
    list.forEach(m=>{
      const li=document.createElement('li');
      li.style.padding='10px 12px'; li.style.borderBottom='1px solid #f0f2f7'; li.style.cursor='pointer';
      const label = (m.bookPage!=null) ? `p.${m.bookPage}` : 'match';
      li.innerHTML = `<div style="font-size:12px;color:#6b7280">${label}</div><div>${esc(m.snippet||'')}</div>`;
      li.addEventListener('click', async ()=>{
        if (isText){ highlightInTxt(m.pos, m.len); }
        else { queueRender(m.page); await sleep(140); await highlightOnPage(searchTerm); }
      });
      ul.appendChild(li);
    });
  }

  async function highlightOnPage(snippet){
    if (!pdfDoc) return false;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    if (!pageTextCache.has(currentPage)) pageTextCache.set(currentPage, tc);
    const items = tc.items.map(i=>i.str);
    const joined = items.join(' ').toLowerCase();
    const needle = snippet.toLowerCase().replace(/\s+/g,' ').trim();
    const start = joined.indexOf(needle);
    const hl = $('#highlightLayer'); if (start===-1){ hl.innerHTML=''; return false; }

    let acc=0, sItem=0, sChar=0;
    for (let i=0;i<items.length;i++){ const s=items[i]; if (acc+s.length+1>start){ sItem=i; sChar=start-acc; break; } acc+=s.length+1; }
    const endIndex = start + needle.length; let eItem=sItem, eChar=endIndex-acc;
    for (let i=sItem;i<items.length;i++){ const s=items[i], spanEnd=acc+s.length+1; if (spanEnd>=endIndex){ eItem=i; eChar=endIndex-acc; break; } acc=spanEnd; }

    const page = await pdfDoc.getPage(currentPage);
    const view = page.getViewport({ scale });
    hl.innerHTML='';
    for (let i=sItem;i<=eItem;i++){
      const it = tc.items[i];
      const tr = pdfjsLib.Util.transform(pdfjsLib.Util.transform(view.transform, it.transform), [1,0,0,-1,0,0]);
      const [a,b,c,d,e,f]=tr; const fs=Math.hypot(a,b);
      const wPerChar = (it.width ? (it.width*scale) : Math.abs(a)) / Math.max(1, it.str.length);
      let left=e, top=f-fs, wChars=it.str.length;
      if (i===sItem){ left+=wPerChar*sChar; wChars-=sChar; }
      if (i===eItem){ wChars=(i===sItem ? (eChar-sChar) : eChar); }
      const box=document.createElement('div'); box.className='highlight';
      box.style.left=left+'px'; box.style.top=top+'px';
      box.style.width=Math.max(2, wPerChar*Math.max(0,wChars))+'px';
      box.style.height=Math.max(2, fs*1.1)+'px';
      hl.appendChild(box);
    }
    return true;
  }

  // ===== Export =====
  async function exportVisibleText(){
    if (isText){
      if (!textContent) return;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([textContent],{type:'text/plain'}));
      a.download=(currentUrl?.split('/').pop()?.replace(/\.[^.]+$/,'')||'text')+'.txt';
      a.click(); URL.revokeObjectURL(a.href);
      return;
    }
    if (!pdfDoc) return;
    const tc = pageTextCache.get(currentPage) || await pdfDoc.getPage(currentPage).then(p=>p.getTextContent());
    const text = tc.items.map(i=>i.str).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
    a.download=`book-p${bookFromPdf(currentPage)}-pdf-p${currentPage}.txt`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ===== Drawer data =====
  async function loadRepos(){
    try{
      const r = await fetch('data/repos.json', { cache:'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const ul = $('#repoList'); if (!ul) return; ul.innerHTML='';
      for (const d of data){
        const li=document.createElement('li'); li.className='repo-item'; li.dataset.name=(d.name||'').toLowerCase();
        li.style.padding='10px 12px'; li.style.borderBottom='1px solid #f0f2f7'; li.style.cursor='pointer';
        li.innerHTML=`<div><strong>${esc(d.name||'')}</strong>${d.desc?`<div class="muted">${esc(d.desc)}</div>`:''}${d.url?`<div class="muted">${esc(d.url)}</div>`:''}</div>`;
        if (d.url) li.addEventListener('click', ()=>window.open(d.url,'_blank'));
        ul.appendChild(li);
      }
    }catch{}
  }
  function filterRepos(q){
    const needle=(q||'').toLowerCase();
    $$('.repo-item').forEach(li => li.style.display = (li.dataset.name||'').includes(needle) ? '' : 'none');
  }

  // ===== helpers =====
  function bind(sel, fn){ const el=$(sel); if (el) el.addEventListener('click', fn); }
  function setLabel(s){ const el=$('#pageLabel'); if (el) el.textContent=s; }
  function loadCal(){ return JSON.parse(localStorage.getItem(key('calib')) || '{}'); }
  function saveCal(o){ localStorage.setItem(key('calib'), JSON.stringify(o)); }
  function bookFromPdf(pdf){
    const c=loadCal();
    if (Array.isArray(c.anchors)&&c.anchors.length){
      const sorted=[...c.anchors].sort((x,y)=>x.bookPageStart-y.bookPageStart);
      let chosen=sorted[0]||{bookPageStart:1,offset:(typeof c.offset==='number')?c.offset:DEFAULT_OFF};
      for (const a of sorted){ const pivot=a.bookPageStart+a.offset; if (pivot<=pdf) chosen=a; else break; }
      return pdf - chosen.offset;
    }
    const off=(typeof c.offset==='number')?c.offset:DEFAULT_OFF; return pdf-off;
  }
  function pdfFromBook(book){
    const c=loadCal();
    if (Array.isArray(c.anchors)&&c.anchors.length){
      const a=c.anchors.filter(x=>x.bookPageStart<=book).sort((x,y)=>y.bookPageStart-x.bookPageStart)[0];
      if (a) return book + a.offset;
    }
    const off=(typeof c.offset==='number')?c.offset:DEFAULT_OFF; return book+off;
  }
});
