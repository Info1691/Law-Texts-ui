/* Forensic search (reads the index Agent-2 writes to law-index) */
const INDEX_URL = "https://info1691.github.io/law-index/forensics/index.json";

const elQ   = document.getElementById("q");
const elJur = document.getElementById("jur");
const elGo  = document.getElementById("go");
const elRes = document.getElementById("results");
const elStatus = document.getElementById("status");

let INDEX = [];

// very light normalizer: lowercase, strip punctuation, simple plural trim
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ") // drop punctuation
    .replace(/\s+/g, " ")
    .trim();
}
function stem(token) {
  // naive stemming for s/es
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.endsWith("es"))  return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

// small synonym map for early usefulness
const SYN = {
  trustee: ["trustee","trustees","trusteeship","fiduciary"],
  film: ["film","movie","motion","picture","production","feature"],
  producer: ["producer","production","producing"],
  money: ["money","funds","assets","property","trust property","trust funds"],
  breach: ["breach","wrong","misfeasance","malfeasance","dishonesty","default"]
};

function expandTerms(terms) {
  const out = new Set();
  for (const t of terms) {
    out.add(t);
    // synonyms
    for (const [key, arr] of Object.entries(SYN)) {
      if (t === key || arr.includes(t)) arr.forEach(v => out.add(v));
    }
  }
  return [...out];
}

function tokenize(s) {
  return norm(s).split(" ").filter(Boolean).map(stem);
}

function scoreDoc(doc, qTerms, jur) {
  if (jur && (doc.jurisdiction || "").toLowerCase() !== jur) return 0;

  // fields to search
  const hay = [
    doc.title || "",
    doc.reference || "",
    (doc.jurisdiction || ""),
    (doc.keywords || []).join(" ")
  ].map(norm).join(" ");

  let score = 0;
  for (const t of qTerms) {
    // exact term
    if (hay.includes(` ${t} `) || hay.endsWith(` ${t}`) || hay.startsWith(`${t} `) ) score += 5;
    // loose containment
    if (hay.includes(t)) score += 2;
  }
  // small boost for newer material
  if (Number(doc.year) >= 2020) score += 1;

  return score;
}

function render(results, ms) {
  elRes.innerHTML = "";
  elStatus.textContent = `${results.length} result${results.length!==1?'s':''} • ${ms} ms`;

  if (!results.length) {
    elRes.innerHTML = `<div class="empty">No results. Try different terms or fewer filters.</div>`;
    return;
    }

  for (const r of results) {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <h3><a href="${r.url_txt}" target="_blank" rel="noopener">${r.title || r.reference || r.id}</a></h3>
      <div class="meta">${(r.jurisdiction || "").toUpperCase()} • ${r.reference || ""} ${r.year?("• "+r.year):""}</div>
      <div class="badges">${(r.keywords||[]).slice(0,6).map(k=>`<span class="badge">${k}</span>`).join("")}</div>
    `;
    elRes.appendChild(div);
  }
}

async function loadIndex() {
  try {
    const r = await fetch(INDEX_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Fetch ${r.status}`);
    INDEX = await r.json();
  } catch (e) {
    elStatus.textContent = "Failed to load index.";
    console.error(e);
  }
}

async function search() {
  const t0 = performance.now();
  const q = elQ.value.trim();
  const jur = (elJur.value || "").toLowerCase();

  if (!q) { render([], 0); return; }

  const baseTerms = tokenize(q);
  const terms = expandTerms(baseTerms);

  // score + sort
  const scored = INDEX
    .map(d => ({ d, s: scoreDoc(d, terms, jur)}))
    .filter(x => x.s > 0)
    .sort((a,b) => b.s - a.s)
    .map(x => x.d)
    .slice(0, 100);

  render(scored, Math.round(performance.now() - t0));
}

elGo.addEventListener("click", search);
elQ.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

loadIndex().then(()=> {
  // Optional: pre-fill a demo query for first run
  // elQ.value = "trustee film producer client money";
  // search();
});
