// ==UserScript==
// @name         Mijn vulcheck
// @namespace    olivier.vulcheck
// @version      0.2.0
// @description  Bewaar bekeken Jumbo-producten in een lokale dagelijkse checklist.
// @match        https://product.jumbo.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  const VERSION = 1;
  const KEY = 'ov.vulcheck.v1';
  const fields = new Set(['ArticleNumber', 'Description', 'NetContent', 'ContentUnit',
    'PresentationGroupDescription', 'EanNumber', 'UnitFullName', 'ColloInhoud',
    'Producten.Unit_Article_Selected', 'Producten.Unit_Article', 'Producten.EanNumber_Article']);
  const value = x => x && typeof x === 'object' ? x.value : undefined;
  const str = (x, max = 200) => typeof x === 'string' ? x.slice(0, max) : '';
  function day(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function validDay(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  }
  function parseProduct(p) {
    if (!p || typeof p !== 'object' || !/^\d{1,20}$/.test(p.article || '') ||
        typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.eans)) throw Error('Ongeldig product');
    if (p.eans.length > 30 || p.eans.some(e => typeof e !== 'string' || !/^\d{8,14}$/.test(e))) throw Error('Ongeldige barcode');
    return { article: p.article, name: str(p.name), size: str(p.size, 60), category: str(p.category, 100),
      eans: [...new Set(p.eans)], pack: str(p.pack, 30) };
  }
  function parseBackup(data) {
    if (!data || data.version !== VERSION || !Array.isArray(data.entries) || data.entries.length > 10000) {
      throw Error('Dit is geen ondersteunde Mijn vulcheck-back-up.');
    }
    const seen = new Set();
    return data.entries.map(e => {
      const product = parseProduct(e.product);
      if (!validDay(e.day) || typeof e.done !== 'boolean' || typeof e.note !== 'string' || e.note.length > 1000 ||
          typeof e.added !== 'string' || !Number.isFinite(Date.parse(e.added))) throw Error('Ongeldige checklistregel.');
      const id = `${e.day}:${product.article}`;
      if (seen.has(id)) throw Error('Dubbele checklistregel.');
      seen.add(id);
      return { id, day: e.day, product, done: e.done, note: e.note, added: e.added };
    });
  }
  function addEntry(entries, product, date = new Date()) {
    const p = parseProduct(product), dateKey = day(date), id = `${dateKey}:${p.article}`;
    if (entries.some(e => e.id === id)) return entries;
    return [...entries, { id, day: dateKey, product: p, done: false, note: '', added: date.toISOString() }];
  }
  function mergeEntries(existing, incoming) {
    const ids = new Set(existing.map(e => e.id));
    return [...existing, ...incoming.filter(e => !ids.has(e.id))];
  }
  // Read rendered product details as well as network data: Safari can inject after
  // the initial responses, or run the script in a separate JavaScript world.
  function isProductPage(url) {
    try { const parsed = new URL(url); return /\/artikel\/[^/?#]+/i.test(parsed.pathname + parsed.hash); }
    catch { return false; }
  }
  function productFromText(text, headings = [], url = '') {
    const lines = text.split(/[\r\n\t]+/).map(s => s.trim()).filter(Boolean);
    const articleLabel = /^(?:artikel\s*(?:nummer|nr\.?|no\.?)?|article\s*(?:number|no\.?)|art\.?\s*nr\.?)\s*:?\s*(\d{1,20})?\s*$/i;
    const index = lines.findIndex(line => articleLabel.test(line));
    // Jumbo's detail screen has an unlabelled number above the product name.
    // Use this layout only on an article route, never on a search-results page.
    const detailsIndex = lines.findIndex(line => /^(?:eigenschappen|beschikbaarheid)$/i.test(line));
    const header = detailsIndex < 0 ? lines : lines.slice(0, detailsIndex);
    const numberIndex = isProductPage(url) ? header.findIndex(line => /^\d{4,10}$/.test(line)) : -1;
    const article = index >= 0 ? lines[index].match(articleLabel)[1] || lines[index + 1] : header[numberIndex];
    if (!/^\d{1,20}$/.test(article || '')) return null;
    function labelled(label) {
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(label);
        if (match) return (match[1] || lines[i + 1] || '').trim();
      }
      return '';
    }
    const generic = /^(?:jumbo|producten?|product(?:informatie|details|gegevens)|artikel(?:informatie|details|gegevens)?|details|informatie|zoeken|home|inloggen|welkom|barcodes?|voorraad|logistiek|eigenschappen|beschikbaarheid|locatie|melding maken)$/i;
    const names = [...new Set(headings.map(s => s.trim()).filter(s => s && !generic.test(s) && !/^\d+$/.test(s)))];
    const layoutName = numberIndex >= 0 ? header[numberIndex + 1] || '' : '';
    const name = labelled(/^(?:productnaam|artikelomschrijving|omschrijving|description)\s*:\s*(.*)$/i) ||
      labelled(/^(?:productnaam|artikelomschrijving|omschrijving|description)\s*$/i) ||
      (names.length === 1 ? names[0] : '') ||
      (/[a-zÀ-ÿ]/i.test(layoutName) && !generic.test(layoutName) ? layoutName : '');
    if (!name || articleLabel.test(name)) return null;
    const ean = labelled(/^(?:ean(?:\s*(?:nummer|code))?|barcode)\s*:?\s*(\d{8,14})?\s*$/i);
    return parseProduct({ article, name,
      size: labelled(/^(?:netto[- ]?inhoud|inhoud)\s*:\s*(.*)$/i) ||
        (numberIndex >= 0 ? header.slice(numberIndex + 2).find(line => /^\d[\d.,]*\s*(?:GR|G|KG|ML|CL|L|ST|STUKS?)\b/i.test(line)) || '' : ''),
      category: labelled(/^(?:presentatiegroep|categorie|locatie)\s*:\s*(.*)$/i) || labelled(/^locatie$/i),
      pack: labelled(/^collo[- ]?inhoud\s*:?\s*(.*)$/i),
      eans: /^\d{8,14}$/.test(ean) ? [ean] : [] });
  }
  function readPageProduct(doc) {
    const visible = element => !element.closest('#ov-vulcheck, [hidden], [aria-hidden="true"]') &&
      element.getClientRects().length > 0;
    // Limit extraction to the visible page. Never read search inputs or hidden
    // runtime objects, which may belong to another product.
    const headings = [...doc.querySelectorAll('h1, h2, h3, [role="heading"], [itemprop="name"]')]
      .filter(visible).map(el => el.innerText || el.textContent || '');
    return productFromText(doc.body?.innerText || '', headings, location.href);
  }
  function createDecoder() {
    const cache = new Map();
    let selected = null;
    function ingest(data, allowSingle = false) {
      if (!data || typeof data !== 'object') return null;
      // Retain only product fields, never accounts, cookies, session objects or hashes.
      function merge(id, attrs, type) {
        const clean = {};
        for (const [key, field] of Object.entries(attrs || {})) {
          if (fields.has(key)) clean[key] = value(field);
        }
        if (!Object.keys(clean).length && !type) return;
        cache.set(id, { ...(cache.get(id) || {}), ...clean, ...(type ? { type } : {}) });
      }
      for (const o of data.objects || []) {
        if (/^Producten\.(Article|Unit|EanNumber)$/.test(o.objectType)) merge(o.guid, o.attributes, o.objectType);
      }
      for (const [id, attrs] of Object.entries(data.changes || {})) merge(id, attrs);
      for (const id of data.deletes || []) cache.delete(id);
      let opened = null;
      for (const ins of data.instructions || []) {
        const args = ins.args || {};
        if (ins.type === 'open_form' && args.FormParameters?.$Article) opened = args.FormParameters.$Article;
        else if (ins.type === 'open_form' && /Producten_Home/.test(args.FormPath || '')) selected = null;
      }
      if (opened) selected = opened;
      if (!selected && allowSingle) {
        const articles = [...cache].filter(([, x]) => /^\d+$/.test(x.ArticleNumber || ''));
        if (articles.length === 1) selected = articles[0][0];
      }
      const article = cache.get(selected);
      const unit = article && cache.get(article['Producten.Unit_Article_Selected']);
      let result = null;
      if (article?.ArticleNumber && unit?.Description) {
        const eans = [...cache.values()].filter(x => x['Producten.EanNumber_Article'] === selected)
          .map(x => x.EanNumber).filter(x => typeof x === 'string' && /^\d{8,14}$/.test(x));
        if (typeof unit.EanNumber === 'string' && /^\d{8,14}$/.test(unit.EanNumber)) eans.unshift(unit.EanNumber);
        result = parseProduct({ article: article.ArticleNumber, name: unit.Description,
          size: [unit.NetContent, unit.ContentUnit].filter(Boolean).join(' '),
          category: article.PresentationGroupDescription || '', eans,
          pack: unit.ColloInhoud || '' });
      }
      // A shift may contain many searches; old runtime objects are not a persistent catalogue.
      if (cache.size > 1500) { cache.clear(); selected = null; }
      return result;
    }
    return { ingest, reset() { cache.clear(); selected = null; } };
  }
  const core = { day, parseProduct, parseBackup, addEntry, mergeEntries, createDecoder, productFromText, isProductPage };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (window.top !== window.self || window.__ovVulcheck) return;
  window.__ovVulcheck = true;

  const decoder = createDecoder();
  let current = null, generation = 0, entries = [], storageBroken = false;
  let render = () => {}, notify = () => {}, requestsSeen = 0;
  let pageProduct = null, pageUrl = location.href, staleArticle = null;
  function refreshPage() {
    if (pageUrl !== location.href) {
      staleArticle = pageProduct?.article || current?.article || null;
      pageUrl = location.href;
      generation++; decoder.reset(); current = null;
    }
    pageProduct = readPageProduct(document);
    if (pageProduct?.article === staleArticle) pageProduct = null;
    else if (pageProduct) staleArticle = null;
  }
  function activeProduct() {
    if (!isProductPage(location.href)) return null;
    if (pageProduct) {
      return current?.article === pageProduct.article ? { ...current, ...pageProduct,
        eans: pageProduct.eans.length ? pageProduct.eans : current.eans } : pageProduct;
    }
    return current;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      entries = raw ? parseBackup(JSON.parse(raw)) : [];
      storageBroken = false;
    } catch { storageBroken = true; }
  }
  load();
  function save(next) {
    if (storageBroken) { notify('Opslag niet leesbaar. Bestaande gegevens worden niet overschreven.'); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: VERSION, entries: next }));
      entries = next;
      return true;
    } catch { notify('Opslaan mislukt. Maak ruimte vrij of controleer Safari-opslag.'); return false; }
  }
  function isXas(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin && /^\/xas\/?$/.test(u.pathname); }
    catch { return false; }
  }
  function begin(body) {
    let request;
    try { request = typeof body === 'string' ? JSON.parse(body) : null; } catch { /* non-JSON request */ }
    const search = Object.values(request?.changes || {}).some(o =>
      ['SearchString', 'ScanString'].some(k => typeof o.members?.[k]?.value === 'string' && o.members[k].value.trim()));
    const bootstrap = request?.action === 'get_session_data';
    if (search || bootstrap) { generation++; decoder.reset(); current = null; render(); }
    return { generation, bootstrap: bootstrap && /\/artikel\//.test(request?.params?.referrer || '') };
  }
  function receive(data, context) {
    if (context.generation !== generation) return;
    try { requestsSeen++; current = decoder.ingest(data, context.bootstrap); render(); }
    catch { current = null; render(); }
  }
  // Observe copies of existing responses. Never modify payloads or initiate Jumbo requests.
  const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
  const xhrMeta = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const result = originalOpen.call(this, method, url, ...rest);
    xhrMeta.set(this, { watch: isXas(url) });
    return result;
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (xhrMeta.get(this)?.watch) {
      const context = begin(body);
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;
        try { receive(this.responseType === 'json' ? this.response : JSON.parse(this.responseText), context); }
        catch { /* Ignore HTML login pages and other non-JSON responses. */ }
      }, { once: true });
    }
    return originalSend.call(this, body);
  };
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const watch = isXas(typeof input === 'string' || input instanceof URL ? input : input.url);
      // Mendix normally uses a string body. A Request body is copied without consuming the original.
      const context = watch ? (init?.body !== undefined ? Promise.resolve(begin(init.body)) :
        input instanceof Request ? input.clone().text().then(begin).catch(() => begin(null)) : Promise.resolve(begin(null))) : null;
      const pending = originalFetch.apply(this, arguments);
      if (watch) pending.then(response => {
        if (response.ok) { const copy = response.clone(); Promise.all([copy.json(), context]).then(([data, ctx]) => receive(data, ctx)).catch(() => {}); }
      }).catch(() => {});
      return pending;
    };
  }

  function mount() {
    const host = document.createElement('div');
    host.id = 'ov-vulcheck';
    host.style.cssText = 'position:fixed;z-index:2147483646;bottom:0;right:0;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182c29;font-size:16px;line-height:1.45;color-scheme:light}
      *{box-sizing:border-box} button,input,textarea,select{font:inherit}button{cursor:pointer;touch-action:manipulation}
      button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #a76a13;outline-offset:3px}
      button{border:0;border-radius:12px;padding:12px 15px;min-height:44px;background:#e8ede8;color:#182c29;font-weight:650}
      button:disabled{opacity:.5;cursor:default}.primary{background:#194f42;color:white}.quiet{background:transparent}.danger{color:#9a3434}
      .launch{pointer-events:auto;margin:12px 12px calc(12px + env(safe-area-inset-bottom));box-shadow:0 4px 24px #0003;background:#194f42;color:white;border:1px solid #ffffff55;border-radius:30px}
      [hidden]{display:none!important}.save-product{pointer-events:auto;position:fixed;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);min-height:48px;padding:10px 14px;margin:0;background:#fff;color:#194f42;border:2px solid #194f42;border-radius:14px;box-shadow:0 4px 20px #0002;font-weight:650;cursor:pointer}.save-product input{width:24px;height:24px;min-width:24px;margin:0;padding:0;accent-color:#194f42}.save-product:has(input:checked){background:#e7efe4}
      dialog{pointer-events:auto;position:fixed;inset:0 0 0 auto;width:min(100%,460px);height:100%;height:100dvh;max-height:100%;max-width:100%;margin:0;border:0;padding:0;background:#f7f8f3;color:#182c29;box-shadow:-8px 0 50px #0002}
      dialog::backdrop{background:#14292366}.shell{height:100%;display:flex;flex-direction:column}.head{padding:20px 20px 14px;border-bottom:1px solid #dce3da;background:#fff}
      .row{display:flex;align-items:center;justify-content:space-between;gap:10px}.eyebrow{font-size:11px;letter-spacing:2px;font-weight:750;color:#65776e;text-transform:uppercase}h1{font-size:25px;margin:4px 0}h2{font-size:18px;margin:4px 0 8px}p{margin:6px 0}.sub{font-size:13px;color:#586b61}.body{overflow:auto;overscroll-behavior:contain;padding:16px 20px calc(24px + env(safe-area-inset-bottom));flex:1}
      .capture{background:#e7efe4;border:1px solid #d4e1ce;border-radius:16px;padding:16px;margin-bottom:20px}.capture button{width:100%;margin-top:10px}
      .controls{display:grid;gap:10px;margin-bottom:16px}select,input,textarea{width:100%;border:1px solid #c9d3c7;background:#fff;color:#182c29;border-radius:10px;padding:11px;font-size:16px}textarea{min-height:66px;resize:vertical}
      .card{background:#fff;border:1px solid #dce3da;border-radius:14px;padding:14px;margin:10px 0}.card.done{background:#f0f3ed}.card.done h2{text-decoration:line-through;color:#627365}.check{flex:0 0 44px;width:44px;padding:8px;font-size:20px}.card h2{font-size:16px}.chips{font-size:12px;color:#586b61;margin:8px 0;overflow-wrap:anywhere}.empty{padding:25px 10px;text-align:center;color:#586b61}.empty strong{display:block;color:#182c29;font-size:18px;margin-bottom:8px}
      details{margin-top:10px}summary{cursor:pointer;padding:8px 0;min-height:40px;font-size:13px}label{display:block;font-size:13px;margin-bottom:6px}footer{margin-top:24px;border-top:1px solid #dce3da;padding-top:16px}.backup{display:flex;gap:8px;flex-wrap:wrap}.toast{pointer-events:auto;position:fixed;bottom:calc(82px + env(safe-area-inset-bottom));right:14px;max-width:min(390px,calc(100vw - 28px));padding:14px 18px;background:#182c29;color:#fff;border-radius:12px;box-shadow:0 4px 24px #0003;font-size:14px}.status{font-size:12px;color:#586b61;margin-top:12px}.warning{color:#963d27}
    `;
    root.append(style);
    function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
    function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b; }
    const launch = button('Mijn vulcheck', () => { load(); render(); dialog.showModal(); }, 'launch');
    const quickSave = el('label', undefined, 'save-product'), quickCheck = el('input'), quickLabel = el('span');
    quickCheck.type = 'checkbox'; quickCheck.setAttribute('aria-label', 'Bewaar dit product op de lijst van vandaag');
    quickSave.append(quickCheck, quickLabel); quickSave.hidden = true;
    let displayedArticle = null;
    quickCheck.addEventListener('change', () => {
      const checked = quickCheck.checked;
      refreshPage(); load();
      const product = activeProduct();
      if (!product || product.article !== displayedArticle) {
        render(); notify('De productpagina is veranderd. Controleer het product en probeer opnieuw.'); return;
      }
      if (checked) saveProduct(product);
      else {
        if (confirm(`${product.name} uit de lijst van vandaag verwijderen?`)) {
          if (save(entries.filter(e => e.id !== `${day()}:${product.article}`))) notify('Product uit de lijst verwijderd.');
        }
        render();
      }
    });
    const dialog = el('dialog'); dialog.setAttribute('aria-label', 'Mijn vulcheck');
    const shell = el('div', undefined, 'shell'), head = el('header', undefined, 'head'), titleRow = el('div', undefined, 'row');
    const titles = el('div'); titles.append(el('div', 'Jouw dienst, jouw lijst', 'eyebrow'), el('h1', 'Mijn vulcheck'));
    titleRow.append(titles, button('Sluiten', () => dialog.close(), 'quiet'));
    head.append(titleRow, el('p', 'Bewaar nu. Controleer straks.', 'sub'));
    const body = el('div', undefined, 'body'), capture = el('section', undefined, 'capture');
    const controls = el('div', undefined, 'controls'), dateSelect = el('select'), query = el('input');
    dateSelect.setAttribute('aria-label', 'Welke dag'); query.type = 'search'; query.placeholder = 'Zoek naam, artikel of barcode'; query.setAttribute('aria-label', 'Zoek in je checklist');
    let selectedDay = day(), openOnly = false;
    const filter = button('Alle statussen', () => { openOnly = !openOnly; renderList(); });
    filter.setAttribute('aria-pressed', 'false');
    const count = el('p', '', 'sub'), list = el('div');
    dateSelect.addEventListener('change', () => { selectedDay = dateSelect.value; renderList(); });
    query.addEventListener('input', renderList);
    controls.append(dateSelect, query, filter, count);
    const footer = el('footer'), backups = el('div', undefined, 'backup'), status = el('p', '', 'status');
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    backups.append(button('Exporteer back-up', () => {
      const blob = new Blob([JSON.stringify({ version: VERSION, entries }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = `vulcheck-${day()}.json`; root.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    }), button('Importeer', () => file.click()));
    file.addEventListener('change', async () => {
      const selected = file.files[0]; file.value = ''; if (!selected) return;
      try {
        if (selected.size > 10 * 1024 * 1024) throw Error('Back-up is te groot (maximaal 10 MB).');
        const incoming = parseBackup(JSON.parse(await selected.text())); load();
        const merged = mergeEntries(entries, incoming);
        if (merged.length > 10000) throw Error('Te veel regels (maximaal 10.000).');
        const added = merged.length - entries.length;
        if (save(merged)) { render(); notify(`${added} regels toegevoegd. Bestaande regels zijn behouden.`); }
      } catch (error) { notify(error instanceof SyntaxError ? 'Dit bestand is geen geldige JSON-back-up.' : error.message); }
    });
    footer.append(backups, file, el('p', 'Alleen opgeslagen in Safari op dit toestel. Maak regelmatig een back-up: wissen van websitegegevens verwijdert ook je lijst.', 'sub'),
      el('p', 'Persoonlijk hulpmiddel · geen officiële Jumbo-functie · v0.2.0', 'sub'), status);
    body.append(capture, controls, list, footer); shell.append(head, body); dialog.append(shell);
    const toast = el('div', '', 'toast'); toast.hidden = true; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    root.append(launch, quickSave, dialog, toast); document.body.append(host);
    let toastTimer;
    notify = message => { (dialog.open ? shell : root).append(toast); toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6500); };
    function saveProduct(product) {
      load();
      if (entries.length >= 10000 && !entries.some(e => e.id === `${day()}:${product.article}`)) {
        notify('Lijst is vol. Exporteer en verwijder oude regels.'); render(); return;
      }
      if (save(addEntry(entries, product))) { selectedDay = day(); notify(`${product.name} staat op vandaag.`); }
      render();
    }
    function updateEntry(id, changes) { load(); if (save(entries.map(e => e.id === id ? { ...e, ...changes } : e))) render(); }
    function renderList() {
      filter.textContent = openOnly ? 'Alleen nog controleren' : 'Alle statussen'; filter.setAttribute('aria-pressed', String(openOnly));
      const scope = entries.filter(e => selectedDay === 'all' || e.day === selectedDay);
      count.textContent = `${scope.filter(e => !e.done).length} nog controleren · ${scope.filter(e => e.done).length} klaar`;
      const term = query.value.trim().toLocaleLowerCase('nl');
      const shown = scope.filter(e => (!openOnly || !e.done) && [e.product.name, e.product.article, ...e.product.eans, e.note].join(' ').toLocaleLowerCase('nl').includes(term))
        .sort((a, b) => Number(a.done) - Number(b.done) || b.day.localeCompare(a.day) || b.added.localeCompare(a.added));
      list.replaceChildren();
      if (!shown.length) {
        const empty = el('div', undefined, 'empty'); empty.append(el('strong', scope.length ? 'Niets in deze weergave' : 'Je lijst is nog leeg'),
          el('p', scope.length ? 'Pas je zoekopdracht of filter aan.' : 'Open een product in Jumbo en vink rechtsboven Bewaar voor vandaag aan.'));
        list.append(empty);
      }
      for (const entry of shown) {
        const p = entry.product, card = el('article', undefined, `card${entry.done ? ' done' : ''}`), row = el('div', undefined, 'row');
        const check = button(entry.done ? '✓' : '○', () => updateEntry(entry.id, { done: !entry.done }), 'check');
        check.setAttribute('aria-label', `${entry.done ? 'Markeer als nog controleren' : 'Markeer als gecontroleerd'}: ${p.name}`); check.setAttribute('aria-pressed', String(entry.done));
        const text = el('div'); text.style.flex = '1'; text.append(el('h2', p.name), el('p', [p.size, p.category].filter(Boolean).join(' · '), 'sub'));
        row.append(text, check); card.append(row, el('p', `Artikel ${p.article}${selectedDay === 'all' ? ` · ${entry.day}` : ''}`, 'chips'));
        if (entry.note) card.append(el('p', entry.note, 'sub'));
        const details = el('details'); details.append(el('summary', 'Barcodes, notitie en opties'));
        details.append(el('p', p.eans.join(' · ') || 'Geen barcode ontvangen', 'chips'));
        if (p.pack) details.append(el('p', `Collo-inhoud: ${p.pack}`, 'sub'));
        const label = el('label', 'Notitie'), note = el('textarea'); note.maxLength = 1000; note.value = entry.note; note.placeholder = 'Bijvoorbeeld: tweede kar, bovenste vak'; label.append(note); details.append(label);
        note.addEventListener('change', () => { load(); if (save(entries.map(e => e.id === entry.id ? { ...e, note: note.value } : e))) notify('Notitie opgeslagen.'); });
        if (entry.day !== day()) details.append(button('Ook op vandaag zetten', () => {
          load(); const next = addEntry(entries, p); if (save(next)) { selectedDay = day(); render(); notify('Product staat op vandaag.'); }
        }));
        details.append(button('Verwijderen', () => {
          if (confirm(`${p.name} uit de lijst van ${entry.day} verwijderen?`)) { load(); if (save(entries.filter(e => e.id !== entry.id))) render(); }
        }, 'quiet danger'));
        card.append(details); list.append(card);
      }
    }
    render = () => {
      refreshPage();
      const today = day();
      const product = activeProduct();
      const exists = product && entries.some(e => e.id === `${today}:${product.article}`);
      displayedArticle = product?.article || null;
      quickSave.hidden = !product && !/\/artikel\//i.test(location.pathname + location.hash);
      quickCheck.checked = Boolean(exists);
      quickCheck.disabled = !product || storageBroken;
      quickLabel.textContent = !product ? 'Product laden…' : exists ? 'Op je lijst vandaag' : 'Bewaar voor vandaag';
      quickSave.title = product ? `${product.name} · Artikel ${product.article}` : 'Wacht tot de productgegevens zichtbaar zijn.';
      launch.textContent = `Mijn vulcheck · ${entries.filter(e => e.day === today && !e.done).length}`;
      capture.replaceChildren(el('div', 'Huidig product', 'eyebrow'));
      if (product) {
        capture.append(el('h2', product.name), el('p', `${product.size} · Artikel ${product.article}`, 'sub'));
        const add = button(exists ? 'Staat al op vandaag ✓' : 'Bewaar voor vandaag', () => {
          refreshPage();
          const latest = activeProduct();
          if (!latest || latest.article !== product.article) { render(); notify('Open het product opnieuw.'); return; }
          saveProduct(latest);
        }, 'primary'); add.disabled = exists || storageBroken; capture.append(add);
      } else {
        capture.append(el('h2', 'Open eerst een product'), el('p', 'Scan of zoek in Jumbo en open de productdetails. Vink rechtsboven Bewaar voor vandaag aan om het product op je lijst te zetten.', 'sub'));
      }
      const dates = [...new Set([today, ...entries.map(e => e.day)])].sort().reverse();
      if (selectedDay !== 'all' && !dates.includes(selectedDay)) selectedDay = today;
      dateSelect.replaceChildren();
      for (const d of dates) { const option = el('option', d === today ? `Vandaag · ${d}` : d); option.value = d; dateSelect.append(option); }
      const all = el('option', 'Alle dagen · ook onafgeronde producten'); all.value = 'all'; dateSelect.append(all); dateSelect.value = selectedDay;
      status.textContent = storageBroken ? 'Opslag niet leesbaar; bewaren is geblokkeerd om je gegevens te beschermen.' :
        pageProduct && product ? 'Product herkend op de pagina.' :
        isProductPage(location.href) && !product ? 'Product nog niet herkend. Wacht tot de naam en het artikelnummer zichtbaar zijn. Blijft dit staan? Deel een schermafbeelding van de productpagina.' :
        requestsSeen ? `Verbinding gezien · ${requestsSeen} app-antwoorden gelezen` : 'Nog geen app-antwoorden gezien. Ververs Jumbo na installatie en zoek een product.';
      status.className = storageBroken ? 'status warning' : 'status';
      // Leave an in-progress note intact when unrelated background responses arrive.
      if (root.activeElement?.tagName !== 'TEXTAREA') renderList();
    };
    window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) { load(); render(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); render(); } });
    let scanTimer;
    let lastPage = '';
    function scanPage() {
      refreshPage();
      const signature = JSON.stringify([location.href, activeProduct(), day()]);
      if (signature !== lastPage) { lastPage = signature; render(); }
    }
    const observer = new MutationObserver(records => {
      if (records.every(record => record.target === host || host.contains(record.target))) return;
      clearTimeout(scanTimer); scanTimer = setTimeout(scanPage, 120);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    window.addEventListener('popstate', scanPage);
    window.addEventListener('hashchange', scanPage);
    // Also catch pushState routing and date changes, without patching Jumbo's router.
    setInterval(() => { if (!document.hidden) scanPage(); }, 1000);
    render();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
