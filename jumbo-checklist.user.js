// ==UserScript==
// @name         Mijn vulcheck
// @namespace    olivier.vulcheck
// @version      0.4.1
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
  const core = { day, parseProduct, parseBackup, addEntry, mergeEntries, createDecoder, productFromText, isProductPage };
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
  let render = () => {}, notify = () => {}, requestsSeen = 0;
  let pageProduct = null, pageUrl = location.href, staleArticle = null;
  function refreshPage() {
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
      const nextFifo = parseFifo(data?.fifo, new Set(next.map(e => e.product.article)));
      entries = next; fifo = nextFifo;
      storageBroken = false;
    } catch { storageBroken = true; }
  }
  load();
  function save(next, nextFifo = fifo) {
    if (storageBroken) { notify('Opslag niet leesbaar. Bestaande gegevens worden niet overschreven.'); return false; }
    try {
      const cleanedFifo = parseFifo(nextFifo, new Set(next.map(e => e.product.article)));
      localStorage.setItem(KEY, JSON.stringify({ version: VERSION, entries: next, fifo: cleanedFifo }));
      entries = next; fifo = cleanedFifo;
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
      .launch{pointer-events:auto;margin:16px 16px calc(16px + env(safe-area-inset-bottom));min-height:44px;padding:10px 18px;background:#ffcc00;border-radius:6px;font-weight:700;box-shadow:0 2px 10px #0002}
      .save-product{pointer-events:auto;position:fixed;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));width:44px;height:44px;display:grid;place-items:center;cursor:pointer}
      .save-product input{width:26px;height:26px;margin:0;accent-color:#ffcc00;cursor:pointer;box-shadow:0 0 0 2px #fff;border-radius:3px}.save-product input:disabled{cursor:wait}
      dialog{pointer-events:auto;position:fixed;inset:0 0 0 auto;width:min(100%,400px);height:100%;height:100dvh;max-height:100%;max-width:100%;margin:0;border:0;padding:0;background:#fff;color:#222;box-shadow:-4px 0 24px #0002}
      dialog::backdrop{background:#0005}.shell{height:100%;display:flex;flex-direction:column}
      .head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top));border-bottom:4px solid #ffcc00}h1{font-size:21px;margin:0;font-weight:700}
      .close,.remove{flex-shrink:0;display:grid;place-items:center;width:44px;height:44px;background:transparent;border-radius:4px;font-size:25px;font-weight:400}.close:hover,.remove:hover{background:#f4f4f4}
      .body{overflow:auto;overscroll-behavior:contain;flex:1;padding:0 16px calc(16px + env(safe-area-inset-bottom))}.list{list-style:none;margin:0;padding:0}
      .item{display:flex;align-items:center;border-bottom:1px solid #e9e9e9;min-height:88px}.product{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:14px 0;text-decoration:none;color:inherit}.product:hover .name{text-decoration:underline}.product[aria-disabled]{cursor:default}
      .photo{flex:0 0 56px;width:56px;height:56px;display:grid;place-items:center;border-radius:4px;background:#fafafa}.photo img{width:100%;height:100%;object-fit:contain}.placeholder{width:22px;height:28px;border:1.5px solid #b5b5b5;border-radius:3px;background:linear-gradient(#fafafa 35%,#ffcc00 35%,#ffcc00 65%,#fafafa 65%)}
      .name{display:block;font-size:14px;font-weight:700;overflow-wrap:anywhere}.sub{display:block;font-size:13px;color:#707070;margin-top:3px}.remove{font-size:20px;color:#707070;margin-left:4px}.empty{padding:32px 0;color:#707070;font-size:14px}
      .toast{pointer-events:auto;position:fixed;bottom:calc(76px + env(safe-area-inset-bottom));right:16px;max-width:min(360px,calc(100vw - 32px));padding:12px 16px;background:#222;color:#fff;border-radius:4px;font-size:14px;box-shadow:0 2px 12px #0002}
      .nav{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #eee}.nav button{padding:10px 12px;min-height:44px;border-radius:4px;background:#f2f2f2}.nav button[aria-pressed="true"]{background:#ffcc00;font-weight:700}
      dialog.fifo-view{width:min(100%,760px)}.fifo-section h2{font-size:18px;margin:20px 0 10px}.fifo-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px}.fifo-table th{text-align:left;padding:8px 4px;border-bottom:2px solid #ffcc00}.fifo-table th:first-child{width:43%}.fifo-table th:nth-child(2){width:25%}.fifo-table td{padding:10px 4px;border-bottom:1px solid #e9e9e9;vertical-align:top}
      .fifo-table select,.fifo-table input{display:block;box-sizing:border-box;width:100%;min-width:0;height:44px;min-height:44px;max-height:44px;margin:0;padding:6px;border:1px solid #aaa;border-radius:4px;background:#fff;color:#222;font:inherit;font-size:16px;line-height:normal}.fifo-table select:focus-visible{outline:3px solid #222;outline-offset:2px}.fifo-table :disabled{opacity:.5}.fifo-help{font-size:14px;color:#666}
    `;
    host.style.setProperty('--list-font', getComputedStyle(document.body).fontFamily || 'Arial, sans-serif');
    root.append(style);
    function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
    function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b; }
    let view = 'list';
    const launch = button('Mijn lijst', () => { view = 'list'; load(); render(); dialog.showModal(); }, 'launch');
    const quickSave = el('label', undefined, 'save-product'), quickCheck = el('input');
    quickCheck.type = 'checkbox'; quickCheck.setAttribute('aria-label', 'Bewaar dit product');
    quickSave.append(quickCheck); quickSave.hidden = true;
    let displayedArticle = null;
    quickCheck.addEventListener('change', () => {
      const checked = quickCheck.checked;
      refreshPage(); load();
      const product = activeProduct();
      if (!product || product.article !== displayedArticle) {
        render(); notify('De productpagina is veranderd. Probeer opnieuw.'); return;
      }
      if (checked) {
        if (entries.length >= 10000) { notify('Je lijst is vol. Verwijder eerst een product.'); render(); return; }
        save(addEntry(entries, { ...product, url: safeUrl(location.href, true) }));
      } else save(entries.filter(e => e.product.article !== product.article));
      render();
    });
    const dialog = el('dialog'), shell = el('div', undefined, 'shell'), head = el('header', undefined, 'head');
    dialog.setAttribute('aria-labelledby', 'list-title');
    const title = el('h1', 'Mijn lijst'); title.id = 'list-title';
    const close = button('×', () => dialog.close(), 'close'); close.setAttribute('aria-label', 'Sluiten');
    head.append(title, close);
    const body = el('div', undefined, 'body'), list = el('ul', undefined, 'list');
    const nav = el('nav', undefined, 'nav'); nav.setAttribute('aria-label', 'Vulcheck pagina’s');
    const showView = next => { view = next; load(); render(); };
    const listButton = button('Mijn lijst', () => showView('list'));
    const fifoButton = button('Fifo check', () => showView('fifo'), 'fifo-button');
    nav.append(listButton, fifoButton);
    const fifoPage = el('div', undefined, 'fifo-page');
    body.append(list, fifoPage); shell.append(head, nav, body); dialog.append(shell);
    const toast = el('div', '', 'toast'); toast.hidden = true; toast.setAttribute('role', 'status');
    root.append(launch, quickSave, dialog, toast); document.body.append(host);
    let toastTimer;
    notify = message => { (dialog.open ? shell : root).append(toast); toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6500); };
    let listSignature = '';
    let fifoSignature = '';
    function renderFifo() {
      title.textContent = view === 'fifo' ? 'Fifo check' : 'Mijn lijst';
      dialog.classList.toggle('fifo-view', view === 'fifo');
      list.hidden = view !== 'list'; fifoPage.hidden = view !== 'fifo';
      listButton.setAttribute('aria-pressed', String(view === 'list'));
      fifoButton.setAttribute('aria-pressed', String(view === 'fifo'));
      if (view !== 'fifo') return;
      const products = [...new Map(entries.map(e => [e.product.article, e.product])).values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      const signature = JSON.stringify([storageBroken, fifo, products]);
      if (signature === fifoSignature) return;
      fifoSignature = signature;
      fifoPage.replaceChildren();
      if (storageBroken || !products.length) fifoPage.append(el('p', storageBroken ?
        'Je opgeslagen gegevens kunnen niet worden gelezen.' :
        'Bewaar eerst producten in Mijn lijst. Daarna kun je ze hier kiezen.', 'fifo-help'));
      for (const category of ['zuivel', 'vvp']) {
        const label = category === 'zuivel' ? 'Zuivel' : 'VVP';
        const section = el('section', undefined, 'fifo-section'), heading = el('h2', label);
        heading.id = 'fifo-' + category;
        const table = el('table', undefined, 'fifo-table'); table.dataset.category = category;
        table.setAttribute('aria-labelledby', heading.id);
        const thead = el('thead'), header = el('tr'), tbody = el('tbody');
        for (const text of ['Product', 'Fifo', 'Wie gevuld']) { const th = el('th', text); th.scope = 'col'; header.append(th); }
        thead.append(header); table.append(thead, tbody);
        fifo[category].forEach((row, index) => {
          const tr = el('tr'), product = el('select'), status = el('select'), names = el('input');
          const accessible = `${label}, rij ${index + 1}`;
          product.setAttribute('aria-label', 'Product — ' + accessible);
          status.setAttribute('aria-label', 'Fifo — ' + accessible);
          names.setAttribute('aria-label', 'Wie gevuld — ' + accessible);
          const option = (select, value, text) => { const o = el('option', text); o.value = value; select.append(o); };
          option(product, '', 'Kies product…');
          for (const p of products) {
            if (p.article === row.article || !fifo[category].some(r => r.article === p.article))
              option(product, p.article, `${p.name}${p.size ? ' · ' + p.size : ''}`);
          }
          product.value = row.article; product.disabled = storageBroken || !products.length;
          option(status, '', '—'); option(status, 'yes', 'Ja'); option(status, 'no', 'Nee');
          status.value = row.fifo === null ? '' : row.fifo ? 'yes' : 'no';
          names.type = 'text'; names.maxLength = 200; names.placeholder = 'Naam / namen'; names.value = row.names;
          status.disabled = names.disabled = storageBroken || !row.article;
          function update(field, value) {
            load();
            if (fifo[category][index].article !== row.article) { fifoSignature = ''; render(); notify('Deze rij is gewijzigd. Probeer opnieuw.'); return; }
            if (field === 'article' && value && fifo[category].some((r, i) => i !== index && r.article === value)) {
              fifoSignature = ''; render(); return;
            }
            const next = { ...fifo, [category]: fifo[category].map((r, i) => i !== index ? r :
              field === 'article' ? { ...emptyFifoRow(), article: value } : { ...r, [field]: value }) };
            const saved = save(entries, next);
            // Keep the text field and caret intact while typing.
            if (saved && field === 'names') fifoSignature = JSON.stringify([storageBroken, fifo, products]);
            else fifoSignature = '';
            render();
          }
          product.addEventListener('change', () => update('article', product.value));
          status.addEventListener('change', () => update('fifo', status.value === '' ? null : status.value === 'yes'));
          names.addEventListener('input', () => update('names', names.value));
          for (const control of [product, status, names]) { const td = el('td'); td.append(control); tr.append(td); }
          tbody.append(tr);
        });
        section.append(heading, table); fifoPage.append(section);
      }
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
      launch.textContent = unique.size ? 'Mijn lijst · ' + unique.size : 'Mijn lijst';
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
        const needsUpdate = entries.some(e => e.product.article === product.article &&
          ((url && e.product.url !== url) || (product.image && e.product.image !== product.image)));
        if (needsUpdate) save(entries.map(e => e.product.article === product.article ?
          { ...e, product: { ...e.product, ...(url ? { url } : {}), ...(product.image ? { image: product.image } : {}) } } : e));
      }
      const exists = product && entries.some(e => e.product.article === product.article);
      displayedArticle = product?.article || null;
      quickSave.hidden = !isProductPage(location.href);
      quickCheck.checked = Boolean(exists); quickCheck.disabled = !product || storageBroken;
      quickCheck.setAttribute('aria-label', exists ? 'Verwijder dit product uit mijn lijst' : 'Bewaar dit product');
      quickSave.title = product ? product.name + (exists ? ' · Op mijn lijst' : ' · Bewaren') : 'Product laden…';
      renderList();
      renderFifo();
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
