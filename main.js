// ===== HOTFIX main.js (rhs-hotfix) =====

(function(){
  // ---- tiny helper for safe element lookup
  function must(id){
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}. Make sure index.html has it.`);
    return el;
  }

  // ---- find all required elements early and show friendly error if missing
  let els;
  try {
    els = {
      list: must("bookList"),
      filter: must("filterInput"),
      search: must("searchInput"),
      prev: must("prevBtn"),
      next: must("nextBtn"),
      viewer: must("viewer"),
      results: must("results"),
      status: must("status"),
      metaBook: must("metaBook"),
      metaChapter: must("metaChapter"),
      metaSource: must("metaSource"),
      metaRef: must("metaRef"),
      // viewer internals:
      pageWrap: must("pageWrap"),
      canvas: must("pdfCanvas"),
      hlayer: must("highlightLayer"),
      textLayer: must("textLayer"),
      pageInfo: must("pageInfo"),
      printBtn: must("printBtn"),
      exportBtn: must("exportBtn")
    };
  } catch (e){
    const box = document.createElement("div");
    box.style.cssText = "margin:12px;padding:12px;border:1px solid #e2e6ea;border-radius:8px;color:#b00020;background:#fff5f5;";
    box.innerHTML = `<strong>UI wiring error</strong><br>${e.message}<br><br>
    Needed ids: bookList, filterInput, searchInput, prevBtn, nextBtn, viewer, results, status,
    metaBook, metaChapter, metaSource, metaRef, pageWrap, pdfCanvas, highlightLayer, textLayer, pageInfo, printBtn, exportBtn.`;
    document.body.appendChild(box);
    return;
  }

  // ---- small utils
  const REGISTRY = ["textbooks.json"];
  const isPDF = (u) => /\.pdf(\?|#|$)/i.test((u||"").trim());
  const clean = (s) => (s||"").toString().trim();
  const esc = (s) => (s||"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function setStatus(msg, err=false){ els.status.textContent = msg || ""; els.status.className = "status"+(err?" error":""); }

  // ---- app state
  const st = {
    registry: [],
    book: null,
    pdf: null,
    isPdf: false,
    page: 1,
    total: 0,
    scale: 1,
    hits: [],
    hitIdx: -1,
    query: "",
    pageTextCache: {} // p->text
  };

  // ---- boot
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
    }catch(e){
      setStatus("Failed to load list: "+(e.message||e), true);
    }
  })();

  // ---- list
  function renderList(items){
    els.list.innerHTML = "";
    items.forEach(b=>{
      const li = document.createElement("li");
      li.className = "list-item";
      li.innerHTML = `<strong>${esc(b.title||"Untitled")}</strong><br><small>${esc(b.jurisdiction||"")}${b.reference?(" — "+esc(b.reference)):""}</small>`;
      li.addEventListener("click", ()=>selectBook(b, li));
      els.list.appendChild(li);
    });
  }

  // ---- select book
  async function selectBook(book, li){
    Array.from(els.list.children).forEach(n=>n.classList.remove("active"));
    if (li) li.classList.add("active");

    st.book = book;
    st.isPdf = isPDF(book.reference_url);
    st.pdf = null; st.page=1; st.total=0; st.hits=[]; st.hitIdx=-1; st.query=""; st.pageTextCache={};
    els.results.innerHTML = "";
    els.metaBook.textContent = book.title || "—";
    els.metaChapter.textContent = "—";
    els.metaSource.textContent = book.jurisdiction || "—";
    els.metaRef.textContent = book.reference || "—";

    const url = clean(book.reference_url);
    if (!url){ setStatus("No reference_url", true); return; }

    try{
      if (!st.isPdf){
        setStatus("Loading text…");
        const r = await fetch(url,{cache:"no-store"});
        if (!r.ok) throw new Error("HTTP "+r.status);
        const t = await r.text();
        els.pageWrap.replaceChildren(document.createElement("pre"));
        const pre = els.pageWrap.firstChild;
        pre.textContent = t;
        pre.style.margin="0"; pre.style.padding="12px";
        els.pageInfo.textContent = "—";
        setStatus("Text loaded.");
        return;
      }

      setStatus("Loading PDF…");
      if (!window.pdfjsLib) throw new Error("PDF.js not available");
      st.pdf = await pdfjsLib.getDocument({url}).promise;
      st.total = st.pdf.numPages;
      setStatus(`PDF loaded (${st.total} pages).`);
      await renderPage(st.page);
    }catch(e){
      setStatus("Load error: "+(e.message||e), true);
    }
  }

  function computeScale(unscaledWidth){
    const w = Math.max(els.viewer.clientWidth, 700);
    const target = Math.min(w - 24, 1100);   // fit center column
    return Math.min((target/unscaledWidth)*1.1, 3.0);
  }

  async function renderPage(pageNum){
    if (!st.pdf) return;
    st.page = Math.max(1, Math.min(pageNum, st.total));
    const page = await st.pdf.getPage(st.page);

    // compute scale for readable width
    const unscaled = page.getViewport({scale:1});
    st.scale = computeScale(unscaled.width);

    const vpCSS = page.getViewport({scale: st.scale});
    const ctx = els.canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    // size canvas & layers
    els.canvas.style.width = Math.round(vpCSS.width)+"px";
    els.canvas.style.height= Math.round(vpCSS.height)+"px";
    els.canvas.width  = Math.floor(vpCSS.width*dpr);
    els.canvas.height = Math.floor(vpCSS.height*dpr);
    els.textLayer.style.width = els.hlayer.style.width = els.canvas.style.width;
    els.textLayer.style.height= els.hlayer.style.height= els.canvas.style.height;

    // render page
    const transform = dpr!==1 ? [dpr,0,0,dpr,0,0] : null;
    const vpDevice = page.getViewport({scale: st.scale, transform});
    await page.render({canvasContext: ctx, viewport: vpDevice}).promise;

    // rebuild text layer (invisible)
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

    // pass 1: matches within a single item
    for (const it of content.items){
      const text = it.str || "";
      const low = text.toLowerCase();
      if (!low.includes(needle)) continue;

      const m = pdfjsLib.Util.transform(vpCSS.transform, it.transform);
      const x = m[4], yTop = m[5];
      const h = Math.hypot(m[2], m[3]);       // CSS px
      const wPx = it.width * vpCSS.scale;
      const avg = wPx / Math.max(1, text.length);

      let from=0, pos;
      while ((pos = low.indexOf(needle, from)) !== -1){
        addHL(x + pos*avg, yTop - h*1.15, Math.max(2, avg*needle.length), h*1.3);
        from = pos + needle.length;
      }
    }

    // pass 2: split across adjacent items (tail/head)
    const items = content.items;
    for (let i=0; i+1<items.length; i++){
      const A = items[i], B = items[i+1];
      const aText = (A.str||"").toLowerCase();
      const bText = (B.str||"").toLowerCase();
      for (let k=1; k<needle.length; k++){
        if (aText.endsWith(needle.slice(0,k)) && bText.startsWith(needle.slice(k))){
          // A box
          {
            const m = pdfjsLib.Util.transform(vpCSS.transform, A.transform);
            const x = m[4], yTop = m[5];
            const h = Math.hypot(m[2], m[3]);
            const wPx = A.width * vpCSS.scale;
            const avg = wPx / Math.max(1, (A.str||"").length);
            addHL(x + ((A.str||"").length - k)*avg, yTop - h*1.15, Math.max(2, avg*k), h*1.3);
          }
          // B box
          {
            const m = pdfjsLib.Util.transform(vpCSS.transform, B.transform);
            const x = m[4], yTop = m[5];
            const h = Math.hypot(m[2], m[3]);
            const wPx = B.width * vpCSS.scale;
            const avg = wPx / Math.max(1, (B.str||"").length);
            addHL(x, yTop - h*1.15, Math.max(2, avg*(needle.length-k)), h*1.3);
          }
          break;
        }
      }
    }

    function addHL(x,y,w,h){
      const d = document.createElement("div");
      d.className = "hl";
      d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:rgba(255,235,59,.55);border-radius:2px;pointer-events:none;`;
      els.hlayer.appendChild(d);
    }
  }

  async function getPageText(p){
    if (st.pageTextCache[p]) return st.pageTextCache[p];
    const page = await st.pdf.getPage(p);
    const content = await page.getTextContent();
    const t = content.items.map(i=>i.str).join(" ");
    st.pageTextCache[p] = t;
    return t;
  }

  // ---- search
  async function runSearch(){
    st.query = clean(els.search.value);
    els.results.innerHTML = ""; st.hits=[]; st.hitIdx=-1;

    if (!st.query){ setStatus(""); await renderPage(st.page); return; }
    if (!st.pdf){ setStatus("Open a PDF first.", true); return; }

    setStatus("Searching…");
    const needle = st.query.toLowerCase();
    for (let p=1; p<=st.total && st.hits.length<150; p++){
      const t = (await getPageText(p)).toLowerCase();
      let from=0, pos;
      while ((pos = t.indexOf(needle, from)) !== -1){
        // we don’t need exact char offsets for now, just collect page + snippet
        st.hits.push({page:p});
        from = pos + needle.length;
      }
      await new Promise(r=>setTimeout(r,0));
    }

    if (!st.hits.length){ setStatus("No matches."); await renderPage(st.page); return; }

    // right pane list
    const frag = document.createDocumentFragment();
    for (const [i,h] of st.hits.entries()){
      const div = document.createElement("div");
      div.className = "result";
      div.textContent = `p.${h.page}`;
      div.addEventListener("click", ()=>gotoHit(i));
      frag.appendChild(div);
    }
    els.results.appendChild(frag);
    st.hitIdx = 0;
    await gotoHit(0);
    setStatus(`Found ${st.hits.length} match(es).`);
  }

  async function gotoHit(i){
    if (!st.hits[i]) return;
    st.hitIdx = i;
    await renderPage(st.hits[i].page); // will draw highlights for current st.query
    // side selection/auto-scroll
    const rows = els.results.querySelectorAll(".result");
    rows.forEach(n=>n.classList.remove("active"));
    const row = rows[i];
    if (row){ row.classList.add("active"); row.scrollIntoView({block:"nearest"}); }
  }

  function prevNext(step){
    // if searching, move hit; else page
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

  // ---- events
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

    els.search.addEventListener("keydown", e=>{ if (e.key==="Enter") runSearch(); });

    els.prev.addEventListener("click", ()=>prevNext(-1));
    els.next.addEventListener("click", ()=>prevNext(1));

    window.addEventListener("keydown", e=>{
      if (e.key==="ArrowLeft") prevNext(-1);
      if (e.key==="ArrowRight") prevNext(1);
    });

    els.printBtn.addEventListener("click", ()=>window.print());
    els.exportBtn.addEventListener("click", ()=>{
      setStatus("Export to TXT only works for plain .txt books in this UI.", true);
    });

    window.addEventListener("resize", ()=>{
      if (st.pdf) renderPage(st.page);
    }, {passive:true});
  }
})();
