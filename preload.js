// Preload — drag region + taskbar badge observer + titlebar theme resync

const { contextBridge, ipcRenderer } = require('electron');

// Expose restart function for auto-updater banner. With contextIsolation the
// preload's `window` is not the page's `window`, so the banner (injected via
// executeJavaScript into the main world) can only see it through contextBridge.
contextBridge.exposeInMainWorld('__electronRestart', () => ipcRenderer.send('restart-for-update'));

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    /* Drag region via body::after — doesn't conflict with body::before (nebula) */
    body::after {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      -webkit-app-region: drag;
      z-index: 99999;
    }

    /* Clickable elements in the top bar must override drag */
    button, a, input, select, textarea, [role="button"], [onclick] {
      -webkit-app-region: no-drag;
    }

    /* Hide PWA install prompts */
    [data-pwa-install], .pwa-install-prompt {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  // Watch for notification badge changes in the DOM.
  // The web app renders .notification-bell-badge with the unread count.
  // React mutates the DOM constantly (streaming chat, lists); the observer
  // callback is coalesced to one DOM query per animation frame instead of
  // one per mutation batch, so it never competes with rendering.
  let lastCount = 0;
  let badgeCheckScheduled = false;
  const readBadge = () => {
    badgeCheckScheduled = false;
    const badge = document.querySelector('.notification-bell-badge');
    const count = badge ? parseInt(badge.textContent || '0', 10) || 0 : 0;
    if (count !== lastCount) {
      lastCount = count;
      ipcRenderer.send('set-badge-count', count);
    }
  };
  const observer = new MutationObserver(() => {
    if (badgeCheckScheduled) return;
    badgeCheckScheduled = true;
    requestAnimationFrame(readBadge);
  });

  // Start observing once the app has loaded
  const startObserving = () => {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    readBadge();
  };

  // Wait a bit for the app to render
  setTimeout(startObserving, 3000);

  // Titlebar theme: the main process samples the pixels under the native
  // window controls. Instead of polling every second it now resamples when
  // something that can change the top-bar colour actually happens — theme /
  // brand switch (data-theme / data-brand on <html>). Route changes are caught
  // in main.js via 'did-navigate-in-page' — patching history.pushState here
  // would only patch the isolated preload world, not the page.
  const requestTitlebarSync = () => ipcRenderer.send('titlebar-resync');
  new MutationObserver(requestTitlebarSync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-brand', 'class', 'style'],
  });
});
