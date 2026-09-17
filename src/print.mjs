import { day } from './model.mjs';

// A standalone document avoids printing Jumbo's page or the scrollable dialog.
function fifoPrintDocument(entries, fifo, date = new Date(), controller = '') {
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const products = new Map(entries.map(e => [e.product.article, e.product]));
  const cells = row => {
    const p = products.get(row.article);
    if (!p) return '<td></td><td></td><td></td>';
    return `<td><strong>${escape(p.article)}</strong><div>${escape(p.name)}</div>${p.size ? `<small>${escape(p.size)}</small>` : ''}</td>
      <td class="answer">${row.fifo === null ? '' : row.fifo ? '✓ Ja' : '✗ Nee'}</td><td>${escape(row.names)}</td>`;
  };
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>FIFO controle lijst - ${day(date)}</title><style>
    *{box-sizing:border-box}html{-webkit-text-size-adjust:none;text-size-adjust:none}body{margin:0;background:#eee;color:#111;font:10pt/1.2 Arial,sans-serif}
    .actions{padding:16px;text-align:center}.actions button{padding:12px 20px;font:inherit;font-weight:bold;cursor:pointer}.actions p{margin:8px 0}
    .sheet{position:relative;width:100%;max-width:277mm;aspect-ratio:277/190;margin:0 auto 20px;background:white;overflow:hidden}
    main{position:absolute;top:0;left:0;width:277mm;padding:10mm;background:white;transform-origin:top left}h1{font-size:19pt;margin:0 0 4mm}
    .meta{display:flex;gap:12mm;border:1.5pt solid #111;padding:3mm;margin-bottom:4mm}.controller{flex:1}
    table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1pt solid #111;padding:2mm;text-align:left;overflow-wrap:anywhere;vertical-align:top}
    thead th{background:#f1f1f1;vertical-align:middle;font-size:9pt}tbody th{font-size:10pt}tbody tr{height:15mm;break-inside:avoid}
    td div{margin-top:1mm}small{font-size:9pt}.answer{white-space:nowrap;font-size:10pt}
    .notes{margin-top:4mm;border:1.5pt solid #111;min-height:58mm;padding:3mm;break-inside:avoid}.notes h2{font-size:13pt;margin:0 0 3mm}
    .notes p{font-size:9pt;line-height:1.4;margin:2mm 0}
    /* Best-effort layout for manual webpage printing; use Open PDF for a clean export. */
    @page{size:A4 landscape;margin:0}@media print{body{background:white}.actions{display:none}.sheet{height:190mm;aspect-ratio:auto;margin:0 auto;break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}}
    </style></head><body><div class="actions"><button type="button" id="print">Open PDF</button> <a id="download" hidden>Download PDF</a><p id="pdf-status" role="status">Open de PDF en kies delen, bewaren of afdrukken.</p></div><div class="sheet"><main>
    <h1>Dagelijkse FIFO check!</h1><div class="meta"><span><strong>Datum:</strong> ${escape(date.toLocaleDateString('nl-NL'))}</span><span><strong>Dag:</strong> ${escape(date.toLocaleDateString('nl-NL', { weekday: 'long' }))}</span><span class="controller"><strong>Controleur:</strong> ${controller ? escape(controller) : '________________________'}</span></div>
    <table aria-label="FIFO controle Zuivel en VVP"><colgroup><col style="width:10%"><col style="width:25%"><col style="width:7%"><col style="width:13%"><col style="width:25%"><col style="width:7%"><col style="width:13%"></colgroup>
    <thead><tr><th scope="col">Productgroep</th><th scope="col">Artikelnummer - zuivel</th><th scope="col">Fifo?</th><th scope="col">Wie gevuld?</th><th scope="col">Artikelnummer - VVP</th><th scope="col">Fifo?</th><th scope="col">Wie gevuld?</th></tr></thead>
    <tbody>${Array.from({ length: 5 }, (_, i) => `<tr><th scope="row">Product ${i + 1}</th>${cells(fifo.zuivel[i])}${cells(fifo.vvp[i])}</tr>`).join('')}</tbody></table>
    <section class="notes"><h2>Opmerkingen / Bijzonderheden</h2><p><strong>FIFO gevuld? Vinkje zetten. Niet FIFO gevuld? Kruisje zetten.</strong> Leeg = nog niet gecontroleerd.</p>
    <p>Niet FIFO gevuld? Ga na wie het gevuld heeft. Niemand gevuld? Noteer alle vullers van deze koeling in het niet-FIFO-vullen-lijstje.</p></section>
    </main></div></body></html>`;
}

function fitFifoSheet(doc) {
  const sheet = doc.querySelector('.sheet'), content = sheet.querySelector('main');
  // Measure untransformed content, including long names, and shrink the entire form.
  // Absolute positioning keeps its original height out of the pagination flow.
  const width = content.offsetWidth, height = content.scrollHeight;
  if (!width || !height || !sheet.clientWidth || !sheet.clientHeight) return;
  const scale = Math.min(1, sheet.clientWidth / width, sheet.clientHeight / height);
  content.style.transform = `scale(${scale})`;
}

// Draw locally with the browser's fonts so accents and FIFO symbols survive export.

export { fifoPrintDocument, fitFifoSheet };
