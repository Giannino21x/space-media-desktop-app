// The throw: a small bubble with the first words flies in an arc from the pet to the pointer (regeln.js wurfBogen),
// pops on impact — that is the moment main pastes the text. The overlay covers the display and is shown by pet.js
// only for the throw; it draws nothing else.

(function () {
  const api = window.spaceInsel;
  const R = window.SpaceRegeln;
  const canvas = document.getElementById('wurf');
  const ctx = canvas.getContext('2d');
  const NACHLAUF_MS = 240;
  let lauf = null;

  function messen() {
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    return dpr;
  }

  function blase(x, y, skala, text, farbe, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(skala, skala);
    ctx.font = '600 12.5px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
    const b = Math.ceil(ctx.measureText(text).width) + 22;
    const h = 26;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(8,9,12,0.95)';
    ctx.beginPath();
    ctx.roundRect(-b / 2, -h / 2, b, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = `rgba(${farbe},0.9)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#f5f6f8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  function bild(t) {
    if (!lauf) return;
    const dpr = lauf.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const e = t - lauf.start;
    const p = Math.min(1, e / lauf.dauer);
    if (e < lauf.dauer) {
      const pos = R.wurfBogen(lauf.von, lauf.nach, p);
      const skala = 0.55 + 0.45 * Math.min(1, p * 3);
      blase(pos.x, pos.y, skala, lauf.text, lauf.farbe, 1);
    } else {
      // impact: the bubble shrinks away, a ring spreads where the words landed
      const q = Math.min(1, (e - lauf.dauer) / NACHLAUF_MS);
      if (q < 0.5) blase(lauf.nach.x, lauf.nach.y, 1 - q * 2, lauf.text, lauf.farbe, 1 - q * 2);
      ctx.save();
      ctx.globalAlpha = 1 - q;
      ctx.strokeStyle = `rgba(${lauf.farbe},0.9)`;
      ctx.lineWidth = 2 - q;
      ctx.beginPath();
      ctx.arc(lauf.nach.x, lauf.nach.y, 6 + 22 * q, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (q >= 1) { lauf = null; ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); return; }
    }
    requestAnimationFrame(bild);
  }

  api.onWurfStart((w) => {
    if (!w || !w.von || !w.nach) return;
    const dpr = messen();
    lauf = { von: w.von, nach: w.nach, text: String(w.text || '…'), farbe: String(w.farbe || '51,170,255'), dauer: Math.max(120, Number(w.dauer) || 400), start: performance.now(), dpr };
    requestAnimationFrame(bild);
  });
})();
