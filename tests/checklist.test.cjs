const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { productFromText, isProductPage } = require('../jumbo-checklist.user.js');
const source = fs.readFileSync(require.resolve('../jumbo-checklist.user.js'), 'utf8');
const url = 'https://product.jumbo.com/p/artikel/1f4a41b7-60ad-4cd0-b474-6c94dda7aab9';
// Text and order transcribed from the user's product-detail screenshot.
const fusilli = `717144\nJUMBO FUSILLI\n1\n15\n500 GR\nIn assortiment\nLocatie\nPASTA\nmeter 2, plank 7, positie 3\nEigenschappen\nCollo inhoud\n12 stuks\nEAN\n8718452931859\nBeschikbaarheid\nIn mijn assortiment\n19-01-2026 t/m 31-12-9999`;

test('reads the screenshot layout without an article-number label or semantic title', () => {
  assert.deepEqual(productFromText(fusilli, ['Eigenschappen', 'Beschikbaarheid'], url), {
    article: '717144', name: 'JUMBO FUSILLI', size: '500 GR', category: 'PASTA',
    pack: '12 stuks', eans: ['8718452931859']
  });
});

test('does not treat an unlabelled search result, UUID, price or EAN as an article', () => {
  assert.equal(productFromText(fusilli, [], 'https://product.jumbo.com/'), null);
  assert.equal(productFromText('JUMBO FUSILLI\n1\n15\nEAN\n8718452931859', [], url), null);
  assert.equal(productFromText('Laden…', [], url), null);
  assert.equal(isProductPage(url), true);
  assert.equal(isProductPage('https://product.jumbo.com/'), false);
});

test('also supports labelled article fields and tab-separated properties', () => {
  const p = productFromText('Artikelnummer: 123456\nOmschrijving: Melk\nEAN\t8712345678901');
  assert.equal(p.article, '123456');
  assert.equal(p.name, 'Melk');
  assert.deepEqual(p.eans, ['8712345678901']);
});

function setup(initial = {}, beforeEval = () => {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<!doctype html><body><main id="product"></main></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  // jsdom does not implement layout/innerText. Model the visible text separately
  // from the userscript's shadow UI; the product fixture is the only page content.
  Object.defineProperty(w.document.body, 'innerText', { get: () => w.document.querySelector('main').textContent });
  w.HTMLElement.prototype.getClientRects = () => [{}];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.confirm = () => true;
  for (const [key, value] of Object.entries(initial)) w.localStorage.setItem(key, value);
  beforeEval(w);
  w.document.querySelector('main').textContent = fusilli;
  w.eval(source);
  const root = w.document.querySelector('#ov-vulcheck').shadowRoot;
  const listAction = root.querySelector('[data-destination="list"]');
  const stored = () => JSON.parse(w.localStorage.getItem('ov.vulcheck.v1'));
  const tick = async () => { await new Promise(resolve => w.setTimeout(resolve, 200)); };
  return { dom, w, root, listAction, stored, tick, errors };
}

function backFixture(w) {
  const back = w.document.createElement('button');
  back.className = 'btn mx-button mx-name-actionButton7 elevation-high btn-icon-only spacing-outer-left-sm btn-default';
  back.dataset.buttonId = 'p.Producten.Article_Details.actionButton7';
  back.innerHTML = '<span class="glyphicon glyphicon-chevron-left" aria-hidden="true"></span>';
  w.document.querySelector('main').append(back);
  return back;
}

// Control just the recovery timers; DOM observation and product detection stay real.
function recoveryClock(w) {
  const pending = new Map();
  const originalSet = w.setTimeout.bind(w), originalClear = w.clearTimeout.bind(w);
  let id = -1;
  w.setTimeout = (fn, delay, ...args) => {
    if (delay !== 2500 && delay !== 300) return originalSet(fn, delay, ...args);
    pending.set(id, fn); return id--;
  };
  w.clearTimeout = timer => { pending.delete(timer); originalClear(timer); };
  return () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); };
}

