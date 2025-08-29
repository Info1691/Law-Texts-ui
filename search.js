/* Cross-repo search (beta)
 * Sources:
 *  - Texts:   law-index public ingest catalog (provides url_txt for each book)
 *  - Laws:    laws-ui/laws.json -> url_txt
 *  - Rules:   rules-ui/rules.json -> url_txt
 *
 * Light, client-only scoring + snippet extraction with small synonym expansion.
 */

/*** CONFIG ***/
const TEXTS_CATALOG =
  "https://info1691.github.io/law-index/catalogs/ingest-catalog.json";
const LAWS_LIST =
  "https://info1691.github.io/laws-ui/laws.json";
const RULES_LIST =
  "https://info1691.github.io/rules-ui/rules.json";

// Cap how much text we fetch & scan per document (keeps it snappy in-browser)
const MAX_CHARS = 200_000;

/*** UTIL ***/
const $ = (sel) => document.querySelector(sel);
const escapeHTML = (s) =>
  s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Basic fetch with small retry
async function get(url, as = "json") {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { mode: "cors", redirect: "follow" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return as === "text" ? res.text() : res.json();
    } catch (e) {
      if (i === 1) throw e;
      await sleep(250);
    }
  }
}

/*** QUERY NORMALISATION & EXPANSION ***/
// Tiny synonym map for early probes; you can grow this safely over time.
const SYN = {
  trustee: ["trustees", "trustee’s", "trustee's"],
  trustees: ["trustee", "trustee’s", "trustee's"],
  beneficiary: ["beneficiaries", "beneficiary’s", "beneficiary's"],
  beneficiaries: ["beneficiary"],
  beddoe: ["beddoes", "beddoe’s", "beddoe's"],
  beddoes: ["beddoe", "beddoe’s", "beddoe's"],
  consent: ["consent", "approval", "assent", "sanction", "authorisation", "authorization"],
  litigation: ["litigation", "proceedings", "lawsuit", "action"],
  counsel: ["counsel", "qc", "kc", "silk", "senior counsel"],
  costs: ["costs", "expenses", "costs of the action", "legal costs"],
};

