// =====================
// Law-Texts-ui / main.js (finalfix1)
// =====================

(function () {
  // ---------- Safe element lookup ----------
  function $(id) { const el = document.getElementById(id); if (!el) throw new Error(`Missing #${id}`); return el; }

  // ---------- DOM ----------
  const els = {
    list: $("bookList"),
    filter: $("filterInput"),
    search: $("searchInput"),
    prev: $("prevBtn"),
    next: $("nextBtn"),
    zoomIn: $("zoomInBtn"),
    zoomOut: $("zoomOutBtn"),
    zoomLabel: $("zoomLabel"),
    viewer: $("viewer"),
    results: $("results"),
    resultsBottom: $("resultsBottom"),
    status: $("status"),
    metaBook: $("metaBook"),
    metaChapter: $("metaChapter"),
    metaSource: $("metaSource"),
    metaRef: $("metaRef"),
    pageWrap: $("pageWrap"),
    canvas: $("pdfCanvas"),
    hlayer: $("highlightLayer"),
    textLayer: $("textLayer"),
    pageInfo: $("pageInfo"),
    printBtn: $("printBtn"),
    exportBtn: $("exportBtn"),
  };

  // ---------- Utils ----------
  const REGISTRY = ["textbooks.json"];
  const isPDF = (u) => /\.pdf(\?|#|$)/i.test((u || "").trim());
  const clean = (s) => (s || "").toString().trim();
  const esc = (s) => (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  function setStatus(msg, err=false){ els.status.textContent = msg||""; els.status.className = "status" + (err?" error":""); }

  // ---------- State ----------
  const st = {
    registry: [],
    book: null,
    isPdf: false,
    pdf: null,
    page: 1,
    total: 0,
    scale: 1,
    zoomFactor: 1.35,           // default boost over "fit width"
    query: "",
    hits: [],
    hitIdx: -1,
    pageTextCache: {}
  };

  // ---------- Boot ----------
  (async function boot(){
    try{
      setStatus("Loading registry…");
      for (const path of REGISTRY){
        const r = await fetch(path, {cache:"no-store"});
        if (r.ok){
          const data = await r.json();
          if (Array.isArray(data) && data.length){ st.registry = data; break; }
        }
      }
      if (!st.registry.length) throw new Error("Could not load textbooks.json");
      renderList(st.registry);
      wireEvents();
      setStatus("");
    }catch(e){ setStatus("Failed to load list: "+(e.message||e), true); }
  })();

  // ---------- List ----------
  function renderList(items){
    els.list.innerHTML = "";
    items.forEach(b=>{
      const li = document.createElement("li");
      li.className = "list-item";
      li.innerHTML = `<strong>${esc(b.title||"Untitled")}</strong><br>
        <small>${esc(b.jurisdiction||"")}${b.reference?(" — "+esc(b.reference)):""}</small>`;
      li.addEventListener("click", ()=>selectBook(b, li));
      els.list.appendChild(li);
    });
  }

  // ---------- Select book ----------
  async function selectBook(book, li){
    Array.from(els.list.children).forEach(n=>n.classList.remove("active"));
    if (li) li.classList.add("active");

    st.book = book;
    st.isPdf = isPDF(book.reference_url);
    st.pdf = null; st.page=1; st.total=0;
    st.scale = 1; st.zoomFactor = 1.35;
    st.query = ""; st.hits=[]; st.hitIdx=-1; st.pageTextCache={};
    els.results.innerHTML = ""; els.resultsBottom.innerHTML = "";
    updateZoomLabel();

    els.metaBook.textContent = book.title || "—";
    els.metaChapter.textContent = "—";
    els.metaSource.textContent = book.jurisdiction || "—";
    els.metaRef.textContent = book.reference || "—";

    const url = clean(book.reference_url);
    if (!url){ setStatus("No reference_url.", true); return; }

    try{
      if (!st.isPdf){
        setStatus("Loading text…");
        const r = await fetch(url,{cache:"no-store"});
        if (!r.ok) throw new Error("HTTP "+r.status);
        const txt = await r.text();
        const pre = document.createElement("pre");
        pre.textContent = txt; pre.style.margin="0"; pre.style.padding="12px";
        els.pageWrap.replaceChildren(pre);
        els.pageInfo.textContent = "—";
        setStatus("Text loaded.");
        return;
      }

      if (!window.pdfjsLib) throw new Error("PDF.js not available");
      setStatus("Loading PDF…");
      st.pdf = await pdfjsLib.getDocument({url}).promise;
      st.total = st.pdf.numPages;
      setStatus(`PDF loaded (${st.total} pages).`);
      await renderPage(st.page);
    }catch(e){ setStatus("Load error: "+(e.message||e), true); }
  }

  // ---------- Rendering ----------
  function updateZoomLabel(){ els.zoomLabel.textContent = Math.round(st.zoomFactor*100) + "%"; }

  // Fit to centre width, then multiply by user zoomFactor
  function computeScale(unscaledWidth){
    const inner = Math.max(els.viewer.clientWidth - 16, 600); // padding accounted
    return Math.min((inner / unscaledWidth) * st.zoomFactor, 3.0);
  }

  async function renderPage(pageNum){
    if (!st.pdf) return;
    st.page = Math.max(1, Math.min(pageNum, st.total));
    const page = await st.pdf.getPage(st.page);

    const unscaled = page.getViewport({scale:1});
    st.scale = computeScale(unscaled.width);

    const vpCSS = page.getViewport({scale: st.scale});
    const ctx = els.canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    // CSS sizes
    els.canvas.style.width  = Math.round(vpCSS.width) + "px";
    els.canvas.style.height = Math.round(vpCSS.height) + "px";
    els.hlayer.style.width  = els.textLayer.style.width  = els.canvas.style.width;
    els.hlayer.style.height = els.textLayer.style.height = els.canvas.style.height;

    // device pixels for crispness
    els.canvas.width  = Math.floor(vpCSS.width  * dpr);
    els.canvas.height = Math.floor(vpCSS.height * dpr);

    // render page
    const transform = dpr!==1 ? [dpr,0,0,dpr,0,0] : null;
    const vpDevice = page.getViewport({scale: st.scale, transform});
    await page.render({canvasContext: ctx, viewport: vpDevice}).promise;

    // invisible text layer (kept for selection/anchor if needed)
    els.textLayer.innerHTML = "";
    await pdfjsLib.renderTextLayer({
      textContent: await page.getTextContent(),
      container: els.textLayer,
      viewport: vpCSS,
      textDivs: []
    }).promise;
    els.textLayer.style.color = "transparent";

    // highlights
    await drawHighlights(page, vpCSS);

    // page counter
    els.pageInfo.textContent = `${st.page} / ${st.total}`;
  }

  async function drawHighlights(page, vpCSS){
    const q = clean(st.query);
    els.hlayer.innerHTML = "";
    if (!q) return;

    const content = await page.getTextContent();
    const needle = q.toLowerCase();

    // pass 1 — matches inside a single item
    for (const it of content.items){
      const text = it.str || "";
      const low  = text.toLowerCase();
      if (!low.includes(needle)) continue;

      const m = pdfjsLib.Util.transform(vpCSS.transform, it.transform);
      const x = m[4], yTop = m[5];
      const h = Math.hypot(m[2], m[3]);    // CSS px
      const wPx = it.width * vpCSS.scale;  // CSS px
      const avg = wPx / Math.max(1, text.length);

      let from = 0, pos;
      while ((pos = low.indexOf(needle, from)) !== -1){
        addHL(x + pos*avg, yTop - h*1.15, Math.max(2, avg*needle.length), h*1.3);
        from = pos + needle.length;
      }
    }

    // pass 2 — split across adjacent items
    const items = content.items;
    for (let i=0; i+1<items.length; i++){
      const A = items[i], B = items[i+1];
      const aText = (A.str||"").toLowerCase();
      const bText = (B.str||"").toLowerCase();
      for (let k=1; k<needle.length; k++){
        if (aText.endsWith(needle.slice(0,k)) && bText.startsWith(needle.slice(k))){
          boxFor(A, k); boxForB(B, needle.length-k); break;
        }
      }
    }

    function boxFor(item, chars){
      const m = pdfjsLib.Util.transform(vpCSS.transform, item.transform);
      const x = m[4], yTop = m[5], h = Math.hypot(m[2], m[3]);
      const wPx = item.width * vpCSS.scale;
      const avg = wPx / Math.max(1, (item.str||"").length);
      addHL(x + (((item.str||"").length) - chars)*avg, yTop - h*1.15, Math.max(2, avg*chars), h*1.3);
    }
    function boxForB(item, chars){
      const m = pdfjsLib.Util.transform(vpCSS.transform, item.transform);
      const x = m[4], yTop = m[5], h = Math.hypot(m[2], m[3]);
      const wPx = item.width * vpCSS.scale;
      const avg = wPx / Math.max(1, (item.str||"").length);
      addHL(x, yTop - h*1.15, Math.max(2, avg*chars), h*1.3);
    }
    function addHL(x,y,w,h){
      const d = document.createElement("div");
      d.className = "hl";
      d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:rgba(255,235,59,.55);border-radius:2px;pointer-events:none;`;
      els.hlayer.appendChild(d);
    }
  }

  // ---------- Search ----------
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
    st.hits=[]; st.hitIdx=-1;
    els.results.innerHTML = ""; els.resultsBottom.innerHTML = "";

    if (!st.query){
      setStatus("");
      await renderPage(st.page); // clears highlights
      return;
    }
    if (!st.pdf){ setStatus("Open a PDF first.", true); return; }

    setStatus("Searching…");
    const needle = st.query.toLowerCase();
    const rx = new RegExp(st.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");

    for (let p=1; p<=st.total && st.hits.length<300; p++){
      const txt = await getPageText(p);
      const low = txt.toLowerCase();
      let from=0, pos;
      while ((pos = low.indexOf(needle, from)) !== -1){
        const snippet = txt.slice(Math.max(0, pos-80), Math.min(txt.length, pos+needle.length+80));
        st.hits.push({page:p, snippet});
        from = pos + needle.length;
      }
      await new Promise(r=>setTimeout(r,0));
    }

    if (!st.hits.length){
      setStatus("No matches.");
      await renderPage(st.page);
      return;
    }

    // Build right pane + bottom tray with snippets (highlighted)
    const fragRight = document.createDocumentFragment();
    const fragTray  = document.createDocumentFragment();
    st.hits.forEach((h,i)=>{
      const html = `p.${h.page}: … ${esc(h.snippet).replace(rx, m=>`<em>${esc(m)}</em>`)} …`;
      const mk = (cls)=>{ const d=document.createElement("div"); d.className=cls; d.innerHTML=html; d.addEventListener("click",()=>gotoHit(i)); return d; };
      fragRight.appendChild(mk("result"));
      fragTray.appendChild(mk("result"));
    });
    els.results.appendChild(fragRight);
    els.resultsBottom.appendChild(fragTray);

    st.hitIdx = 0;
    await gotoHit(0);
    setStatus(`Found ${st.hits.length} match(es).`);
  }

  async function gotoHit(i){
    if (!st.hits[i]) return;
    st.hitIdx = i;
    await renderPage(st.hits[i].page); // draws highlight for current query

    // mark active row (right + tray) and autoscroll
    const mark = (container)=>{
      const rows = container.querySelectorAll(".result");
      rows.forEach(n=>n.classList.remove("active"));
      const row = rows[i]; if (row){ row.classList.add("active"); row.scrollIntoView({block:"nearest"}); }
    };
    mark(els.results);
    mark(els.resultsBottom);
  }

  // ---------- Navigation & Zoom ----------
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

  function zoom(delta){
    st.zoomFactor = Math.max(0.5, Math.min(2.5, st.zoomFactor + delta));
    updateZoomLabel();
    if (st.pdf) renderPage(st.page);
  }

  // ---------- Events ----------
  function wireEvents(){
    els.filter.addEventListener("input", ()=>{
      const q = els.filter.value.toLowerCase();
      const list = st.registry.filter(b =>
        (b.title||"").toLowerCase().includes(q) ||
        (b.jurisdiction||"").toLowerCase().includes(q) ||
        (b.reference||"").toLowerCase().includes(q)
      );
      renderList(list);
    });

    // search: Enter or debounced as-you-type
    els.search.addEventListener("keydown", e=>{ if (e.key==="Enter") runSearch(); });
    let timer=null;
    els.search.addEventListener("input", ()=>{ clearTimeout(timer); timer=setTimeout(runSearch, 300); });

    els.prev.addEventListener("click", ()=>nav(-1));
    els.next.addEventListener("click", ()=>nav(1));
    els.zoomIn.addEventListener("click", ()=>zoom(+0.1));
    els.zoomOut.addEventListener("click", ()=>zoom(-0.1));

    window.addEventListener("keydown", (e)=>{
      if (e.key==="ArrowLeft")  nav(-1);
      if (e.key==="ArrowRight") nav(1);
      if (e.key==="=" || e.key==="+") zoom(+0.1);
      if (e.key==="-" )          zoom(-0.1);
    }, {passive:true});

    els.printBtn.addEventListener("click", ()=>window.print());
    els.exportBtn.addEventListener("click", ()=>setStatus("Export to TXT is available for .txt sources only.", true));

    // Re-fit on resize/rotation
    window.addEventListener("resize", ()=>{ if (st.pdf) renderPage(st.page); }, {passive:true});
  }
})();
