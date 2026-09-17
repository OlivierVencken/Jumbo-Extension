import { KEY, VERSION, parseProduct, parseBackup, parseFifo, parseRoundReport } from './model.mjs';

let entries = [], storageBroken = false;
let fifo = parseFifo(undefined, new Set());
let fifoProducts = [], lastRound = null, roundInProgress = false;
// Keep state immutable between successful loads/saves so renderers can reuse it.
let loadedRaw;
const allProducts = () => [...new Map([...fifoProducts, ...entries.map(e => e.product)].map(p => [p.article, p])).values()];
let notify = () => {};
export function setStorageNotifier(callback) { notify = callback; }

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!storageBroken && raw === loadedRaw) return;
    const data = raw ? JSON.parse(raw) : undefined;
    const next = data ? parseBackup(data) : [];
    if (data?.fifoProducts !== undefined && (!Array.isArray(data.fifoProducts) || data.fifoProducts.length > 10)) throw Error('Ongeldige FIFO-producten.');
    const catalog = new Map([...(data?.fifoProducts || []).map(parseProduct), ...next.map(e => e.product)].map(p => [p.article, p]));
    const nextFifo = parseFifo(data?.fifo, new Set(catalog.keys()));
    const selected = new Set(Object.values(nextFifo).flat().map(r => r.article));
    const nextReport = parseRoundReport(data?.lastRound);
    if (data?.roundInProgress !== undefined && typeof data.roundInProgress !== 'boolean') throw Error('Ongeldige FIFO-ronde.');
    const rows = Object.values(nextFifo).flat().filter(row => row.article);
    roundInProgress = rows.length > 0 && (data?.roundInProgress ??
      (rows.some(row => row.fifo !== null) && rows.some(row => row.fifo === null)));
    lastRound = nextReport; entries = next; fifo = nextFifo; fifoProducts = [...catalog.values()].filter(p => selected.has(p.article));
    storageBroken = false;
    loadedRaw = raw;
  } catch { storageBroken = true; }
}
function save(next, nextFifo = fifo, extraProducts = [], report = lastRound, inProgress = roundInProgress) {
  if (storageBroken) { notify('Opslag niet leesbaar. Bestaande gegevens worden niet overschreven.'); return false; }
  try {
    const catalog = new Map([...allProducts(), ...next.map(e => e.product), ...extraProducts.map(parseProduct)].map(p => [p.article, p]));
    const cleanedFifo = parseFifo(nextFifo, new Set(catalog.keys()));
    const selected = new Set(Object.values(cleanedFifo).flat().map(r => r.article));
    const nextProducts = [...catalog.values()].filter(p => selected.has(p.article));
    const nextReport = parseRoundReport(report);
    const nextInProgress = Boolean(inProgress && nextProducts.length);
    const raw = JSON.stringify({ version: VERSION, entries: next, fifo: cleanedFifo, fifoProducts: nextProducts, lastRound: nextReport, roundInProgress: nextInProgress });
    localStorage.setItem(KEY, raw);
    loadedRaw = raw;
    roundInProgress = nextInProgress; lastRound = nextReport; entries = next; fifo = cleanedFifo; fifoProducts = nextProducts;
    return true;
  } catch { notify('Opslaan mislukt. Maak ruimte vrij of controleer Safari-opslag.'); return false; }
}

export { entries, storageBroken, fifo, fifoProducts, lastRound, roundInProgress, allProducts, load, save };
