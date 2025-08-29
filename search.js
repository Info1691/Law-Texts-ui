<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Search — Trust Law Textbooks</title>
  <link rel="icon" href="./logo.png" />
  <link rel="stylesheet" href="./style.css" />
  <style>
    /* minimal page-local polish that won't fight your theme */
    .container{max-width:1040px;margin:0 auto;padding:1.25rem}
    .hstack{display:flex;gap:.5rem;align-items:center}
    .query{flex:1;border:1px solid #d9dde7;border-radius:10px;padding:.8rem 1rem}
    .muted{opacity:.7;font-size:.9rem}
    .pill{display:inline-block;border:1px solid #d9dde7;border-radius:999px;padding:.1rem .5rem;font-size:.75rem}
    .result{background:#fff;border:1px solid #eef2f7;border-radius:12px;padding:1rem 1rem 0;margin:.75rem 0}
    .result h3{margin:.2rem 0 .4rem 0;font-size:1.05rem}
    .src{font-weight:600;opacity:.75}
    .snippet{white-space:pre-wrap;margin:.5rem 0 1rem 0}
    mark{background:#fff3a6;padding:0 .15rem;border-radius:.15rem}
    .group{margin-top:1.25rem}
    .group h2{font-size:1rem;opacity:.8;margin:.25rem 0}
    .hdr{background:#0f3b58;color:#fff;padding:.6rem 0}
    .hdr .brand{max-width:1040px;margin:0 auto;padding:0 1.25rem;font-weight:600}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="hdr"><div class="brand">Trust Law Textbooks — Search (beta)</div></div>
  <div class="container">
    <div class="hstack">
      <input id="q" class="query" type="search" placeholder="Search texts, laws & rules… (e.g. beddoe order trustee litigation consent)" />
      <button id="go" class="pill" title="Search">Search</button>
      <a class="pill" href="./index.html" title="Back to catalog">Catalog</a>
    </div>
    <div class="muted" style="margin:.5rem 0 1rem">
      Searches: Textbooks (public catalog) + Laws (laws-ui) + Rules (rules-ui). Results show a short snippet; click the title to open the full TXT.
    </div>

    <div id="status" class="muted">Loading sources…</div>

    <div id="results"></div>
  </div>

  <script src="./search.js" defer></script>
</body>
</html>
