/* Lightweight left drawer for cross-repo navigation */
(function (w, d) {
  const LINKS = [
    { href: 'https://info1691.github.io/rules-ui/',         label: 'Rules Repository' },
    { href: 'https://info1691.github.io/laws-ui/',          label: 'Laws Repository' },
    { href: 'https://info1691.github.io/commentary-ui/',    label: 'Commentary Viewer' },
    { href: 'https://info1691.github.io/Law-Texts-ui/',     label: 'Trust Law Textbooks' },
    { href: 'https://info1691.github.io/compliance-ui/',    label: 'Compliance – Citations' },
    { href: 'https://info1691.github.io/compliance-ui/bulk/', label: 'Citations – Bulk Upload' },
    { href: 'https://info1691.github.io/breaches-ui/',      label: 'Breaches Manager' }
  ];

  function buildDrawer() {
    let el = d.getElementById('repo-drawer');
    if (el) return el;

    el = d.createElement('aside');
    el.id = 'repo-drawer';
    el.className = 'drawer';
    el.innerHTML = `
      <div class="drawer-head">
        <span class="drawer-title">Repos</span>
        <button class="drawer-close" type="button" aria-label="Close">&times;</button>
      </div>
      <nav class="drawer-nav" role="navigation" aria-label="Repos">
        ${LINKS.map(l => `<a class="drawer-link" href="${l.href}">${l.label}</a>`).join('')}
      </nav>
      <div class="drawer-foot">Press Esc to close • Click outside to close</div>
    `;
    d.body.appendChild(el);
    return el;
  }

  function outsideClick(e, drawer, btn) {
    if (!drawer.classList.contains('open')) return;
    const within = drawer.contains(e.target) || btn.contains(e.target);
    if (!within) close(drawer);
  }

  function open(drawer, btn) {
    drawer.classList.add('open');
    d.body.classList.add('drawer-open');
    btn.setAttribute('aria-expanded', 'true');
  }

  function close(drawer, btn) {
    drawer.classList.remove('open');
    d.body.classList.remove('drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  const API = {
    init(buttonSelector) {
      const btn = d.querySelector(buttonSelector);
      if (!btn) return console.warn('RepoDrawer: button not found', buttonSelector);

      const drawer = buildDrawer();
      const closeBtn = drawer.querySelector('.drawer-close');

      // Wire events
      btn.addEventListener('click', () => {
        if (drawer.classList.contains('open')) close(drawer, btn);
        else open(drawer, btn);
      });
      closeBtn.addEventListener('click', () => close(drawer, btn));
      d.addEventListener('keydown', e => { if (e.key === 'Escape') close(drawer, btn); });
      d.addEventListener('click', e => outsideClick(e, drawer, btn));
    }
  };

  w.RepoDrawer = API;
})(window, document);
