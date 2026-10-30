// The SPACE Bot as a pixel astronaut — the sprite sheet of the web app's Pixel-Büro (astronaut-36.png, cells 36×54,
// mapping after src/lib/team/pixel/sprites.ts, recolouring after recolor.ts there). Pure: which cell a pose is, when
// the helmet lifts to breathe, which pixels are the cyan accents that turn into the bot's colour, the pixel glyphs
// above the helmet. Tested in insel/sprite.test.js; the pet page loads it as a classic script → window.SpaceSprite.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpaceSprite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ZELLE_B = 36;
  const ZELLE_H = 54;
  const SPALTEN = 4;
  const ZEILEN = 6;
  /** Rows above this are helmet — it lifts one pixel while breathing. */
  const KOPF_ZEILEN = 36;
  /** The inside of the visor in the cells facing the viewer (blink: dark for 120 ms; dozing: the upper half dark). */
  const VISIER = { x: 9, y: 30, w: 18, h: 7 };
  const ATEM_S = 2.4;
  const BLINZELN_MS = 120;
  const BLINZELN_MIN_MS = 3000;
  const BLINZELN_MAX_MS = 6000;

  const RICHTUNG_ZEILE = { unten: 0, oben: 1, links: 2, rechts: 3 };

  /**
   * Pose → cell (source pixels). Standing poses face the viewer; `laufen` takes the direction and the distance walked
   * (one step every 6 px). Unknown poses stand still.
   */
  function zelle(pose, richtung, strecke) {
    const z = (spalte, zeile) => ({ sx: spalte * ZELLE_B, sy: zeile * ZELLE_H });
    switch (pose) {
      case 'laufen': return z(Math.floor((strecke || 0) / 6) % 4, RICHTUNG_ZEILE[richtung] ?? 0);
      case 'mappe': return z(0, 5);
      case 'winken': return z(1, 5);
      case 'klemmbrett': return z(2, 5);
      case 'kaffee': return z(3, 5);
      case 'sitzen': return z(2, 4);
      case 'sitzenKaffee': return z(3, 4);
      case 'tippen': return z(Math.floor((strecke || 0) * 5) % 2, 4);
      default: return z(0, RICHTUNG_ZEILE[richtung] ?? 0);
    }
  }

  /** Does the helmet lift right now? `t` seconds in the pose; a slower rhythm while asleep. */
  function atmet(t, periode) {
    const p = periode || ATEM_S;
    return (t % p) < p / 2;
  }

  // ---- colour ----

  function hsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
    return [h * 360, s, l];
  }

  /** The cyan accents of the base sprite (eye arcs, suit lights, 170–207°); the navy visor and shadows stay. */
  function istAkzent(r, g, b) {
    const [h, s, l] = hsl(r, g, b);
    return h >= 170 && h <= 207 && s >= 0.3 && l >= 0.3 && l <= 0.95;
  }

  /** Turn the accent pixels of raw RGBA bytes into [r,g,b]; the pixel's lightness scales the target. */
  function umfaerben(data, zu) {
    const [tr, tg, tb] = zu;
    const [, , tl] = hsl(tr, tg, tb);
    const basis = Math.max(0.2, tl);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!istAkzent(r, g, b)) continue;
      const [, , l] = hsl(r, g, b);
      const k = l / basis;
      data[i] = Math.min(255, Math.round(tr * k));
      data[i + 1] = Math.min(255, Math.round(tg * k));
      data[i + 2] = Math.min(255, Math.round(tb * k));
    }
  }

  /** The visible body of a cell: bounding box of the opaque pixels (cell-local), or the whole cell when empty. */
  function koerper(data, breite, hoehe) {
    let x0 = breite;
    let y0 = hoehe;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < hoehe; y++) {
      for (let x = 0; x < breite; x++) {
        if (data[(y * breite + x) * 4 + 3] < 40) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: breite, h: hoehe };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---- glyphs above the helmet (5 × 7, «#» = pixel) ----

  const GLYPHEN = {
    herz: ['.#.#.', '#####', '#####', '#####', '.###.', '..#..', '.....'],
    frage: ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    fertig: ['.....', '....#', '...#.', '#.#..', '##...', '.#...', '.....'],
    daumen: ['..#..', '..#..', '.###.', '#####', '#####', '#####', '.###.'],
    note: ['..##.', '..#.#', '..#..', '..#..', '###..', '###..', '.....'],
    z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    spirale: ['.###.', '#...#', '#.#.#', '#.##.', '#....', '.###.', '.....'],
    zu: ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  };
  const GLYPH_FARBE = { herz: '#ff6b8a', frage: '#ffc24d', fertig: '#6ee7a0', daumen: '#6ee7a0', note: '#dfe6f2', z: '#c9d3e3', spirale: '#ffc24d', zu: '#c9d3e3' };
  const GLYPH_B = 5;
  const GLYPH_H = 7;

  function glyphPixel(name) {
    const aus = [];
    (GLYPHEN[name] || []).forEach((zeile, y) => {
      for (let x = 0; x < zeile.length; x++) if (zeile[x] === '#') aus.push({ x, y });
    });
    return aus;
  }

  // ---- cartoon timing (after the Pixel-Büro's emotes) ----

  const EMOTE_MS = 1400;
  const POP_MS = 180;
  const HUPF_PX = 3;
  const HUPF_MS = 320;

  /** Size while popping: 0 → 1.25 → 1 in POP_MS, then 1; before the start 0. */
  function popSkala(start, jetzt) {
    const p = (jetzt - start) / POP_MS;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return p < 0.6 ? (p / 0.6) * 1.25 : 1.25 - ((p - 0.6) / 0.4) * 0.25;
  }
  /** Floating: 0 or −1 pixel, switching every 600 ms. */
  function schweben(start, jetzt) {
    return Math.floor((jetzt - start) / 600) % 2 === 1 ? -1 : 0;
  }
  /** The hop: pixels above the ground (0 when over). */
  function hupfHoehe(start, jetzt) {
    const p = (jetzt - start) / HUPF_MS;
    if (p <= 0 || p >= 1) return 0;
    return Math.round(HUPF_PX * Math.sin(Math.PI * p));
  }
  /** Squash on a poke: [sx, sy] over 370 ms (keyframes after the SPACE face). */
  function squash(start, jetzt) {
    const e = jetzt - start;
    const folge = (keys) => {
      if (e <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) {
        if (e <= keys[i][0]) {
          const [t0, v0] = keys[i - 1];
          const [t1, v1] = keys[i];
          const t = (e - t0) / (t1 - t0);
          return v0 + (v1 - v0) * (1 - (1 - t) * (1 - t));
        }
      }
      return keys[keys.length - 1][1];
    };
    if (e >= 370) return [1, 1];
    return [folge([[0, 1], [70, 1.16], [200, 0.95], [370, 1]]), folge([[0, 1], [70, 0.8], [200, 1.1], [370, 1]])];
  }
  /** Head shake on an error: x offset in pixels over 480 ms (six swings of ±1). */
  function kopfSchuetteln(start, jetzt) {
    const e = jetzt - start;
    if (e < 0 || e >= 480) return 0;
    return Math.floor(e / 80) % 2 === 0 ? -1 : 1;
  }

  return {
    ZELLE_B, ZELLE_H, SPALTEN, ZEILEN, KOPF_ZEILEN, VISIER, ATEM_S, BLINZELN_MS, BLINZELN_MIN_MS, BLINZELN_MAX_MS,
    EMOTE_MS, POP_MS, HUPF_PX, HUPF_MS, GLYPHEN, GLYPH_FARBE, GLYPH_B, GLYPH_H,
    zelle, atmet, istAkzent, umfaerben, koerper, glyphPixel, popSkala, schweben, hupfHoehe, squash, kopfSchuetteln,
  };
});
