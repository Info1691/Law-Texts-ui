// Law-Texts-ui /search.js
// Client-only, cross-repo paragraph search with quotable snippets + citations.
// Sources:
//   - Textbooks from law-index (ingest catalog -> txt urls)
//   - Laws from laws-ui/laws.json -> data/laws/.../*.txt
//   - Rules from rules-ui/rules.json -> data/rules/.../*.txt
//
// Everything is fetched lazily and cached in-memory per page load.

const byId = (id) => document.getElementById(id);

const CATALOGS = {
  textbooks: "https://info1691.github.io/law-index/catalogs/ingest-catalog.json",
  laws:      "https://info1691.github.io/laws-ui/laws.json",
  rules:     "https://info1691.github.io/rules-ui/rules.json",
};

// simple synonyms/normalization for trusty queries
const SYNONYMS = {
  trustees: ["trustee"],
  trustee:  ["trustees"],
  trusts:   ["trust"],
  trust:    ["trusts"],
  beneficiaries: ["beneficiary","beneficiaries'","beneficiary's"],
  beddoes:  ["beddoe", "beddoes"],
  litigation: ["litigate","litigating","litigated"],
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
  tokens.forEach(t=>{
    out.add(t);
    (SYNONYMS[t]||[]).forEach(s=>out.add(s));
  });
  return Array.from(out);
}

function tokenizeQuery(q){
  const raw = q.split(/\s+/).map(normToken).filter(Boolean);
  return expandTokens(raw);
}

function paraSplit(txt) {
  // Split into paragraphs; keep start line for primitive pin cites
  const lines = txt.split(/\r?\n/);
  const paras = [];
  let start = 0, buf = [];
  const flush = (i) => {
    if (!buf.length) return;
    const para = buf.join("\n").trim();
    if (para) paras.push({ text: para, startLine: i - buf.length + 1, endLine: i });
    buf = [];
  };
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (line.trim()==="") { flush(i); start = i+1; continue; }
    buf.push(line);
  }
  flush(lines.length);
  return paras;
}

function highlight(text, tokens){
  let out = text;
  tokens.forEach(t=>{
    if (!t) return;
    const re = new RegExp(`\\b(${escapeRegExp(t)})\\b`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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

function pickTop(arr, n){ return arr.slice(0, n); }

function docCardTitle(d){ return d.title || d.reference || d.id || d.txt || "Untitled"; }

function linkToTXT(d){
  // Always return the canonical TXT url
  return d.txt || d.url_txt || d.reference_url || d.href || "#";
}

// --- catalog loaders --------------------------------------------------------

async function loadTextbooks() {
  // From law-index ingest catalog
  const cat = await loadJSON(CATALOGS.textbooks);
  // items look like: { title, jurisdiction, reference, txt: "texts/uk/...", ... }
  return cat
    .filter(it => (it.kind||"").toLowerCase()==="txt" && it.txt)
    .map(it => ({
      id: it.slug || it.reference || it.title,
      source: "Textbooks",
      jurisdiction: it.jurisdiction || "",
      title: it.title || it.reference,
      txt: `https://info1691.github.io/law-index/${it.txt}`,
    }));
}

async function loadLaws() {
  // From laws-ui/laws.json → items with full TXT paths already inside repo
  const cat = await loadJSON(CATALOGS.laws);
  // items: { id, title, jurisdiction, txt }
  return cat
    .filter(it => it.txt)
    .map(it => ({
      id: it.id,
      source: "Laws",
      jurisdiction: (it.jurisdiction||"").toUpperCase(),
      title: it.title,
      txt: `https://info1691.github.io/laws-ui/${it.txt}`,
    }));
}

async function loadRules() {
  const cat = await loadJSON(CATALOGS.rules);
  return cat
    .filter(it => it.txt)
    .map(it => ({
      id: it.id,
      source: "Rules",
      jurisdiction: (it.jurisdiction||"").toUpperCase(),
      title: it.title,
      txt: `https://info1691.github.io/rules-ui/${it.txt}`,
    }));
}

// --- search core ------------------------------------------------------------

async function runSearch(query){
  const status = byId("status");
  const results = byId("results");
  results.innerHTML = "";
  status.textContent = "Loading catalogs…";

  const [texts, laws, rules] = await Promise.all([
    loadTextbooks(), loadLaws(), loadRules()
  ]);
  const allDocs = [...texts, ...laws, ...rules];

  status.textContent = `Searching ${allDocs.length} documents…`;

  const tokens = tokenizeQuery(query);
  const tokenRe = new RegExp(tokens.map(escapeRegExp).join("|"), "i");

  // Load each TXT lazily, find matching paragraphs (first 3 per doc)
  const hits = [];
  for (const d of allDocs){
    try{
      const txt = await loadTXT(linkToTXT(d));
      const paras = paraSplit(txt);
      const matches = [];
      for (const p of paras){
        if (tokenRe.test(p.text)) {
          // score: count token occurrences
          const score = tokens.reduce((acc,t)=>acc+(p.text.match(new RegExp(`\\b${escapeRegExp(t)}\\b`, "gi"))||[]).length,0);
          matches.push({ ...p, score });
        }
      }
      if (matches.length){
        hits.push({
          doc: d,
          snippets: pickTop(matches.sort((a,b)=>b.score-a.score), 3)
        });
      }
    }catch(e){
      // Ignore fetch failures but note in console
      console.warn("Fetch failed:", d, e);
    }
  }

  // Group by source
  const bySource = new Map();
  hits.forEach(h=>{
    const key = h.doc.source;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(h);
  });

  status.textContent = `Found ${hits.length} matching documents across ${bySource.size} sources.`;

  // Render
  const order = ["Textbooks","Laws","Rules"];
  order.forEach(group=>{
    const groupHits = bySource.get(group)||[];
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
          <a href="${linkToTXT(doc)}" target="_blank" rel="noopener">
            <h3>${docCardTitle(doc)}</h3>
          </a>
          ${juris}
          <span class="pill">${group}</span>
        </div>
      `;

      snippets.forEach(s=>{
        const snip = document.createElement("div");
        snip.className = "snippet";
        const short = s.text.length>700 ? s.text.slice(0,700)+"…" : s.text;
        snip.innerHTML = highlight(short, tokens);
        div.appendChild(snip);

        const cite = document.createElement("div");
        cite.className = "cite";
        cite.innerHTML =
          `<span>¶ ${s.startLine}–${s.endLine}</span>
           <a href="${linkToTXT(doc)}" target="_blank" rel="noopener">open TXT</a>`;
        div.appendChild(cite);
      });

      wrap.appendChild(div);
    });
  });

  if (!results.children.length){
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No matches across textbooks, laws, or rules.";
    results.appendChild(p);
  }
}

// --- wire up ---------------------------------------------------------------

const form = byId("form");
const qEl  = byId("q");

form.addEventListener("submit", (e)=>{
  e.preventDefault();
  const q = qEl.value.trim();
  if (!q) return;
  runSearch(q);
});

// optional: run a demo query on first load if URL has ?q=
const url = new URL(location.href);
const preset = url.searchParams.get("q");
if (preset){ qEl.value = preset; runSearch(preset); }
