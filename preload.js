// Preload — inject drag region as a div (NOT body::before, which the web app
// uses for its nebula gradient effect). No global CSS hacks.

window.addEventListener('DOMContentLoaded', () => {
  // Draggable titlebar region as a real element
  const dragRegion = document.createElement('div');
  dragRegion.id = 'electron-drag-region';
  dragRegion.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'height: 40px',
    '-webkit-app-region: drag',
    'z-index: 99999',
    'pointer-events: none',
  ].join(';');
  document.body.appendChild(dragRegion);

  // Clickable elements must override the drag region
  const style = document.createElement('style');
  style.textContent = `
    button, a, input, select, textarea, [role="button"], [onclick] {
      -webkit-app-region: no-drag;
    }
    [data-pwa-install], .pwa-install-prompt {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
});
