const { app, BrowserWindow, shell, Menu, ipcMain, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const APP_URL = 'https://space-media-app.vercel.app';
const isDev = process.argv.includes('--dev');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'SPACE Media App',
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

  const url = isDev ? 'http://localhost:3000' : APP_URL;
  mainWindow.loadURL(url);

  // External links → system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('http://localhost')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('http://localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