test('opening the current saved product closes the list without reloading', () => {
  const { dom, root, listAction, errors } = setup();
  try {
    listAction.click(); root.querySelector('.launch').click();
    root.querySelector('.product').click();
    assert.equal(root.querySelector('dialog').open, false);
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('stuck back recovers without a session marker while allowing the native icon click', () => {
  const { dom, w, errors } = setup();
  try {
    const flush = recoveryClock(w), back = backFixture(w);
    let nativeClicks = 0;
    back.addEventListener('click', () => nativeClicks++);
    back.firstChild.click();
    assert.equal(nativeClicks, 1);
    assert.equal(errors.length, 0);
    flush();
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /navigation/);
  } finally { dom.window.close(); }
});

test('successful native navigation, hidden/replaced pages and disabled buttons do not redirect', () => {
  for (const state of ['route', 'removed', 'hidden', 'disabled', 'layout-hidden', 'other-button']) {
    const { dom, w, errors } = setup();
    try {
      const flush = recoveryClock(w), back = backFixture(w);
      if (state === 'disabled') back.dataset.disabled = 'true';
      if (state === 'other-button') back.dataset.buttonId = 'unrelated';
      back.click();
      if (state === 'route') w.history.pushState({}, '', '/');
      if (state === 'removed') back.remove();
      if (state === 'hidden') back.hidden = true;
      if (state === 'layout-hidden') back.getClientRects = () => [];
      flush();
      assert.equal(errors.length, 0, state);
    } finally { dom.window.close(); }
  }
});

test('observing the supplied close response recovers even without a captured click', () => {
  for (const closed of [true, false]) {
    const { dom, w, errors } = setup({}, w => {
      // No actual network traffic: exercise the real XHR observation wrapper.
      w.XMLHttpRequest.prototype.open = function () {};
      w.XMLHttpRequest.prototype.send = function () {};
    });
    try {
      const flush = recoveryClock(w);
      backFixture(w);
      const xhr = new w.XMLHttpRequest();
      xhr.open('POST', '/xas/');
      xhr.send(JSON.stringify({ action: 'runtimeOperation', params: { Article: { guid: '123' } } }));
      Object.defineProperties(xhr, {
        status: { value: 200 }, responseType: { value: 'json' },
        response: { value: {
          changes: { '123': { _PDPClosed: { value: closed } } },
          instructions: [{ type: 'close', target: 'system', args: { NumberOfPagesToClose: 1 } }]
        } }
      });
      xhr.dispatchEvent(new w.Event('load'));
      flush();
      assert.equal(errors.length, closed ? 1 : 0);
      if (closed) assert.match(errors[0].message, /navigation/);
    } finally { dom.window.close(); }
  }
});

test('listAction saves once, survives reload, and reflects checklist removal', async () => {
  const first = setup();
  try {
    assert.equal(first.listAction.disabled, false);
    assert.equal(first.root.querySelector('.save-product').hidden, false);
    first.listAction.click();
    assert.equal(first.stored().entries.length, 1);
    assert.equal(first.stored().entries[0].product.name, 'JUMBO FUSILLI');
    assert.equal(first.stored().entries[0].done, false);
    assert.equal((first.listAction.getAttribute('aria-pressed') === 'true'), true);
    const saved = first.w.localStorage.getItem('ov.vulcheck.v1');
    const second = setup({ 'ov.vulcheck.v1': saved });
    try {
      assert.equal((second.listAction.getAttribute('aria-pressed') === 'true'), true);
      const launch = second.root.querySelector('.launch'); launch.click();
      second.root.querySelector('.remove').click();
      assert.equal((second.listAction.getAttribute('aria-pressed') === 'true'), false);
      assert.equal(second.stored().entries.length, 0);
      second.listAction.click();
      assert.equal(second.stored().entries.length, 1);
      second.listAction.click();
      assert.equal(second.stored().entries.length, 0);
    } finally { second.dom.window.close(); }
  } finally { first.dom.window.close(); }
});

test('SPA navigation clears the old product and saves the new one', async () => {
  const { dom, w, root, listAction, stored, tick } = setup();
  try {
    w.history.pushState({}, '', '/p/artikel/second-product');
    // Click before the observer runs: never save old DOM under the new route.
    listAction.click();
    assert.equal(stored(), null);
    w.document.querySelector('main').textContent = fusilli.replace('717144', '123456').replace('JUMBO FUSILLI', 'JUMBO PENNE');
    await tick();
    assert.equal(listAction.disabled, false);
    assert.equal((listAction.getAttribute('aria-pressed') === 'true'), false);
    listAction.click();
    assert.equal(stored().entries[0].product.article, '123456');
    assert.equal(stored().entries[0].product.name, 'JUMBO PENNE');
    w.history.pushState({}, '', '/');
    w.document.querySelector('main').textContent = 'Zoek een product';
    await tick();
    assert.equal(root.querySelector('.save-product').hidden, true);
  } finally { dom.window.close(); }
});

test('late-rendered product details are detected without network interception', async () => {
  const { dom, w, root, listAction, tick } = setup();
  try {
    w.document.querySelector('main').textContent = 'Laden…';
    await tick();
    assert.equal(listAction.disabled, true);
    w.document.querySelector('main').textContent = fusilli;
    await tick();
    assert.equal(listAction.disabled, false);
    assert.match(root.querySelector('.save-product').title, /JUMBO FUSILLI/);
  } finally { dom.window.close(); }
});

test('storage failure never leaves a falsely checked listAction', () => {
  const { dom, w, root, listAction } = setup();
  try {
    w.Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    listAction.click();
    assert.equal((listAction.getAttribute('aria-pressed') === 'true'), false);
    assert.match(root.querySelector('.toast').textContent, /Opslaan mislukt/);
  } finally { dom.window.close(); }
});


test('minimal list saves exact links and product photos, with no visible listAction label', async () => {
  const { dom, w, root, listAction, stored, tick } = setup();
  try {
    const image = w.document.createElement('img');
    image.src = 'https://images.jumbo.com/fusilli.png'; image.alt = 'JUMBO FUSILLI';
    w.document.querySelector('main').append(image);
    await tick(); listAction.click();
    assert.equal(root.querySelector('.product-trigger').textContent, '');
    assert.equal(stored().entries[0].product.url, url);
    assert.equal(stored().entries[0].product.image, image.src);
    assert.equal(root.querySelector('.product').href, url);
    assert.equal(root.querySelector('.photo img').src, image.src);
    assert.equal(root.querySelectorAll('select, textarea, details, footer, .capture').length, 0);
    root.querySelector('.photo img').dispatchEvent(new w.Event('error'));
    assert.ok(root.querySelector('.placeholder'));
  } finally { dom.window.close(); }
});

test('older products stay visible across days, deduplicate, and acquire links on revisit', () => {
  const p = productFromText(fusilli, [], url);
  const entries = ['2026-01-01', '2026-01-02'].map(day => ({
    id: day + ':' + p.article, day, product: p, done: true, note: 'Keep this note', added: day + 'T12:00:00Z'
  }));
  const { dom, root, listAction, stored } = setup({ 'ov.vulcheck.v1': JSON.stringify({ version: 1, entries }) });
  try {
    assert.equal(root.querySelectorAll('.item').length, 1);
    assert.equal((listAction.getAttribute('aria-pressed') === 'true'), true);
    assert.equal(root.querySelector('.product').href, url);
    assert.equal(stored().entries[0].note, 'Keep this note');
    listAction.click();
    assert.equal(stored().entries.length, 0);
  } finally { dom.window.close(); }
});

test('stored links reject scripts and unrelated product destinations', () => {
  const { parseProduct, parseBackup } = require('../jumbo-checklist.user.js');
  const p = productFromText(fusilli, [], url);
  assert.equal(parseProduct({ ...p, url: 'javascript:alert(1)', image: 'data:text/html,bad' }).url, undefined);
  assert.equal(parseProduct({ ...p, url: 'https://example.com/p/artikel/123' }).url, undefined);
  assert.equal(parseProduct({ ...p, image: 'javascript:alert(1)' }).image, undefined);
  assert.equal(parseBackup({version: 1, entries: []}).length, 0);
});

function fifoFixture() {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    day: '2026-09-16', product: { article: String(100000 + i), name: `Product ${i + 1}`, eans: [] },
    done: false, note: '', added: '2026-09-16T12:00:00Z'
  }));
  return { 'ov.vulcheck.v1': JSON.stringify({ version: 1, entries }) };
}
function change(w, element, value, event = 'change') {
  element.value = value; element.dispatchEvent(new w.Event(event, { bubbles: true }));
}

