const { app, BrowserWindow, shell, Menu, ipcMain, nativeImage, dialog, net, Tray, Notification } = require('electron');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const os = require('os');
const path = require('path');
const { anmeldeAdresse, connectorOrigin, createConnectorHost } = require('./connector');
const { DateienFehler, createDateienHost, fehlerMeldung, grundVon } = require('./dateien');
const { fensterWache } = require('./fenster');
const { createInselHost } = require('./insel/insel');

// Tests can run a second copy next to the installed app with their own data.
if (process.env.SPACE_USER_DATA) app.setPath('userData', process.env.SPACE_USER_DATA);

// One app per user (packaged). A second start hands its arguments to this one — opening the app again focuses
// the window, and Claude Code's sign-in (BROWSER = this exe) delivers Anthropic's page here, so the app opens it
// from the foreground and the browser comes to the front (connector.js anmelden).
const einzigeInstanz = !app.isPackaged || app.requestSingleInstanceLock();
if (!einzigeInstanz) app.quit();

const APP_URL = 'https://app.space-media.ch';
// Former production host. Still served by Vercel; keep it navigable so
// links/redirects that carry the old origin stay inside the window.
const LEGACY_APP_URL = 'https://space-media-app.vercel.app';
const APP_ORIGINS = [APP_URL, LEGACY_APP_URL];
const isDev = process.argv.includes('--dev');

// Only the app's own pages stay in the window (exact origin, localhost only with --dev) — the same rule as the
// bridges; everything else opens in the system browser (fenster.js).
const appFenster = fensterWache({ allowed: APP_ORIGINS, isDev, openExternal: (url) => shell.openExternal(url) });

// Background (Windows): the X hides the window, the app keeps running in the notification area so the
// SPACE Connector («Eigenes Claude-Abo») keeps serving the person's chat — also from the phone. «Beenden» in
// the tray menu (or an update) really quits. Started with Windows (login item) the app comes up hidden.
const IM_HINTERGRUND_ARG = '--im-hintergrund';
const hintergrund = process.platform === 'win32';
const versteckterStart = process.argv.includes(IM_HINTERGRUND_ARG);
let beenden = false;
let tray = null;

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

  // Notifications without a browser popup; the microphone (audio only) for the app's own pages — dictation and
  // meeting recording in the app. Everything else is refused.
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'notifications') return callback(true);
    if (permission === 'media') {
      const nurTon = !details.mediaTypes || details.mediaTypes.every((t) => t === 'audio');
      return callback(nurTon && appFenster.imFenster((details && details.requestingUrl) || webContents.getURL()));
    }
    callback(false);
  });

  // Show after first paint is composited (prevents flash). Started with Windows: stay in the tray.
  mainWindow.once('ready-to-show', () => {
    if (!versteckterStart) mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (beenden || !hintergrund || !tray) return;
    event.preventDefault();
    mainWindow.hide();
    hintergrundHinweis();
  });

  // --dev loads a local Next dev server; SPACE_DEV_URL overrides the port
  // when 3000 is taken (e.g. SPACE_DEV_URL=http://localhost:3100 npm run dev).
  const url = isDev ? (process.env.SPACE_DEV_URL || 'http://localhost:3000') : APP_URL;
  mainWindow.loadURL(url);

  // External links → system browser
  mainWindow.webContents.setWindowOpenHandler(appFenster.oeffnen);
  mainWindow.webContents.on('will-navigate', appFenster.navigieren);
  // Signed in or out (a full navigation): the island asks the app again.
  mainWindow.webContents.on('did-navigate', () => { if (insel) insel.neuLaden(); });

  // The window (taskbar, Alt+Tab) is always «SPACE Media Engine» — without
  // this Electron takes the page title («SPACE Bot», «Chat · SPACE Bot»).
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
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

/** Bring the window back (tray click, second app start, notification). */
function zeigen() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const hintergrundDatei = () => path.join(app.getPath('userData'), 'hintergrund.json');

/** Once: tell the person the app is still running (where to find it, how to quit). */
function hintergrundHinweis() {
  try {
    if (JSON.parse(fs.readFileSync(hintergrundDatei(), 'utf8')).hinweis) return;
  } catch { /* first time */ }
  try { fs.writeFileSync(hintergrundDatei(), JSON.stringify({ hinweis: true })); } catch { /* best effort */ }
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: 'SPACE läuft im Hintergrund weiter',
    body: 'Öffnen oder beenden über das SPACE-Symbol unten rechts neben der Uhr.',
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });
  n.on('click', zeigen);
  n.show();
}

