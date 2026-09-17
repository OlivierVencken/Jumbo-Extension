# Mijn vulcheck

Personal Jumbo checklist userscript for Safari/Userscripts.

## Development and production builds

Use Node.js 20.19+ and install the pinned dependencies with `npm ci`.
Edit **`src/`**, not the generated files in `dist/`.

| Command | Result |
| --- | --- |
| `npm run build` | Build the minified, standalone **`dist/jumbo-checklist.user.js`** for production. |
| `npm run build:dev` | Build readable `dist/jumbo-checklist.dev.user.js` with an inline source map. |
| `npm run dev` | Watch source and metadata changes and rebuild the development file automatically. |
| `npm run preview` | Build the development file and serve the local mobile fixture. |
| `npm test` | Rebuild production and run unit, bundle, and browser-fixture regression tests. |

For local development, run `npm run dev` in one terminal and `npm run preview`
in another. Open `http://127.0.0.1:8124/p/artikel/fixture` and refresh after edits.
The fixture contains synthetic product data and makes no Jumbo requests. For
testing on Jumbo, install the development file in Userscripts and reload the page
after copying a rebuild; keep only one copy enabled.

Before releasing, update `src/metadata.txt`, run `npm test`, and distribute only
`dist/jumbo-checklist.user.js`. All generated output lives in `dist/` and is
ignored by Git; run the build after a fresh checkout. Both builds embed
the JavaScript and styles in a single file, preserve the userscript header at the
very top, and need no runtime dependencies, external imports, or build server.
The build targets Safari 15.4+ syntax; real iPhone behavior still needs device testing.

### Source layout

| File | Responsibility |
| --- | --- |
| `src/main.mjs` | Top-level startup and duplicate/frame guards. |
| `src/model.mjs` | Product, checklist, FIFO and saved-report validation. |
| `src/storage.mjs` | Persistence, immutable state, and storage-failure protection. |
| `src/products.mjs` | Visible product details and greeting extraction. |
| `src/decoder.mjs` | Product fallback from Mendix responses. |
| `src/page.mjs` | Current product, route changes, and response coordination. |
| `src/network.mjs` | Passive fetch/XHR observation. |
| `src/navigation.mjs` | Recovery from a stuck native Back action. |
| `src/ui.mjs`, `src/styles.css` | Checklist, product menu, FIFO rounds and appearance. |
| `src/print.mjs`, `src/pdf.mjs` | Print preview and local one-page PDF generation. |
| `src/urls.mjs`, `src/core.mjs` | URL validation and pure helper exports for tests. |
| `src/metadata.txt` | Userscript name, version, matches and permissions. |
| `scripts/build.mjs` | esbuild bundling, watch mode and atomic output writes. |

UI and page callbacks are wired during startup. Storage exports live ES-module
bindings; replace state through `load()`/`save()` rather than mutating it. This
lets unchanged storage reuse validated data and unchanged lists reuse their rows.
Product extraction skips search pages, and each page scan supplies its result to
the renderer without scanning the DOM a second time. Storage keys and data formats
remain compatible with previous releases.

## Update on iPhone

1. Run `npm run build`, then copy `dist/jumbo-checklist.user.js` into the folder used by Userscripts, replacing the existing file. Keep only one enabled copy.
2. Reload `https://product.jumbo.com/` in Safari and open a product.
3. Tap the product icon in the top-right corner, then choose Mijn lijst, Zuivel FIFO, or VVP FIFO. Each option independently adds or removes the current product.
4. Open the checklist icon beside the account icon to see **Mijn lijst**. On pages without an account icon, it appears at the bottom-right.

Tap a selected menu option again to remove the product from that destination. The remove button in Mijn lijst only removes it from that list. Reloading preserves the list, and products remain visible across days. Existing version 0.1.0 data remains compatible.

Open **Mijn lijst → Fifo check** for an overview of the chosen **Zuivel** and **VVP** products. Add products through the product menu and remove them with the × next to a product. Each category holds up to five products, independently of Mijn lijst.

Tap **Start FIFO check** to open a guided round. A new round clears previous answers and names, keeping the chosen products. Use the Zuivel/VVP filter to choose which category to check. Each product shows its name, size, article number, and available location (presentation group, meter, plank, and positie) and pack information. Older saved products may need to be reopened once to capture their shelf location.

Answer **Ja** to save and continue immediately, or **Nee** to enter the filler's name(s), then tap **Opslaan en verder**. Both categories must be completed before the round offers **Print / PDF**. Completing the round clears its selected FIFO products automatically. The latest completed table is saved separately for printing, including after a reload; use the print icon on the empty FIFO overview. Answers save after each completed product. **Verder met FIFO check** resumes a partial round, including after reloading before the first answer. While a round is in progress, Start FIFO check is disabled; resume and finish the existing round first. Removing or clearing Mijn lijst preserves FIFO products and answers.

On **Fifo check**, use the **Print / PDF** icon in the top-right corner to open the form preview, then tap **Open PDF**. Save or print that PDF through its viewer/share menu, or use **Download PDF** in the form preview. Allow pop-ups if prompted. The PDF is generated locally as exactly one landscape A4 page, without Safari's website URL, automatic date or page-count footer. The form's own date/day remains at the top. Zuivel and VVP appear side by side, with five rows each, article numbers and product names, FIFO answers, names, and space for the controller and notes. Unchecked answers and empty slots remain blank. Long entries wrap and the complete form scales down together, including notes. The PDF uses a high-resolution image, so its text is not selectable. No external PDF service or runtime library is used. Opening, sharing and printing still need an on-device iPhone check.

Product detection reads visible article details on `/p/artikel/…` pages, including the unlabelled article number above the name. This works without needing to capture the page's initial network response. The previous response decoder remains as a fallback. Product detection is based on the supplied screenshot; the authenticated Jumbo page and iPhone Safari still need an on-device check.

Data is saved only in the browser on that device. Clearing Safari website data removes the saved list.

The PDF's **Controleur** field is filled from the visible **Hello / Hallo {name}** greeting on the search page. The name stays available while navigating to products within the app and updates when another greeting appears. It is kept only in memory: after a full reload on a product page, visit the search page once before printing. If no greeting has been detected, the field remains blank for handwriting.

## Local verification

`npm ci` then `npm test` checks extraction, product menus, persistence, navigation,
storage failures, FIFO rounds, PDF output, startup guards, and both bundle formats.
Tests exercise the generated production file in jsdom and import pure helpers
directly from source. `npm run preview` serves the development fixture;
`node tests/preview.cjs` serves the current production file in the same fixture.
