# Mijn vulcheck

Personal Jumbo checklist userscript for Safari/Userscripts. Version 0.2.0 adds a checkbox to the top-right of product pages.

## Update on iPhone

1. Replace the contents of your existing `jumbo-checklist.user.js` in the folder used by Userscripts with the updated file. Keep only one enabled copy.
2. Reload `https://product.jumbo.com/` in Safari and open a product.
3. Check **Bewaar voor vandaag** in the top-right corner. The label changes to **Op je lijst vandaag**.
4. Open **Mijn vulcheck** at the bottom-right to see the saved product.

Unchecking the top-right checkbox asks before removing the product from today's list. The circle inside the list marks a saved product as checked/completed instead. Reloading preserves the list, notes, and completed status. Existing version 0.1.0 data remains compatible.

Product detection reads visible article details on `/p/artikel/…` pages, including the unlabelled article number above the name. This works without needing to capture the page's initial network response. The previous response decoder remains as a fallback. Product detection is based on the supplied screenshot; the authenticated Jumbo page and iPhone Safari still need an on-device check.

Data is saved only in the browser on that device. Use **Exporteer back-up** before clearing Safari website data.

## Local verification

`npm ci` then `npm test` runs extraction, checkbox, persistence, navigation, and storage-failure checks. `node tests/preview.cjs` serves a synthetic mobile fixture at `http://127.0.0.1:8124/p/artikel/fixture` for browser checks; it does not contact Jumbo.
