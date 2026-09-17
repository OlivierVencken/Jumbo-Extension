// ==UserScript==
// @name         Mijn vulcheck
// @namespace    olivier.vulcheck
// @version      0.7.1
// @description  Bewaar Jumbo-producten en controleer FIFO voor Zuivel en VVP.
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
    const product = { article: p.article, name: str(p.name), size: str(p.size, 60), category: str(p.category, 100),
      eans: [...new Set(p.eans)], pack: str(p.pack, 30) };
    if (p.location) product.location = str(p.location, 200);
    const url = safeUrl(p.url, true), image = safeUrl(p.image);
    if (url) product.url = url;
    if (image) product.image = image;
    return product;
  }
  function safeUrl(value, product = false) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      if (product && (url.origin !== 'https://product.jumbo.com' || !isProductPage(url.href))) return '';
      return url.href;
    } catch { return ''; }
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
  const emptyFifoRow = () => ({ article: '', fifo: null, names: '' });
  function parseFifo(data, products) {
    const result = {};
    for (const category of ['zuivel', 'vvp']) {
      const rows = data === undefined ? [] : data?.[category];
      if (!Array.isArray(rows) || rows.length > 5) throw Error('Ongeldige FIFO-lijst.');
      const seen = new Set();
      result[category] = Array.from({ length: 5 }, (_, i) => {
        const row = rows[i];
        if (row === undefined) return emptyFifoRow();
        if (!row || typeof row.article !== 'string' || (row.article && !/^\d{1,20}$/.test(row.article)) ||
            ![null, true, false].includes(row.fifo) || typeof row.names !== 'string' || row.names.length > 200 ||
            (row.article && seen.has(row.article))) throw Error('Ongeldige FIFO-regel.');
        seen.add(row.article);
        return products.has(row.article) ? { article: row.article, fifo: row.fifo, names: row.names } : emptyFifoRow();
      });
    }
    return result;
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
      location: ['meter', 'plank', 'positie'].map(label => {
        const match = lines.join(' ').match(new RegExp('\\b' + label + '\\s*:?\\s*(\\d+[a-z]?)\\b', 'i'));
        return match ? label + ' ' + match[1] : '';
      }).filter(Boolean).join(', '),
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
    const product = productFromText(doc.body?.innerText || '', headings, location.href);
    if (!product) return null;
    product.url = safeUrl(location.href, true);
    const images = [...doc.querySelectorAll('main img, [role="main"] img, img')].filter(visible);
    const photo = images.find(img => img.getAttribute('itemprop') === 'image' ||
      (img.alt && img.alt.toLocaleLowerCase('nl').includes(product.name.toLocaleLowerCase('nl')))) ||
      images.find(img => !/logo|icon|avatar|banner/i.test(`${img.alt} ${img.className} ${img.src}`) &&
        (img.naturalWidth || img.width) >= 80 && (img.naturalHeight || img.height) >= 80);
    const image = safeUrl(photo?.currentSrc || photo?.src);
    if (image) product.image = image;
    return product;
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
  function readGreetingName(doc) {
    // Match a greeting element, not the full page, search input, or hidden previous screen.
    for (const node of doc.querySelectorAll('.mx-text.mx-name-text1')) {
      if (node.closest('#ov-vulcheck,[hidden],[aria-hidden="true"]') || !node.getClientRects().length ||
          node.querySelector('input,textarea,select,button') || doc.defaultView.getComputedStyle(node).visibility !== 'visible') continue;
      const text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ')
        .replace(/\s*\u{1F44B}[\uFE0E\uFE0F]?[\u{1F3FB}-\u{1F3FF}]?\s*$/u, '').trim();
      const match = /^(?:hello|hallo)\s*,?\s+([\p{L}\p{M}][\p{L}\p{M} .’'\-]{0,99}?)[!,]?$/iu.exec(text);
      if (match) return match[1].trim();
    }
    return '';
  }
  const core = { day, parseProduct, parseBackup, addEntry, mergeEntries, createDecoder, productFromText, isProductPage, readGreetingName };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (window.top !== window.self || window.__ovVulcheck) return;
  window.__ovVulcheck = true;

  const BACK_SELECTOR = 'button[data-button-id="p.Producten.Article_Details.actionButton7"], .productpage button.mx-name-actionButton7';
  let backRecoveryTimer;
  function backPage(button = document.querySelector(BACK_SELECTOR)) {
    return isProductPage(location.href) && button ? { url: location.href, button } : null;
  }
  function recoverBack(page, delay) {
    if (!page) return;
    clearTimeout(backRecoveryTimer);
    backRecoveryTimer = setTimeout(() => {
      const { button, url } = page;
      // Give Mendix time to close the screen. Never redirect a new or hidden page.
      if (location.href === url && button.isConnected && button.getClientRects().length &&
          !button.closest('[hidden], [aria-hidden="true"]')) location.assign('/');
    }, delay);
  }
  document.addEventListener('click', event => {
    const back = event.target instanceof Element && event.target.closest(BACK_SELECTOR);
    if (!back || back.disabled || back.dataset.disabled === 'true') return;
    // Also works in Safari's isolated world, where network hooks may be unavailable.
    recoverBack(backPage(back), 2500);
  }, true);

  const decoder = createDecoder();
  let current = null, generation = 0, entries = [], storageBroken = false;
  let fifo = parseFifo(undefined, new Set());
  let fifoProducts = [], lastRound = null;
  function parseRoundReport(report) {
    if (report == null) return null;
    if (!Array.isArray(report.products) || report.products.length > 10 ||
        typeof report.date !== 'string' || !Number.isFinite(Date.parse(report.date))) throw Error('Ongeldig FIFO-resultaat.');
    const products = report.products.map(parseProduct);
    return { products, fifo: parseFifo(report.fifo, new Set(products.map(p => p.article))), date: report.date };
  }
  const allProducts = () => [...new Map([...fifoProducts, ...entries.map(e => e.product)].map(p => [p.article, p])).values()];
  let render = () => {}, notify = () => {}, requestsSeen = 0;
  let pageProduct = null, pageUrl = location.href, staleArticle = null;
  let controllerName = '';
  function refreshPage() {
    // Mendix keeps this script alive between the search screen and article pages.
    // Do not persist a person's name alongside the shared checklist.
    if (/^\/p\/producten\/?$/.test(location.pathname)) controllerName = readGreetingName(document) || controllerName;
    if (pageUrl !== location.href) {
      clearTimeout(backRecoveryTimer);
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
      const data = raw ? JSON.parse(raw) : undefined;
      const next = data ? parseBackup(data) : [];
      if (data?.fifoProducts !== undefined && (!Array.isArray(data.fifoProducts) || data.fifoProducts.length > 10)) throw Error('Ongeldige FIFO-producten.');
      const catalog = new Map([...(data?.fifoProducts || []).map(parseProduct), ...next.map(e => e.product)].map(p => [p.article, p]));
      const nextFifo = parseFifo(data?.fifo, new Set(catalog.keys()));
      const selected = new Set(Object.values(nextFifo).flat().map(r => r.article));
      const nextReport = parseRoundReport(data?.lastRound);
      lastRound = nextReport; entries = next; fifo = nextFifo; fifoProducts = [...catalog.values()].filter(p => selected.has(p.article));
      storageBroken = false;
    } catch { storageBroken = true; }
  }
  load();
  function save(next, nextFifo = fifo, extraProducts = [], report = lastRound) {
    if (storageBroken) { notify('Opslag niet leesbaar. Bestaande gegevens worden niet overschreven.'); return false; }
    try {
      const catalog = new Map([...allProducts(), ...next.map(e => e.product), ...extraProducts.map(parseProduct)].map(p => [p.article, p]));
      const cleanedFifo = parseFifo(nextFifo, new Set(catalog.keys()));
      const selected = new Set(Object.values(cleanedFifo).flat().map(r => r.article));
      const nextProducts = [...catalog.values()].filter(p => selected.has(p.article));
      const nextReport = parseRoundReport(report);
      localStorage.setItem(KEY, JSON.stringify({ version: VERSION, entries: next, fifo: cleanedFifo, fifoProducts: nextProducts, lastRound: nextReport }));
      lastRound = nextReport; entries = next; fifo = cleanedFifo; fifoProducts = nextProducts;
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
    return { generation, backPage: backPage(), bootstrap: bootstrap && /\/artikel\//.test(request?.params?.referrer || '') };
  }
  function receive(data, context) {
    if (context.generation !== generation) return;
    // The native close can succeed on the server but leave a deep-linked page
    // visible because there is no previous Mendix page in this runtime.
    if (data?.instructions?.some(instruction => instruction.type === 'close') &&
        Object.values(data.changes || {}).some(change => change?._PDPClosed?.value === true)) {
      recoverBack(context.backPage, 300);
    }
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

  // A standalone document avoids printing Jumbo's page or the scrollable dialog.
  function fifoPrintDocument(entries, fifo, date = new Date(), controller = '') {
    const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const products = new Map(entries.map(e => [e.product.article, e.product]));
    const cells = row => {
      const p = products.get(row.article);
      if (!p) return '<td></td><td></td><td></td>';
      return `<td><strong>${escape(p.article)}</strong><div>${escape(p.name)}</div>${p.size ? `<small>${escape(p.size)}</small>` : ''}</td>
        <td class="answer">${row.fifo === null ? '' : row.fifo ? '✓ Ja' : '✗ Nee'}</td><td>${escape(row.names)}</td>`;
    };
    return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>FIFO controle lijst - ${day(date)}</title><style>
      *{box-sizing:border-box}html{-webkit-text-size-adjust:none;text-size-adjust:none}body{margin:0;background:#eee;color:#111;font:10pt/1.2 Arial,sans-serif}
      .actions{padding:16px;text-align:center}.actions button{padding:12px 20px;font:inherit;font-weight:bold;cursor:pointer}.actions p{margin:8px 0}
      .sheet{position:relative;width:100%;max-width:277mm;aspect-ratio:277/190;margin:0 auto 20px;background:white;overflow:hidden}
      main{position:absolute;top:0;left:0;width:277mm;padding:10mm;background:white;transform-origin:top left}h1{font-size:19pt;margin:0 0 4mm}
      .meta{display:flex;gap:12mm;border:1.5pt solid #111;padding:3mm;margin-bottom:4mm}.controller{flex:1}
      table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1pt solid #111;padding:2mm;text-align:left;overflow-wrap:anywhere;vertical-align:top}
      thead th{background:#f1f1f1;vertical-align:middle;font-size:9pt}tbody th{font-size:10pt}tbody tr{height:15mm;break-inside:avoid}
      td div{margin-top:1mm}small{font-size:9pt}.answer{white-space:nowrap;font-size:10pt}
      .notes{margin-top:4mm;border:1.5pt solid #111;min-height:58mm;padding:3mm;break-inside:avoid}.notes h2{font-size:13pt;margin:0 0 3mm}
      .notes p{font-size:9pt;line-height:1.4;margin:2mm 0}
      /* Best-effort layout for manual webpage printing; use Open PDF for a clean export. */
      @page{size:A4 landscape;margin:0}@media print{body{background:white}.actions{display:none}.sheet{height:190mm;aspect-ratio:auto;margin:0 auto;break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}}
      </style></head><body><div class="actions"><button type="button" id="print">Open PDF</button> <a id="download" hidden>Download PDF</a><p id="pdf-status" role="status">Open de PDF en kies delen, bewaren of afdrukken.</p></div><div class="sheet"><main>
      <h1>Dagelijkse FIFO check!</h1><div class="meta"><span><strong>Datum:</strong> ${escape(date.toLocaleDateString('nl-NL'))}</span><span><strong>Dag:</strong> ${escape(date.toLocaleDateString('nl-NL', { weekday: 'long' }))}</span><span class="controller"><strong>Controleur:</strong> ${controller ? escape(controller) : '________________________'}</span></div>
      <table aria-label="FIFO controle Zuivel en VVP"><colgroup><col style="width:10%"><col style="width:25%"><col style="width:7%"><col style="width:13%"><col style="width:25%"><col style="width:7%"><col style="width:13%"></colgroup>
      <thead><tr><th scope="col">Productgroep</th><th scope="col">Artikelnummer - zuivel</th><th scope="col">Fifo?</th><th scope="col">Wie gevuld?</th><th scope="col">Artikelnummer - VVP</th><th scope="col">Fifo?</th><th scope="col">Wie gevuld?</th></tr></thead>
      <tbody>${Array.from({ length: 5 }, (_, i) => `<tr><th scope="row">Product ${i + 1}</th>${cells(fifo.zuivel[i])}${cells(fifo.vvp[i])}</tr>`).join('')}</tbody></table>
      <section class="notes"><h2>Opmerkingen / Bijzonderheden</h2><p><strong>FIFO gevuld? Vinkje zetten. Niet FIFO gevuld? Kruisje zetten.</strong> Leeg = nog niet gecontroleerd.</p>
      <p>Niet FIFO gevuld? Ga na wie het gevuld heeft. Niemand gevuld? Noteer alle vullers van deze koeling in het niet-FIFO-vullen-lijstje.</p></section>
      </main></div></body></html>`;
  }

  function fitFifoSheet(doc) {
    const sheet = doc.querySelector('.sheet'), content = sheet.querySelector('main');
    // Measure untransformed content, including long names, and shrink the entire form.
    // Absolute positioning keeps its original height out of the pagination flow.
    const width = content.offsetWidth, height = content.scrollHeight;
    if (!width || !height || !sheet.clientWidth || !sheet.clientHeight) return;
    const scale = Math.min(1, sheet.clientWidth / width, sheet.clientHeight / height);
    content.style.transform = `scale(${scale})`;
  }

  // Draw locally with the browser's fonts so accents and FIFO symbols survive export.
  // A single image-backed PDF page avoids Safari's HTML pagination and added footers.
  function fifoPdf(doc) {
    const canvas = doc.createElement('canvas');
    const pageWidth = 841.89, pageHeight = 595.28, inset = 28.35, width = pageWidth - 2 * inset;
    canvas.width = Math.ceil(pageWidth * 3); canvas.height = Math.ceil(pageHeight * 3);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const font = (size, bold) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`; };
    const wrap = (text, maxWidth, size, bold = false) => {
      font(size, bold);
      const lines = [];
      let line = '';
      for (const word of text.trim().split(/\s+/)) {
        if (line && ctx.measureText(`${line} ${word}`).width <= maxWidth) { line += ` ${word}`; continue; }
        if (line) lines.push(line);
        line = '';
        for (const char of word) {
          if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
          line += char;
        }
      }
      if (line) lines.push(line);
      return lines;
    };
    const textBlock = (text, maxWidth, size, bold = false) => {
      const lines = wrap(text, maxWidth, size, bold);
      return { lines, size, bold, height: lines.length * size * 1.25 };
    };
    const drawText = (block, x, y) => {
      font(block.size, block.bold); ctx.fillStyle = '#111';
      block.lines.forEach((line, i) => ctx.fillText(line, x, y + i * block.size * 1.25));
    };
    const box = (x, y, w, h, shaded = false) => {
      if (shaded) { ctx.fillStyle = '#f1f1f1'; ctx.fillRect(x, y, w, h); }
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8; ctx.strokeRect(x, y, w, h);
    };
    const title = textBlock(doc.querySelector('h1').textContent, width, 19, true);
    const meta = [...doc.querySelectorAll('.meta span')].map(el => textBlock(el.textContent, width / 3 - 18, 10));
    const metaHeight = Math.max(...meta.map(block => block.height)) + 16;
    const columns = [10, 25, 7, 13, 25, 7, 13].map(percent => width * percent / 100);
    const rows = [...doc.querySelectorAll('table tr')].map((row, index) => {
      const cells = [...row.children].map((cell, column) => {
        // Keep article, product name and size on separate lines as in the preview.
        const marker = cell.classList.contains('answer') ? cell.textContent.trim()[0] : '';
        const marked = marker === '✓' || marker === '✗';
        const parts = [...cell.childNodes].map(node => node.textContent.trim()).filter(Boolean);
        const blocks = parts.map(text => textBlock(marked ? text.slice(1).trim() : text, columns[column] - 10 - (marked ? 12 : 0), index === 0 ? 9 : 10, cell.tagName === 'TH'));
        return { blocks, marker: marked ? marker : '', height: blocks.reduce((sum, block) => sum + block.height, 0) };
      });
      return { cells, height: Math.max(index === 0 ? 28 : 42.5, ...cells.map(cell => cell.height + 12)) };
    });
    const notesTitle = textBlock(doc.querySelector('.notes h2').textContent, width - 18, 13, true);
    const notes = [...doc.querySelectorAll('.notes p')].map(el => textBlock(el.textContent, width - 18, 9));
    const notesHeight = Math.max(164, 18 + notesTitle.height + notes.reduce((sum, block) => sum + block.height + 6, 0));
    const contentHeight = title.height + 12 + metaHeight + 12 + rows.reduce((sum, row) => sum + row.height, 0) + 12 + notesHeight;
    const scale = Math.min(1, (pageHeight - 2 * inset) / contentHeight);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(3, 3);
    ctx.translate(inset + width * (1 - scale) / 2, inset);
    ctx.scale(scale, scale); ctx.textBaseline = 'top';
    let y = 0;
    drawText(title, 0, y); y += title.height + 12;
    box(0, y, width, metaHeight);
    meta.forEach((block, i) => drawText(block, i * width / 3 + 8, y + 8));
    y += metaHeight + 12;
    rows.forEach((row, index) => {
      let x = 0;
      row.cells.forEach((cell, column) => {
        box(x, y, columns[column], row.height, index === 0);
        let textY = y + 6;
        if (cell.marker) {
          // Draw check/cross explicitly; not every platform font contains these glyphs.
          ctx.beginPath(); ctx.lineWidth = 1.2;
          if (cell.marker === '✓') { ctx.moveTo(x + 5, y + 11); ctx.lineTo(x + 8, y + 14); ctx.lineTo(x + 13, y + 7); }
          else { ctx.moveTo(x + 5, y + 7); ctx.lineTo(x + 12, y + 14); ctx.moveTo(x + 12, y + 7); ctx.lineTo(x + 5, y + 14); }
          ctx.stroke();
        }
        cell.blocks.forEach(block => { drawText(block, x + 5 + (cell.marker ? 12 : 0), textY); textY += block.height; });
        x += columns[column];
      });
      y += row.height;
    });
    y += 12; box(0, y, width, notesHeight); y += 9;
    drawText(notesTitle, 9, y); y += notesTitle.height + 6;
    notes.forEach(block => { drawText(block, 9, y); y += block.height + 6; });
    const jpeg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.95).split(',')[1]), char => char.charCodeAt(0));
    const ascii = text => Uint8Array.from(text, char => char.charCodeAt(0));
    const chunks = [], offsets = [0];
    let length = 0;
    const append = data => { chunks.push(data); length += data.length; };
    const object = (number, body, stream) => {
      offsets[number] = length;
      append(ascii(`${number} 0 obj\n${body}\n`));
      if (stream) { append(ascii('stream\n')); append(stream); append(ascii('\nendstream\n')); }
      append(ascii('endobj\n'));
    };
    append(ascii('%PDF-1.4\n'));
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Sheet 4 0 R >> >> /Contents 5 0 R >>`);
    object(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    const content = ascii(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Sheet Do Q`);
    object(5, `<< /Length ${content.length} >>`, content);
    const xref = length;
    append(ascii(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function mount() {
    const host = document.createElement('div');
    host.id = 'ov-vulcheck';
    host.style.cssText = 'position:fixed;z-index:2147483646;bottom:0;right:0;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{font-family:var(--list-font,Arial,sans-serif);color:#222;font-size:16px;line-height:1.4;color-scheme:light}
      *{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit}button,a,input{touch-action:manipulation}
      button{cursor:pointer;color:inherit;border:0}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #222;outline-offset:3px}
      .launch{pointer-events:auto;margin:16px 16px calc(16px + env(safe-area-inset-bottom));width:44px;height:44px;display:grid;place-items:center;padding:10px;background:#ffcc00;border-radius:6px;box-shadow:0 2px 10px #0002}
      .save-product{pointer-events:auto;position:fixed;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));width:44px;height:44px;display:grid;place-items:center;cursor:pointer}
      .product-trigger{display:grid;place-items:center;width:44px;height:44px;padding:10px;background:#fff;border:1px solid #e5e5e5;border-radius:6px;box-shadow:0 2px 8px #0001}.product-trigger:hover{background:#f5f5f5}.product-trigger[aria-expanded="true"]{background:#ffcc00;border-color:#ffcc00}
      .product-menu{position:absolute;top:52px;right:0;width:min(290px,calc(100vw - 24px));padding:6px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;box-shadow:0 6px 24px #0002}.product-menu p{margin:8px 10px;color:#666;font-size:13px;overflow-wrap:anywhere}.product-action{display:flex;align-items:center;gap:12px;width:100%;min-height:48px;padding:10px;text-align:left;background:transparent;border-radius:4px;font-size:14px}.product-action:hover{background:#f5f5f5}.product-action::before{content:'+';font-size:22px;width:24px;text-align:center;flex-shrink:0}.product-action[aria-pressed="true"]::before{content:'✓';color:#716000}.product-action:disabled,.product-trigger:disabled{opacity:.5;cursor:default}
      dialog{pointer-events:auto;position:fixed;inset:0 0 0 auto;width:min(100%,400px);height:100%;height:100dvh;max-height:100%;max-width:100%;margin:0;border:0;padding:0;background:#fff;color:#222;box-shadow:-4px 0 24px #0002}
      dialog::backdrop{background:#0005}.shell{height:100%;display:flex;flex-direction:column}
      .head{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:8px;padding:12px;padding-top:calc(12px + env(safe-area-inset-top));border-bottom:4px solid #ffcc00}
      .head:focus{outline:none}
      .close,.remove{flex-shrink:0;display:grid;place-items:center;width:44px;height:44px;background:transparent;border-radius:4px;font-size:25px;font-weight:400}.close:hover,.remove:hover{background:#f4f4f4}
      .head-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}.head-icon{display:grid;place-items:center;width:44px;height:44px;padding:10px;border-radius:4px;background:transparent}.head-icon:hover{background:#f4f4f4}.head-icon:disabled{opacity:.5;cursor:default}
      .body{overflow:auto;overscroll-behavior:contain;flex:1;padding:0 16px calc(16px + env(safe-area-inset-bottom))}.list{list-style:none;margin:0;padding:0}
      .item{display:flex;align-items:center;border-bottom:1px solid #e9e9e9;min-height:88px}.product{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:14px 0;text-decoration:none;color:inherit}.product:hover .name{text-decoration:underline}.product[aria-disabled]{cursor:default}
      .photo{flex:0 0 56px;width:56px;height:56px;display:grid;place-items:center;border-radius:4px;background:#fafafa}.photo img{width:100%;height:100%;object-fit:contain}.placeholder{width:22px;height:28px;border:1.5px solid #b5b5b5;border-radius:3px;background:linear-gradient(#fafafa 35%,#ffcc00 35%,#ffcc00 65%,#fafafa 65%)}
      .name{display:block;font-size:14px;font-weight:700;overflow-wrap:anywhere}.sub{display:block;font-size:13px;color:#707070;margin-top:3px}.remove{font-size:20px;color:#707070;margin-left:4px}.empty{padding:32px 0;color:#707070;font-size:14px}
      .toast{pointer-events:auto;position:fixed;bottom:calc(76px + env(safe-area-inset-bottom));right:16px;max-width:min(360px,calc(100vw - 32px));padding:12px 16px;background:#222;color:#fff;border-radius:4px;font-size:14px;box-shadow:0 2px 12px #0002}
      .nav{display:flex;gap:4px;min-width:0}.nav button{padding:10px 8px;min-height:44px;border-radius:4px;background:#f2f2f2;font-size:14px;white-space:nowrap}.nav button[aria-pressed="true"]{background:#ffcc00;font-weight:700}
      dialog.fifo-view{width:min(100%,760px)}.fifo-section h2{font-size:18px;margin:20px 0 10px}.fifo-help{font-size:14px;color:#666}
      .round-primary,.round-no,.round-back{min-height:48px;padding:12px 18px;border-radius:6px;font-weight:700;background:#ffcc00}.round-primary:disabled{opacity:.5;cursor:default}.start-round,.resume-round{display:block;width:100%;margin:20px 0 12px}.resume-round{background:#f2f2f2}.round-back{display:block;margin:24px auto 16px;background:#f2f2f2;font-weight:400}
      .round-page{max-width:540px;margin:0 auto;padding-top:20px;text-align:center}.round-filters{justify-content:center}.round-filters button{flex:1}.round-progress{font-size:14px;color:#666;margin:20px 0}.round-card{padding:24px 16px;background:#fafafa;border:1px solid #eee;border-radius:10px}.round-card img{width:120px;height:120px;object-fit:contain}.round-card h2{font-size:22px;margin:8px 0;overflow-wrap:anywhere}.round-card dl{margin:24px 0 0;text-align:left;display:grid;grid-template-columns:110px 1fr;gap:10px;font-size:14px}.round-card dt{color:#666}.round-card dd{margin:0;overflow-wrap:anywhere}.round-page h2:focus{outline:none}.round-page h3{font-size:20px;margin:24px 0 12px}.round-answers{display:flex;gap:12px}.round-answers button{flex:1;font-size:18px}.round-no{background:#fff;border:1px solid #bbb}.round-no[aria-pressed="true"]{border:2px solid #222;background:#f2f2f2}.round-names{margin-top:20px;text-align:left}.round-names label{display:block;font-size:14px;font-weight:700}.round-names input{width:100%;min-height:48px;border:1px solid #aaa;border-radius:5px;margin:8px 0 12px;padding:10px;font-size:16px}.round-names button{width:100%}
      /* Keep motion on stable containers: data refreshes must not replay every row. */
      @media (prefers-reduced-motion:no-preference){
        @keyframes panel-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
        @keyframes backdrop-in{from{background:#0000}to{background:#0005}}
        @keyframes content-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes saved{0%,100%{transform:scale(1)}45%{transform:scale(1.16)}}
        dialog[open]{animation:panel-in 240ms cubic-bezier(.2,.8,.2,1)}
        dialog[open]::backdrop{animation:backdrop-in 240ms ease-out}
        .list:not([hidden]),.fifo-page:not([hidden]){animation:content-in 180ms ease-out}
        .toast:not([hidden]){animation:content-in 200ms ease-out}
        button{transition:background-color 140ms ease,color 140ms ease,box-shadow 160ms ease,transform 140ms ease}
        button:enabled:active{transform:scale(.96)}
        .photo{transition:transform 180ms ease}
        @media (hover:hover) and (pointer:fine){
          .launch:hover{transform:translateY(-2px);box-shadow:0 5px 16px #0003}
          .launch:active{transform:translateY(0) scale(.96)}
          .product[href]:hover .photo{transform:scale(1.04)}
        }
        /* Enhanced exit motion where the browser can retain the dialog's top layer.
           Older browsers still get the entry animation and native instant closing. */
        @supports (transition-behavior:allow-discrete) and (overlay:auto){
          dialog{opacity:0;transform:translateX(24px);transition:opacity 200ms ease,transform 240ms cubic-bezier(.2,.8,.2,1),display 240ms allow-discrete,overlay 240ms allow-discrete}
          dialog[open]{opacity:1;transform:translateX(0);animation:none}
          dialog::backdrop{background:#0000;transition:background-color 240ms ease,display 240ms allow-discrete,overlay 240ms allow-discrete}
          dialog[open]::backdrop{background:#0005;animation:none}
          @starting-style{
            dialog[open]{opacity:0;transform:translateX(24px)}
            dialog[open]::backdrop{background:#0000}
          }
        }
      }
    `;
    host.style.setProperty('--list-font', getComputedStyle(document.body).fontFamily || 'Arial, sans-serif');
    root.append(style);
    function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
    function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b; }
    function setIcon(control, label, path) {
      control.setAttribute('aria-label', label); control.title = label;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
      const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', path);
      svg.append(shape); control.replaceChildren(svg);
    }
    let view = 'list';
    const launch = button('', () => { view = 'list'; load(); render(); dialog.showModal(); head.focus({ preventScroll: true }); }, 'launch');
    launch.id = 'ov-list-launch';
    launch.setAttribute('aria-haspopup', 'dialog');
    setIcon(launch, 'Mijn lijst', 'M3 6l1.5 1.5L7 4 M10 6h11 M3 13l1.5 1.5L7 11 M10 13h11 M3 20l1.5 1.5L7 18 M10 20h11');
    // Use the site's visual classes, without copying Mendix action hooks or logout behavior.
    function placeLaunch() {
      const account = [...document.querySelectorAll('button[data-button-id="p.Producten.Producten_Home.actionButton7"], button.logout-btn')]
        .find(control => control.querySelector('.icon-person') && control.getClientRects().length &&
          !control.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(control).visibility !== 'hidden');
      if (account) {
        const classes = 'btn btn-tertiary btn-icon-only spacing-outer-right-none btn-default';
        if (launch.className !== classes) launch.className = classes;
        if (launch.nextElementSibling !== account) account.before(launch);
      } else {
        if (launch.className !== 'launch') launch.className = 'launch';
        if (launch.parentNode !== root) root.prepend(launch);
      }
    }
    const quickSave = el('div', undefined, 'save-product');
    const productMenu = el('div', undefined, 'product-menu');
    productMenu.id = 'ov-product-menu'; productMenu.hidden = true;
    const menuTitle = el('p');
    const productTrigger = button('', () => {
      refreshPage(); load(); render();
      if (!activeProduct() || storageBroken) return;
      productMenu.hidden = !productMenu.hidden;
      productTrigger.setAttribute('aria-expanded', String(!productMenu.hidden));
      if (!productMenu.hidden) actions.list.focus();
    }, 'product-trigger');
    setIcon(productTrigger, 'Product toevoegen', 'M8 3H5v18h14V3h-3 M9 2h6v4H9z M8 13h8 M12 9v8');
    productTrigger.setAttribute('aria-expanded', 'false');
    productTrigger.setAttribute('aria-controls', productMenu.id);
    const actions = {};
    const destinations = { list: 'Mijn lijst', zuivel: 'Zuivel FIFO', vvp: 'VVP FIFO' };
    let displayedArticle = null;
    function closeProductMenu(restoreFocus = false) {
      productMenu.hidden = true; productTrigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) productTrigger.focus();
    }
    for (const [destination, label] of Object.entries(destinations)) {
      const action = button('', () => {
        const expected = displayedArticle;
        refreshPage(); load();
        const product = activeProduct();
        if (!product || product.article !== expected) {
          closeProductMenu(); render(); notify('De productpagina is veranderd. Probeer opnieuw.'); return;
        }
        const snapshot = { ...product, url: safeUrl(location.href, true) };
        let saved = false, removing = false;
        if (destination === 'list') {
          removing = entries.some(e => e.product.article === product.article);
          if (!removing && entries.length >= 10000) { notify('Je lijst is vol. Verwijder eerst een product.'); return; }
          saved = save(removing ? entries.filter(e => e.product.article !== product.article) : addEntry(entries, snapshot));
        } else {
          const rows = fifo[destination];
          const existing = rows.findIndex(r => r.article === product.article);
          removing = existing >= 0;
          const index = removing ? existing : rows.findIndex(r => !r.article);
          if (index < 0) { notify(label + ' is vol (5 producten). Maak eerst een rij vrij in Fifo check.'); return; }
          const next = { ...fifo, [destination]: rows.map((r, i) => i !== index ? r :
            { ...emptyFifoRow(), article: removing ? '' : product.article }) };
          saved = save(entries, next, [snapshot]);
        }
        render();
        if (saved) notify((removing ? 'Verwijderd uit ' : 'Toegevoegd aan ') + label + '.');
      }, 'product-action');
      action.dataset.destination = destination;
      actions[destination] = action;
    }
    productMenu.append(menuTitle, ...Object.values(actions));
    quickSave.append(productTrigger, productMenu); quickSave.hidden = true;
    quickSave.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeProductMenu(true); }
    });
    document.addEventListener('click', event => {
      if (!event.composedPath().includes(quickSave)) closeProductMenu();
    });
    // Page scripts can move focus after a click. Only explicit dismissal should
    // close this disclosure; losing focus does not mean the user clicked outside.
    const dialog = el('dialog'), shell = el('div', undefined, 'shell'), head = el('header', undefined, 'head');
    // Start focus on the header so Safari does not outline the first tab on opening.
    // It stays outside the tab order; keyboard navigation still highlights controls.
    head.tabIndex = -1; head.setAttribute('autofocus', '');
    const close = button('×', () => dialog.close(), 'close'); close.setAttribute('aria-label', 'Sluiten');
    const printButton = button('', () => {
      load(); render();
      if (storageBroken) { notify('Je opgeslagen gegevens kunnen niet worden gelezen.'); return; }
      const printWindow = window.open('', '_blank');
      if (!printWindow) { notify('Sta pop-ups toe om de FIFO-lijst te printen of als PDF te bewaren.'); return; }
      try {
        printWindow.opener = null;
        printWindow.document.open();
        const report = view === 'round' && roundResult ? roundResult : !chosenRows().length ? lastRound : null;
        printWindow.document.write(fifoPrintDocument((report?.products || allProducts()).map(product => ({ product })),
          report?.fifo || fifo, report ? new Date(report.date) : new Date(), controllerName));
        printWindow.document.close();
        const fit = () => fitFifoSheet(printWindow.document);
        printWindow.addEventListener('beforeprint', fit);
        printWindow.addEventListener('afterprint', fit);
        printWindow.addEventListener('resize', fit);
        let pdfUrl;
        printWindow.document.getElementById('print').addEventListener('click', () => {
          try {
            // Reuse the snapshot's PDF; its URL remains valid while this page is open.
            if (!pdfUrl) pdfUrl = URL.createObjectURL(fifoPdf(printWindow.document));
            const download = printWindow.document.getElementById('download');
            download.href = pdfUrl; download.download = `FIFO-${day(new Date())}.pdf`; download.hidden = false;
            const link = printWindow.document.createElement('a');
            link.href = pdfUrl; link.target = '_blank'; link.rel = 'noopener';
            printWindow.document.body.append(link); link.click(); link.remove();
          } catch (_) {
            printWindow.document.getElementById('pdf-status').textContent = 'PDF maken is mislukt. Probeer opnieuw via Open PDF.';
          }
        });
        fit();
      } catch (_) { notify('Afdrukken kon niet worden gestart. Probeer opnieuw via Print / PDF.'); }
    }, 'head-icon print-fifo');
    setIcon(printButton, 'Print beide FIFO-tabellen of bewaar als PDF', 'M6 9V3h12v6 M6 18H3V9h18v9h-3 M6 14h12v7H6z M17 12h1');
    const clearButton = button('', () => {
      load();
      if (save([])) { render(); close.focus(); notify('Je lijst is leeggemaakt.'); }
      else render();
    }, 'head-icon clear-list');
    setIcon(clearButton, 'Lijst leegmaken', 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7');
    const headActions = el('div', undefined, 'head-actions');
    headActions.append(printButton, clearButton, close);
    const body = el('div', undefined, 'body'), list = el('ul', undefined, 'list');
    const nav = el('nav', undefined, 'nav'); nav.setAttribute('aria-label', 'Vulcheck pagina’s');
    const showView = next => { view = next; load(); render(); };
    const listButton = button('Mijn lijst', () => showView('list'));
    const fifoButton = button('Fifo check', () => showView('fifo'), 'fifo-button');
    nav.append(listButton, fifoButton);
    head.append(nav, headActions);
    const fifoPage = el('div', undefined, 'fifo-page'), roundPage = el('div', undefined, 'round-page');
    body.append(list, fifoPage, roundPage); shell.append(head, body); dialog.append(shell);
    const toast = el('div', '', 'toast'); toast.hidden = true; toast.setAttribute('role', 'status');
    root.append(launch, quickSave, dialog, toast); document.body.append(host);
    let toastTimer;
    notify = message => { (dialog.open ? shell : root).append(toast); toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6500); };
    let listSignature = '';
    let fifoSignature = '';
    let round = null, roundResult = null, roundFilter = 'zuivel', roundSignature = '', roundCurrentKey = null, namesDraft = '', askingNames = false;
    const categoryName = category => category === 'zuivel' ? 'Zuivel' : 'VVP';
    const chosenRows = (data = fifo) => ['zuivel', 'vvp'].flatMap(category => data[category]
      .filter(row => row.article).map(row => ({ ...row, category, key: category + ':' + row.article })));
    function focusRound() {
      const target = roundPage.querySelector('h2');
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
      body.scrollTop = 0;
    }
    function startRound() {
      load();
      const selected = chosenRows();
      if (storageBroken || !selected.length) return;
      const next = Object.fromEntries(['zuivel', 'vvp'].map(category => [category,
        fifo[category].map(row => ({ ...row, fifo: null, names: '' }))]));
      if (!save(entries, next)) return;
      roundResult = null;
      round = selected.map(({ category, article, key }) => ({ category, article, key }));
      roundFilter = round[0].category; askingNames = false; namesDraft = ''; roundSignature = '';
      showView('round'); focusRound();
    }
    function productDetails(product, container) {
      if (product.image) {
        const photo = el('img'); photo.src = product.image; photo.alt = ''; photo.referrerPolicy = 'no-referrer';
        photo.addEventListener('error', () => photo.remove(), { once: true }); container.append(photo);
      }
      container.append(el('h2', product.name));
      if (product.size) container.append(el('p', product.size, 'sub'));
      const details = el('dl');
      for (const [label, value] of [['Artikelnummer', product.article], ['Locatie', [product.category, product.location].filter(Boolean).join(' · ') || 'Niet bekend'], ['Collo inhoud', product.pack]]) {
        if (value) details.append(el('dt', label), el('dd', value));
      }
      container.append(details);
    }
    function renderRound() {
      if (view !== 'round' || !round) return;
      const rows = chosenRows(roundResult?.fifo || fifo), products = new Map((roundResult?.products || allProducts()).map(p => [p.article, p]));
      const active = round.map(item => rows.find(row => row.key === item.key)).filter(Boolean);
      const pending = active.filter(row => row.fifo === null);
      const current = pending.find(row => row.category === roundFilter);
      if (roundCurrentKey !== (current?.key || null)) { askingNames = false; namesDraft = ''; roundCurrentKey = current?.key || null; }
      const signature = JSON.stringify([storageBroken, active, [...products], roundFilter, askingNames]);
      if (signature === roundSignature) return;
      roundSignature = signature; roundPage.replaceChildren();
      const filters = el('nav', undefined, 'nav round-filters'); filters.setAttribute('aria-label', 'FIFO categorie');
      for (const category of ['zuivel', 'vvp']) {
        const remaining = pending.filter(row => row.category === category).length;
        const filter = button(categoryName(category) + ' · ' + remaining, () => {
          roundFilter = category; askingNames = false; namesDraft = ''; renderRound(); focusRound();
        });
        filter.dataset.filter = category; filter.setAttribute('aria-pressed', String(roundFilter === category)); filters.append(filter);
      }
      roundPage.append(filters);
      const progress = el('p', `${active.length - pending.length} van ${active.length} gecontroleerd`, 'round-progress');
      progress.setAttribute('role', 'status'); roundPage.append(progress);
      const back = button('Terug naar producten', () => showView('fifo'), 'round-back');
      if (storageBroken) {
        roundPage.append(el('h2', 'Opslag niet leesbaar'), el('p', 'Je antwoorden kunnen nu niet veilig worden opgeslagen.'), back); return;
      }
      if (!pending.length) {
        roundPage.append(el('h2', active.length ? 'FIFO check afgerond!' : 'Geen producten meer in deze ronde'),
          el('p', active.length ? 'Wil je de tabel printen of bewaren als PDF?' : 'Voeg producten toe om een nieuwe ronde te starten.'));
        if (active.length) roundPage.append(button('Print / PDF', () => printButton.click(), 'round-primary round-print'));
        roundPage.append(back); return;
      }
      if (!current) {
        const other = roundFilter === 'zuivel' ? 'vvp' : 'zuivel';
        roundPage.append(el('h2', categoryName(roundFilter) + ' klaar'),
          button('Verder met ' + categoryName(other), () => { roundFilter = other; renderRound(); focusRound(); }, 'round-primary'), back); return;
      }
      const product = products.get(current.article);
      const card = el('section', undefined, 'round-card'); card.dataset.article = current.article;
      productDetails(product, card); roundPage.append(card);
      const question = el('h3', 'FIFO gevuld?'); roundPage.append(question);
      function answer(yes, names = '') {
        load();
        const row = fifo[current.category].find(row => row.article === current.article);
        if (!row || row.fifo !== null) {
          askingNames = false; namesDraft = ''; roundSignature = ''; render();
          notify('Dit product is gewijzigd. De ronde is bijgewerkt.'); return;
        }
        const next = { ...fifo, [current.category]: fifo[current.category].map(row => row.article !== current.article ? row :
          { ...row, fifo: yes, names: yes ? '' : names.trim() }) };
        const keys = new Set(round.map(item => item.key));
        const completed = chosenRows(next).filter(row => keys.has(row.key));
        if (completed.length && completed.every(row => row.fifo !== null)) {
          const reportFifo = Object.fromEntries(['zuivel', 'vvp'].map(category => [category,
            next[category].map(row => keys.has(category + ':' + row.article) ? row : emptyFifoRow())]));
          const articles = new Set(completed.map(row => row.article));
          const report = { fifo: reportFifo, products: allProducts().filter(p => articles.has(p.article)), date: new Date().toISOString() };
          const cleared = Object.fromEntries(['zuivel', 'vvp'].map(category => [category,
            next[category].map(row => keys.has(category + ':' + row.article) ? emptyFifoRow() : row)]));
          // Archive results and clear selections together: a failed write preserves the round.
          if (!save(entries, cleared, [], report)) return;
          roundResult = lastRound;
        } else if (!save(entries, next)) return;
        askingNames = false; namesDraft = ''; roundSignature = ''; render(); focusRound();
      }
      const answers = el('div', undefined, 'round-answers');
      const yes = button('Ja', () => answer(true), 'round-primary round-yes');
      const no = button('Nee', () => { askingNames = true; renderRound(); roundPage.querySelector('input')?.focus(); }, 'round-no');
      no.setAttribute('aria-pressed', String(askingNames)); answers.append(yes, no); roundPage.append(answers);
      if (askingNames) {
        const form = el('form', undefined, 'round-names'), label = el('label', 'Wie heeft dit product gevuld?');
        const input = el('input'); input.id = 'ov-round-names'; label.htmlFor = input.id;
        input.type = 'text'; input.required = true; input.maxLength = 200; input.placeholder = 'Naam / namen'; input.value = namesDraft;
        input.addEventListener('input', () => { namesDraft = input.value; input.setCustomValidity(''); });
        const submit = button('Opslaan en verder', () => {}, 'round-primary'); submit.type = 'submit';
        form.append(label, input, submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (!input.value.trim()) { input.setCustomValidity('Vul minstens één naam in.'); input.reportValidity(); return; }
          answer(false, input.value);
        });
        roundPage.append(form);
      }
      roundPage.append(back);
    }
    function renderFifo() {
      const isFifo = view !== 'list';
      dialog.setAttribute('aria-label', view === 'round' ? 'FIFO ronde' : isFifo ? 'Fifo check' : 'Mijn lijst');
      dialog.classList.toggle('fifo-view', isFifo);
      printButton.hidden = !isFifo; printButton.disabled = storageBroken;
      clearButton.hidden = view !== 'list'; clearButton.disabled = storageBroken || !entries.length;
      list.hidden = view !== 'list'; fifoPage.hidden = view !== 'fifo'; roundPage.hidden = view !== 'round';
      listButton.setAttribute('aria-pressed', String(view === 'list'));
      fifoButton.setAttribute('aria-pressed', String(isFifo));
      if (view === 'round') { renderRound(); return; }
      if (view !== 'fifo') return;
      const products = new Map(allProducts().map(p => [p.article, p]));
      const signature = JSON.stringify([storageBroken, fifo, [...products], round]);
      if (signature === fifoSignature) return;
      fifoSignature = signature; fifoPage.replaceChildren();
      if (storageBroken || !chosenRows().length) fifoPage.append(el('p', storageBroken ?
        'Je opgeslagen gegevens kunnen niet worden gelezen.' :
        'Open een product en voeg het via het productmenu toe aan Zuivel FIFO of VVP FIFO.', 'fifo-help'));
      for (const category of ['zuivel', 'vvp']) {
        const section = el('section', undefined, 'fifo-section'); section.dataset.category = category;
        section.append(el('h2', categoryName(category)));
        const selected = fifo[category].filter(row => row.article);
        if (!selected.length) section.append(el('p', 'Nog geen producten gekozen.', 'fifo-help'));
        const items = el('ul', undefined, 'list');
        for (const row of selected) {
          const product = products.get(row.article), item = el('li', undefined, 'item');
          const text = el('div', undefined, 'product');
          const description = el('div'); description.append(el('span', product.name, 'name'),
            el('span', [product.article, product.size].filter(Boolean).join(' · '), 'sub')); text.append(description);
          const remove = button('×', () => {
            load(); const next = { ...fifo, [category]: fifo[category].map(r => r.article === row.article ? emptyFifoRow() : r) };
            if (save(entries, next)) render();
          }, 'remove');
          remove.disabled = storageBroken; remove.setAttribute('aria-label', 'Verwijder uit ' + categoryName(category) + ': ' + product.name);
          item.append(text, remove); items.append(item);
        }
        section.append(items); fifoPage.append(section);
      }
      const rows = chosenRows();
      if (rows.some(row => row.fifo === null) && (round || rows.some(row => row.fifo !== null))) {
        fifoPage.append(button('Verder met FIFO check', () => {
          load(); roundResult = null; round = chosenRows().map(({ category, article, key }) => ({ category, article, key }));
          roundFilter = chosenRows().find(row => row.fifo === null)?.category || 'zuivel';
          askingNames = false; namesDraft = ''; roundSignature = '';
          showView('round'); focusRound();
        }, 'round-primary resume-round'));
      }
      const start = button('Start FIFO check', startRound, 'round-primary start-round');
      start.disabled = storageBroken || !chosenRows().length;
      fifoPage.append(start);
      if (lastRound && !rows.length) fifoPage.append(el('p', 'Je FIFO-producten zijn leeggemaakt. Met Print / PDF kun je de laatste afgeronde ronde nog printen.', 'fifo-help'));
      if (chosenRows().some(row => row.fifo !== null)) fifoPage.append(el('p', 'Een nieuwe ronde wist de vorige antwoorden. Je gekozen producten blijven bewaard.', 'fifo-help'));
    }
    function renderList() {
      const unique = new Map();
      for (const entry of [...entries].sort((a, b) => b.added.localeCompare(a.added))) {
        if (!unique.has(entry.product.article)) unique.set(entry.product.article, { ...entry.product });
        else {
          const p = unique.get(entry.product.article);
          p.url ||= entry.product.url; p.image ||= entry.product.image;
        }
      }
      const launchLabel = unique.size ? 'Mijn lijst · ' + unique.size : 'Mijn lijst';
      launch.setAttribute('aria-label', launchLabel); launch.title = launchLabel;
      const signature = JSON.stringify([storageBroken, [...unique.values()]]);
      if (signature === listSignature) return;
      listSignature = signature;
      list.replaceChildren();
      if (!unique.size) list.append(el('li', storageBroken ? 'Je opgeslagen lijst kan niet worden gelezen.' : 'Je lijst is nog leeg.', 'empty'));
      for (const p of unique.values()) {
        const row = el('li', undefined, 'item'), link = el(p.url ? 'a' : 'div', undefined, 'product');
        if (p.url) {
          link.href = p.url;
          link.addEventListener('click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            dialog.close();
            // Reopening the current product only needs to dismiss the list.
            if (link.href === location.href) { event.preventDefault(); return; }
          });
        }
        else { link.setAttribute('aria-disabled', 'true'); link.title = 'Open dit product eenmalig in Jumbo om de link te bewaren.'; }
        const photo = el('span', undefined, 'photo');
        const placeholder = () => photo.replaceChildren(el('span', undefined, 'placeholder'));
        photo.setAttribute('aria-hidden', 'true');
        if (p.image) {
          const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
          img.addEventListener('error', placeholder, { once: true }); img.src = p.image; photo.append(img);
        } else placeholder();
        const text = el('span'); text.append(el('span', p.name, 'name'));
        if (p.size) text.append(el('span', p.size, 'sub'));
        if (!p.url) text.append(el('span', 'Open opnieuw in Jumbo om te koppelen', 'sub'));
        link.append(photo, text);
        const remove = button('×', () => {
          load(); if (save(entries.filter(e => e.product.article !== p.article))) { render(); (list.querySelector('.remove') || close).focus(); }
        }, 'remove');
        remove.setAttribute('aria-label', 'Verwijderen: ' + p.name); remove.title = 'Verwijderen';
        row.append(link, remove); list.append(row);
      }
    }
    render = () => {
      refreshPage();
      const product = activeProduct();
      // Enrich legacy entries when their product is revisited, retaining notes and dates.
      if (product && !storageBroken) {
        const url = safeUrl(location.href, true);
        const updates = { ...(url ? { url } : {}), ...(product.image ? { image: product.image } : {}),
          ...(product.location ? { location: product.location } : {}), ...(product.category ? { category: product.category } : {}) };
        const outdated = p => p.article === product.article && Object.entries(updates).some(([key, value]) => p[key] !== value);
        if (entries.some(e => outdated(e.product)) || fifoProducts.some(outdated)) {
          const existing = allProducts().find(p => p.article === product.article);
          save(entries.map(e => outdated(e.product) ? { ...e, product: { ...e.product, ...updates } } : e),
            fifo, existing ? [{ ...existing, ...updates }] : []);
        }
      }
      if (displayedArticle !== (product?.article || null)) closeProductMenu();
      displayedArticle = product?.article || null;
      quickSave.hidden = !isProductPage(location.href);
      productTrigger.disabled = !product || storageBroken;
      if (quickSave.hidden || productTrigger.disabled) closeProductMenu();
      menuTitle.textContent = product?.name || 'Product laden…';
      quickSave.title = product?.name || 'Product laden…';
      for (const [destination, action] of Object.entries(actions)) {
        const selected = Boolean(product && (destination === 'list' ? entries.some(e => e.product.article === product.article) :
          fifo[destination].some(r => r.article === product.article)));
        action.disabled = !product || storageBroken;
        action.setAttribute('aria-pressed', String(selected));
        action.textContent = destinations[destination];
        action.setAttribute('aria-label', (selected ? 'Verwijder uit ' : 'Voeg toe aan ') + destinations[destination]);
      }
      renderList();
      renderFifo();
    };
    window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) { load(); render(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); render(); } });
    let scanTimer;
    let lastPage = '';
    function scanPage() {
      placeLaunch();
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
    placeLaunch();
    render();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