/** Start with Windows (hidden, in the tray). */
function mitWindowsStarten(an) {
  if (!hintergrund || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: an, args: [IM_HINTERGRUND_ARG] });
  trayMenue();
}

function trayMenue() {
  if (!tray) return;
  const autostart = app.getLoginItemSettings({ args: [IM_HINTERGRUND_ARG] }).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'SPACE öffnen', click: zeigen },
    { type: 'separator' },
    { label: 'Mit Windows starten', type: 'checkbox', checked: autostart, enabled: app.isPackaged, click: (item) => mitWindowsStarten(item.checked) },
    ...(insel ? [
      { type: 'separator' },
      { label: 'Insel oben anzeigen', type: 'checkbox', checked: insel.an, click: (item) => insel.schalten(item.checked) },
      { label: 'Diktieren mit Strg rechts', type: 'checkbox', checked: insel.diktat, enabled: insel.an, click: (item) => insel.diktatSchalten(item.checked) },
    ] : []),
    { type: 'separator' },
    { label: 'Beenden', click: () => { beenden = true; app.quit(); } },
  ]));
}

function trayAnlegen() {
  if (!hintergrund || tray) return;
  // The SPACE face, drawn crisp for 16–64 px (insel/ui/gesicht.js); amber eyes while an approval waits.
  tray = new Tray(path.join(__dirname, 'assets', 'tray.ico'));
  tray.setToolTip('SPACE Media Engine');
  tray.on('click', zeigen);
  trayMenue();
}

