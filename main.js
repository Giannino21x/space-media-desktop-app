const { app, BrowserWindow, shell, Menu, ipcMain, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const APP_URL = 'https://app.space-media.ch';
// Former production host. Still served by Vercel; keep it navigable so
// links/redirects that carry the old origin stay inside the window.
const LEGACY_APP_URL = 'https://space-media-app.vercel.app';

function isAppUrl(url) {
  return url.startsWith(APP_URL) || url.startsWith(LEGACY_APP_URL) || url.startsWith('http://localhost');
}
const isDev = process.argv.includes('--dev');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'SPACE Media Engine',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#04070d',
    show: false,

    // Frameless + native controls
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#04070d',
      symbolColor: '#ffffff',
      height: 40,
    } : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    roundedCorners: true,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:spaceapp',
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // Auto-grant notification permission (no browser popup needed)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Show after first paint is composited (prevents flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // --dev loads a local Next dev server; SPACE_DEV_URL overrides the port
  // when 3000 is taken (e.g. SPACE_DEV_URL=http://localhost:3100 npm run dev).
  const url = isDev ? (process.env.SPACE_DEV_URL || 'http://localhost:3000') : APP_URL;
  mainWindow.loadURL(url);

  // External links → system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Windows: adapt the window-control symbols (–, □, ×) to what's actually
  // rendered under the titlebar — sample real pixels, DOM-independent.
  //
  // Sampling is event-driven, not polled: capturePage is a compositor
  // readback, and doing it every second put a small hitch into an otherwise
  // steady frame rate. The renderer (preload.js) asks for a resync when the
  // theme/brand attribute or the route changes; focus and load do too. A slow
  // 10 s safety tick (only while the window is focused) catches everything else.
  if (process.platform === 'win32') {
    let applied = null; // last {r,g,b,symbolColor} actually set on the overlay
    let pendingCount = 0;
    let syncTimer = null;
    const syncTitlebarTheme = async () => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
      try {
        const [w] = mainWindow.getContentSize();
        // Sample a strip left of the native buttons (buttons are ~138px wide)
        const img = await mainWindow.webContents.capturePage({
          x: Math.max(0, w - 200), y: 6, width: 40, height: 28,
        });
        const bmp = img.toBitmap(); // BGRA
        if (!bmp.length) return;
        let r = 0, g = 0, b = 0;
        const px = bmp.length / 4;
        for (let i = 0; i < bmp.length; i += 4) {
          b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2];
        }
        r /= px; g /= px; b /= px;
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const symbolColor = luminance > 0.5 ? '#1f2937' : '#ffffff';
        const changed = !applied
          || applied.symbolColor !== symbolColor
          || Math.abs(applied.r - r) + Math.abs(applied.g - g) + Math.abs(applied.b - b) > 48;
        if (!changed) { pendingCount = 0; return; }
        // Require two consecutive samples that want a change, so one-frame
        // states (white load flash, dialogs sliding in) never stick.
        pendingCount++;
        if (pendingCount < 2) { scheduleSync(350); return; }
        pendingCount = 0;
        applied = { r, g, b, symbolColor };
        const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
        mainWindow.setTitleBarOverlay({
          color: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
          symbolColor,
          height: 40,
        });
      } catch (_) {
        // capturePage can fail transiently (e.g. during navigation) — ignore
      }
    };
    // Coalesce bursts (a route change fires several history/attribute events)
    // into one sample after the UI has settled.
    const scheduleSync = (delay) => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { syncTimer = null; syncTitlebarTheme(); }, delay);
    };
    // Delay the post-load sample past the initial paint/flash of the web app.
    mainWindow.webContents.on('did-finish-load', () => scheduleSync(1000));
    mainWindow.webContents.on('did-navigate-in-page', () => scheduleSync(400));
    mainWindow.on('focus', () => scheduleSync(50));
    ipcMain.on('titlebar-resync', () => scheduleSync(300));
    setInterval(() => { if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) scheduleSync(0); }, 10000);
  }
}

// Generate a badge overlay icon with a number (Windows taskbar)
function createBadgeIcon(count) {
  const size = 16;
  const canvas = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="8" fill="#ef4444"/>
      <text x="8" y="12" text-anchor="middle" fill="white" font-size="10" font-family="Arial" font-weight="bold">${count > 9 ? '9+' : count}</text>
    </svg>
  `;
  return nativeImage.createFromBuffer(
    Buffer.from(canvas.trim())
  );
}

// Restart app to install update
ipcMain.on('restart-for-update', () => {
  autoUpdater.quitAndInstall();
});

// Listen for badge count updates from the renderer
ipcMain.on('set-badge-count', (event, count) => {
  if (!mainWindow) return;
  if (process.platform === 'win32') {
    if (count > 0) {
      mainWindow.setOverlayIcon(createBadgeIcon(count), `${count} ungelesene Benachrichtigungen`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }
  // macOS dock badge
  if (process.platform === 'darwin') {
    app.setBadgeCount(count);
  }
});

// GPU flags — before app.ready
if (app && app.commandLine) {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
  app.commandLine.appendSwitch('enable-smooth-scrolling');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
  app.commandLine.appendSwitch('disable-features', 'PaintHolding');
}

// Windows: set app user model ID for notifications to show "SPACE Media App"
if (process.platform === 'win32') {
  app.setAppUserModelId('ch.space-media.app');
}

// Auto-updater: check GitHub Releases for new versions
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-downloaded', (info) => {
  // Silently install on next quit, or notify user
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      if (!document.getElementById('space-update-banner')) {
        const banner = document.createElement('div');
        banner.id = 'space-update-banner';
        banner.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(16,185,129,0.95);color:white;padding:12px 20px;border-radius:12px;font-family:Inter,sans-serif;font-size:13px;z-index:99999;cursor:pointer;box-shadow:0 8px 32px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px);';
        banner.innerHTML = '<span style="font-size:16px">✨</span> Update v${info.version} bereit — klicke zum Neustarten';
        banner.onclick = () => { window.__electronRestart && window.__electronRestart(); };
        document.body.appendChild(banner);
      }
    `);
  }
});

app.on('ready', () => {
  Menu.setApplicationMenu(null);
  createWindow();

  // Check for updates (not in dev mode)
  if (!isDev) {
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
    // Check every 30 minutes
    setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000);
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
