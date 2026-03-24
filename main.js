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
    title: 'SPACE Media',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#04070d',
    show: false,

    // Frameless + native traffic lights on Mac = Notion-style
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
      backgroundThrottling: false,
    },
  });

  // Smooth fade-in on load
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.setOpacity(0);
    let opacity = 0;
    const fadeIn = setInterval(() => {
      opacity += 0.1;
      if (opacity >= 1) {
        mainWindow.setOpacity(1);
        clearInterval(fadeIn);
      } else {
        mainWindow.setOpacity(opacity);
      }
    }, 12);
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

// Performance flags (must be before app.ready)
if (app && app.commandLine) {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
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
