// Preload — use body::after for drag region (body::before is used by web app for nebula gradient)

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
});
