// Local-only mobile fixture, based on the supplied screenshot; no Jumbo requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req, res) => {
  if (req.url === '/userscript.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return res.end(fs.readFileSync(path.join(__dirname, '../jumbo-checklist.user.js')));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="nl"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vulcheck test fixture</title>
  <style>body{margin:0;font:16px Arial;background:white;color:#141414}header{height:155px;background:#f1f1f1;display:flex;align-items:center;justify-content:center}main{padding:16px}p{margin:0 0 16px}h1{font-size:20px}h2{font-size:16px;margin-top:36px}td{padding:14px 0;border-bottom:1px solid #eee}table{width:100%}small{color:#666}.pack{background:#f7c441;border-radius:16px;padding:25px 10px;font-weight:bold}.price{float:right;font-weight:bold;font-size:25px}</style>
  <header><span class="pack">FUSILLI</span></header><main><p>717144</p><h1>JUMBO FUSILLI</h1><span class="price">1<sup>15</sup></span><p>500 GR</p><p>✓ In assortiment</p><table><tr><td>Locatie</td><td>PASTA<br><small>meter 2, plank 7, positie 3</small></td></tr></table><h2>Eigenschappen</h2><table><tr><td>Collo inhoud</td><td>12 stuks</td></tr><tr><td>EAN</td><td>8718452931859</td></tr></table><h2>Beschikbaarheid</h2><p>In mijn assortiment</p></main><script src="/userscript.js"></script></html>`);
}).listen(8124, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:8124/p/artikel/fixture'));
