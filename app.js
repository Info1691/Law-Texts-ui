(() => {
  const BASE = window.LAW_INDEX_BASE;
  const SRC  = window.CATALOG_SRC;

  const elCatalog = document.getElementById('catalog');
  const elStatus  = document.getElementById('status');

  function pill(text){ const s=document.createElement('span'); s.className='pill'; s.textContent=text; return s; }

  function row(btns){
    const r=document.createElement('div'); r.className='row';
    btns.forEach(b=>r.appendChild(b)); return r;
  }

  function button(label, href){
    const a=document.createElement('a');
    a.className='btn'; a.textContent=label; a.href=href; a.target='_blank'; a.rel='noopener';
    return a;
  }

  function normalize(items){
    // accept either {txt:"texts/…"} or {url_txt:"https://…"}
    return (Array.isArray(items)?items:[])
      .filter(x => x && (x.txt || x.url_txt))
      .map(x => ({
        title: x.title || x.reference || x.slug || x.id || 'Untitled',
        reference: x.reference || '',
        jurisdiction: (x.jurisdiction || '').toUpperCase(),
        year: x.year || '',
        txt: x.url_txt || (BASE + (x.txt || ''))
      }));
  }

  async function load(){
    try{
      elStatus.textContent = `Source: ${SRC}`;
      const res = await fetch(SRC, { cache: 'no-store' });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = normalize(data);

      elCatalog.innerHTML = '';
      items.forEach(item => {
        const card = document.createElement('div'); card.className='card';

        const h = document.createElement('div'); h.className='title'; h.textContent = item.title;
        const meta = document.createElement('div'); meta.className='muted';
        meta.textContent = [item.jurisdiction, item.year, item.reference].filter(Boolean).join(' · ');

        const actions = row([ button('TXT', item.txt) ]);

        card.appendChild(h);
        card.appendChild(meta);
        card.appendChild(actions);
        elCatalog.appendChild(card);
      });

      const count = items.length;
      const c = document.createElement('div');
      c.className='muted';
      c.style.marginTop = '8px';
      c.textContent = `Loaded ${count} item(s).`;
      elCatalog.appendChild(c);
    }catch(err){
      elCatalog.innerHTML = '';
      const e = document.createElement('div'); e.className='card';
      e.innerHTML = `<div class="title">Load error</div>
                     <div class="muted">Failed to read ${SRC} — ${err.message}</div>`;
      elCatalog.appendChild(e);
    }
  }

  load();
})();
