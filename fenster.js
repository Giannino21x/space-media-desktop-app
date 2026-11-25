// What may load in the app window. Only the app's own pages stay inside — exact origin, the same rule the bridges use
// (connectorOrigin): a prefix check let https://app.space-media.ch.evil.com and, in the packaged build,
// http://localhost into the frameless window. Everything else opens in the system browser. Pure, tested in
// fenster.test.js; main.js hangs the handlers on the window.

const { connectorOrigin } = require('./connector');

function fensterWache({ allowed, isDev, openExternal }) {
  const imFenster = (url) => connectorOrigin(url, { allowed, isDev }) !== null;
  return {
    imFenster,
    // webContents.setWindowOpenHandler
    oeffnen({ url }) {
      if (imFenster(url)) return { action: 'allow' };
      openExternal(url);
      return { action: 'deny' };
    },
    // webContents 'will-navigate'
    navigieren(event, url) {
      if (imFenster(url)) return;
      event.preventDefault();
      openExternal(url);
    },
  };
}

// Windows groups taskbar buttons and finds name and symbol through this ID: it takes the Start menu shortcut that
// carries it. A dev run (`npm run dev`, plain electron.exe) under the same ID let a shortcut to electron.exe claim it
// once — then the installed app showed «Electron» with the Electron symbol. Dev runs get their own ID.
const APP_ID = 'ch.space-media.app';
function appModelId(isPackaged) {
  return isPackaged ? APP_ID : `${APP_ID}.dev`;
}

module.exports = { APP_ID, appModelId, fensterWache };
