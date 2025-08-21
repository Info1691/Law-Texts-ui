// =====================
// Law-Texts-ui / main.js (restore1)
// =====================

(function () {
  // Safe lookup
  const $ = (id) => { const el = document.getElementById(id); if (!el) throw new Error(`Missing #${id}`); return el; };

  // DOM
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

  // Utils
  const REGISTRY = ["textbooks.json"];
  const isPDF = (u) => /\.pdf(\?|#|$)/i.test((u || "").trim());
  const clean = (s) => (s || "").toString().trim();
  const esc = (s) => (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const setStatus = (m, bad=false)=>{ els.status.textContent=m||""; els.status.className="status"+(bad?" error":""); };

  // State
  const st = {
    registry: [],
    book: null,
    isPdf: false,
    pdf: null,
    page: 1,
    total: 0,
    scale: 1,
    zoomFactor: 1.35,     // room to boost beyond fit-to-width
    query: "",
    hits: [],
    hitIdx: -1,
    pageTextCache: {}
  };

  // Boot
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
      wire();
      setStatus("");
    }catch(e){ setStatus("Failed to load list: "+(e.message||e), true); }
  })();

  // List
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

  // Select
  async function selectBook(book, li){
    Array.from(els.list.children).forEach(n=>n.classList.remove("active"));
    if (li) li.classList.add("active");

    st.book = book;
    st.isPdf = isPDF(book.reference_url);
    st.pdf = null; st.page=1; st.total=0;
    st.scale=1; st.zoomFactor=1.35;
    st.query=""; st.hits=[]; st.hitIdx=-1; st.pageTextCache={};
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

  // Rendering: fit to full width + zoom factor
  function updateZoomLabel(){ els.zoomLabel.textContent = Math.round(st.zoomFactor*100)+"%"; }
  function computeScale(unscaledWidth){
    const inner = Math.max(els.viewer.clientWidth - 16, 600); // fit width of centre pane
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

    // device pixels (crisp)
    els.canvas.width  = Math.floor(vpCSS.width  * dpr);
    els.canvas.height = Math.floor(vpCSS.height * dpr);

    // render
    const transform = dpr!==1 ? [dpr,0,0,dpr,0,0] : null;
    const vpDevice = page.getViewport({scale: st.scale, transform});
    await page.render({canvasContext: ctx, viewport: vpDevice}).promise;

    // text layer (invisible; used for accurate geometry if needed)
    els.textLayer.innerHTML = "";
    await pdfjsLib.renderTextLayer({
      textContent: await page.getTextContent(),
      container: els.textLayer,
      viewport: vpCSS,
      textDivs: []
    }).promise;
    els.textLayer.style.color = "transparent";

    // draw highlights for current query
    await drawHighlights(page, vpCSS);

    els.pageInfo.textContent = `${st.page} / ${st.total}`;
  }

  async function drawHighlights(page, vpCSS){
    const q = clean(st.query);
    els.hlayer.innerHTML = "";
    if (!q) return;

    const content = await page.getTextContent();
    const needle = q.toLowerCase();

    // single-item matches
    for (const it of content.items){
      const text = it.str || "";
      const low  = text.toLowerCase();
      if (!low.includes(needle)) continue;

      const m = pdfjsLib.Util.transform(vpCSS.transform, it.transform);
      const x = m[4], yTop = m[5];
      const h = Math.hypot(m[2], m[3]);    // CSS px
      const wPx = it.width * vpCSS.scale;  // CSS px
      const avg = wPx / Math.max(1, text.length);

      let from=0, pos;
      while ((pos = low.indexOf(needle, from)) !== -1){
        addHL(x + pos*avg, yTop - h*1.15, Math.max(2, avg*needle.length), h*1.3);
        from = pos + needle.length;
      }
    }

    // split across adjacent items
    const items = content.items;
    for (let i=0; i+1<items.length; i++){
      const A = items[i], B = items[i+1];
      const aText = (A.str||"").toLowerCase();
      const bText = (B.str||"").toLowerCase();
      for (let k=1; k<needle.length; k++){
        if (aText.endsWith(needle.slice(0,k)) && bText.startsWith(needle.slice(k))){
          box(A,k); boxB(B, needle.length-k); break;
        }
      }
    }

    function box(item, chars){
      const m = pdfjsLib.Util.transform(vpCSS.transform, item.transform);
      const x = m[4], yTop = m[5], h = Math.hypot(m[2], m[3]);
      const wPx = item.width * vpCSS.scale;
      const avg = wPx / Math.max(1, (item.str||"").length);
      addHL(x + (((item.str||"").length) - chars)*avg, yTop - h*1.15, Math.max(2, avg*chars), h*1.3);
    }
    function boxB(item, chars){
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

  // Search
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
      await renderPage(st.page); // clears on-page highlights
      return;
    }
    if (!st.pdf){ setStatus("Open a PDF first.", true); return; }

    setStatus("Searching…");
    const needle = st.query.toLowerCase();
    const rx = new RegExp(rxEsc(st.query), "gi");

    for (let p=1; p<=st.total && st.hits.length<400; p++){
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

    if (!st.hits.length){ setStatus("No matches."); await renderPage(st.page); return; }

    // Right pane and bottom tray with snippets
    const makeRow = (i,h) => {
      const d = document.createElement("div");
      d.className = "result";
      d.innerHTML = `p.${h.page}: … ${esc(h.snippet).replace(rx, m=>`<em>${esc(m)}</em>`)} …`;
      d.addEventListener("click", ()=>gotoHit(i));
      return d;
    };
    const fragR = document.createDocumentFragment();
    const fragB = document.createDocumentFragment();
    st.hits.forEach((h,i)=>{ fragR.appendChild(makeRow(i,h)); fragB.appendChild(makeRow(i,h)); });
    els.results.appendChild(fragR);
    els.resultsBottom.appendChild(fragB);

    st.hitIdx = 0;
    await gotoHit(0);
    setStatus(`Found ${st.hits.length} match(es).`);
  }

  async function gotoHit(i){
    if (!st.hits[i]) return;
    st.hitIdx = i;
    await renderPage(st.hits[i].page); // on-page highlights for st.query

    // mark active in both lists
    const mark = (root)=>{
      const rows = root.querySelectorAll(".result");
      rows.forEach(n=>n.classList.remove("active"));
      const row = rows[i]; if (row){ row.classList.add("active"); row.scrollIntoView({block:"nearest"}); }
    };
    mark(els.results);
    mark(els.resultsBottom);
  }

  // Navigation & Zoom
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

  // Events
  function wire(){
    els.filter.addEventListener("input", ()=>{
      const q = els.filter.value.toLowerCase();
      const list = st.registry.filter(b =>
        (b.title||"").toLowerCase().includes(q) ||
        (b.jurisdiction||"").toLowerCase().includes(q) ||
        (b.reference||"").toLowerCase().includes(q)
      );
      renderList(list);
    });

    // search: Enter or as-you-type (debounced)
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

    window.addEventListener("resize", ()=>{ if (st.pdf) renderPage(st.page); }, {passive:true});
  }
})();
