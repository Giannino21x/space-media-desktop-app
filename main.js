const { app, BrowserWindow, shell, Menu } = require('electron');
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

app.on('ready', () => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
