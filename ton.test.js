// The app window's sound: the rule (ton.js) and the page's side (preload.js → seiteStill: silent notifications,
// open microphone reported). Giannino, 25.11.2026: no sound while the app is not in front, the sounds in the app stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { NACHLAUF_MS, tonStumm, tonWache } = require('./ton');

const z = (extra) => ({ stumm: false, vorne: false, aufnahme: false, hoerbar: false, stilleMs: Infinity, ...extra });

test('in front: sound on, also when it was muted', () => {
  assert.equal(tonStumm(z({ vorne: true })), false);
  assert.equal(tonStumm(z({ vorne: true, stumm: true })), false);
});

test('hidden, minimised or without focus and quiet: muted', () => {
  assert.equal(tonStumm(z({})), true);
  assert.equal(tonStumm(z({ stilleMs: NACHLAUF_MS })), true);
});

test('a recording or sound still playing is not cut off when the window goes to the back', () => {
  assert.equal(tonStumm(z({ aufnahme: true })), false);
  assert.equal(tonStumm(z({ hoerbar: true })), false);
  // read-aloud pauses between sentences
  assert.equal(tonStumm(z({ stilleMs: NACHLAUF_MS - 1 })), false);
});

test('once muted in the background, a new sound does not unmute it', () => {
  assert.equal(tonStumm(z({ stumm: true, hoerbar: true })), true);
  assert.equal(tonStumm(z({ stumm: true, stilleMs: 0 })), true);
});

// ---- the page's side, run against a fake page
const quelle = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const stueck = quelle.slice(quelle.indexOf('// <seite-still>'), quelle.indexOf('// </seite-still>'));

function seite() {
  const ereignisse = [];
  const gezeigt = [];
  class Notification { constructor(titel, opts) { this.titel = titel; this.opts = opts; } static get permission() { return 'granted'; } }
  class ServiceWorkerRegistration { showNotification(titel, opts) { gezeigt.push({ titel, opts }); return Promise.resolve(); } }
  class Spur {
    constructor() { this.readyState = 'live'; this.weg = []; }
    addEventListener(name, f) { if (name === 'ended') this.weg.push(f); }
    stop() { this.readyState = 'ended'; }
    ende() { this.readyState = 'ended'; for (const f of this.weg) f(); }
  }
  const spuren = [];
  const w = {
    Notification,
    ServiceWorkerRegistration,
    Event: class { constructor(type) { this.type = type; } },
    dispatchEvent: (e) => ereignisse.push(e.type),
    navigator: { mediaDevices: { getUserMedia: async (v) => { const s = v.audio ? [new Spur()] : []; spuren.push(...s); return { getAudioTracks: () => s }; } } },
  };
  vm.runInNewContext(`${stueck}; seiteStill(w);`, { w });
  return { w, ereignisse, gezeigt, spuren };
}

test('notifications of the page are always silent, everything else kept', async () => {
  const { w, gezeigt } = seite();
  const n = new w.Notification('Neu', { body: 'x', silent: false });
  assert.equal(n.titel, 'Neu');
  assert.equal(JSON.stringify(n.opts), JSON.stringify({ body: 'x', silent: true }));
  assert.ok(n instanceof w.Notification);
  assert.equal(w.Notification.permission, 'granted');
  assert.equal(new w.Notification('Ohne').opts.silent, true);
  // silent together with vibrate throws in Chromium: vibrate goes
  assert.equal(JSON.stringify(new w.Notification('V', { vibrate: [100] }).opts), JSON.stringify({ silent: true }));
  await new w.ServiceWorkerRegistration().showNotification('SW', { tag: 't' });
  assert.equal(JSON.stringify(gezeigt), JSON.stringify([{ titel: 'SW', opts: { tag: 't', silent: true } }]));
});

test('an open microphone is reported until it is stopped or ends', async () => {
  const { w, ereignisse, spuren } = seite();
  await w.navigator.mediaDevices.getUserMedia({ audio: true });
  await w.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.deepEqual(ereignisse, ['space-aufnahme-an', 'space-aufnahme-an']);
  spuren[0].stop();
  assert.equal(ereignisse.at(-1), 'space-aufnahme-an'); // one still open
  spuren[1].ende();
  assert.equal(ereignisse.at(-1), 'space-aufnahme-aus');
  spuren[1].ende(); // twice → no second report
  assert.equal(ereignisse.length, 4);
});

