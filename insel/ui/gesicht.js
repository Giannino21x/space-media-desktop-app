// SPACE face — the helmet of the SPACE Bot with its dark visor and LED eyes, drawn in Canvas 2D.
// Our own character (white helmet, rimmed visor, scan-line LED eyes, antenna on the right). The LED colour carries
// the state (working blue, waiting amber, done green, error red). Motion feel after a desk companion: eyes that
// follow the cursor anywhere on screen across a curved visor, blinks, breathing, squash on a poke, dizzy after three,
// hearts after resting the pointer, a hop and an eye roll across the visor when something is done, the visor that
// lifts to take a file. No images, no libraries. Classic script → window.SpaceGesicht.

(function () {
  const TAU = Math.PI * 2;
  const LED = '98,214,255';
  const FARBEN = {
    bereit: LED,
    arbeitet: '64,166,255',
    wartet: '245,165,36',
    fertig: '52,211,153',
    fehler: '244,80,94',
    hoert: '120,224,255',
    schlaeft: '148,162,184',
  };

  const klemmen = (x, a, b) => Math.min(b, Math.max(a, x));
  const glatt = (t) => t * t * (3 - 2 * t);
  const raus = (t) => 1 - (1 - t) * (1 - t);
  const rein = (t) => t * t;
  /** Frame-rate independent approach: k = 1 − base^dt. */
  const naeher = (x, ziel, base, dt) => x + (ziel - x) * (1 - Math.pow(base, dt));

  function rgb(s) { return s.split(',').map(Number); }
  function mischen(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

  /** Keyframes [ [ms, value], … ] → value at time t ms (linear between, eased out). */
  function folge(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return v0 + (v1 - v0) * raus((t - t0) / (t1 - t0));
      }
    }
    return keys[keys.length - 1][1];
  }

  // ---- eye forms (centre 0,0; w × h of a normal eye) ----

  function ovalPfad(ctx, w, h) {
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2);
  }

  function herzPfad(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.42);
    ctx.bezierCurveTo(-s * 0.62, s * 0.02, -s * 0.5, -s * 0.52, 0, -s * 0.2);
    ctx.bezierCurveTo(s * 0.5, -s * 0.52, s * 0.62, s * 0.02, 0, s * 0.42);
    ctx.closePath();
  }

  function augeZeichnen(ctx, form, w, h, seite, t, farbe) {
    ctx.fillStyle = farbe;
    ctx.strokeStyle = farbe;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const linie = Math.max(1.2, w * 0.42);
    switch (form) {
      case 'bogen': // happy ^
        ctx.lineWidth = linie;
        ctx.beginPath();
        ctx.arc(0, h * 0.22, w * 0.62, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
        return;
      case 'strich': // asleep
        ctx.lineWidth = linie * 0.8;
        ctx.beginPath();
        ctx.arc(0, -h * 0.12, w * 0.6, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        return;
      case 'genervt': // a flat line, tilted inwards
        ctx.lineWidth = linie * 0.9;
        ctx.beginPath();
        ctx.moveTo(-w * 0.62, -seite * h * 0.1);
        ctx.lineTo(w * 0.62, seite * h * 0.1);
        ctx.stroke();
        return;
      case 'spirale': {
        ctx.lineWidth = Math.max(1, w * 0.22);
        ctx.beginPath();
        const dreh = t * 9 * seite;
        for (let i = 0; i <= 40; i++) {
          const a = dreh + (i / 40) * TAU * 2.2;
          const r = (i / 40) * w * 0.66;
          if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
        return;
      }
      case 'herz':
        ctx.fillStyle = 'rgb(255,104,168)';
        herzPfad(ctx, w * 1.75);
        ctx.fill();
        return;
      case 'gross':
        ovalPfad(ctx, w * 1.18, h * 1.12);
        ctx.fill();
        return;
      case 'punkt':
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.42, 0, TAU);
        ctx.fill();
        return;
      default: // 'oval'
        ovalPfad(ctx, w, h);
        ctx.fill();
    }
  }

  // ---- geometry ----

  /** Layout for a canvas of `groesse` CSS px. 'eng' = the helmet fills the canvas (tiny faces); 'weit' leaves room
   *  above for hops, hearts and the badge. */
  function mass(groesse, rahmen) {
    const eng = rahmen === 'eng';
    const voll = rahmen === 'voll'; // icons: the helmet fills the square
    const W = groesse * (voll ? 0.98 : eng ? 0.84 : 0.6);
    const H = W * 0.86;
    return {
      W, H,
      cx: groesse / 2,
      cy: groesse * (voll ? 0.5 : eng ? 0.53 : 0.6),
      visier: { w: W * 0.8, h: H * 0.54, dy: H * 0.04 },
      auge: { w: W * 0.145, h: W * 0.2, abstand: W * 0.18 },
    };
  }

  function helmPfad(ctx, x, y, w, h) {
    const oben = Math.min(w / 2, h * 0.6);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [oben, oben, h * 0.3, h * 0.3]);
  }

  const ruhig = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function erstellen(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    let groesse = o.groesse || 64;
    let m = mass(groesse, o.rahmen);
    let details = o.details != null ? o.details : groesse >= 40;
    let dpr = 1;

    const z = {
      t: 0, zuletzt: 0, laeuft: false, timer: null, stillSeit: 0,
      // gaze (−1..1), smoothed
      bx: 0, by: 0, zielX: 0, zielY: 0,
      zeiger: null,
      // body
      neigung: 0, hop: 0, sx: 1, sy: 1,
      squash: null,   // { start, art }
      hopStart: -1e9, hopHoehe: 0,
      rollStart: -1e9, rollDauer: 950, rollRunden: 1,
      wackelStart: -1e9,
      // eyes
      offen: 1, blinzeln: [], naechsterBlinzler: 0, augenSkala: 1, augenZiel: 1,
      form: 'oval', formVorher: 'oval', formWechsel: 1,
      grund: 'oval', ausdruck: null, ausdruckBis: 0,
      schwindligBis: 0, stupse: [],
      // state
      zustand: 'bereit', farbe: rgb(o.farbe || LED), farbZiel: rgb(o.farbe || LED), eigeneFarbe: o.farbe || null,
      abzeichen: null, abzeichenSkala: 0, abzeichenWechsel: -1e9, abzeichenNeu: null,
      denkt: false, hoert: false, pegel: 0, pegelGlatt: 0, schlaeft: false, staunt: false,
      visier: 0, visierZiel: 0,
      // particles & gestures
      herzen: [], zs: [], funken: [],
      hover: 0, herzZuletzt: -1e9, hoverPunkt: null,
      winkenBis: 0,
    };

    function groesseSetzen(neu) {
      groesse = neu;
      m = mass(groesse, o.rahmen);
      if (o.details == null) details = groesse >= 40;
      dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(groesse * dpr);
      canvas.height = Math.round(groesse * dpr);
      canvas.style.width = `${groesse}px`;
      canvas.style.height = `${groesse}px`;
    }
    groesseSetzen(groesse);

    const jetzt = () => performance.now();

    function blinzelnPlanen(t, erst) {
      z.naechsterBlinzler = t + (erst ? 1500 + Math.random() * 2000 : 2200 + Math.random() * 3200);
    }
    blinzelnPlanen(jetzt(), true);

    function blinzle(t) {
      z.blinzeln.push(t);
      if (Math.random() < 0.22) z.blinzeln.push(t + 230);
    }

    function formFuer(t) {
      if (z.schwindligBis > t) return 'spirale';
      if (z.ausdruckBis > t && z.ausdruck) return z.ausdruck;
      if (z.schlaeft) return 'strich';
      if (z.staunt) return 'gross';
      return z.grund;
    }

    // ---- update ----

    function schritt(dt, t) {
      z.t += dt;

      // gaze: anywhere on screen, tanh falloff; states override
      let zx = 0;
      let zy = 0;
      if (z.zeiger) {
        zx = Math.tanh((z.zeiger.x - m.cx) / 260);
        zy = Math.tanh((z.zeiger.y - m.cy) / 200);
      }
      if (z.denkt) { zx = zx * 0.3 + 0.55; zy = zy * 0.3 - 0.55; }
      if (z.staunt) { zx *= 0.4; zy = -0.85; }
      if (z.schlaeft) { zx = 0; zy = 0.3; }
      if (z.schwindligBis > t) { zx = 0.35 * Math.sin(z.t * 9); zy = 0.2 * Math.cos(z.t * 9); }
      z.bx = naeher(z.bx, zx, 0.0025, dt);
      z.by = naeher(z.by, zy, 0.0025, dt);

      // body: tilt toward the gaze, wobble when dizzy
      const zielNeigung = z.bx * 0.06 + (z.schwindligBis > t ? Math.sin(z.t * 9) * 0.1 : 0);
      z.neigung = naeher(z.neigung, zielNeigung, 0.0008, dt);

      // squash keyframes
      let sx = 1;
      let sy = 1;
      if (z.squash && ruhig()) z.squash = null;
      if (z.squash) {
        const e = t - z.squash.start;
        const gross = z.squash.art === 'schluck';
        sy = folge([[0, 1], [70, gross ? 0.74 : 0.8], [200, 1.1], [370, 1]], e);
        sx = folge([[0, 1], [70, gross ? 1.26 : 1.16], [200, 0.95], [370, 1]], e);
        if (e > 400) z.squash = null;
      }
      z.sx = sx;
      z.sy = sy;

      // hop: up eased out, down eased in, landing squash
      const he = t - z.hopStart;
      if (he < 150) z.hop = -z.hopHoehe * raus(he / 150);
      else if (he < 450) z.hop = -z.hopHoehe * (1 - rein((he - 150) / 300));
      else z.hop = 0;
      if (he >= 450 && he < 470 && !z.squash) z.squash = { start: t, art: 'stups' };

      // blink
      if (!z.schlaeft && z.schwindligBis <= t && t >= z.naechsterBlinzler) {
        blinzle(t);
        blinzelnPlanen(t);
      }
      let offen = 1;
      z.blinzeln = z.blinzeln.filter((b) => t - b < 220);
      for (const b of z.blinzeln) {
        const e = t - b;
        if (e < 0) continue;
        const v = e < 70 ? 1 - glatt(e / 70) * 0.94 : 0.06 + raus((e - 70) / 130) * 0.94;
        offen = Math.min(offen, klemmen(v, 0.06, 1));
      }
      z.offen = offen;

      // hover → love after 1.9 s (cooldown 6 s)
      if (z.hover && t - z.hover > 1900 && t - z.herzZuletzt > 6000) {
        z.herzZuletzt = t;
        herzenZeigen();
        if (o.beiHerzen) o.beiHerzen();
      }
      z.augenSkala = naeher(z.augenSkala, (z.hover ? 1.08 : 1) * (z.hoert ? 1 + z.pegelGlatt * 0.25 : 1), 0.0008, dt);

      // expression cross-fade
      const form = formFuer(t);
      if (form !== z.form) { z.formVorher = z.form; z.form = form; z.formWechsel = 0; }
      z.formWechsel = Math.min(1, z.formWechsel + dt / 0.14);

      // colour follows the state
      z.farbe = mischen(z.farbe, z.farbZiel, 1 - Math.pow(0.002, dt));

      // badge pop: out 90 ms, swap at 100, back in 280 ms (back ease)
      const ae = t - z.abzeichenWechsel;
      if (ae < 90) z.abzeichenSkala = 1 - ae / 90;
      else {
        if (z.abzeichenNeu !== undefined) { z.abzeichen = z.abzeichenNeu; z.abzeichenNeu = undefined; }
        const p = klemmen((ae - 100) / 280, 0, 1);
        const c = 1.70158;
        z.abzeichenSkala = z.abzeichen ? 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2) : 0;
      }

      z.visier = naeher(z.visier, z.visierZiel, 0.0001, dt);
      z.pegelGlatt += (z.pegel - z.pegelGlatt) * Math.min(1, dt * 14);

      // particles
      z.herzen = z.herzen.filter((h) => t - h.start < h.leben);
      z.funken = z.funken.filter((f) => t - f.start < 700);
      if (z.schlaeft && (!z.zs.length || t - z.zs[z.zs.length - 1].start > 1300)) z.zs.push({ start: t });
      z.zs = z.zs.filter((q) => t - q.start < 2600);
    }

    // ---- draw ----

    function zeichnen(t) {
      const { W, H, cx, cy, visier, auge } = m;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, groesse, groesse);
      const farbe = z.farbe.map(Math.round).join(',');

      const atem = Math.sin(z.t * (z.schlaeft ? 1.8 : 1.5));
      const amp = ruhig() ? 0 : z.schlaeft ? 1 : 0.35;
      const sx = z.sx * (1 - 0.02 * amp * atem);
      const sy = z.sy * (1 + 0.035 * amp * atem);

      ctx.save();
      ctx.translate(cx, cy + H / 2 + z.hop * W);
      ctx.rotate(z.neigung);
      ctx.scale(sx, sy);
      ctx.translate(0, -H / 2);
      const x0 = -W / 2;
      const y0 = -H / 2;

      // antenna (behind the shell); its tip lags behind the head a little
      if (details) {
        const wipp = Math.sin(z.t * 2.1) * W * 0.012 - z.neigung * W * 0.25;
        ctx.strokeStyle = 'rgba(205,214,226,0.95)';
        ctx.lineWidth = Math.max(1, W * 0.028);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(W * 0.46, -H * 0.02);
        ctx.lineTo(W * 0.52 + wipp, -H * 0.66);
        ctx.stroke();
        ctx.fillStyle = `rgb(${farbe})`;
        ctx.beginPath();
        ctx.arc(W * 0.52 + wipp, -H * 0.66, Math.max(1, W * 0.032), 0, TAU);
        ctx.fill();
      }

      // shell
      helmPfad(ctx, x0, y0, W, H);
      const schale = ctx.createLinearGradient(W * 0.3, y0, -W * 0.3, y0 + H);
      schale.addColorStop(0, '#fbfcfe');
      schale.addColorStop(0.55, '#e2e7ee');
      schale.addColorStop(1, '#b9c2cf');
      ctx.fillStyle = schale;
      ctx.fill();
      if (o.kontur) { // icons on a light taskbar: a fine edge keeps the white helmet visible
        ctx.lineWidth = Math.max(0.75, W * 0.035);
        ctx.strokeStyle = 'rgba(20,28,40,0.45)';
        ctx.stroke();
      }
      ctx.save();
      ctx.clip();
      const rand = ctx.createRadialGradient(0, 0, W * 0.15, 0, 0, W * 0.72);
      rand.addColorStop(0, 'rgba(40,52,70,0)');
      rand.addColorStop(0.6, 'rgba(40,52,70,0)');
      rand.addColorStop(1, 'rgba(40,52,70,0.2)');
      ctx.fillStyle = rand;
      ctx.fillRect(x0, y0, W, H);
      const licht = ctx.createRadialGradient(-W * 0.22, y0 + H * 0.16, 0, -W * 0.22, y0 + H * 0.16, W * 0.42);
      licht.addColorStop(0, 'rgba(255,255,255,0.7)');
      licht.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = licht;
      ctx.fillRect(x0, y0, W, H);
      if (details) { // the seam of the top panel
        ctx.fillStyle = 'rgba(140,155,178,0.22)';
        ctx.fillRect(-W * 0.14, y0, Math.max(0.6, W * 0.012), H * 0.24);
        ctx.fillRect(W * 0.13, y0, Math.max(0.6, W * 0.012), H * 0.24);
      }
      ctx.restore();

      // ear piece
      if (details) {
        ctx.fillStyle = '#c3ccd8';
        ctx.beginPath();
        ctx.ellipse(W * 0.5, H * 0.04, W * 0.05, H * 0.17, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(90,105,125,0.35)';
        ctx.beginPath();
        ctx.ellipse(W * 0.515, H * 0.04, W * 0.022, H * 0.11, 0, 0, TAU);
        ctx.fill();
      }

      // the visor; lifts for a file (z.visier 0..1) and opens the helmet
      const vw = visier.w;
      const vh = visier.h;
      const auf = z.visier;
      const vr = [vh * 0.46, vh * 0.46, vh * 0.5, vh * 0.5];
      if (auf > 0.01) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-vw / 2, -vh / 2 + visier.dy, vw, vh, vr);
        ctx.fillStyle = '#020306';
        ctx.fill();
        const innen = ctx.createRadialGradient(0, visier.dy + vh * 0.2, 0, 0, visier.dy + vh * 0.2, vw * 0.6);
        innen.addColorStop(0, `rgba(${farbe},${0.28 * auf})`);
        innen.addColorStop(1, `rgba(${farbe},0)`);
        ctx.fillStyle = innen;
        ctx.fill();
        ctx.restore();
      }
      const vx = z.bx * W * 0.035;
      const vy = visier.dy + z.by * H * 0.02 - auf * H * 0.46;
      ctx.save();
      ctx.translate(vx, vy);
      ctx.scale(1, 1 - auf * 0.5);
      ctx.beginPath();
      ctx.roundRect(-vw / 2, -vh / 2, vw, vh, vr);
      ctx.lineWidth = Math.max(1.5, W * 0.085);
      ctx.strokeStyle = `rgba(${farbe},${0.16 + (z.hoert ? z.pegelGlatt * 0.35 : 0)})`;
      ctx.stroke();
      const glas = ctx.createLinearGradient(0, -vh / 2, 0, vh / 2);
      glas.addColorStop(0, '#16233a');
      glas.addColorStop(1, '#03060c');
      ctx.fillStyle = glas;
      ctx.fill();
      ctx.lineWidth = Math.max(1, W * 0.032);
      ctx.strokeStyle = `rgba(${farbe},0.92)`;
      ctx.stroke();

      // eyes, clipped to the glass
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(-vw / 2, -vh / 2, vw, vh, vr);
      ctx.clip();
      const maxX = vw / 2 - auge.abstand - auge.w / 2 - W * 0.035;
      const maxY = vh / 2 - auge.h / 2 - W * 0.03;
      // done / dizzy: the eyes scroll across the visor like a LED marquee
      const re = t - z.rollStart;
      let roll = 0;
      if (re >= 0 && re < z.rollDauer) roll = glatt(re / z.rollDauer) * z.rollRunden;
      const span = vw + auge.abstand * 2 + auge.w;
      const ex = z.bx * maxX + (roll % 1) * span - (roll % 1 > 0.5 ? span : 0);
      const ey = z.by * maxY;
      const aw = auge.w * z.augenSkala;
      const ah = auge.h * z.augenSkala;
      const zeichneAugen = (form, alpha) => {
        if (alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        for (const seite of [-1, 1]) {
          ctx.save();
          // curved glass: the eye nearer the edge gets narrower
          const s = 1 - Math.max(0, seite * z.bx) * 0.16;
          ctx.translate(seite * auge.abstand + ex, ey);
          const lid = form === 'oval' || form === 'gross' ? z.offen : Math.max(z.offen, 0.7);
          ctx.scale(s, lid);
          augeZeichnen(ctx, form, aw, ah, seite, z.t, `rgb(${farbe})`);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      };
      ctx.shadowColor = `rgba(${farbe},0.85)`;
      ctx.shadowBlur = Math.max(2, W * 0.09);
      const f = glatt(z.formWechsel);
      zeichneAugen(z.formVorher, 1 - f);
      zeichneAugen(z.form, f);
      ctx.shadowBlur = 0;
      if (details) { // LED scan lines
        ctx.fillStyle = 'rgba(3,7,14,0.42)';
        const schritt = Math.max(2, W * 0.036);
        for (let y = -vh / 2; y < vh / 2; y += schritt) ctx.fillRect(-vw / 2, y, vw, schritt * 0.38);
      }
      if (z.denkt && !ruhig()) { // working: a light sweeps across the visor
        const p = (z.t % 1.6) / 1.6;
        const x = -vw * 0.7 + p * vw * 1.4;
        const g = ctx.createLinearGradient(x - vw * 0.2, 0, x + vw * 0.2, 0);
        g.addColorStop(0, `rgba(${farbe},0)`);
        g.addColorStop(0.5, `rgba(${farbe},0.18)`);
        g.addColorStop(1, `rgba(${farbe},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(-vw / 2, -vh / 2, vw, vh);
      }
      const glanz = ctx.createLinearGradient(-vw / 2, -vh / 2, vw * 0.1, vh * 0.1);
      glanz.addColorStop(0, 'rgba(255,255,255,0.16)');
      glanz.addColorStop(0.45, 'rgba(255,255,255,0.03)');
      glanz.addColorStop(0.46, 'rgba(255,255,255,0)');
      ctx.fillStyle = glanz;
      ctx.fillRect(-vw / 2, -vh / 2, vw, vh);
      ctx.restore(); // eye clip
      ctx.restore(); // visor

      // wave: a small glove next to the helmet
      if (z.winkenBis > t) {
        const rest = (z.winkenBis - t) / 1400;
        ctx.save();
        ctx.globalAlpha = klemmen((1 - rest) * 6, 0, 1) * klemmen(rest * 6, 0, 1);
        ctx.translate(W * 0.62, H * 0.12 + Math.sin(z.t * TAU * 5) * H * 0.04);
        ctx.rotate(Math.sin(z.t * TAU * 2.5) * 0.3 - 0.15);
        ctx.fillStyle = '#e8edf3';
        ctx.strokeStyle = 'rgba(120,135,155,0.55)';
        ctx.lineWidth = Math.max(0.8, W * 0.015);
        ctx.beginPath();
        ctx.roundRect(-W * 0.07, -W * 0.2, W * 0.14, W * 0.2, W * 0.07);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(-W * 0.08, -W * 0.08, W * 0.035, W * 0.05, -0.6, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // badge at the top-left: working dots, «!», «✓», «×»
      if (details && z.abzeichen && z.abzeichenSkala > 0.01) {
        const r = Math.max(4, W * 0.14);
        ctx.save();
        ctx.translate(-W * 0.44, y0 + r * 0.55);
        ctx.scale(z.abzeichenSkala, z.abzeichenSkala);
        ctx.fillStyle = `rgb(${farbe})`;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.2);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.fillStyle = '#05070b';
        ctx.strokeStyle = '#05070b';
        ctx.lineCap = 'round';
        if (z.abzeichen === 'punkte') {
          for (let i = 0; i < 3; i++) {
            const puls = 0.55 + 0.45 * Math.sin(z.t * TAU * 2.4 - i * 0.22 * TAU);
            ctx.globalAlpha = puls;
            ctx.beginPath();
            ctx.arc((i - 1) * r * 0.48, 0, r * 0.16, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        } else if (z.abzeichen === '!') {
          ctx.lineWidth = r * 0.28;
          ctx.beginPath();
          ctx.moveTo(0, -r * 0.5);
          ctx.lineTo(0, r * 0.12);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, r * 0.48, r * 0.15, 0, TAU);
          ctx.fill();
        } else if (z.abzeichen === '✓') {
          ctx.lineWidth = r * 0.26;
          ctx.beginPath();
          ctx.moveTo(-r * 0.45, 0);
          ctx.lineTo(-r * 0.1, r * 0.34);
          ctx.lineTo(r * 0.48, -r * 0.34);
          ctx.stroke();
        } else if (z.abzeichen === '×') {
          ctx.lineWidth = r * 0.26;
          ctx.beginPath();
          ctx.moveTo(-r * 0.35, -r * 0.35);
          ctx.lineTo(r * 0.35, r * 0.35);
          ctx.moveTo(r * 0.35, -r * 0.35);
          ctx.lineTo(-r * 0.35, r * 0.35);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.restore(); // helmet transform

      // hearts rise
      for (const h of z.herzen) {
        const p = (t - h.start) / h.leben;
        if (p < 0) continue;
        ctx.save();
        ctx.globalAlpha = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
        ctx.translate(cx + h.dx * W + Math.sin(p * 5 + h.dx * 9) * W * 0.06, cy - H * 0.5 - p * groesse * 0.4);
        ctx.rotate(Math.sin(p * 6 + h.dx) * 0.3);
        ctx.fillStyle = 'rgb(255,104,168)';
        herzPfad(ctx, W * (0.15 + h.s * 0.05) * (1 + p * 0.4));
        ctx.fill();
        ctx.restore();
      }

      // sparks when done
      for (const f2 of z.funken) {
        const p = (t - f2.start) / 700;
        if (p < 0) continue;
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = `rgb(${farbe})`;
        const d = W * (0.5 + p * 0.45);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(f2.a) * d, cy + Math.sin(f2.a) * d * 0.8, Math.max(1, W * 0.03 * (1 - p)), 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // z z z
      if (z.zs.length) {
        ctx.save();
        ctx.font = `600 ${Math.max(7, W * 0.22)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        for (const q of z.zs) {
          const p = (t - q.start) / 2600;
          ctx.globalAlpha = Math.sin(Math.PI * p) * 0.8;
          ctx.fillStyle = `rgb(${farbe})`;
          ctx.fillText('z', cx + W * (0.42 + p * 0.25), cy - H * (0.45 + p * 0.55));
        }
        ctx.restore();
      }
    }

    // ---- frame loop: runs only while visible; slower when nothing moves ----

    function bewegt(t) {
      return z.hover || z.squash || t - z.hopStart < 500 || t - z.rollStart < z.rollDauer || z.herzen.length
        || z.funken.length || z.schwindligBis > t || z.winkenBis > t || z.denkt || z.hoert || z.formWechsel < 1
        || Math.abs(z.visier - z.visierZiel) > 0.01 || t - z.stillSeit < 1500 || z.blinzeln.length;
    }

    function bild() {
      if (!z.laeuft) return;
      const t = jetzt();
      const dt = z.zuletzt ? Math.min(0.05, (t - z.zuletzt) / 1000) : 1 / 60;
      z.zuletzt = t;
      schritt(dt, t);
      zeichnen(t);
      // still: 12 fps (blinks and breathing stay alive); asleep: 4 fps
      const langsam = z.schlaeft ? 250 : bewegt(t) ? 0 : 83;
      if (langsam) z.timer = setTimeout(() => requestAnimationFrame(bild), langsam);
      else requestAnimationFrame(bild);
    }

    function starten() {
      if (z.laeuft) return;
      z.laeuft = true;
      z.zuletzt = 0;
      requestAnimationFrame(bild);
    }
    function stoppen() {
      z.laeuft = false;
      if (z.timer) clearTimeout(z.timer);
      z.timer = null;
    }
    function aufwecken() {
      z.stillSeit = jetzt();
      if (z.laeuft && z.timer) { clearTimeout(z.timer); z.timer = null; requestAnimationFrame(bild); }
    }

    // ---- reactions ----

    function ausdruck(form, ms) {
      z.ausdruck = form;
      z.ausdruckBis = jetzt() + (ms || 1200);
      aufwecken();
    }

    function herzenZeigen() {
      const t = jetzt();
      for (let i = 0; i < 4; i++) z.herzen.push({ start: t + i * 140, dx: (Math.random() - 0.5) * 0.9, s: Math.random(), leben: 1300 + Math.random() * 500 });
      ausdruck('herz', 1800);
      hupf(0.1);
    }

    /** Poke: squash + annoyed; three within 1.7 s → dizzy for 3.3 s. Returns 'genervt' | 'schwindlig'. */
    function stups() {
      const t = jetzt();
      z.stupse = z.stupse.filter((s) => t - s < 1700);
      z.stupse.push(t);
      z.squash = { start: t, art: 'stups' };
      aufwecken();
      if (z.stupse.length >= 3) {
        z.stupse = [];
        z.schwindligBis = t + 3300;
        z.rollStart = ruhig() ? -1e9 : t;
        z.rollDauer = 1300;
        z.rollRunden = 2;
        return 'schwindlig';
      }
      ausdruck('genervt', 800);
      return 'genervt';
    }

    function hupf(hoehe) {
      if (ruhig()) return;
      z.hopStart = jetzt();
      z.hopHoehe = hoehe == null ? 0.2 : hoehe;
      aufwecken();
    }

    /** Done: happy eyes, a hop, the eyes roll once across the visor, sparks. */
    function fertig() {
      const t = jetzt();
      ausdruck('bogen', 1600);
      hupf(0.18);
      z.rollStart = ruhig() ? -1e9 : t + 120;
      z.rollDauer = 950;
      z.rollRunden = 1;
      for (let i = 0; i < 5; i++) z.funken.push({ start: t + 500, a: -Math.PI / 2 + (i - 2) * 0.55 });
    }

    function winken() {
      z.winkenBis = jetzt() + 1400;
      ausdruck('bogen', 1500);
      hupf(0.12);
    }

    /** A file is coming: the visor lifts (0..1), the eyes look up. */
    function visierOeffnen(p) {
      z.visierZiel = klemmen(p, 0, 1);
      z.staunt = p > 0.2;
      aufwecken();
    }

    /** Gulp: the visor snaps shut over the file, squash, happy. */
    function schlucken() {
      z.visierZiel = 0;
      z.visier = Math.min(z.visier, 0.3);
      z.staunt = false;
      z.squash = { start: jetzt(), art: 'schluck' };
      ausdruck('bogen', 1100);
    }

    /** State → LED colour and badge: bereit | arbeitet | wartet | fertig | fehler | hoert | schlaeft. */
    function zustand(name) {
      if (name === z.zustand) return;
      const vorher = z.zustand;
      z.zustand = name;
      z.farbZiel = rgb(name === 'bereit' && z.eigeneFarbe ? z.eigeneFarbe : (FARBEN[name] || LED));
      const neu = name === 'arbeitet' ? 'punkte' : name === 'wartet' ? '!' : name === 'fertig' ? '✓' : name === 'fehler' ? '×' : null;
      if (neu !== z.abzeichen) { z.abzeichenWechsel = jetzt(); z.abzeichenNeu = neu; }
      z.denkt = name === 'arbeitet';
      if (name === 'wartet' && vorher !== 'wartet') hupf(0.2);
      if (name === 'fehler') ausdruck('genervt', 900);
      if (vorher !== name && name !== 'bereit') blinzle(jetzt());
      aufwecken();
    }

    return {
      starten, stoppen, stups, hupf, winken, fertig, visierOeffnen, schlucken, herzenZeigen, ausdruck, zustand,
      groesse: groesseSetzen,
      /** Pointer in canvas-local CSS px (anywhere on screen), or null. */
      zeiger(p) {
        if (p && z.zeiger && Math.abs(p.x - z.zeiger.x) + Math.abs(p.y - z.zeiger.y) > 0.5) aufwecken();
        z.zeiger = p;
      },
      hover(an) {
        const t = jetzt();
        if (an && !z.hover) { z.hover = t; blinzle(t); }
        if (!an) z.hover = 0;
        aufwecken();
      },
      /** Moving more than 40 px while hovering restarts the love timer. */
      hoverBewegt() { if (z.hover) z.hover = jetzt(); },
      grund(form) { z.grund = form || 'oval'; },
      hoert(an) { z.hoert = !!an; if (!an) z.pegel = 0; aufwecken(); },
      pegel(p) { z.pegel = klemmen(p, 0, 1); },
      schlaf(an) { if (z.schlaeft !== !!an) { z.schlaeft = !!an; if (!an) z.zs = []; aufwecken(); } },
      farbe(rgbText) { z.eigeneFarbe = rgbText || null; if (z.zustand === 'bereit') { z.farbZiel = rgb(rgbText || LED); z.farbe = z.farbZiel.slice(); } },
      get laeuft() { return z.laeuft; },
    };
  }

  window.SpaceGesicht = { erstellen, LED, FARBEN };
})();
