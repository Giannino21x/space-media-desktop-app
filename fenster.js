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

module.exports = { fensterWache };
