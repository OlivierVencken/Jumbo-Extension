import { createDecoder } from './decoder.mjs';
import { readPageProduct, readGreetingName } from './products.mjs';
import { isProductPage } from './urls.mjs';
import { backPage, recoverBack, cancelBackRecovery, installBackRecovery } from './navigation.mjs';
import { observeNetwork } from './network.mjs';

const decoder = createDecoder();
let current = null, generation = 0;
let render = () => {};
let pageProduct = null, pageUrl = location.href, staleArticle = null;
let controllerName = '';
function refreshPage() {
  // Mendix keeps this script alive between the search screen and article pages.
  // Do not persist a person's name alongside the shared checklist.
  if (/^\/p\/producten\/?$/.test(location.pathname)) controllerName = readGreetingName(document) || controllerName;
  if (pageUrl !== location.href) {
    cancelBackRecovery();
    staleArticle = pageProduct?.article || current?.article || null;
    pageUrl = location.href;
    generation++; decoder.reset(); current = null;
  }
  // Search pages cannot supply an active product; avoid scanning all their text/images.
  pageProduct = isProductPage(location.href) ? readPageProduct(document) : null;
  if (pageProduct?.article === staleArticle) pageProduct = null;
  else if (pageProduct) staleArticle = null;
}
function activeProduct() {
  if (!isProductPage(location.href)) return null;
  if (pageProduct) {
    return current?.article === pageProduct.article ? { ...current, ...pageProduct,
      ean: pageProduct.ean || current.ean } : pageProduct;
  }
  return current;
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
  try { current = decoder.ingest(data, context.bootstrap); render(); }
  catch { current = null; render(); }
}

export function startPageTracking(onChange) {
  render = onChange;
  installBackRecovery();
  observeNetwork(begin, receive);
}

export { refreshPage, activeProduct, controllerName };
