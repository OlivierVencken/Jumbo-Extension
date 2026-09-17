import { start } from './ui.mjs';

// Install once, only in the top-level page.
if (window.top === window.self && !window.__ovVulcheck) {
  window.__ovVulcheck = true;
  start();
}
