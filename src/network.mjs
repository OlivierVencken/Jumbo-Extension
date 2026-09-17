// Observe existing responses without initiating requests or consuming original bodies.
export function observeNetwork(begin, receive) {
  function isXas(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin && /^\/xas\/?$/.test(u.pathname); }
    catch { return false; }
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
}
