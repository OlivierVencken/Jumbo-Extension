# Mijn vulcheck

Personal Jumbo checklist userscript for Safari/Userscripts.
## Update on iPhone

1. Replace the contents of your existing `jumbo-checklist.user.js` in the folder used by Userscripts with the updated file. Keep only one enabled copy.
2. Reload `https://product.jumbo.com/` in Safari and open a product.
3. Check the checkbox in the top-right corner to save the product.
4. Open **Mijn lijst** at the bottom-right to see the saved product.

Unchecking the top-right checkbox or using a product's remove button removes it from the list. Reloading preserves the list, and products remain visible across days. Existing version 0.1.0 data remains compatible.

Open **Mijn lijst → Fifo check** for the **Zuivel** and **VVP** tables. Each table has five slots with **Product**, **Fifo**, and **Wie gevuld** columns. Choose from your saved products, select **Ja** or **Nee**, and enter one or more names. The initial **—** means not checked yet. Each product can be selected once per category. Select **Kies product…** to clear a slot.

FIFO selections, answers, and names save automatically on this device and remain until changed, including across days. Replacing a product clears that row's answer and names. Removing a product from Mijn lijst also clears its FIFO rows.

On **Fifo check**, use **Print / PDF** in the top-right corner to open a print-ready sheet and the browser's print menu. Choose a printer or **Save as PDF** (on iPhone, use the print preview's sharing options to save the PDF to Files). Allow pop-ups if prompted. The landscape A4 sheet follows the existing FIFO control form: Zuivel and VVP side by side, five rows each, article numbers and product names, FIFO answers, names, today's date/day, and space to write the controller and notes. Unchecked answers and empty slots remain blank. The preview stays open after printing or cancelling, with a button to print again. Long entries wrap and may continue onto additional pages. Safari/iPhone printing still needs an on-device check.

Product detection reads visible article details on `/p/artikel/…` pages, including the unlabelled article number above the name. This works without needing to capture the page's initial network response. The previous response decoder remains as a fallback. Product detection is based on the supplied screenshot; the authenticated Jumbo page and iPhone Safari still need an on-device check.

Data is saved only in the browser on that device. Clearing Safari website data removes the saved list.

## Local verification

`npm ci` then `npm test` runs extraction, checkbox, persistence, navigation, and storage-failure checks. `node tests/preview.cjs` serves a synthetic mobile fixture at `http://127.0.0.1:8124/p/artikel/fixture` for browser checks; it does not contact Jumbo.
