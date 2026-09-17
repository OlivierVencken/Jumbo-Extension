import { parseProduct } from './model.mjs';

const fields = new Set(['ArticleNumber', 'Description', 'NetContent', 'ContentUnit',
  'PresentationGroupDescription', 'EanNumber', 'UnitFullName', 'ColloInhoud',
  'Producten.Unit_Article_Selected', 'Producten.Unit_Article', 'Producten.EanNumber_Article']);
const value = x => x && typeof x === 'object' ? x.value : undefined;
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
      const validEan = value => typeof value === 'string' && /^\d{8,14}$/.test(value);
      const ean = validEan(unit.EanNumber) ? unit.EanNumber : [...cache.values()]
        .find(x => x['Producten.EanNumber_Article'] === selected && validEan(x.EanNumber))?.EanNumber || '';
      result = parseProduct({ article: article.ArticleNumber, name: unit.Description,
        size: [unit.NetContent, unit.ContentUnit].filter(Boolean).join(' '),
        category: article.PresentationGroupDescription || '', ean,
        pack: unit.ColloInhoud || '' });
    }
    // A shift may contain many searches; old runtime objects are not a persistent catalogue.
    if (cache.size > 1500) { cache.clear(); selected = null; }
    return result;
  }
  return { ingest, reset() { cache.clear(); selected = null; } };
}

export { createDecoder };
