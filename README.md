# Mijn vulcheck

Personal Jumbo checklist userscript for Safari/Userscripts.
## Update on iPhone

1. Replace the contents of your existing `jumbo-checklist.user.js` in the folder used by Userscripts with the updated file. Keep only one enabled copy.
2. Reload `https://product.jumbo.com/` in Safari and open a product.
3. Tap the product icon in the top-right corner, then choose Mijn lijst, Zuivel FIFO, or VVP FIFO. Each option independently adds or removes the current product.
4. Open the checklist icon beside the account icon to see **Mijn lijst**. On pages without an account icon, it appears at the bottom-right.

Tap a selected menu option again to remove the product from that destination. The remove button in Mijn lijst only removes it from that list. Reloading preserves the list, and products remain visible across days. Existing version 0.1.0 data remains compatible.

Open **Mijn lijst → Fifo check** for an overview of the chosen **Zuivel** and **VVP** products. Add products through the product menu and remove them with the × next to a product. Each category holds up to five products, independently of Mijn lijst.

Tap **Start FIFO check** to open a guided round. A new round clears previous answers and names, keeping the chosen products. Use the Zuivel/VVP filter to choose which category to check. Each product shows its name, size, article number, and available location and pack information. Older saved products may need to be reopened once to capture their shelf location.

Answer **Ja** to save and continue immediately, or **Nee** to enter the filler's name(s), then tap **Opslaan en verder**. Both categories must be completed before the round offers **Print / PDF**. Answers save after each completed product. **Verder met FIFO check** resumes a partial round, including after reloading when at least one answer has been saved. Removing or clearing Mijn lijst preserves FIFO products and answers.

On **Fifo check**, use the **Print / PDF** icon in the top-right corner to open the form preview, then tap **Open PDF**. Save or print that PDF through its viewer/share menu, or use **Download PDF** in the form preview. Allow pop-ups if prompted. The PDF is generated locally as exactly one landscape A4 page, without Safari's website URL, automatic date or page-count footer. The form's own date/day remains at the top. Zuivel and VVP appear side by side, with five rows each, article numbers and product names, FIFO answers, names, and space for the controller and notes. Unchecked answers and empty slots remain blank. Long entries wrap and the complete form scales down together, including notes. The PDF uses a high-resolution image, so its text is not selectable. No external PDF service or runtime library is used. Opening, sharing and printing still need an on-device iPhone check.

Product detection reads visible article details on `/p/artikel/…` pages, including the unlabelled article number above the name. This works without needing to capture the page's initial network response. The previous response decoder remains as a fallback. Product detection is based on the supplied screenshot; the authenticated Jumbo page and iPhone Safari still need an on-device check.

Data is saved only in the browser on that device. Clearing Safari website data removes the saved list.

The PDF's **Controleur** field is filled from the visible **Hello / Hallo {name}** greeting on the search page. The name stays available while navigating to products within the app and updates when another greeting appears. It is kept only in memory: after a full reload on a product page, visit the search page once before printing. If no greeting has been detected, the field remains blank for handwriting.

## Local verification

`npm ci` then `npm test` runs extraction, product menu, persistence, navigation, and storage-failure checks. `node tests/preview.cjs` serves a synthetic mobile fixture at `http://127.0.0.1:8124/p/artikel/fixture` for browser checks; it does not contact Jumbo.
