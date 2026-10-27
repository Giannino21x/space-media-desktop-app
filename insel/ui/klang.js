// Sounds of the island — synthesised on the fly with Web Audio (no sound files): short, soft, low volume.
// Classic script → window.SpaceKlang.spielen(name); SpaceKlang.an = false mutes.

(function () {
  let ctx = null;
  const LAUT = 0.12;

  function kontext() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** One note: frequency glide from f0 to f1, attack/decay envelope. */
  function ton(c, start, { f0, f1, dauer, typ = 'sine', laut = 1 }) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = typ;
    osc.frequency.setValueAtTime(f0, start);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, start + dauer);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(LAUT * laut, start + Math.min(0.012, dauer / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dauer);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dauer + 0.02);
  }

  const KLAENGE = {
    hallo: [[0, { f0: 660, f1: 720, dauer: 0.11 }], [0.1, { f0: 880, f1: 990, dauer: 0.16 }]],
    stups: [[0, { f0: 520, f1: 300, dauer: 0.12, typ: 'triangle' }]],
    schwindlig: [[0, { f0: 700, f1: 380, dauer: 0.18, typ: 'triangle' }], [0.16, { f0: 620, f1: 340, dauer: 0.18, typ: 'triangle' }], [0.32, { f0: 540, f1: 300, dauer: 0.22, typ: 'triangle' }]],
    freigabe: [[0, { f0: 784, dauer: 0.16 }], [0.15, { f0: 1047, dauer: 0.28 }]],
    fertig: [[0, { f0: 659, dauer: 0.1 }], [0.09, { f0: 784, dauer: 0.1 }], [0.18, { f0: 1047, dauer: 0.22 }]],
    schluck: [[0, { f0: 320, f1: 120, dauer: 0.16, typ: 'triangle', laut: 1.3 }]],
    diktatStart: [[0, { f0: 880, f1: 1180, dauer: 0.07, laut: 0.8 }]],
    diktatEnde: [[0, { f0: 1100, f1: 820, dauer: 0.08, laut: 0.8 }]],
    fehler: [[0, { f0: 330, dauer: 0.12, typ: 'triangle' }], [0.14, { f0: 262, dauer: 0.18, typ: 'triangle' }]],
    herz: [[0, { f0: 988, dauer: 0.09, laut: 0.6 }], [0.08, { f0: 1319, dauer: 0.14, laut: 0.6 }]],
  };

  window.SpaceKlang = {
    an: true,
    spielen(name) {
      if (!this.an || !KLAENGE[name]) return;
      try {
        const c = kontext();
        const t = c.currentTime + 0.01;
        for (const [ab, note] of KLAENGE[name]) ton(c, t + ab, note);
      } catch { /* no audio device */ }
    },
  };
})();
