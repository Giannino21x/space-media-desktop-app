// Preload script — runs in isolated context before web content loads
// Injects CSS to make the app feel native (draggable titlebar region, etc.)

window.addEventListener('DOMContentLoaded', () => {
  // Add drag region for frameless window (Windows uses titleBarOverlay, Mac uses hiddenInset)
  const style = document.createElement('style');
  style.textContent = `
    /* Make top area draggable like a native titlebar */
    body::before {
      content: '';
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      -webkit-app-region: drag;
      z-index: 99999;
      pointer-events: none;
    }

    /* Ensure clickable elements in the titlebar area still work */
    button, a, input, select, textarea, [role="button"], [onclick] {
      -webkit-app-region: no-drag;
    }

    /* Hide any web-based install prompts since we're already in the app */
    [data-pwa-install], .pwa-install-prompt {
      display: none !important;
    }

    /* Smooth scrolling everywhere */
    * {
      scroll-behavior: smooth;
    }
  `;
  document.head.appendChild(style);
});
