// Preload — drag region + taskbar badge observer

const { ipcRenderer } = require('electron');

// Expose restart function for auto-updater banner
window.__electronRestart = () => ipcRenderer.send('restart-for-update');

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

  // Watch for notification badge changes in the DOM
  // The web app renders .notification-bell-badge with the unread count
  let lastCount = 0;
  const observer = new MutationObserver(() => {
    const badge = document.querySelector('.notification-bell-badge');
    const count = badge ? parseInt(badge.textContent || '0', 10) || 0 : 0;
    if (count !== lastCount) {
      lastCount = count;
      ipcRenderer.send('set-badge-count', count);
    }
  });

  // Start observing once the app has loaded
  const startObserving = () => {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // Initial check
    const badge = document.querySelector('.notification-bell-badge');
    const count = badge ? parseInt(badge.textContent || '0', 10) || 0 : 0;
    if (count > 0) {
      ipcRenderer.send('set-badge-count', count);
    }
  };

  // Wait a bit for the app to render
  setTimeout(startObserving, 3000);
});
