import { isProductPage } from './urls.mjs';

const BACK_SELECTOR = 'button[data-button-id="p.Producten.Article_Details.actionButton7"], .productpage button.mx-name-actionButton7';
let backRecoveryTimer;
function backPage(button = document.querySelector(BACK_SELECTOR)) {
  return isProductPage(location.href) && button ? { url: location.href, button } : null;
}
function recoverBack(page, delay) {
  if (!page) return;
  clearTimeout(backRecoveryTimer);
  backRecoveryTimer = setTimeout(() => {
    const { button, url } = page;
    // Give Mendix time to close the screen. Never redirect a new or hidden page.
    if (location.href === url && button.isConnected && button.getClientRects().length &&
        !button.closest('[hidden], [aria-hidden="true"]')) location.assign('/');
  }, delay);
}
export function cancelBackRecovery() { clearTimeout(backRecoveryTimer); }

export function installBackRecovery() {
  document.addEventListener('click', event => {
    const back = event.target instanceof Element && event.target.closest(BACK_SELECTOR);
    if (!back || back.disabled || back.dataset.disabled === 'true') return;
    // Also works in Safari's isolated world, where network hooks may be unavailable.
    recoverBack(backPage(back), 2500);
  }, true);
}

export { backPage, recoverBack };
