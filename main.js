// Law-Texts-ui — clean viewer (fit-to-width, on-page highlights, left drawer, right matches)

(function () {
  // ---- Safe lookup ----
  const $ = (id)=>{ const el=document.getElementById(id); if(!el) throw new Error(`Missing #${id}`); return el; };

  // ---- DOM ----
  const els = {
    drawer: $("drawer"), drawerToggle: $("drawerToggle"), drawerClose: $("drawerClose"),
    list: $("bookList"), filter: $("filterInput"),
    search: $("searchInput"), prev: $("prevBtn"), next: $("nextBtn"),
    metaBook: $("metaBook"), metaChapter: $("metaChapter"), metaSource: $("metaSource"), metaRef: $("metaRef"),
    viewer: $("viewer"), surface: $("pageSurface"), canvas: $("pdfCanvas"),
    hlayer: $("highlightLayer"), textLayer: $("textLayer"), pageInfo: $("pageInfo"),
    results: $("results"), status: $("status"),
    printBtn: $("printBtn"), exportBtn: $("exportBtn")
  };

  // ---- PDF.js worker (critical) ----
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  // ---- Utils ----
  const REGISTRY = ["textbooks.json"];
  const isPDF = (u)=> /\.pdf(\?|#|$)/i.test((u||"").trim());
  const clean = (s)=> (s||"").toString().trim();
  const esc = (s)=> (s||"").replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const rxEsc = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const setStatus = (m, bad=false)=>{ els.status.textContent=m||""; els.status.className="status"+(bad?" error":""); };

  // ---- State ----
  const st = {
    registry: [], book:null, isPdf:false,
    pdf:null, page:1, total:0, scale:1,
    query:"", hits:[], hitIdx:-1, pageTextCache:{}
  };

  // ---- Boot ----
  (async function boot(){
    try{
      setStatus("Loading registry…");
      const r = await fetch(REGISTRY[0], {cache:"no-store"});
      if (!r.ok) throw new Error("Could not load textbooks.json");
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) throw new Error("Empty registry");
      st.registry = data;
      renderList(st.registry);
      wire();
      setStatus("");
    }catch(e){ setStatus("Init error: "+(e.message||e), true); }
  })();

  // ---- List ----
  function renderList(items){
    els.list.innerHTML = "";
    items.forEach(b=>{
      const li=document.createElement("li");
      li.className="list-item";
      li.innerHTML = `<strong>${esc(b.title||"Untitled")}</strong><br>
        <small>${esc(b.jurisdiction||"")}${b.reference?(" — "+esc(b.reference)):""}</small>`;
      li.addEventListener("click", ()=>selectBook(b, li));
      els.list.appendChild(li);
    });
  }

  // ---- Select book ----
  async function selectBook(book, li){
    Array.from(els.list.children).forEach(n=>n.classList.remove("active"));
    if (li) li.classList.add("active");

    st.book=book; st.isPdf = isPDF(book.reference_url);
    st.pdf=null; st.page=1; st.total=0; st.scale=1;
    st.query=""; st.hits=[]; st.hitIdx=-1; st.pageTextCache={};
    els.results.innerHTML="";

    els.metaBook.textContent = book.title||"—";
    els.metaChapter.textContent = "—";
    els.metaSource.textContent = book.jurisdiction||"—";
    els.metaRef.textContent = book.reference||"—";

    const url = clean(book.reference_url);
    if (!url){ setStatus("No reference_url.", true); return; }

    try{
      if (!st.isPdf){
        setStatus("Loading text…");
        const r = await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error("HTTP "+r.status);
        const txt = await r.text();
        const pre = document.createElement("pre");
        pre.textContent = txt; pre.style.margin="0"; pre.style.padding="12px";
        els.surface.style.width = "100%"; els.surface.style.height="auto";
        els.surface.replaceChildren(pre);
        els.pageInfo.textContent = "—";
        setStatus("Text loaded.");
        return;
      }

      setStatus("Loading PDF…");
      if (!window.pdfjsLib) throw new Error("PDF.js missing");
      st.pdf = await pdfjsLib.getDocument({url}).promise;
      st.total = st.pdf.numPages;
      setStatus(`PDF loaded (${st.total} pages).`);
      await renderPage(st.page);
    }catch(e){ setStatus("Load error: "+(e.message||e), true); }
  }

  // ---- Geometry helpers ----
  function innerViewerWidthPx(){
    const cs = getComputedStyle(els.viewer);
    const padL = parseFloat(cs.paddingLeft)||0, padR=parseFloat(cs.paddingRight)||0;
    return Math.max(els.viewer.clientWidth - padL - padR, 320);
  }
  function computeScale(unscaledWidth){
    const inner = innerViewerWidthPx();
    const gutter = 0.965; // ~3.5% side gutter => ~13.5cm in a 14cm pane
    return Math.min((inner * gutter) / unscaledWidth, 4.0);
  }

  // ---- Render page ----
  async function renderPage(pageNum){
    if (!st.pdf) return;
    st.page = Math.max(1, Math.min(pageNum, st.total));
    const page = await st.pdf.getPage(st.page);

    const unscaled = page.getViewport({scale:1});
    st.scale = computeScale(unscaled.width);

    const vpCSS = page.getViewport({scale: st.scale});
    const dpr = window.devicePixelRatio || 1;
    const vpDevice = page.getViewport({scale: st.scale, transform: (dpr!==1 ? [dpr,0,0,dpr,0,0] : null)});

    // Size page surface to exact CSS px so overlay math matches
    els.surface.style.width  = Math.round(vpCSS.width)  + "px";
    els.surface.style.height = Math.round(vpCSS.height) + "px";

    // Canvas CSS fills surface; device px for crispness
    els.canvas.style.width="100%"; els.canvas.style.height="100%";
    els.canvas.width  = Math.floor(vpCSS.width  * dpr);
    els.canvas.height = Math.floor(vpCSS.height * dpr);

    // Render page
    const ctx = els.canvas.getContext("2d");
    await page.render({canvasContext: ctx, viewport: vpDevice}).promise;

    // Render text layer (invisible but aligned)
    els.textLayer.style.setProperty("--scale-factor", String(st.scale)); // PDF.js v3 requirement
    els.textLayer.innerHTML = "";
    await pdfjsLib.renderTextLayer({
      textContent: await page.getTextContent(),
      container: els.textLayer,
      viewport: vpCSS,
      textDivs: []
    }).promise;
    els.textLayer.style.color = "transparent";

    // Draw on-page highlights
    await drawHighlights(page, vpCSS);

    els.pageInfo.textContent = `${st.page} / ${st.total}`;
  }

  // ---- Highlights ----
  async function drawHighlights(page, vpCSS){
    const q = clean(st.query);
    els.hlayer.innerHTML = "";
    if (!q) return;

    const content = await page.getTextContent();
    const needle = q.toLowerCase();

    // Within one item
    for (const it of content.items){
      const text = it.str || ""; const low = text.toLowerCase();
      if (!low.includes(needle)) continue;

      const m = pdfjsLib.Util.transform(vpCSS.transform, it.transform);
      const x = m[4], yTop = m[5];
      const h = Math.hypot(m[2], m[3]);            // CSS px
      const wPx = it.width * vpCSS.scale;          // CSS px
      const avg = wPx / Math.max(1, text.length);  // per-character width estimate

      let from=0, pos;
      while((pos = low.indexOf(needle, from)) !== -1){
        addHL(x + pos*avg, yTop - h*1.15, Math.max(2, avg*needle.length), h*1.3);
        from = pos + needle.length;
      }
    }

    // Across adjacent items (split words)
    const items = content.items;
    for (let i=0; i+1<items.length; i++){
      const A = items[i], B = items[i+1];
      const a = (A.str||"").toLowerCase(), b = (B.str||"").toLowerCase();
      for (let k=1; k<needle.length; k++){
        if (a.endsWith(needle.slice(0,k)) && b.startsWith(needle.slice(k))){
          markTail(A,k); markHead(B, needle.length-k); break;
        }
      }
    }

    function markTail(item, k){
      const m = pdfjsLib.Util.transform(vpCSS.transform, item.transform);
      const x = m[4], yTop = m[5], h = Math.hypot(m[2], m[3]);
      const wPx = item.width * vpCSS.scale;
      const avg = wPx / Math.max(1, (item.str||"").length);
      addHL(x + (((item.str||"").length)-k)*avg, yTop - h*1.15, Math.max(2, avg*k), h*1.3);
    }
    function markHead(item, k){
      const m = pdfjsLib.Util.transform(vpCSS.transform, item.transform);
      const x = m[4], yTop = m[5], h = Math.hypot(m[2], m[3]);
      const wPx = item.width * vpCSS.scale;
      const avg = wPx / Math.max(1, (item.str||"").length);
      addHL(x, yTop - h*1.15, Math.max(2, avg*k), h*1.3);
    }
    function addHL(x,y,w,h){
      const d=document.createElement("div");
      d.className="hl";
      d.style.left=x+"px"; d.style.top=y+"px"; d.style.width=w+"px"; d.style.height=h+"px";
      els.hlayer.appendChild(d);
    }
  }

  // ---- Search ----
  async function getPageText(p){
    if (st.pageTextCache[p]) return st.pageTextCache[p];
    const page = await st.pdf.getPage(p);
    const content = await page.getTextContent();
    const t = content.items.map(i=>i.str).join(" ");
    st.pageTextCache[p] = t;
    return t;
  }

  async function runSearch(){
    st.query = clean(els.search.value);
    st.hits=[]; st.hitIdx=-1; els.results.innerHTML="";

    if (!st.query){ setStatus(""); await renderPage(st.page); return; }
    if (!st.pdf){ setStatus("Open a PDF first.", true); return; }

    setStatus("Searching…");
    const needle = st.query.toLowerCase();
    const rx = new RegExp(rxEsc(st.query), "gi");

    for (let p=1; p<=st.total && st.hits.length<400; p++){
      const txt = await getPageText(p);
      const low = txt.toLowerCase();
      let from=0, pos;
      while((pos = low.indexOf(needle, from)) !== -1){
        const snippet = txt.slice(Math.max(0, pos-80), Math.min(txt.length, pos+needle.length+80));
        st.hits.push({page:p, snippet});
        from = pos + needle.length;
      }
      await new Promise(r=>setTimeout(r,0));
    }

    if (!st.hits.length){ setStatus("No matches."); await renderPage(st.page); return; }

    const frag = document.createDocumentFragment();
    st.hits.forEach((h,i)=>{
      const row = document.createElement("div");
      row.className="result";
      row.innerHTML = `p.${h.page}: … ${esc(h.snippet).replace(rx, m=>`<em>${esc(m)}</em>`)} …`;
      row.addEventListener("click", ()=>gotoHit(i));
      frag.appendChild(row);
    });
    els.results.appendChild(frag);

    st.hitIdx=0;
    await gotoHit(0);
    setStatus(`Found ${st.hits.length} match(es).`);
  }

  async function gotoHit(i){
    if (!st.hits[i]) return;
    st.hitIdx = i;
    await renderPage(st.hits[i].page); // on-page highlight uses st.query

    const rows = els.results.querySelectorAll(".result");
    rows.forEach(n=>n.classList.remove("active"));
    const row = rows[i]; if (row){ row.classList.add("active"); row.scrollIntoView({block:"nearest"}); }
  }

  // ---- Navigation ----
  function nav(step){
    if (st.hits.length){
      let i = st.hitIdx + step;
      if (i<0) i = st.hits.length-1;
      if (i>=st.hits.length) i = 0;
      gotoHit(i);
    } else if (st.pdf){
      const want = st.page + (step<0?-1:1);
      if (want>=1 && want<=st.total) renderPage(want);
    }
  }

  // ---- Events ----
  function wire(){
    // Drawer
    els.drawerToggle.addEventListener("click", ()=>{ els.drawer.classList.add("open"); els.drawer.setAttribute("aria-hidden","false"); });
    els.drawerClose .addEventListener("click", ()=>{ els.drawer.classList.remove("open"); els.drawer.setAttribute("aria-hidden","true"); });

    // Filter list
    els.filter.addEventListener("input", ()=>{
      const q = els.filter.value.toLowerCase();
      const list = st.registry.filter(b =>
        (b.title||"").toLowerCase().includes(q) ||
        (b.jurisdiction||"").toLowerCase().includes(q) ||
        (b.reference||"").toLowerCase().includes(q)
      );
      renderList(list);
    });

    // Search: Enter + debounce as-you-type
    els.search.addEventListener("keydown", e=>{ if (e.key==="Enter") runSearch(); });
    let t=null; els.search.addEventListener("input", ()=>{ clearTimeout(t); t=setTimeout(runSearch, 300); });

    // Nav buttons + arrow keys
    els.prev.addEventListener("click", ()=>nav(-1));
    els.next.addEventListener("click", ()=>nav(1));
    window.addEventListener("keydown", (e)=>{
      if (e.key==="ArrowLeft")  nav(-1);
      if (e.key==="ArrowRight") nav(1);
    }, {passive:true});

    // Utilities
    els.printBtn.addEventListener("click", ()=>window.print());
    els.exportBtn.addEventListener("click", ()=>setStatus("Export to TXT works for plain .txt sources only.", true));

    // Refit on resize / rotation
    window.addEventListener("resize", ()=>{ if (st.pdf) renderPage(st.page); }, {passive:true});
  }
})();
