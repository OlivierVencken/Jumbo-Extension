function safeUrl(value, product = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (product && (url.origin !== 'https://product.jumbo.com' || !isProductPage(url.href))) return '';
    return url.href;
  } catch { return ''; }
}
function isProductPage(url) {
  try { const parsed = new URL(url); return /\/artikel\/[^/?#]+/i.test(parsed.pathname + parsed.hash); }
  catch { return false; }
}

export { safeUrl, isProductPage };
