'use strict';
if ('serviceWorker' in navigator && !window.DockNative) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