test('greeting detection reads visible names, including nested text, and ignores inputs and hidden greetings', () => {
  const { readGreetingName } = require('../jumbo-checklist.user.js');
  const { dom, w } = setup();
  try {
    for (const [html, expected] of [
      ['<h1 class="mx-text mx-name-text1">Hello Olivier</h1>', 'Olivier'],
      ['<h5 class="mx-text mx-name-text1">Hallo Olivier 👋</h5>', 'Olivier'],
      ['<h5 class="mx-text mx-name-text1">Hallo Zoë van Dijk 👋🏽</h5>', 'Zoë van Dijk'],
      ['<div><h2 class="mx-text mx-name-text1">Hallo, <span>Zoë van Dijk</span>!</h2><p>Zoeken</p></div>', 'Zoë van Dijk'],
      ['<p class="mx-text mx-name-text1">Hello Anne-Marie O’Neill!</p>', 'Anne-Marie O’Neill'],
      ['<div hidden><h2 class="mx-text mx-name-text1">Hello Wrong</h2></div><h2 class="mx-text mx-name-text1">Hallo Sam</h2>', 'Sam'],
      ['<h2 class="mx-text mx-name-text1" aria-hidden="true">Hello Wrong</h2><input value="Hello Search">', ''],
      ['<h2 class="mx-text mx-name-text1" style="visibility:hidden">Hello Wrong</h2>', ''],
      ['<p class="mx-text mx-name-text1">Hello</p>', ''],
      ['<h1>Hello Wrong</h1><p class="mx-text mx-name-text1">Zoeken</p>', ''],
    ]) {
      w.document.querySelector('main').innerHTML = html;
      assert.equal(readGreetingName(w.document), expected, html);
    }
  } finally { dom.window.close(); }
});

