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
  const checkbox = root.querySelector('.save-product input');
  const stored = () => JSON.parse(w.localStorage.getItem('ov.vulcheck.v1'));
  const tick = async () => { await new Promise(resolve => w.setTimeout(resolve, 200)); };
  return { dom, w, root, checkbox, stored, tick, errors };
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
  const { dom, root, checkbox, errors } = setup();
  try {
    checkbox.click(); root.querySelector('.launch').click();
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

test('checkbox saves once, survives reload, and reflects checklist removal', async () => {
  const first = setup();
  try {
    assert.equal(first.checkbox.disabled, false);
    assert.equal(first.root.querySelector('.save-product').hidden, false);
    first.checkbox.click();
    assert.equal(first.stored().entries.length, 1);
    assert.equal(first.stored().entries[0].product.name, 'JUMBO FUSILLI');
    assert.equal(first.stored().entries[0].done, false);
    assert.equal(first.checkbox.checked, true);
    const saved = first.w.localStorage.getItem('ov.vulcheck.v1');
    const second = setup({ 'ov.vulcheck.v1': saved });
    try {
      assert.equal(second.checkbox.checked, true);
      const launch = second.root.querySelector('.launch'); launch.click();
      second.root.querySelector('.remove').click();
      assert.equal(second.checkbox.checked, false);
      assert.equal(second.stored().entries.length, 0);
      second.checkbox.click();
      assert.equal(second.stored().entries.length, 1);
      second.checkbox.click();
      assert.equal(second.stored().entries.length, 0);
    } finally { second.dom.window.close(); }
  } finally { first.dom.window.close(); }
});

test('SPA navigation clears the old product and saves the new one', async () => {
  const { dom, w, root, checkbox, stored, tick } = setup();
  try {
    w.history.pushState({}, '', '/p/artikel/second-product');
    // Click before the observer runs: never save old DOM under the new route.
    checkbox.click();
    assert.equal(stored(), null);
    w.document.querySelector('main').textContent = fusilli.replace('717144', '123456').replace('JUMBO FUSILLI', 'JUMBO PENNE');
    await tick();
    assert.equal(checkbox.disabled, false);
    assert.equal(checkbox.checked, false);
    checkbox.click();
    assert.equal(stored().entries[0].product.article, '123456');
    assert.equal(stored().entries[0].product.name, 'JUMBO PENNE');
    w.history.pushState({}, '', '/');
    w.document.querySelector('main').textContent = 'Zoek een product';
    await tick();
    assert.equal(root.querySelector('.save-product').hidden, true);
  } finally { dom.window.close(); }
});

test('late-rendered product details are detected without network interception', async () => {
  const { dom, w, root, checkbox, tick } = setup();
  try {
    w.document.querySelector('main').textContent = 'Laden…';
    await tick();
    assert.equal(checkbox.disabled, true);
    w.document.querySelector('main').textContent = fusilli;
    await tick();
    assert.equal(checkbox.disabled, false);
    assert.match(root.querySelector('.save-product').title, /JUMBO FUSILLI/);
  } finally { dom.window.close(); }
});

test('storage failure never leaves a falsely checked checkbox', () => {
  const { dom, w, root, checkbox } = setup();
  try {
    w.Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    checkbox.click();
    assert.equal(checkbox.checked, false);
    assert.match(root.querySelector('.toast').textContent, /Opslaan mislukt/);
  } finally { dom.window.close(); }
});


test('minimal list saves exact links and product photos, with no visible checkbox label', async () => {
  const { dom, w, root, checkbox, stored, tick } = setup();
  try {
    const image = w.document.createElement('img');
    image.src = 'https://images.jumbo.com/fusilli.png'; image.alt = 'JUMBO FUSILLI';
    w.document.querySelector('main').append(image);
    await tick(); checkbox.click();
    assert.equal(root.querySelector('.save-product').textContent, '');
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
  const { dom, root, checkbox, stored } = setup({ 'ov.vulcheck.v1': JSON.stringify({ version: 1, entries }) });
  try {
    assert.equal(root.querySelectorAll('.item').length, 1);
    assert.equal(checkbox.checked, true);
    assert.equal(root.querySelector('.product').href, url);
    assert.equal(stored().entries[0].note, 'Keep this note');
    checkbox.click();
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
