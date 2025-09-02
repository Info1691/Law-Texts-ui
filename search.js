// --- configuration -----------------------------------------------------------
const CATALOGS = {
  // Textbooks: public catalog you already publish from the ingest pipeline
  textbooks: "https://info1691.github.io/law-index/catalogs/ingest-catalog.json",

  // Laws & Rules catalogs served by the Law-Texts-ui site (these files below)
  laws:  location.origin + "/laws.json",
  rules: location.origin + "/rules.json",
};

// --- helpers ----------------------------------------------------------------
const $ = sel => document.querySelector(sel);
const enc = u => encodeURI(u);
const html = s => s.replace(/[&<>]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
const hilite = (txt, q) => {
  if (!q) return html(txt);
  const rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + ")", "ig");
  return html(txt).replace(rx, "<mark>$1</mark>");
};

function snippetAround(text, idx, win){
  const start = Math.max(0, idx - Math.floor(win/2));
  const end   = Math.min(text.length, start + win);
  const pre = start>0 ? "…" : "";
  const post = end<text.length ? "…" : "";
  return pre + text.slice(start,end) + post;
}

async function getJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error(`Fetch failed: ${url} — ${r.status} ${r.statusText}`);
  return r.json();
}
async function getTXT(url){
  const r = await fetch(enc(url), { cache: "no-store" });
  if(!r.ok) throw new Error(`Fetch failed: ${url} — ${r.status} ${r.statusText}`);
  return r.text();
}

function renderCard(container, rec, snips, kind){
  const div = document.createElement("div");
  div.className = "card";
  const meta = `${rec.jurisdiction?.toUpperCase?.() || ""} ${rec.year? "· "+rec.year:""}`.trim();
  div.innerHTML = `
    <div class="title">${html(rec.title || "(untitled)")}</div>
    <div class="meta">${html(meta)}</div>
    ${snips.map(s=>`<span class="snip">${s}</span>`).join("")}
    <a class="btn-txt" href="${enc(rec.url_txt)}" target="_blank" rel="noopener">open TXT</a>
  `;
  container.appendChild(div);
}

function renderError(container, msg){
  const pre = document.createElement("pre");
  pre.className = "error";
  pre.textContent = msg;
  container.appendChild(pre);
}

// --- main search -------------------------------------------------------------
async function searchAll(query, orMode, win, maxSnips){
  const counts = { textbooks:0, laws:0, rules:0 };

  // Load catalogs (and show any errors inline)
  const cats = {};
  for(const [k, url] of Object.entries(CATALOGS)){
    try{
      cats[k] = await getJSON(url);
    }catch(e){
      // show catalog error clearly in the section
      renderError($("#"+k), `Catalog error: ${e.message}`);
      cats[k] = []; // continue with others
    }
  }

  // Helper to process one catalog list
  async function process(list, targetEl){
    const results = [];
    for(const rec of list){
      if(!rec?.url_txt) continue;
      try{
        const txt = await getTXT(rec.url_txt);
        const hay = txt.toLowerCase();
        const qs = orMode? query.split(/\s+/).filter(Boolean) : [query];
        let found = false, snippets = [];
        for(const term of qs){
          if(!term) continue;
          let pos = 0, hits=0;
          while((pos = hay.indexOf(term.toLowerCase(), pos)) !== -1){
            snippets.push(hilite(snippetAround(txt, pos, win), term));
            pos += term.length;
            hits++;
            if(snippets.length >= maxSnips) break;
          }
          if(hits>0) found = true;
          if(snippets.length >= maxSnips) break;
        }
        if(found){
          results.push({ rec, snippets });
        }
      }catch(e){
        // show one-line fetch error for this file
        renderError(targetEl, e.message);
      }
    }
    results.forEach(r => renderCard(targetEl, r.rec, r.snippets));
    return results.length;
  }

  counts.textbooks = await process(cats.textbooks || [], $("#textbooks"));
  counts.laws      = await process(cats.laws      || [], $("#laws"));
  counts.rules     = await process(cats.rules     || [], $("#rules"));

  $("#counts").textContent = `Matches — Textbooks: ${counts.textbooks} · Laws: ${counts.laws} · Rules: ${counts.rules}`;
}

// --- boot --------------------------------------------------------------------
(async function init(){
  // keep query in the box (no clearing)
  const params = new URLSearchParams(location.search);
  const q0 = params.get("q") || "";
  $("#q").value = q0;

  const run = () => {
    const q = $("#q").value.trim();
    const orMode = $("#ormode").checked;
    const win = Math.max(60, parseInt($("#win").value||"240",10));
    const snips = Math.max(1, parseInt($("#snips").value||"6",10));

    // clear old
    $("#textbooks").innerHTML = "";
    $("#laws").innerHTML = "";
    $("#rules").innerHTML = "";
    $("#counts").textContent = "Searching…";

    // push state (so reloads/bookmarks work)
    const u = new URL(location.href);
    if(q) u.searchParams.set("q", q); else u.searchParams.delete("q");
    history.replaceState({}, "", u);

    if(!q){ $("#counts").textContent = "Enter a term."; return; }
    searchAll(q, orMode, win, snips).catch(err=>{
      $("#counts").textContent = "Error.";
      renderError($("#textbooks"), err.message);
    });
  };

  $("#go").addEventListener("click", run);
  $("#q").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); run(); } });

  // auto-run if ?q= present
  if(q0) $("#go").click();
})();