test('PDF prefills the greeting name, retains it on article navigation, and refreshes it on the search page', async () => {
  const preview = new JSDOM('');
  preview.window.focus = preview.window.print = () => {};
  const { dom, w, root, tick } = setup({}, w => { w.open = () => preview.window; });
  const printController = () => {
    root.querySelector('.fifo-button').click();
    root.querySelector('.print-fifo').click();
    return preview.window.document.querySelector('.controller').textContent;
  };
  try {
    assert.match(printController(), /____/);
    w.history.pushState({}, '', '/p/producten');
    w.document.querySelector('main').innerHTML = '<h5 class="mx-text mx-name-text1">Hallo Olivier 👋</h5>';
    await tick();
    assert.equal(printController(), 'Controleur: Olivier');
    w.history.pushState({}, '', '/p/artikel/next');
    w.document.querySelector('main').textContent = fusilli;
    assert.equal(printController(), 'Controleur: Olivier');
    w.history.pushState({}, '', '/p/producten');
    w.document.querySelector('main').innerHTML = '<h5 class="mx-text mx-name-text1">Hallo Anne-Marie 👋</h5>';
    assert.equal(printController(), 'Controleur: Anne-Marie');
    assert.equal(w.localStorage.getItem('ov.vulcheck.v1'), null);
  } finally { dom.window.close(); preview.window.close(); }
});

test('product menu adds independent FIFO products, persists and exports them without list entries', () => {
  const preview = new JSDOM('', { url: 'https://product.jumbo.com/' });
  const { dom, w, root, stored, listAction } = setup({}, w => { w.open = () => preview.window; });
  try {
    const trigger = root.querySelector('.product-trigger'), menu = root.querySelector('.product-menu');
    const zuivel = root.querySelector('[data-destination="zuivel"]');
    const vvp = root.querySelector('[data-destination="vvp"]');
    trigger.click();
    assert.equal(menu.hidden, false);
    assert.equal(root.activeElement, listAction);
    zuivel.click(); vvp.click();
    assert.deepEqual(stored().entries, []);
    assert.equal(stored().fifo.zuivel[0].article, '717144');
    assert.equal(stored().fifo.vvp[0].article, '717144');
    assert.equal(stored().fifoProducts.length, 1);
    listAction.click(); listAction.click();
    assert.deepEqual(stored().entries, []);
    assert.equal(stored().fifo.zuivel[0].article, '717144');
    const second = setup({ 'ov.vulcheck.v1': JSON.stringify(stored()) });
    try {
      assert.equal(second.root.querySelector('[data-destination="zuivel"]').getAttribute('aria-pressed'), 'true');
      second.root.querySelector('.fifo-button').click();
      assert.match(second.root.querySelector('.fifo-table select').selectedOptions[0].textContent, /JUMBO FUSILLI/);
    } finally { second.w.close(); }
    zuivel.click();
    assert.equal(stored().fifo.zuivel[0].article, '');
    assert.equal(stored().fifo.vvp[0].article, '717144');
    root.querySelector('.fifo-button').click(); root.querySelector('.print-fifo').click();
    assert.match(preview.window.document.querySelector('tbody tr').textContent, /717144.*JUMBO FUSILLI/s);
    vvp.click();
    assert.deepEqual(stored().fifoProducts, []);
    trigger.click();
    listAction.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.hidden, true);
    assert.equal(root.activeElement, trigger);
    trigger.click(); w.document.body.click();
    assert.equal(menu.hidden, true);
  } finally { w.close(); preview.window.close(); }
});

