const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
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

function setup(initial = {}) {
  const dom = new JSDOM('<!doctype html><body><main id="product"></main></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // jsdom does not implement layout/innerText. Model the visible text separately
  // from the userscript's shadow UI; the product fixture is the only page content.
  Object.defineProperty(w.document.body, 'innerText', { get: () => w.document.querySelector('main').textContent });
  w.HTMLElement.prototype.getClientRects = () => [{}];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.confirm = () => true;
  for (const [key, value] of Object.entries(initial)) w.localStorage.setItem(key, value);
  w.document.querySelector('main').textContent = fusilli;
  w.eval(source);
  const root = w.document.querySelector('#ov-vulcheck').shadowRoot;
  const checkbox = root.querySelector('.save-product input');
  const stored = () => JSON.parse(w.localStorage.getItem('ov.vulcheck.v1'));
  const tick = async () => { await new Promise(resolve => w.setTimeout(resolve, 200)); };
  return { dom, w, root, checkbox, stored, tick };
}

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
      [...second.root.querySelectorAll('button')].find(b => b.textContent === 'Verwijderen').click();
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
