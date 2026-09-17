// A single image-backed PDF page avoids Safari's HTML pagination and added footers.
function fifoPdf(doc) {
  const canvas = doc.createElement('canvas');
  const pageWidth = 841.89, pageHeight = 595.28, inset = 28.35, width = pageWidth - 2 * inset;
  canvas.width = Math.ceil(pageWidth * 3); canvas.height = Math.ceil(pageHeight * 3);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const font = (size, bold) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`; };
  const wrap = (text, maxWidth, size, bold = false) => {
    font(size, bold);
    const lines = [];
    let line = '';
    for (const word of text.trim().split(/\s+/)) {
      if (line && ctx.measureText(`${line} ${word}`).width <= maxWidth) { line += ` ${word}`; continue; }
      if (line) lines.push(line);
      line = '';
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const textBlock = (text, maxWidth, size, bold = false) => {
    const lines = wrap(text, maxWidth, size, bold);
    return { lines, size, bold, height: lines.length * size * 1.25 };
  };
  const drawText = (block, x, y) => {
    font(block.size, block.bold); ctx.fillStyle = '#111';
    block.lines.forEach((line, i) => ctx.fillText(line, x, y + i * block.size * 1.25));
  };
  const box = (x, y, w, h, shaded = false) => {
    if (shaded) { ctx.fillStyle = '#f1f1f1'; ctx.fillRect(x, y, w, h); }
    ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8; ctx.strokeRect(x, y, w, h);
  };
  const title = textBlock(doc.querySelector('h1').textContent, width, 19, true);
  const meta = [...doc.querySelectorAll('.meta span')].map(el => textBlock(el.textContent, width / 3 - 18, 10));
  const metaHeight = Math.max(...meta.map(block => block.height)) + 16;
  const columns = [10, 25, 7, 13, 25, 7, 13].map(percent => width * percent / 100);
  const rows = [...doc.querySelectorAll('table tr')].map((row, index) => {
    const cells = [...row.children].map((cell, column) => {
      // Keep article, product name and size on separate lines as in the preview.
      const marker = cell.classList.contains('answer') ? cell.textContent.trim()[0] : '';
      const marked = marker === '✓' || marker === '✗';
      const parts = [...cell.childNodes].map(node => node.textContent.trim()).filter(Boolean);
      const blocks = parts.map(text => textBlock(marked ? text.slice(1).trim() : text, columns[column] - 10 - (marked ? 12 : 0), index === 0 ? 9 : 10, cell.tagName === 'TH'));
      return { blocks, marker: marked ? marker : '', height: blocks.reduce((sum, block) => sum + block.height, 0) };
    });
    return { cells, height: Math.max(index === 0 ? 28 : 42.5, ...cells.map(cell => cell.height + 12)) };
  });
  const notesTitle = textBlock(doc.querySelector('.notes h2').textContent, width - 18, 13, true);
  const notes = [...doc.querySelectorAll('.notes p')].map(el => textBlock(el.textContent, width - 18, 9));
  const notesHeight = Math.max(164, 18 + notesTitle.height + notes.reduce((sum, block) => sum + block.height + 6, 0));
  const contentHeight = title.height + 12 + metaHeight + 12 + rows.reduce((sum, row) => sum + row.height, 0) + 12 + notesHeight;
  const scale = Math.min(1, (pageHeight - 2 * inset) / contentHeight);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(3, 3);
  ctx.translate(inset + width * (1 - scale) / 2, inset);
  ctx.scale(scale, scale); ctx.textBaseline = 'top';
  let y = 0;
  drawText(title, 0, y); y += title.height + 12;
  box(0, y, width, metaHeight);
  meta.forEach((block, i) => drawText(block, i * width / 3 + 8, y + 8));
  y += metaHeight + 12;
  rows.forEach((row, index) => {
    let x = 0;
    row.cells.forEach((cell, column) => {
      box(x, y, columns[column], row.height, index === 0);
      let textY = y + 6;
      if (cell.marker) {
        // Draw check/cross explicitly; not every platform font contains these glyphs.
        ctx.beginPath(); ctx.lineWidth = 1.2;
        if (cell.marker === '✓') { ctx.moveTo(x + 5, y + 11); ctx.lineTo(x + 8, y + 14); ctx.lineTo(x + 13, y + 7); }
        else { ctx.moveTo(x + 5, y + 7); ctx.lineTo(x + 12, y + 14); ctx.moveTo(x + 12, y + 7); ctx.lineTo(x + 5, y + 14); }
        ctx.stroke();
      }
      cell.blocks.forEach(block => { drawText(block, x + 5 + (cell.marker ? 12 : 0), textY); textY += block.height; });
      x += columns[column];
    });
    y += row.height;
  });
  y += 12; box(0, y, width, notesHeight); y += 9;
  drawText(notesTitle, 9, y); y += notesTitle.height + 6;
  notes.forEach(block => { drawText(block, 9, y); y += block.height + 6; });
  const jpeg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.95).split(',')[1]), char => char.charCodeAt(0));
  const ascii = text => Uint8Array.from(text, char => char.charCodeAt(0));
  const chunks = [], offsets = [0];
  let length = 0;
  const append = data => { chunks.push(data); length += data.length; };
  const object = (number, body, stream) => {
    offsets[number] = length;
    append(ascii(`${number} 0 obj\n${body}\n`));
    if (stream) { append(ascii('stream\n')); append(stream); append(ascii('\nendstream\n')); }
    append(ascii('endobj\n'));
  };
  append(ascii('%PDF-1.4\n'));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Sheet 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  const content = ascii(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Sheet Do Q`);
  object(5, `<< /Length ${content.length} >>`, content);
  const xref = length;
  append(ascii(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob(chunks, { type: 'application/pdf' });
}

export { fifoPdf };