test('product menu stays open through delayed focus changes, refreshes, and option clicks', async () => {
  const { w, root, tick } = setup();
  try {
    const trigger = root.querySelector('.product-trigger'), menu = root.querySelector('.product-menu');
    const outside = w.document.createElement('button');
    w.document.body.append(outside);
    trigger.click();
    await tick();
    // Model a page script reclaiming focus after the menu opens, without a click.
    outside.focus();
    w.dispatchEvent(new w.StorageEvent('storage', { key: 'ov.vulcheck.v1' }));
    await tick();
    assert.equal(menu.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    for (const action of root.querySelectorAll('.product-action')) {
      action.click();
      await tick();
      assert.equal(menu.hidden, false);
    }
    trigger.click();
    assert.equal(menu.hidden, true);
    trigger.click();
    menu.querySelector('p').click();
    assert.equal(menu.hidden, false);
    outside.click();
    assert.equal(menu.hidden, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally { w.close(); }
});

test('full FIFO categories and failed writes preserve products and independent destinations', () => {
  const { w, root, stored } = setup(fifoFixture());
  try {
    root.querySelector('.fifo-button').click();
    for (let i = 0; i < 5; i++) change(w, root.querySelectorAll('[data-category="zuivel"] tbody tr')[i].querySelector('select'), String(100000 + i));
    const before = JSON.stringify(stored());
    const zuivel = root.querySelector('[data-destination="zuivel"]'), vvp = root.querySelector('[data-destination="vvp"]');
    zuivel.click();
    assert.equal(JSON.stringify(stored()), before);
    assert.match(root.querySelector('.toast').textContent, /vol/);
    const originalSet = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = () => { throw Error('QuotaExceededError'); };
    vvp.click();
    assert.equal(vvp.getAttribute('aria-pressed'), 'false');
    assert.equal(JSON.stringify(stored()), before);
    w.Storage.prototype.setItem = originalSet;
    vvp.click();
    assert.equal(stored().fifo.vvp[0].article, '717144');
    assert.equal(stored().entries.some(e => e.product.article === '717144'), false);
  } finally { w.close(); }
});

test('FIFO has two five-row tables, unique saved choices, independent categories, and persistent answers', () => {
  const { dom, w, root, stored } = setup(fifoFixture());
  try {
    root.querySelector('.launch').click(); root.querySelector('.fifo-button').click();
    assert.equal(root.querySelectorAll('.fifo-table').length, 2);
    const rows = category => root.querySelectorAll(`[data-category="${category}"] tbody tr`);
    const controls = (category, index) => rows(category)[index].querySelectorAll('select, input');
    assert.equal(rows('zuivel').length, 5); assert.equal(rows('vvp').length, 5);
    assert.equal(controls('zuivel', 0)[1].disabled, true);
    for (let i = 0; i < 5; i++) change(w, controls('zuivel', i)[0], String(100000 + i));
    assert.equal(controls('zuivel', 0)[0].options.length, 3); // blank, current product, unused sixth
    change(w, controls('zuivel', 0)[1], 'yes');
    const input = controls('zuivel', 0)[2]; input.focus();
    change(w, input, 'Anne, Sam', 'input');
    assert.equal(root.activeElement, input);
    change(w, controls('vvp', 0)[0], '100000'); change(w, controls('vvp', 0)[1], 'no');
    assert.deepEqual(stored().fifo.zuivel[0], { article: '100000', fifo: true, names: 'Anne, Sam' });
    assert.equal(stored().fifo.vvp[0].fifo, false);
    const second = setup({ 'ov.vulcheck.v1': w.localStorage.getItem('ov.vulcheck.v1') });
    try {
      second.root.querySelector('.fifo-button').click();
      assert.equal(second.root.querySelector('.fifo-table input').value, 'Anne, Sam');
      assert.equal(second.root.querySelectorAll('.fifo-table select')[1].value, 'yes');
    } finally { second.dom.window.close(); }
    change(w, controls('zuivel', 0)[0], '100005');
    assert.deepEqual(stored().fifo.zuivel[0], { article: '100005', fifo: null, names: '' });
    change(w, controls('zuivel', 0)[0], '');
    assert.equal(controls('zuivel', 0)[2].disabled, true);
  } finally { dom.window.close(); }
});

test('removing a saved product preserves its FIFO row and failed writes restore the saved answer', () => {
  const { dom, w, root, stored } = setup(fifoFixture());
  try {
    root.querySelector('.fifo-button').click();
    change(w, root.querySelector('.fifo-table select'), '100000');
    const originalSet = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = () => { throw Error('QuotaExceededError'); };
    change(w, root.querySelectorAll('.fifo-table select')[1], 'yes');
    assert.equal(root.querySelectorAll('.fifo-table select')[1].value, '');
    assert.equal(stored().fifo.zuivel[0].fifo, null);
    assert.match(root.querySelector('.toast').textContent, /Opslaan mislukt/);
    w.Storage.prototype.setItem = originalSet;
    root.querySelector('.nav button').click(); root.querySelector('.remove').click();
    assert.deepEqual(stored().fifo.zuivel[0], { article: '100000', fifo: null, names: '' });
  } finally { dom.window.close(); }
});

test('clearing the list preserves independent FIFO selections', () => {
  const { dom, w, root, listAction, stored } = setup(fifoFixture());
  try {
    listAction.click(); root.querySelector('.launch').click();
    const clear = root.querySelector('.clear-list');
    assert.equal(clear.hidden, false);
    assert.equal(clear.disabled, false);
    root.querySelector('.fifo-button').click();
    assert.equal(clear.hidden, true);
    change(w, root.querySelector('.fifo-table select'), '100000');
    change(w, root.querySelectorAll('.fifo-table select')[1], 'yes');
    root.querySelector('.nav button').click();
    clear.click();
    assert.deepEqual(stored().entries, []);
    assert.deepEqual(stored().fifo.zuivel[0], { article: '100000', fifo: true, names: '' });
    assert.equal(stored().fifoProducts[0].article, '100000');
    assert.equal((listAction.getAttribute('aria-pressed') === 'true'), false);
    assert.equal(root.querySelectorAll('.item').length, 0);
    assert.equal(clear.disabled, true);
    assert.equal(root.activeElement, root.querySelector('.close'));
    const reloaded = setup({ 'ov.vulcheck.v1': JSON.stringify(stored()) });
    try { assert.equal(reloaded.root.querySelectorAll('.item').length, 0); }
    finally { reloaded.dom.window.close(); }
  } finally { dom.window.close(); }
});

test('failed clear preserves saved products and reports the failure', () => {
  const initial = fifoFixture();
  const { dom, w, root } = setup(initial);
  try {
    root.querySelector('.launch').click();
    w.Storage.prototype.setItem = () => { throw Error('QuotaExceededError'); };
    root.querySelector('.clear-list').click();
    assert.equal(w.localStorage.getItem('ov.vulcheck.v1'), initial['ov.vulcheck.v1']);
    assert.equal(root.querySelectorAll('.item').length, 6);
    assert.match(root.querySelector('.toast').textContent, /Opslaan mislukt/);
  } finally { dom.window.close(); }
});

test('malformed FIFO storage is protected from overwrites', () => {
  const initial = fifoFixture(), data = JSON.parse(initial['ov.vulcheck.v1']);
  data.fifo = { zuivel: Array(6).fill({ article: '', fifo: null, names: '' }), vvp: [] };
  initial['ov.vulcheck.v1'] = JSON.stringify(data);
  const { dom, w, root } = setup(initial);
  try {
    root.querySelector('.fifo-button').click();
    assert.equal(root.querySelector('.fifo-table select').disabled, true);
    assert.equal(root.querySelector('.print-fifo').disabled, true);
    assert.equal(root.querySelector('.clear-list').disabled, true);
    assert.equal(w.localStorage.getItem('ov.vulcheck.v1'), initial['ov.vulcheck.v1']);
  } finally { dom.window.close(); }
});

test('FIFO export previews both categories, current edits and blank slots without printing the webpage', () => {
  const initial = fifoFixture(), data = JSON.parse(initial['ov.vulcheck.v1']);
  data.entries[0].product.name = '<img src=x onerror=alert(1)> Melk & yoghurt';
  initial['ov.vulcheck.v1'] = JSON.stringify(data);
  const preview = new JSDOM('', { url: 'https://product.jumbo.com/' });
  let prints = 0;
  preview.window.print = () => prints++;
  preview.window.focus = () => {};
  const { dom, w, root } = setup(initial, w => { w.open = () => preview.window; });
  try {
    assert.equal(root.querySelector('.print-fifo').hidden, true);
    root.querySelector('.fifo-button').click();
    assert.equal(root.querySelector('.print-fifo').hidden, false);
    const controls = category => root.querySelector(`[data-category="${category}"] tbody tr`).querySelectorAll('select,input');
    change(w, controls('zuivel')[0], '100000');
    change(w, controls('zuivel')[1], 'yes');
    change(w, controls('zuivel')[2], 'Anne <Sam> & Jo', 'input');
    change(w, controls('vvp')[0], '100001');
    change(w, controls('vvp')[1], 'no');
    const before = w.localStorage.getItem('ov.vulcheck.v1');
    root.querySelector('.print-fifo').click();
    const doc = preview.window.document;
    assert.equal(prints, 0);
    assert.equal(doc.querySelectorAll('tbody tr').length, 5);
    const cells = doc.querySelector('tbody tr').querySelectorAll('td');
    assert.match(cells[0].textContent, /100000.*<img src=x onerror=alert\(1\)> Melk & yoghurt/s);
    assert.equal(cells[1].textContent, '✓ Ja');
    assert.equal(cells[2].textContent, 'Anne <Sam> & Jo');
    assert.match(cells[3].textContent, /100001/);
    assert.equal(cells[4].textContent, '✗ Nee');
    assert.equal(doc.querySelector('tbody tr:nth-child(2) td').textContent, '');
    assert.equal(doc.querySelectorAll('img,script,input,select').length, 0);
    assert.equal(w.localStorage.getItem('ov.vulcheck.v1'), before);
    assert.equal(doc.getElementById('print').textContent, 'Open PDF');
    root.querySelector('.nav button').click();
    assert.equal(root.querySelector('.print-fifo').hidden, true);
  } finally { dom.window.close(); preview.window.close(); }
});

test('blocked print popups explain how to retry and an empty FIFO list can be printed', () => {
  const { dom, root, errors } = setup({}, w => { w.open = () => null; });
  try {
    root.querySelector('.fifo-button').click();
    assert.equal(root.querySelector('.print-fifo').disabled, false);
    root.querySelector('.print-fifo').click();
    assert.match(root.querySelector('.toast').textContent, /pop-ups/);
    assert.equal(errors.length, 0);
  } finally { dom.window.close(); }
});

test('FIFO fits the entire form on narrow previews and refits tall content before printing', () => {
  const preview = new JSDOM('');
  let pageWidth = 390, pageHeight = 268, contentHeight = 720;
  // jsdom has no layout: model a mobile preview followed by landscape print geometry.
  Object.defineProperties(preview.window.HTMLElement.prototype, {
    clientWidth: { get() { return this.className === 'sheet' ? pageWidth : 0; } },
    clientHeight: { get() { return this.className === 'sheet' ? pageHeight : 0; } },
    offsetWidth: { get() { return this.tagName === 'MAIN' ? 1047 : 0; } },
    scrollHeight: { get() { return this.tagName === 'MAIN' ? contentHeight : 0; } }
  });
  preview.window.focus = preview.window.print = () => {};
  const { dom, root } = setup(fifoFixture(), w => { w.open = () => preview.window; });
  try {
    root.querySelector('.fifo-button').click();
    root.querySelector('.print-fifo').click();
    const main = preview.window.document.querySelector('main');
    const scale = () => Number(main.style.transform.match(/scale\(([^)]+)\)/)[1]);
    assert.ok(main.querySelector('.notes'));
    assert.ok(scale() * 1047 <= pageWidth);
    assert.ok(scale() * contentHeight <= pageHeight);
    // Long product/filler names must shrink, preserving notes on the same page.
    pageWidth = 1047; pageHeight = 718; contentHeight = 1500;
    preview.window.dispatchEvent(new preview.window.Event('beforeprint'));
    assert.equal(scale(), pageHeight / contentHeight);
    // Repeated printing measures original dimensions, so scaling never compounds.
    preview.window.dispatchEvent(new preview.window.Event('beforeprint'));
    assert.equal(scale(), pageHeight / contentHeight);
    contentHeight = 650;
    preview.window.dispatchEvent(new preview.window.Event('beforeprint'));
    assert.equal(scale(), 1);
    pageWidth = 390; pageHeight = 268;
    preview.window.dispatchEvent(new preview.window.Event('afterprint'));
    assert.equal(scale(), pageWidth / 1047);
  } finally { dom.window.close(); preview.window.close(); }
});

test('direct PDF contains exactly one landscape page, valid byte offsets and a complete image', async () => {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  for (const long of [false, true]) {
    const preview = new JSDOM('');
    const canvases = new WeakMap();
    preview.window.HTMLCanvasElement.prototype.getContext = function () {
      const canvas = createCanvas(this.width, this.height); canvases.set(this, canvas);
      return canvas.getContext('2d');
    };
    preview.window.HTMLCanvasElement.prototype.toDataURL = function (...args) { return canvases.get(this).toDataURL(...args); };
    const opened = [];
    preview.window.HTMLAnchorElement.prototype.click = function () { opened.push(this.href); };
    let pdf, created = 0;
    const initial = fifoFixture(), data = JSON.parse(initial['ov.vulcheck.v1']);
    data.entries[0].product.name = long ? 'Lange productomschrijving '.repeat(8) : 'Crème fraîche & yoghurt';
    data.fifo = Object.fromEntries(['zuivel', 'vvp'].map(category => [category, Array.from({ length: 5 }, (_, i) => ({
      article: String(100000 + i), fifo: i % 2 === 0, names: long ? 'Zoë Anne-Marie '.repeat(12) : 'Zoë, Anne-Marie'
    }))]));
    initial['ov.vulcheck.v1'] = JSON.stringify(data);
    const { dom, w, root } = setup(initial, w => {
      w.open = () => preview.window;
      w.URL.createObjectURL = blob => { pdf = blob; created++; return 'blob:https://product.jumbo.com/fixture'; };
    });
    try {
      root.querySelector('.fifo-button').click(); root.querySelector('.print-fifo').click();
      preview.window.document.getElementById('print').click();
      assert.equal(pdf.type, 'application/pdf');
      const bytes = await new Promise((resolve, reject) => {
        const reader = new w.FileReader(); reader.onload = () => resolve(Buffer.from(reader.result)); reader.onerror = reject;
        reader.readAsArrayBuffer(pdf);
      });
      const text = bytes.toString('latin1');
      assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 1);
      assert.match(text, /\/MediaBox \[0 0 841.89 595.28\]/);
      assert.match(text, /\/Count 1/);
      const xref = Number(text.match(/startxref\n(\d+)/)[1]);
      assert.equal(text.slice(xref, xref + 4), 'xref');
      const offsets = text.slice(xref).match(/\d{10} 00000 n/g).map(line => Number(line.slice(0, 10)));
      offsets.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj\n`)));
      const imageStart = text.indexOf('stream\n') + 7;
      const imageLength = Number(text.slice(0, imageStart).match(/\/Length (\d+)/)[1]);
      const image = await loadImage(bytes.subarray(imageStart, imageStart + imageLength));
      assert.equal(image.width, 2526); assert.equal(image.height, 1786);
      assert.equal(opened.length, 1);
      assert.equal(preview.window.document.getElementById('download').hidden, false);
      preview.window.document.getElementById('print').click();
      assert.equal(created, 1); assert.equal(opened.length, 2);
      if (process.env.FIFO_PDF_QA_DIR) {
        fs.mkdirSync(process.env.FIFO_PDF_QA_DIR, { recursive: true });
        fs.writeFileSync(require('node:path').join(process.env.FIFO_PDF_QA_DIR, long ? 'long.pdf' : 'normal.pdf'), bytes);
      }
    } finally { dom.window.close(); preview.window.close(); }
  }
});

test('PDF generation failure leaves the preview available to retry', () => {
  const preview = new JSDOM('');
  preview.window.HTMLCanvasElement.prototype.getContext = () => null;
  const { dom, root } = setup({}, w => { w.open = () => preview.window; });
  try {
    root.querySelector('.fifo-button').click(); root.querySelector('.print-fifo').click();
    preview.window.document.getElementById('print').click();
    assert.match(preview.window.document.getElementById('pdf-status').textContent, /mislukt/);
    assert.equal(preview.window.document.getElementById('download').hidden, true);
    assert.ok(preview.window.document.querySelector('.notes'));
  } finally { dom.window.close(); preview.window.close(); }
});