function normalise(s) {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandQuery(q) {
  const tokens = normalise(q).split(" ").filter(Boolean);
  const bag = new Set(tokens);
  for (const t of tokens) {
    const xs = SYN[t];
    if (xs) xs.forEach((x) => bag.add(x));
  }
  return Array.from(bag);
}

/*** CORPUS LOADING ***/
const corpus = []; // {title, href, source: 'texts'|'laws'|'rules', body?}
const cacheText = new Map();

async function ensureCorpusLoaded() {
  if (corpus.length) return;

  // 1) TEXTS from the public ingest catalog
  try {
    const items = await get(TEXTS_CATALOG, "json");
    for (const it of items) {
      if (!it.url_txt) continue;
      corpus.push({
        title: it.title || it.reference || it.id || "Untitled",
        href: absolutise(it.url_txt),
        source: "texts",
      });
    }
  } catch (e) {
    console.warn("Texts catalog load failed:", e);
  }

  // 2) LAWS
  try {
    const items = await get(LAWS_LIST, "json");
    for (const it of items) {
      if (!it.url_txt) continue;
      corpus.push({
        title: it.title,
        href: absolutise(it.url_txt, "laws"),
        source: "laws",
      });
    }
  } catch (e) {
    console.warn("Laws list load failed:", e);
  }

  // 3) RULES
  try {
    const items = await get(RULES_LIST, "json");
    for (const it of items) {
      if (!it.url_txt) continue;
      corpus.push({
        title: it.title,
        href: absolutise(it.url_txt, "rules"),
        source: "rules",
      });
    }
  } catch (e) {
    console.warn("Rules list load failed:", e);
  }
}

function absolutise(href, kind) {
  if (/^https?:\/\//i.test(href)) return href;
  if (kind === "laws") return `https://info1691.github.io/laws-ui/${href.replace(/^\.\//, "")}`;
  if (kind === "rules") return `https://info1691.github.io/rules-ui/${href.replace(/^\.\//, "")}`;
  // texts are already absolute in the public catalog
  return href;
}

async function loadBody(doc) {
  if (doc.body) return doc.body;
  if (cacheText.has(doc.href)) {
    doc.body = cacheText.get(doc.href);
    return doc.body;
  }
  const t = await get(doc.href, "text");
  const clipped = t.slice(0, MAX_CHARS);
  cacheText.set(doc.href, clipped);
  doc.body = clipped;
  return clipped;
}

/*** SCORING ***/
function scoreDoc(text, tokens) {
  const hay = normalise(text);
  let score = 0;
  for (const t of tokens) {
    const rx = new RegExp(`\\b${escapeReg(t)}\\b`, "g");
    const matches = hay.match(rx);
    if (matches) score += matches.length * 10; // exact word hits
    // phrase boost for two+ words from query appearing within 12 tokens
  }
  return score;
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function makeSnippet(text, tokens, radius = 130) {
  const hay = text; // preserve original case for nicer snippets
  const nHay = normalise(hay);
  let best = 0, pos = 0;

  for (const t of tokens) {
    const rx = new RegExp(`\\b${escapeReg(t)}\\b`, "i");
    const m = nHay.match(rx);
    if (m && m.index !== undefined) {
      // choose earliest strong hit
      if (best === 0 || m.index < best) {
        best = m.index;
        pos = m.index;
      }
    }
  }
  const start = Math.max(0, pos - radius);
  const end = Math.min(hay.length, pos + radius);
  let snip = hay.slice(start, end);

  // highlight
  for (const t of tokens.sort((a,b)=>b.length-a.length)) {
    const rx = new RegExp(`\\b(${escapeReg(t)})\\b`, "gi");
    snip = snip.replace(rx, "<mark>$1</mark>");
  }

  const leftEll = start > 0 ? "…" : "";
  const rightEll = end < hay.length ? "…" : "";
  return `${leftEll}${escapeHTML(snip)}${rightEll}`;
}

/*** RENDER ***/
function render(results) {
  const byGroup = { texts: [], laws: [], rules: [] };
  for (const r of results) byGroup[r.source]?.push(r);

  const parts = [];
  for (const group of ["texts", "laws", "rules"]) {
    const items = byGroup[group];
    if (!items || !items.length) continue;
    const title = group === "texts" ? "Texts" : group === "laws" ? "Laws" : "Rules";
    parts.push(`<div class="group"><h2>${title}</h2></div>`);
    for (const r of items) {
      parts.push(`
        <div class="result">
          <div class="src">${title}</div>
          <h3><a href="${r.href}" target="_blank" rel="noopener">${escapeHTML(r.title)}</a></h3>
          <div class="snippet">${r.snippet}</div>
        </div>
      `);
    }
  }
  $("#results").innerHTML = parts.join("") || `<div class="muted">No results.</div>`;
}

/*** FLOW ***/
async function run() {
  $("#status").textContent = "Loading sources…";
  try {
    await ensureCorpusLoaded();
    $("#status").textContent = `Loaded ${corpus.length} sources. Enter a query and press Search.`;

    // prefill from ?q=
    const qp = new URLSearchParams(location.search);
    const q0 = qp.get("q");
    if (q0) { $("#q").value = q0; doSearch(); }
  } catch (e) {
    $("#status").textContent = "Failed to load sources. See console.";
    console.error(e);
  }
}

async function doSearch() {
  const q = $("#q").value.trim();
  if (!q) return;
  $("#status").textContent = "Searching…";
  const tokens = expandQuery(q);

  // fetch bodies lazily (parallel, but gently)
  await Promise.all(
    corpus.map(async (doc) => { await loadBody(doc); })
  );

  // score & take top results
  const scored = corpus.map((doc) => {
    const s = scoreDoc(doc.body, tokens);
    return s > 0 ? {
      title: doc.title,
      href: doc.href,
      source: doc.source,
      score: s,
      snippet: makeSnippet(doc.body, tokens),
    } : null;
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);

  $("#status").textContent = `${scored.length} hit(s).`;
  render(scored.slice(0, 60));
}

/*** EVENTS ***/
$("#go").addEventListener("click", doSearch);
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

run();
