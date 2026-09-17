import { parseProduct } from './model.mjs';
import { safeUrl, isProductPage } from './urls.mjs';

// Read rendered product details as well as network data: Safari can inject after
// the initial responses, or run the script in a separate JavaScript world.
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
  const locationText = lines.join(' ');
  return parseProduct({ article, name,
    size: labelled(/^(?:netto[- ]?inhoud|inhoud)\s*:\s*(.*)$/i) ||
      (numberIndex >= 0 ? header.slice(numberIndex + 2).find(line => /^\d[\d.,]*\s*(?:GR|G|KG|ML|CL|L|ST|STUKS?)\b/i.test(line)) || '' : ''),
    category: labelled(/^(?:presentatiegroep|categorie|locatie)\s*:\s*(.*)$/i) || labelled(/^locatie$/i),
    location: ['meter', 'plank', 'positie'].map(label => {
      const match = locationText.match(new RegExp('\\b' + label + '\\s*:?\\s*(\\d+[a-z]?)\\b', 'i'));
      return match ? label + ' ' + match[1] : '';
    }).filter(Boolean).join(', '),
    pack: labelled(/^collo[- ]?inhoud\s*:?\s*(.*)$/i),
    ean: /^\d{8,14}$/.test(ean) ? ean : '' });
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

export { productFromText, readPageProduct, readGreetingName };
