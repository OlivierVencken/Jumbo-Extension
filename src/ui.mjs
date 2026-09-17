import styles from './styles.css';
import { KEY, day, addEntry, emptyFifoRow } from './model.mjs';
import { safeUrl, isProductPage } from './urls.mjs';
import { entries, storageBroken, fifo, fifoProducts, lastRound, roundInProgress, allProducts, load, save, setStorageNotifier } from './storage.mjs';
import { refreshPage, activeProduct, controllerName, startPageTracking } from './page.mjs';
import { fifoPrintDocument, fitFifoSheet } from './print.mjs';
import { fifoPdf } from './pdf.mjs';
import JsBarcode from 'jsbarcode';

let render = () => {}, notify = () => {};

function mount() {
  const host = document.createElement('div');
  host.id = 'ov-vulcheck';
  host.style.cssText = 'position:fixed;z-index:2147483646;bottom:0;right:0;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
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
    load(); render();
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
  setStorageNotifier(notify);
  let listEntries = null, listStorageBroken;
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
    if (roundInProgress) { render(); notify('Er is al een FIFO-ronde bezig. Kies Verder met FIFO check.'); return; }
    const selected = chosenRows();
    if (storageBroken || !selected.length) return;
    const next = Object.fromEntries(['zuivel', 'vvp'].map(category => [category,
      fifo[category].map(row => ({ ...row, fifo: null, names: '' }))]));
    if (!save(entries, next, [], lastRound, true)) return;
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
    for (const [label, value] of [['Artikelnummer', product.article], ['EAN', product.ean || 'Niet bekend'], ['Locatie', [product.category, product.location].filter(Boolean).join(' · ') || 'Niet bekend'], ['Collo inhoud', product.pack]]) {
      if (!value) continue;
      const description = el('dd', value);
      if (label === 'Locatie' && (product.category || product.location)) {
        description.className = 'round-location'; description.replaceChildren();
        if (product.category) description.append(el('span', product.category));
        if (product.location) description.append(el('span', product.location, 'shelf-location'));
      }
      details.append(el('dt', label), description);
    }
    container.append(details);
    const toggle = button('', () => openBarcode(product, toggle), 'round-barcode-toggle');
    setIcon(toggle, 'Toon barcode', 'M5 7v10 M8 7v10 M12 7v10 M14 7v10 M18 7v10');
    toggle.setAttribute('aria-haspopup', 'dialog');
    toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'ov-barcode-sheet');
    container.append(toggle);
  }
  const barcodeSheet = el('dialog', undefined, 'barcode-sheet');
  barcodeSheet.id = 'ov-barcode-sheet'; barcodeSheet.setAttribute('aria-labelledby', 'ov-barcode-title');
  root.append(barcodeSheet);
  let barcodeTrigger;
  barcodeSheet.addEventListener('close', () => {
    barcodeTrigger?.setAttribute('aria-expanded', 'false');
    if (barcodeTrigger?.isConnected && dialog.open) barcodeTrigger.focus({ preventScroll: true });
  });
  barcodeSheet.addEventListener('click', event => {
    if (event.target === barcodeSheet) {
      const bounds = barcodeSheet.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) barcodeSheet.close();
    }
  });
  dialog.addEventListener('close', () => { if (barcodeSheet.open) barcodeSheet.close(); });
  function openBarcode(product, trigger) {
    barcodeTrigger = trigger;
    const closeIcon = button('×', () => barcodeSheet.close(), 'close barcode-close');
    closeIcon.setAttribute('aria-label', 'Barcode sluiten');
    const title = el('h2', product.name); title.id = 'ov-barcode-title';
    const content = el('div', undefined, 'round-barcodes');
    const ean = product.ean;
    if (!ean) content.append(el('p', 'Geen EAN opgeslagen. Open de productpagina en toon daar de barcode om deze op te halen.', 'sub'));
    else {
      const item = el('div', undefined, 'round-barcode');
      const format = { 8: 'EAN8', 12: 'UPC', 13: 'EAN13', 14: 'ITF14' }[ean.length];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try {
        if (!format) throw Error('Unsupported barcode');
        JsBarcode(svg, ean, { format, width: 2, height: 80, margin: 20, displayValue: false });
        svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Barcode ${ean}`);
        item.append(svg);
      } catch (_) {
        item.append(el('p', 'Deze code kan niet als barcode worden weergegeven.', 'sub'));
      }
      item.append(el('p', 'EAN ' + ean, 'barcode-number')); content.append(item);
    }
    const dismiss = button('Sluiten', () => barcodeSheet.close(), 'barcode-dismiss');
    barcodeSheet.replaceChildren(closeIcon, title, content, dismiss);
    trigger.setAttribute('aria-expanded', 'true'); barcodeSheet.showModal();
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
    if (barcodeSheet.open) barcodeSheet.close();
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
        if (!save(entries, cleared, [], report, false)) return;
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
    const signature = JSON.stringify([storageBroken, fifo, [...products], roundInProgress]);
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
    if (roundInProgress) {
      fifoPage.append(button('Verder met FIFO check', () => {
        load(); roundResult = null; round = chosenRows().map(({ category, article, key }) => ({ category, article, key }));
        roundFilter = chosenRows().find(row => row.fifo === null)?.category || 'zuivel';
        askingNames = false; namesDraft = ''; roundSignature = '';
        showView('round'); focusRound();
      }, 'round-primary resume-round'));
    }
    const start = button('Start FIFO check', startRound, 'round-primary start-round');
    start.disabled = storageBroken || roundInProgress || !chosenRows().length;
    fifoPage.append(start);
    if (lastRound && !rows.length) fifoPage.append(el('p', 'Je FIFO-producten zijn leeggemaakt. Met Print / PDF kun je de laatste afgeronde ronde nog printen.', 'fifo-help'));
    if (roundInProgress) fifoPage.append(el('p', 'Er is al een FIFO-ronde bezig. Rond deze eerst af voordat je een nieuwe start.', 'fifo-help'));
  }
  function renderList() {
    // Entries are replaced after load/save, never mutated in place. Page scans and
    // FIFO-only updates can reuse the existing rows without sorting/stringifying.
    if (listEntries === entries && listStorageBroken === storageBroken) return;
    listEntries = entries; listStorageBroken = storageBroken;
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
  render = (pageRefreshed = false) => {
    if (!pageRefreshed) refreshPage();
    const product = activeProduct();
    // Enrich legacy entries when their product is revisited, retaining notes and dates.
    if (product && !storageBroken) {
      const url = safeUrl(location.href, true);
      const existing = allProducts().find(p => p.article === product.article);
      const ean = product.ean || existing?.ean || '';
      const updates = { ...(url ? { url } : {}), ...(product.image ? { image: product.image } : {}),
        ...(ean ? { ean } : {}),
        ...(product.location ? { location: product.location } : {}), ...(product.category ? { category: product.category } : {}) };
      const outdated = p => p.article === product.article && Object.entries(updates).some(([key, value]) => p[key] !== value);
      if (entries.some(e => outdated(e.product)) || fifoProducts.some(outdated)) {
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
    if (signature !== lastPage) { lastPage = signature; render(true); }
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

export function start() {
  load();
  startPageTracking(() => render());
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
