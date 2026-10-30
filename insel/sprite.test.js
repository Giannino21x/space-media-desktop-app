const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./ui/sprite');

test('sprite: poses map to the cells of the Pixel-Büro sheet', () => {
  assert.deepEqual(S.zelle('stehen', 'unten'), { sx: 0, sy: 0 });
  assert.deepEqual(S.zelle('stehen', 'links'), { sx: 0, sy: 108 });
  assert.deepEqual(S.zelle('laufen', 'rechts', 13), { sx: 72, sy: 162 });
  assert.deepEqual(S.zelle('mappe'), { sx: 0, sy: 270 });
  assert.deepEqual(S.zelle('winken'), { sx: 36, sy: 270 });
  assert.deepEqual(S.zelle('klemmbrett'), { sx: 72, sy: 270 });
  assert.deepEqual(S.zelle('kaffee'), { sx: 108, sy: 270 });
  assert.deepEqual(S.zelle('tippen', 'unten', 0.3), { sx: 36, sy: 216 });
  assert.deepEqual(S.zelle('unbekannt'), { sx: 0, sy: 0 });
  assert.equal(S.SPALTEN * S.ZELLE_B, 144);
  assert.equal(S.ZEILEN * S.ZELLE_H, 324);
});

test('sprite: breathing lifts the helmet half of the time', () => {
  assert.equal(S.atmet(0.5), true);
  assert.equal(S.atmet(1.5), false);
  assert.equal(S.atmet(2.9), true);
  assert.equal(S.atmet(3, 4), false);
});

test('sprite: only the cyan accents take the bot colour', () => {
  assert.equal(S.istAkzent(80, 220, 240), true);    // cyan accent of the sheet
  assert.equal(S.istAkzent(20, 40, 90), false);     // navy visor
  assert.equal(S.istAkzent(240, 240, 240), false);  // white shell
  assert.equal(S.istAkzent(251, 191, 36), false);   // amber
  const px = new Uint8ClampedArray([80, 220, 240, 255, 240, 240, 240, 255, 80, 220, 240, 0]);
  S.umfaerben(px, [251, 191, 36]);
  assert.ok(px[0] > 200 && px[1] > 150 && px[2] < 120, 'accent turned amber');
  assert.deepEqual(Array.from(px.slice(4, 8)), [240, 240, 240, 255]);
  assert.deepEqual(Array.from(px.slice(8)), [80, 220, 240, 0]);
});

test('sprite: the body is the box of the opaque pixels', () => {
  const b = 4;
  const h = 3;
  const data = new Uint8ClampedArray(b * h * 4);
  const setzen = (x, y) => { data[(y * b + x) * 4 + 3] = 255; };
  setzen(1, 0);
  setzen(2, 2);
  assert.deepEqual(S.koerper(data, b, h), { x: 1, y: 0, w: 2, h: 3 });
  assert.deepEqual(S.koerper(new Uint8ClampedArray(b * h * 4), b, h), { x: 0, y: 0, w: 4, h: 3 });
});

test('sprite: glyphs, pop, hop, squash, head shake', () => {
  for (const name of Object.keys(S.GLYPHEN)) {
    assert.equal(S.GLYPHEN[name].length, S.GLYPH_H, name);
    assert.ok(S.GLYPHEN[name].every((z) => z.length === S.GLYPH_B), name);
    assert.ok(S.GLYPH_FARBE[name], name);
  }
  assert.ok(S.glyphPixel('herz').length > 10);
  assert.deepEqual(S.glyphPixel('nix'), []);
  assert.equal(S.popSkala(100, 50), 0);
  assert.equal(S.popSkala(100, 100 + S.POP_MS * 0.6), 1.25);
  assert.equal(S.popSkala(100, 100 + S.POP_MS), 1);
  assert.equal(S.schweben(0, 100), 0);
  assert.equal(S.schweben(0, 700), -1);
  assert.equal(S.hupfHoehe(0, 0), 0);
  assert.equal(S.hupfHoehe(0, S.HUPF_MS / 2), S.HUPF_PX);
  assert.equal(S.hupfHoehe(0, S.HUPF_MS), 0);
  assert.deepEqual(S.squash(0, 0), [1, 1]);
  const [sx, sy] = S.squash(0, 70);
  assert.ok(sx > 1.1 && sy < 0.9);
  assert.deepEqual(S.squash(0, 500), [1, 1]);
  assert.equal(S.kopfSchuetteln(0, 10), -1);
  assert.equal(S.kopfSchuetteln(0, 90), 1);
  assert.equal(S.kopfSchuetteln(0, 480), 0);
});
