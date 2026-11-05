// The pet is the island's head: the page uses the island's engine and helmet, and main feeds the eyes the pointer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const ui = (datei) => fs.readFileSync(path.join(__dirname, 'ui', datei), 'utf8');

/** The real pet.js with Electron replaced: pointer and clock are the test's, the interval callbacks run by hand. */
function host() {
  class Fenster extends EventEmitter {
    constructor(o) { super(); this.rahmen = { x: o.x, y: o.y, width: o.width, height: o.height }; this.webContents = new EventEmitter(); this.sichtbar = false; }
    isDestroyed() { return false; }
    isVisible() { return this.sichtbar; }
    setIgnoreMouseEvents() {}
    loadFile() {}
    showInactive() { this.sichtbar = true; }
    hide() { this.sichtbar = false; }
    getBounds() { return this.rahmen; }
    setBounds(b) { this.rahmen = b; }
    setPosition(x, y) { this.rahmen = { ...this.rahmen, x, y }; }
    destroy() { this.emit('closed'); }
  }
  const zustand = { zeiger: { x: 100, y: 100 }, jetzt: 1_000_000 };
  const kanaele = {};
  const gesendet = [];
  const intervalle = [];
  const anzeige = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
  const kontext = {
    module: { exports: {} }, __dirname, process,
    require: (name) => (name === 'electron'
      ? { BrowserWindow: Fenster, screen: { getCursorScreenPoint: () => zustand.zeiger, getDisplayNearestPoint: () => anzeige } }
      : name.startsWith('.') ? require(path.join(__dirname, name)) : require(name)),
    Date: Object.assign(function () { return new Date(zustand.jetzt); }, { now: () => zustand.jetzt }),
    setInterval: (fn) => { intervalle.push(fn); return intervalle.length; },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pet.js'), 'utf8'), kontext);
  const pet = kontext.module.exports.createPet({
    fensterOptionen: (x) => x, fensterSichern: () => {}, anzeige: () => anzeige,
    einstellungen: () => ({ pet: true, petVersteckt: 0, petLage: null }), aendern: () => {}, log: () => {},
    kanal: (name, _wer, fn) => { kanaele[name] = fn; },
    senden: (_f, name, daten) => gesendet.push({ name, daten }),
  });
  pet.anlegen();
  pet.fenster.emit('ready-to-show');
  const blicke = () => gesendet.filter((g) => g.name === 'pet:blick').map((g) => g.daten);
  const [takt, wachheit] = intervalle;
  return { pet, zustand, kanaele, blicke, takt, wachheit };
}

test('pet: the eyes get the pointer in window px, wherever it is, but only when it moved', () => {
  const h = host();
  const f = h.pet.fenster.getBounds();
  h.zustand.zeiger = { x: f.x - 900, y: f.y - 500 };
  h.takt();
  h.takt();
  assert.deepEqual(JSON.parse(JSON.stringify(h.blicke())), [{ x: -900, y: -500 }]);
  h.zustand.zeiger = { x: f.x + 10, y: f.y + 20 };
  h.takt();
  assert.deepEqual(JSON.parse(JSON.stringify(h.blicke().at(-1))), { x: 10, y: 20 });
  assert.equal(h.blicke().length, 2);
});

test('pet: asleep the pointer stays out of the page, and after waking the eyes catch up', () => {
  const h = host();
  h.takt();
  const vorher = h.blicke().length;
  h.zustand.jetzt += 11 * 60_000; // past SCHLAFEN_MS
  h.wachheit();
  h.zustand.zeiger = { x: 5, y: 6 };
  h.takt();
  assert.equal(h.blicke().length, vorher);
  h.pet.diktat('hoert');
  h.takt();
  assert.equal(h.blicke().length, vorher + 1);
});

test('pet: no sprite any more — the page runs on the island\'s engine and helmet', () => {
  const h = host();
  assert.equal(h.kanaele['pet:sprite'], undefined);
  const html = ui('pet.html');
  assert.match(html, /<script src="gesicht\.js"><\/script>/);
  assert.doesNotMatch(html, /sprite\.js/);
  assert.match(ui('pet-ui.js'), /SpaceGesicht/);
  assert.doesNotMatch(ui('pet-ui.js'), /SpaceSprite|petSprite/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'), /petSprite/);
  for (const px of [32, 64, 128, 256]) assert.ok(fs.existsSync(path.join(__dirname, 'ui', 'koepfe', `kopf-${px}.png`)));
});

/** The engine in a bare context: it needs a canvas, nothing draws in these tests. */
function motor() {
  const c = { getContext: () => ({}), style: {}, width: 0, height: 0 };
  const w = { devicePixelRatio: 1 };
  vm.runInNewContext(ui('gesicht.js'), { window: w, performance: { now: () => 0 } });
  return w.SpaceGesicht.erstellen(c, { groesse: 110, nurBild: true });
}

test('pet: the hit rect and the clamping use the helmet as measured on the image, not the whole canvas', () => {
  const r = motor().rahmen();
  assert.ok(Math.abs(r.x - 22) < 0.5, `x ${r.x}`);
  assert.ok(Math.abs(r.y - 37.6) < 0.5, `y ${r.y}`);
  assert.ok(Math.abs(r.width - 65.7) < 0.5, `breite ${r.width}`);
  assert.ok(Math.abs(r.height - 56.6) < 0.5, `hoehe ${r.height}`);
});

test('pet: the page starts the engine and tells main it is ready, with the bridge calls preload offers', () => {
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const seite = ui('pet-ui.js');
  for (const [, name] of seite.matchAll(/\bapi\.(pet\w+|onPet\w+)\(/g)) assert.match(preload, new RegExp(`\\b${name}:`), `${name} fehlt in preload.js`);
  assert.match(seite, /kopf\.starten\(\);\s+api\.petBereit\(\);/);
});

/** Draws real frames of the engine on a recording canvas; returns the most calls of each kind in one frame. */
function bilder(reduziert, tun, ms = 1400) {
  let jetzt = 1000;
  let raf = null;
  const timer = new Map();
  let id = 0;
  const felder = {};
  let frame = {};
  const spitze = {};
  const ctx = new Proxy({}, {
    get: (_z, k) => (k in felder ? felder[k] : (...a) => {
      frame[k] = (frame[k] || 0) + 1;
      if (k === 'fillText') frame.text = a[0];
      return { addColorStop() {} };
    }),
    set: (_z, k, v) => { felder[k] = v; return true; },
  });
  const w = { devicePixelRatio: 1 };
  vm.runInNewContext(ui('gesicht.js'), {
    window: w,
    performance: { now: () => jetzt },
    matchMedia: () => ({ matches: reduziert }),
    requestAnimationFrame: (fn) => { raf = fn; return 1; },
    cancelAnimationFrame: () => { raf = null; },
    setTimeout: (fn, wart) => { timer.set(++id, { fn, um: jetzt + (wart || 0) }); return id; },
    clearTimeout: (i) => timer.delete(i),
  });
  const kopf = w.SpaceGesicht.erstellen({ getContext: () => ctx, style: {}, width: 0, height: 0 }, { groesse: 110 });
  kopf.starten();
  tun(kopf);
  for (let t = 0; t < ms; t += 16) {
    jetzt += 16;
    for (const [i, x] of [...timer]) if (x.um <= jetzt) { timer.delete(i); x.fn(); }
    const fn = raf;
    raf = null;
    if (fn) {
      frame = {};
      fn();
      for (const [k, v] of Object.entries(frame)) if (typeof v === 'number') spitze[k] = Math.max(spitze[k] || 0, v);
    }
  }
  return spitze;
}

test('pet: «reduce motion» — no rising hearts, sparks or zzz; the eyes still carry the state', () => {
  const herzen = (r) => bilder(r, (k) => k.herzenZeigen()).bezierCurveTo || 0;
  assert.ok(herzen(false) > 4, 'with motion the rising hearts add curves beyond the two eyes');
  assert.ok(herzen(true) > 0, 'the eyes still turn into hearts');
  assert.ok(herzen(true) <= 4, 'only the two eyes: no rising hearts');

  const funken = (r) => bilder(r, (k) => k.fertig()).arc || 0;
  assert.ok(funken(false) > funken(true), 'sparks only with motion');

  assert.ok((bilder(false, (k) => k.schlaf(true), 3000).fillText || 0) > 0, 'zzz with motion');
  assert.equal(bilder(true, (k) => k.schlaf(true), 3000).fillText || 0, 0, 'no zzz without');
});
