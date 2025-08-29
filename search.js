// Law-Texts-ui /search.js
// Cross-repo paragraph search with inline diagnostics.
// Sources:
//   - Textbooks → law-index/catalogs/ingest-catalog.json
//   - Laws      → laws-ui/laws.json (each item must have .txt path)
//   - Rules     → rules-ui/rules.json (each item must have .txt path)

const byId = (id) => document.getElementById(id);

const CATALOGS = {
  textbooks: "https://info1691.github.io/law-index/catalogs/ingest-catalog.json",
  laws:      "https://info1691.github.io/laws-ui/laws.json",
  rules:     "https://info1691.github.io/rules-ui/rules.json",
};

// simple synonym expansion
const SYNONYMS = {
  trustees: ["trustee"],
  trustee:  ["trustees"],
  trusts:   ["trust"],
  trust:    ["trusts"],
  beneficiaries: ["beneficiary","beneficiaries'","beneficiary's"],
  beddoes:  ["beddoe", "beddoes"],
  litigation: ["litigate","litigating","litigated","litigation"],
  costs: ["cost","costs","legal costs","fees","fee"],
};

function normToken(t) {
  return t.toLowerCase()
    .replace(/[“”‘’]/g,'"')
    .replace(/[^\p{L}\p{N}\-']/gu,'')
    .trim();
}
function expandTokens(tokens){
  const out = new Set();
  tokens.forEach(t=>{ out.add(t); (SYNONYMS[t]||[]).forEach(s=>out.add(s)); });
  return Array.from(out);
}
function tokenizeQuery(q){ return expandTokens(q.split(/\s+/).map(normToken).filter(Boolean)); }

function paraSplit(txt) {
  const lines = txt.split(/\r?\n/);
  const paras = [];
  let buf = [];
  const flush = (i) => {
    if (!buf.length) return;
    const text = buf.join("\n").trim();
    if (text) paras.push({ text, startLine: i - buf.length + 1, endLine: i });
    buf = [];
  };
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (line.trim()==="") { flush(i); continue; }
    buf.push(line);
  }
  flush(lines.length);
  return paras;
}
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlight(text, tokens){
  let out = text;
  tokens.forEach(t=>{
    if (!t) return;
    const re = new RegExp(`\\b(${escapeRegExp(t)})\\b`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}
async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}
async function loadTXT(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}
const pickTop = (arr, n) => arr.slice(0, n);
const docTitle = (d) => d.title || d.reference || d.id || d.txt || "Untitled";
const txtURL  = (d) => d.txt || d.url_txt || d.reference_url || d.href || "#";

// ---------- loaders ----------
async function loadTextbooks() {
  const cat = await loadJSON(CATALOGS.textbooks);
  const items = cat
    .filter(it => (it.kind||"").toLowerCase()==="txt" && it.txt)
    .map(it => ({
      id: it.slug || it.reference || it.title,
      source: "Textbooks",
      jurisdiction: (it.jurisdiction||"").toUpperCase(),
      title: it.title || it.reference,
      txt: `https://info1691.github.io/law-index/${it.txt}`,
    }));
  return items;
}
async function loadLaws() {
  const cat = await loadJSON(CATALOGS.laws);
  const items = cat
    .filter(it => it.txt)
    .map(it => ({
      id: it.id || it.title || it.txt,
      source: "Laws",
      jurisdiction: (it.jurisdiction||"").toUpperCase(),
      title: it.title,
      txt: `https://info1691.github.io/laws-ui/${it.txt}`,
    }));
  return items;
}
async function loadRules() {
  const cat = await loadJSON(CATALOGS.rules);
  const items = cat
    .filter(it => it.txt)
    .map(it => ({
      id: it.id || it.title || it.txt,
      source: "Rules",
      jurisdiction: (it.jurisdiction||"").toUpperCase(),
      title: it.title,
      txt: `https://info1691.github.io/rules-ui/${it.txt}`,
    }));
  return items;
}

// ---------- search ----------
async function runSearch(query){
  const status = byId("status");
  const results = byId("results");
  results.innerHTML = "";
  status.textContent = "Loading catalogs…";

  let texts=[], laws=[], rules=[];
  const diag = [];
  try { texts = await loadTextbooks(); diag.push(`Textbooks: ${texts.length}`); }
  catch(e){ diag.push(`Textbooks: ERROR (${e.message})`); console.warn(e); }
  try { laws  = await loadLaws();      diag.push(`Laws: ${laws.length}`); }
  catch(e){ diag.push(`Laws: ERROR (${e.message})`); console.warn(e); }
  try { rules = await loadRules();     diag.push(`Rules: ${rules.length}`); }
  catch(e){ diag.push(`Rules: ERROR (${e.message})`); console.warn(e); }

  status.textContent = `Loaded → ${diag.join(" · ")}`;

  const allDocs = [...texts, ...laws, ...rules];
  if (!allDocs.length){
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No catalogs loaded — check the three JSON endpoints.";
    results.appendChild(p);
    return;
  }

  const tokens = tokenizeQuery(query);
  const tokenRe = new RegExp(tokens.map(escapeRegExp).join("|"), "i");

  const hits = [];
  const fail = [];
  for (const d of allDocs){
    try{
      const txt = await loadTXT(txtURL(d));
      const paras = paraSplit(txt);
      const matches = [];
      for (const p of paras){
        if (tokenRe.test(p.text)) {
          const score = tokens.reduce((acc,t)=>acc+(p.text.match(new RegExp(`\\b${escapeRegExp(t)}\\b`, "gi"))||[]).length,0);
          matches.push({ ...p, score });
        }
      }
      if (matches.length){
        hits.push({ doc: d, snippets: pickTop(matches.sort((a,b)=>b.score-a.score), 3) });
      }
    }catch(e){
      fail.push(`${d.source}:${docTitle(d)} (${e.message})`);
      console.warn("Fetch failed:", d, e);
    }
  }

  if (fail.length){
    const warn = document.createElement("div");
    warn.className = "source-note";
    warn.style.color = "#b45309";
    warn.textContent = `Skipped ${fail.length} file(s) due to fetch errors (see console).`;
    results.appendChild(warn);
  }

  const bySource = new Map();
  hits.forEach(h=>{ const k=h.doc.source; if(!bySource.has(k)) bySource.set(k,[]); bySource.get(k).push(h); });

  const order = ["Textbooks","Laws","Rules"];
  order.forEach(group=>{
    const groupHits = (bySource.get(group)||[]).sort((a,b)=>docTitle(a.doc).localeCompare(docTitle(b.doc)));
    if (!groupHits.length) return;

    const wrap = document.createElement("section");
    wrap.className = "group";
    wrap.innerHTML = `<h2>${group}</h2>`;
    results.appendChild(wrap);

    groupHits.forEach(({doc, snippets})=>{
      const div = document.createElement("div");
      div.className = "hit";
      const juris = doc.jurisdiction ? `<span class="pill">${doc.jurisdiction}</span>` : "";
      div.innerHTML = `
        <div class="docline">
          <a href="${txtURL(doc)}" target="_blank" rel="noopener"><h3>${docTitle(doc)}</h3></a>
          ${juris}<span class="pill">${group}</span>
        </div>`;
      snippets.forEach(s=>{
        const snip = document.createElement("div");
        snip.className = "snippet";
        const short = s.text.length>700 ? s.text.slice(0,700)+"…" : s.text;
        snip.innerHTML = highlight(short, tokens);
        div.appendChild(snip);

        const cite = document.createElement("div");
        cite.className = "cite";
        cite.innerHTML = `<span>¶ ${s.startLine}–${s.endLine}</span>
                          <a href="${txtURL(doc)}" target="_blank" rel="noopener">open TXT</a>`;
        div.appendChild(cite);
      });
      wrap.appendChild(div);
    });
  });

  if (!results.querySelector(".group")){
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No paragraph matches in textbooks, laws, or rules for this query.";
    results.appendChild(p);
  }
}

// wire up
const form = byId("form");
const qEl  = byId("q");
form.addEventListener("submit", (e)=>{ e.preventDefault(); const q=qEl.value.trim(); if(q) runSearch(q); });
const preset = new URL(location.href).searchParams.get("q"); if (preset){ qEl.value=preset; runSearch(preset); }
