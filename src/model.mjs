import { safeUrl } from './urls.mjs';

const VERSION = 1;
const KEY = 'ov.vulcheck.v1';
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
function parseRoundReport(report) {
  if (report == null) return null;
  if (!Array.isArray(report.products) || report.products.length > 10 ||
      typeof report.date !== 'string' || !Number.isFinite(Date.parse(report.date))) throw Error('Ongeldig FIFO-resultaat.');
  const products = report.products.map(parseProduct);
  return { products, fifo: parseFifo(report.fifo, new Set(products.map(p => p.article))), date: report.date };
}

export { VERSION, KEY, day, parseProduct, parseBackup, addEntry, mergeEntries, emptyFifoRow, parseFifo, parseRoundReport };