test('the preload hands seiteStill to the page and forwards the microphone state', () => {
  assert.match(quelle, /executeInMainWorld\(\{ func: seiteStill \}\)/);
  assert.match(quelle, /'space-aufnahme-an', \(\) => ipcRenderer\.send\('seite-aufnahme', true\)/);
  assert.match(quelle, /'space-aufnahme-aus', \(\) => ipcRenderer\.send\('seite-aufnahme', false\)/);
});

test('the background note is a silent toast', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const hinweis = main.slice(main.indexOf('function hintergrundHinweis'), main.indexOf('function mitWindowsStarten'));
  assert.match(hinweis, /silent: true/);
});

// ---- tonWache against a fake window: window state → setAudioMuted
function fenster({ sichtbar = true, fokus = true, minimiert = false, hoerbar = false } = {}) {
  const win = new EventEmitter();
  const wc = new EventEmitter();
  const st = { sichtbar, fokus, minimiert, stumm: false, aufrufe: [] };
  Object.assign(wc, {
    isAudioMuted: () => st.stumm,
    setAudioMuted: (m) => { st.stumm = m; st.aufrufe.push(m); },
    isCurrentlyAudible: () => hoerbar,
  });
  Object.assign(win, {
    webContents: wc,
    isDestroyed: () => false,
    isVisible: () => st.sichtbar,
    isMinimized: () => st.minimiert,
    isFocused: () => st.fokus,
  });
  let jetzt = 1000;
  const timer = [];
  const uhr = {
    jetzt: () => jetzt,
    warten: (f, ms) => { const t = { f, bis: jetzt + ms }; timer.push(t); return t; },
    abbrechen: (t) => { const i = timer.indexOf(t); if (i >= 0) timer.splice(i, 1); },
  };
  const weiter = (ms) => {
    jetzt += ms;
    for (const t of timer.filter((x) => x.bis <= jetzt)) { uhr.abbrechen(t); t.f(); }
  };
  return { win, wc, st, uhr, weiter };
}

test('tonWache: started hidden → muted; brought to the front → on; to the back → muted again', () => {
  const f = fenster({ sichtbar: false, fokus: false });
  tonWache(f.win, f.uhr);
  assert.equal(f.st.stumm, true);
  f.st.sichtbar = true; f.win.emit('show');
  f.st.fokus = true; f.win.emit('focus');
  assert.equal(f.st.stumm, false); // focus back: sound on
  f.st.fokus = false; f.win.emit('blur');
  assert.equal(f.st.stumm, true);
  f.st.fokus = true; f.win.emit('focus');
  assert.equal(f.st.stumm, false);
  f.st.sichtbar = false; f.win.emit('hide');
  assert.equal(f.st.stumm, true);
});

test('tonWache: in front and focused nothing is muted; minimised mutes', () => {
  const f = fenster();
  tonWache(f.win, f.uhr);
  assert.deepEqual(f.st.aufrufe, []);
  f.st.minimiert = true; f.win.emit('minimize');
  assert.equal(f.st.stumm, true);
  f.st.minimiert = false; f.win.emit('restore');
  assert.equal(f.st.stumm, false);
});

test('tonWache: sound playing when the window goes back runs on, muted after NACHLAUF_MS of silence', () => {
  const f = fenster();
  tonWache(f.win, f.uhr);
  f.wc.emit('audio-state-changed', { audible: true });
  f.st.fokus = false; f.win.emit('blur');
  assert.equal(f.st.stumm, false); // read-aloud keeps going
  f.wc.emit('audio-state-changed', { audible: false });
  f.weiter(NACHLAUF_MS - 100);
  assert.equal(f.st.stumm, false);
  f.wc.emit('audio-state-changed', { audible: true }); // next part
  f.wc.emit('audio-state-changed', { audible: false });
  f.weiter(NACHLAUF_MS + 100);
  assert.equal(f.st.stumm, true);
  f.st.fokus = true; f.win.emit('focus');
  assert.equal(f.st.stumm, false);
});

test('tonWache: a recording keeps the sound in the back; a new page drops the recording', () => {
  const f = fenster();
  const t = tonWache(f.win, f.uhr);
  t.aufnahme(true);
  f.st.fokus = false; f.win.emit('blur');
  assert.equal(f.st.stumm, false);
  t.aufnahme(false);
  assert.equal(f.st.stumm, true);
  f.st.fokus = true; f.win.emit('focus');
  t.aufnahme(true);
  f.wc.emit('did-navigate');
  f.st.fokus = false; f.win.emit('blur');
  assert.equal(f.st.stumm, true);
});