// Restart app to install update
ipcMain.on('restart-for-update', () => {
  // setImmediate: let the IPC handler return before the windows are torn down.
  // (isSilent=false, isForceRunAfter=true) → relaunch the app after installing.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
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

// Only the app's own pages may use the bridges (connector, PC folders); the origin comes from the asking frame,
// never from the page's arguments. localhost only with --dev. No frame (already navigated away) → refused.
function appSenderOrigin(event) {
  if (!event.senderFrame) return null;
  return connectorOrigin(event.senderFrame.url, { allowed: APP_ORIGINS, isDev });
}

// «Eigenes Claude-Abo»: the SPACE Connector runs in the background while the app is open (connector.js).
let connector = null;

// The island (insel/insel.js): SPACE at the top edge of the screen, also while this window is closed — Flow
// dictation (right Ctrl), approvals, a dropped file for the chat. Windows for now.
let insel = null;
// A file dropped on the island, waiting for the chat to take it (once, two minutes).
let inselDatei = null;

/** Navigate the app window client-side (Next router), without a reload when the page is the app. */
function appNavigieren(pfad, opts) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  const sagen = opts && opts.sagen ? JSON.stringify({ ...opts.sagen, at: Date.now() }) : null;
  const js = `(function (p, sagen) {
    try { if (sagen) sessionStorage.setItem('space-sagen-start', sagen); } catch (e) {}
    if (location.pathname + location.search === p) { window.dispatchEvent(new Event('insel:datei')); return; }
    if (window.next && window.next.router && typeof window.next.router.push === 'function') window.next.router.push(p);
    else location.assign(p);
  })(${JSON.stringify(pfad)}, ${JSON.stringify(sagen)})`;
  wc.executeJavaScript(js).catch(() => {
    const basis = isDev ? (process.env.SPACE_DEV_URL || 'http://localhost:3000') : APP_URL;
    mainWindow.loadURL(basis + pfad);
  });
}

ipcMain.handle('insel:datei-nehmen', (event) => {
  if (!appSenderOrigin(event) || !inselDatei || Date.now() - inselDatei.zeit > 2 * 60 * 1000) return null;
  const d = inselDatei;
  inselDatei = null;
  return { name: d.name, type: d.type, daten: d.daten };
});

function connectorSenderOrigin(event) {
  const origin = appSenderOrigin(event);
  if (!origin || !connector) throw new Error('SPACE Connector ist hier nicht verfügbar.');
  return origin;
}

ipcMain.handle('connector:status', (event, opts) => {
  connectorSenderOrigin(event);
  return connector.status({ frisch: Boolean(opts && opts.frisch) });
});
ipcMain.handle('connector:koppeln', (event, input) => {
  const origin = connectorSenderOrigin(event);
  const code = input && typeof input.code === 'string' ? input.code.trim() : '';
  // The page may name its origin; it has to be the one it actually runs on.
  if (input && input.url && connectorOrigin(input.url, { allowed: [origin], isDev: false }) !== origin) {
    throw new Error('Adresse passt nicht zur App.');
  }
  return connector.koppeln(code, origin);
});
// Claude Code's own sign-in (opens Anthropic's page in the browser); resolves when confirmed or cancelled.
ipcMain.handle('connector:anmelden', (event, opts) => {
  connectorSenderOrigin(event);
  return connector.anmelden({ immer: Boolean(opts && opts.immer) });
});
ipcMain.handle('connector:anmelden-abbrechen', (event) => { connectorSenderOrigin(event); return connector.anmeldenAbbrechen(); });
ipcMain.handle('connector:anmeldeseite-oeffnen', (event) => { connectorSenderOrigin(event); return connector.anmeldeseiteOeffnen(); });

app.on('second-instance', (_event, argv) => {
  if (connector && connector.anmeldeseiteAnnehmen(anmeldeAdresse(argv))) return;
  zeigen();
});
ipcMain.handle('connector:starten', (event) => { connectorSenderOrigin(event); return connector.starten(); });
ipcMain.handle('connector:stoppen', (event) => { connectorSenderOrigin(event); return connector.stoppen(); });
ipcMain.handle('connector:entkoppeln', (event) => { connectorSenderOrigin(event); return connector.entkoppeln(); });

// «Dateien» (window.spaceDateien, dateien.js): PC folders the person picked in the system dialog. The web app lists,
// reads and watches them — sync into «Meine Dateien», the bots' live access while the app is open. Read only.
// Answers are { ok, wert } / { ok: false, grund, meldung }, so the page gets the German message, not Electron's
// «Error invoking remote method …».
let dateien = null;
let ordnerDialogOffen = false;
/** webContents id → { seite, abos: Map(abo → abmelden) }; seite counts the page's navigations */
const dateienSeiten = new Map();

function dateienKanal(kanal, handler) {
  ipcMain.handle(kanal, async (event, ...args) => {
    try {
      if (!dateien || !appSenderOrigin(event)) throw new DateienFehler('nichtVerfuegbar');
      return { ok: true, wert: await handler(event, ...args) };
    } catch (err) {
      return { ok: false, grund: grundVon(err), meldung: fehlerMeldung(err) };
    }
  });
}

/** The page behind a webContents went away (reload, navigation, crash, window destroyed) → its watchers too. */
function dateienSeiteFuer(wc) {
  let eintrag = dateienSeiten.get(wc.id);
  if (eintrag) return eintrag;
  eintrag = { seite: 0, abos: new Map() };
  dateienSeiten.set(wc.id, eintrag);
  const abmelden = () => {
    for (const ab of eintrag.abos.values()) ab();
    eintrag.abos.clear();
    eintrag.seite++;
  };
  wc.on('did-navigate', abmelden);
  wc.on('render-process-gone', abmelden);
  wc.once('destroyed', () => { abmelden(); dateienSeiten.delete(wc.id); });
  return eintrag;
}

dateienKanal('dateien:ordner-waehlen', async (event) => {
  if (ordnerDialogOffen) throw new DateienFehler('dialogOffen');
  ordnerDialogOffen = true;
  try {
    const fenster = BrowserWindow.fromWebContents(event.sender);
    const optionen = {
      title: 'Ordner für SPACE freigeben',
      buttonLabel: 'Freigeben',
      message: 'SPACE darf diesen Ordner lesen, aber nie ändern.',
      properties: ['openDirectory', 'dontAddToRecent'],
    };
    const { canceled, filePaths } = fenster ? await dialog.showOpenDialog(fenster, optionen) : await dialog.showOpenDialog(optionen);
    if (canceled || !filePaths || !filePaths[0]) return null;
    return dateien.freigabeAnlegen(filePaths[0]);
  } finally {
    ordnerDialogOffen = false;
  }
});
dateienKanal('dateien:freigaben', () => dateien.freigaben());
dateienKanal('dateien:freigabe-aendern', (_event, id, felder) => dateien.freigabeAendern(id, felder));
dateienKanal('dateien:freigabe-entfernen', (_event, id) => { dateien.freigabeEntfernen(id); });
dateienKanal('dateien:liste', (_event, id, unterpfad) => dateien.liste(id, unterpfad));
dateienKanal('dateien:alle', (_event, id) => dateien.alle(id));
dateienKanal('dateien:lesen', (_event, id, pfad) => dateien.lesen(id, pfad));
dateienKanal('dateien:beobachten', async (event, input) => {
  const abo = input && typeof input.abo === 'string' && /^[\w-]{1,64}$/.test(input.abo) ? input.abo : null;
  if (!abo) throw new DateienFehler('allgemein');
  const wc = event.sender;
  const eintrag = dateienSeiteFuer(wc);
  if (eintrag.abos.has(abo)) return;
  const seite = eintrag.seite;
  const abmelden = await dateien.beobachten(input.id, (aenderungen) => {
    if (!wc.isDestroyed()) wc.send('dateien:aenderungen', { abo, aenderungen });
  });
  // The page navigated while the watcher started: nobody listens any more.
  if (seite !== eintrag.seite || wc.isDestroyed()) return abmelden();
  eintrag.abos.set(abo, abmelden);
});
dateienKanal('dateien:beobachten-ende', (event, input) => {
  const eintrag = dateienSeiten.get(event.sender.id);
  const abo = input && input.abo;
  const abmelden = eintrag && eintrag.abos.get(abo);
  if (!abmelden) return;
  abmelden();
  eintrag.abos.delete(abo);
});

// GPU flags — before app.ready
if (app && app.commandLine) {
  // the island's sounds play without a click first
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
  app.commandLine.appendSwitch('enable-smooth-scrolling');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
  app.commandLine.appendSwitch('disable-features', 'PaintHolding');
}

// Windows: set app user model ID for notifications to show "SPACE Media Engine"
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
  if (!einzigeInstanz) return;
  Menu.setApplicationMenu(null);
  createWindow();

  connector = createConnectorHost({
    userDataDir: app.getPath('userData'),
    isDev,
    allowedOrigins: APP_ORIGINS,
    fetchText: async (url) => {
      const res = await net.fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
    execPath: process.execPath,
    // Windows, packaged: Claude Code's sign-in hands the page to this app instead of rundll32 (see above)
    browserHelper: app.isPackaged && process.platform === 'win32' ? process.execPath : null,
    openExternal: (url) => shell.openExternal(url),
    home: os.homedir(),
    deviceName: `${os.hostname()} (SPACE App)`,
    onChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('connector:changed', status);
    },
    // Paired with one click: from now on the app starts with Windows (hidden), so the chat keeps running
    // over the subscription after a restart. «Mit Windows starten» in the tray menu turns it off.
    onGekoppelt: () => mitWindowsStarten(true),
  });
  dateien = createDateienHost({ userDataDir: app.getPath('userData'), isDev, home: os.homedir() });
  if (process.platform === 'win32') {
    insel = createInselHost({
      appUrl: isDev ? (process.env.SPACE_DEV_URL || 'http://localhost:3000') : APP_URL,
      appPartition: 'persist:spaceapp',
      userDataDir: app.getPath('userData'),
      isDev,
      zeigen,
      navigieren: appNavigieren,
      dateiZumChat: (datei) => {
        inselDatei = { ...datei, zeit: Date.now() };
        appNavigieren('/chat');
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('insel:datei-bereit');
      },
      log: (zeile) => console.log(`[insel] ${zeile}`),
      beiEinstellungen: () => trayMenue(),
      beiLage: (lage) => {
        if (!tray) return;
        // Steno has its own robot; the Bot-Team the SPACE helmet, amber while approvals wait
        const zahl = lage.freigaben.length;
        const bild = lage.steno ? 'tray-steno.ico' : zahl ? 'tray-wartet.ico' : 'tray.ico';
        if (tray.__bild !== bild) { tray.setImage(path.join(__dirname, 'assets', bild)); tray.__bild = bild; }
        tray.setToolTip(lage.steno ? 'Steno' : zahl ? `SPACE · ${zahl === 1 ? 'eine Freigabe wartet' : `${zahl} Freigaben warten`}` : 'SPACE Media Engine');
      },
      testText: app.isPackaged ? null : process.env.SPACE_INSEL_TEST_TEXT || null,
      demo: !app.isPackaged && process.env.SPACE_INSEL_DEMO === '1',
    });
    // After the first paint of the app window, so the island never competes with it.
    setTimeout(() => insel.starten(), versteckterStart ? 1500 : 2500);
  }
  trayAnlegen();
  // A few seconds after start, so the connector never competes with the first paint.
  setTimeout(() => connector.autostart(), 4000);

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

// Quitting for real (tray «Beenden», update, Windows shutdown): let the window close instead of hiding it.
app.on('before-quit', () => { beenden = true; });

// Stop the connector with the app (also before an update installs — it runs from the app's own exe).
app.on('will-quit', () => {
  if (insel) insel.shutdown();
  if (connector) connector.shutdown();
  if (dateien) dateien.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
