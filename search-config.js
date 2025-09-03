<script>
  // Force the UI to use texts.wwwbcb.org catalogs everywhere
  window.SEARCH_CFG = {
    catalogs: {
      textbooks: "https://texts.wwwbcb.org/texts/catalog.json",
      laws:      "https://texts.wwwbcb.org/laws.json",
      rules:     "https://texts.wwwbcb.org/rules.json"
    },
    // Resolve relative url_txt like "./data/..." against the texts root
    resolveUrl(u) {
      return u.startsWith("http") ? u : new URL(u, "https://texts.wwwbcb.org/").toString();
    }
  };
</script>
