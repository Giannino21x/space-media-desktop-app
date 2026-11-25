// The island's windows get their settings when they load (fake Electron, no windows): a throw in fuerFenster()
// left the island and the pill without settings — the pill never sent WAV to the model on this PC (25.11.2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');

const alleFenster = [];
const kanaele = {};
function fakeElectron(gesendet) {
  class Fenster {
    constructor(o) { alleFenster.push(this); this.o = o; this.handler = {}; this.zerstoert = false; this.b = { x: o.x || 0, y: o.y || 0, width: o.width || 10, height: o.height || 10 }; const wc = { send: (k, d) => gesendet.push([o.title, k, d]), session: {} }; this.webContents = new Proxy(wc, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve()) }); return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve()) }); }
    once(e, f) { this.handler[e] = f; } on(e, f) { this.handler[e] = f; }
    loadFile() {} isDestroyed() { return this.zerstoert; } destroy() { this.zerstoert = true; }
    setBounds(b) { this.b = { ...this.b, ...b }; } getBounds() { return this.b; } setPosition(x, y) { this.b.x = x; this.b.y = y; }
    showInactive() {} show() {} hide() {} isVisible() { return true; } setIgnoreMouseEvents() {} setAlwaysOnTop() {} setFocusable() {} setVisibleOnAllWorkspaces() {} blur() {} focus() {}
  }
  const display = { bounds: { x: 0, y: 0, width: 4096, height: 1152 }, workArea: { x: 0, y: 0, width: 4096, height: 1152 }, scaleFactor: 1.25 };
  return {
    BrowserWindow: Fenster,
    screen: { getPrimaryDisplay: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }), on: () => {} },
    ipcMain: { handle: (k, f) => { kanaele[k] = f; }, removeHandler: () => {}, on: () => {} },
    clipboard: { readText: () => '', writeText: () => {}, read: () => '', write: () => {} },
    session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {}, fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) }) },
    nativeTheme: { shouldUseDarkColors: true, on: () => {}, removeListener: () => {} },
  };
}

test('island and pill get their settings on load, with lokalBereit from the model', async () => {
  const gesendet = [];
  const fake = fakeElectron(gesendet);
  const laden = Module._load;
  Module._load = function (anfrage, ...rest) {
    if (anfrage === 'electron') return fake;
    if (anfrage === 'uiohook-napi') throw new Error('kein Hook im Test');
    return laden.call(this, anfrage, ...rest);
  };
  let host = null;
  let dir = null;
  try {
    delete require.cache[require.resolve('./insel')];
    delete require.cache[require.resolve('./pet')];
    const { createInselHost } = require('./insel');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insel-test-'));
    fs.writeFileSync(path.join(dir, 'insel.json'), JSON.stringify({ an: true, diktat: true, pet: false, lokalDiktat: true }));
    host = createInselHost({
      appUrl: 'https://app.example', appPartition: 'persist:x', userDataDir: dir, isDev: false,
      zeigen: () => {}, navigieren: () => {}, dateiZumChat: () => {}, log: () => {}, testText: null, demo: false,
      beiLage: () => {}, beiEinstellungen: () => {}, appFokussiert: () => false,
      lokalKi: { bereit: () => true },
    });
    host.starten();
    // the windows «load»: every ready-to-show the host registered
    for (const f of alleFenster) if (f.handler['ready-to-show']) f.handler['ready-to-show']();
    const einst = gesendet.filter(([, k]) => k === 'insel:einstellungen');
    assert.ok(einst.length >= 2, 'island and pill got settings');
    for (const [, , e] of einst) {
      assert.equal(e.lokalBereit, true);
      assert.equal(e.lokalDiktat, true);
      assert.equal(e.taste, 'strgRechts');
    }
    // the pages ask once they listen (insel:hallo): the answer carries the same settings
    const pille = alleFenster.find((f) => f.o.title === 'SPACE Diktat');
    const antwort = await kanaele['insel:hallo']({ sender: pille.webContents });
    assert.equal(antwort.einstellungen.lokalBereit, true);
    assert.ok(Array.isArray(antwort.lage.laufend));
    // a foreign sender (another window) gets nothing
    await assert.rejects(() => kanaele['insel:hallo']({ sender: {} }), /Nicht erlaubt/);
  } finally {
    if (host) host.shutdown();
    if (typeof dir === 'string') fs.rmSync(dir, { recursive: true, force: true });
    Module._load = laden;
  }
});
