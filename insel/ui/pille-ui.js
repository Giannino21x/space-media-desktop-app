// The dictation pill: records while the right Ctrl is held (insel.js drives it through pille:start / pille:stopp),
// shows the SPACE face listening with nine dots that follow the voice, hands the take to main for transcription and
// pasting. Resting it is a 44×8 capsule; hovered it opens a toolbar (dictate, record a meeting, open SPACE).
// Behaviour after Coucou for Windows (MIT code): log-spaced bands 90–7000 Hz, rise 0.6 / fall 0.25, takes shorter
// than 0.25 s or quieter than 0.004 are dropped silently.
// While the SPACE Pet is on (settings.petAktiv), this window keeps recording but shows nothing: the pet shows the
// listening pill next to the figure, fed with the nine bands from here (pille:pegel), and its messages (pille:meldung).

(function () {
  const api = window.spaceInsel || demoBruecke();
  const S = window.SpaceSymbole;
  const K = window.SpaceKlang;
  const $ = (id) => document.getElementById(id);
  const kapsel = $('kapsel');
  const blase = $('blase');
  const FENSTER = { b: 520, h: 170 };
  const GROESSE = { ruhe: [44, 8], werkzeug: [150, 34], live: [118, 34], denkt: [118, 34], freihand: [166, 34] };
  const BAENDER = 9;

  $('p-diktat').innerHTML = S.mikrofon;
  $('p-sitzung').innerHTML = S.aufnahme;
  $('p-oeffnen').innerHTML = S.oeffnen;
  $('p-weg').innerHTML = S.kreuz;
  $('p-fertig').innerHTML = S.check;
  const punkte = $('punkte');
  for (let i = 0; i < BAENDER; i++) punkte.appendChild(document.createElement('i'));
  const punktEls = Array.from(punkte.children);

  const gesicht = window.SpaceGesicht.erstellen($('p-gesicht'), { groesse: 22, rahmen: 'eng' });

  const st = {
    look: 'ruhe',
    pet: false,     // the pet shows the pill: this window is invisible and click-through
    test: false,    // a fixed test text replaces the transcription (unpackaged): silent takes are kept
    hover: false,
    meldungBreite: 0,
    aufnahme: null,
    pegel: new Array(BAENDER).fill(0),
    ziel: new Array(BAENDER).fill(0),
    lauf: null,
  };
  const uhren = {};
  const uhr = (name, ms, fn) => { clearTimeout(uhren[name]); uhren[name] = ms == null ? undefined : setTimeout(fn, ms); };

  // ---- looks ----

  function look(neu, opts) {
    st.look = neu;
    kapsel.dataset.look = neu;
    kapsel.dataset.art = (opts && opts.art) || '';
    for (const el of document.querySelectorAll('.p-inhalt')) el.classList.toggle('an', el.dataset.look.split(' ').includes(neu));
    if (neu === 'meldung') {
      kapsel.style.width = `${st.meldungBreite}px`;
    } else {
      kapsel.style.width = '';
    }
    if (neu === 'ruhe') { gesicht.stoppen(); blaseZeigen(null); } else gesicht.starten();
    gesicht.hoert(neu === 'live' || neu === 'freihand');
    gesicht.zustand(neu === 'live' || neu === 'freihand' ? 'hoert' : neu === 'denkt' ? 'arbeitet' : opts && opts.art === 'fehler' ? 'fehler' : 'bereit');
    if (neu === 'live' || neu === 'freihand' || neu === 'denkt') laufStarten();
    flaechenMelden();
    setTimeout(flaechenMelden, 60);
    setTimeout(flaechenMelden, 420);
  }

  function flaechenMelden() {
    if (st.pet) { api.pillenFlaechen([]); return; }
    const [w, h] = st.look === 'meldung' ? [st.meldungBreite, 34] : GROESSE[st.look] || GROESSE.ruhe;
    const rects = [];
    if (st.look === 'ruhe') rects.push({ x: (FENSTER.b - 96) / 2, y: FENSTER.h - 26, width: 96, height: 26 });
    else rects.push({ x: (FENSTER.b - w) / 2 - 6, y: FENSTER.h - h - 6, width: w + 12, height: h + 6 });
    if (blase.classList.contains('an')) {
      const r = blase.getBoundingClientRect();
      rects.push({ x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12 });
    }
    api.pillenFlaechen(rects);
  }

  function meldung(text, art, ms) {
    if (st.pet) { api.meldung(text, art); look(st.hover ? 'werkzeug' : 'ruhe'); return; }
    $('p-text').textContent = text;
    $('ansage').textContent = text;
    // text width + face + padding
    const mess = document.createElement('canvas').getContext('2d');
    mess.font = '600 12.5px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
    st.meldungBreite = Math.ceil(mess.measureText(text).width) + 59;
    look('meldung', { art });
    uhr('meldung', ms || 1800, () => { if (st.look === 'meldung') look(st.hover ? 'werkzeug' : 'ruhe'); });
  }

  function blaseZeigen(text) {
    if (!text) { blase.classList.remove('an'); flaechenMelden(); return; }
    blase.textContent = text;
    blase.classList.add('an');
    requestAnimationFrame(flaechenMelden);
  }
  for (const b of document.querySelectorAll('[data-tipp]')) {
    b.addEventListener('mouseenter', () => blaseZeigen(b.dataset.tipp));
    b.addEventListener('mouseleave', () => blaseZeigen(null));
  }

  // ---- hover: within the hot rects (main polls the cursor) ----

  api.onPilleZeiger(({ drin }) => {
    st.hover = drin && !st.pet;
    if (drin) {
      uhr('weg', null);
      if (st.look === 'ruhe') { look('werkzeug'); K.spielen('diktatStart'); }
    } else {
      uhr('weg', 250, () => { if (!st.hover && st.look === 'werkzeug') look('ruhe'); });
    }
  });

  $('p-diktat').addEventListener('click', () => api.taste('freihand'));
  $('p-sitzung').addEventListener('click', () => { look('ruhe'); api.oeffnen('/sitzungen/new'); });
  $('p-oeffnen').addEventListener('click', () => { look('ruhe'); api.oeffnen('/'); });
  $('p-weg').addEventListener('click', () => api.taste('abbrechen'));
  $('p-fertig').addEventListener('click', () => api.taste('fertig'));

  // ---- recording ----

  async function aufnahmeStarten(id) {
    if (st.aufnahme) aufnahmeVerwerfen();
    const a = { id, chunks: [], start: 0, peak: 0, messungen: 0, stopp: null, freihand: false, stream: null, recorder: null, ctx: null, analyser: null };
    st.aufnahme = a;
    // a shortcut tap (Ctrl+C) must not flash the pill: show it only when the take lasts
    uhr('zeigen', 150, () => { if (st.aufnahme === a && !a.stopp) { look(a.freihand ? 'freihand' : 'live'); K.spielen('diktatStart'); } });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (st.aufnahme !== a) { stream.getTracks().forEach((t) => t.stop()); return; }
      a.stream = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      a.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
      a.recorder.ondataavailable = (e) => { if (e.data.size > 0) a.chunks.push(e.data); };
      try {
        a.ctx = new AudioContext();
        const quelle = a.ctx.createMediaStreamSource(stream);
        a.analyser = a.ctx.createAnalyser();
        a.analyser.fftSize = 1024;
        a.analyser.smoothingTimeConstant = 0;
        quelle.connect(a.analyser);
      } catch { a.analyser = null; } // no level meter — the recording still works
      a.recorder.start(250);
      a.start = performance.now();
      if (a.stopp) aufnahmeStoppen(a.stopp);
    } catch {
      if (st.aufnahme !== a) return;
      st.aufnahme = null;
      api.leer(id);
      K.spielen('fehler');
      meldung('Mikrofon nicht verfügbar', 'fehler', 4000);
    }
  }

  function aufraeumen(a) {
    if (a.stream) a.stream.getTracks().forEach((t) => t.stop());
    if (a.ctx) a.ctx.close().catch(() => {});
  }

  function aufnahmeVerwerfen() {
    const a = st.aufnahme;
    if (!a) return;
    st.aufnahme = null;
    uhr('zeigen', null);
    try { if (a.recorder && a.recorder.state !== 'inactive') a.recorder.stop(); } catch { /* already stopped */ }
    aufraeumen(a);
  }

  function aufnahmeStoppen(befehl) {
    const a = st.aufnahme;
    if (!a) return;
    if (!a.recorder) { a.stopp = befehl; return; } // the mic is still opening
    uhr('zeigen', null);
    if (!befehl.senden) {
      aufnahmeVerwerfen();
      api.leer(a.id);
      if (st.look !== 'meldung') look(st.hover ? 'werkzeug' : 'ruhe');
      if (!befehl.still) K.spielen('stups');
      return;
    }
    const dauer = performance.now() - a.start;
    const recorder = a.recorder;
    recorder.onstop = async () => {
      aufraeumen(a);
      if (st.aufnahme === a) st.aufnahme = null;
      // too short, or silent (only when the level could be measured at all)
      if (!st.test && (dauer < 250 || (a.messungen > 3 && a.peak < 0.004))) { api.leer(a.id); look(st.hover ? 'werkzeug' : 'ruhe'); return; }
      const blob = new Blob(a.chunks, { type: recorder.mimeType || 'audio/webm' });
      look('denkt');
      K.spielen('diktatEnde');
      // the model on this PC hears WAV only (lokal-wav.js); if decoding fails the take goes to the app as recorded
      let mime = blob.type;
      let daten = await blob.arrayBuffer();
      if (lokalWav && window.spaceWav) {
        try { daten = (await window.spaceWav.aufnahmeZuWav(daten)).buffer; mime = 'audio/wav'; } catch { /* as recorded */ }
      }
      const r = await api.audio(a.id, mime, daten);
      if (r && r.ok) {
        if (r.kopiert) meldung('Kopiert · Strg+V zum Einfügen', 'info', 1800);
        else { gesicht.fertig(); look(st.hover ? 'werkzeug' : 'ruhe'); }
      } else if (r && r.still) {
        look(st.hover ? 'werkzeug' : 'ruhe');
      } else {
        K.spielen('fehler');
        meldung((r && r.meldung) || 'Das Diktat liess sich nicht lesen.', 'fehler', 4000);
      }
    };
    try { recorder.stop(); } catch { recorder.onstop(); }
  }

  api.onPilleStart(({ id }) => aufnahmeStarten(id));
  api.onPilleFreihand(() => {
    if (st.aufnahme) st.aufnahme.freihand = true;
    look('freihand');
  });
  api.onPilleStopp((b) => aufnahmeStoppen(b));

  // ---- the nine dots, the face's gaze, the level for the island ----

  const kanten = Array.from({ length: BAENDER + 1 }, (_, i) => 90 * Math.pow(7000 / 90, i / BAENDER));
  let fft = null;
  let zeit = null;
  let letzterPegel = 0;

  function laufStarten() {
    if (st.lauf) return;
    let zuletzt = performance.now();
    let messung = 0;
    const bild = (t) => {
      const dt = Math.min(0.05, (t - zuletzt) / 1000);
      zuletzt = t;
      const a = st.aufnahme;
      if (st.look === 'denkt') {
        for (let i = 0; i < BAENDER; i++) st.ziel[i] = 0.25 + 0.25 * Math.sin(t / 160 - 0.7 * i);
      } else if (a && a.analyser && t - messung >= 33) {
        messung = t;
        const n = a.analyser.frequencyBinCount;
        if (!fft || fft.length !== n) { fft = new Float32Array(n); zeit = new Float32Array(a.analyser.fftSize); }
        a.analyser.getFloatFrequencyData(fft);
        a.analyser.getFloatTimeDomainData(zeit);
        a.messungen++;
        for (let i = 0; i < zeit.length; i++) { const v = Math.abs(zeit[i]); if (v > a.peak) a.peak = v; }
        const hz = a.ctx.sampleRate / 2 / n;
        for (let b = 0; b < BAENDER; b++) {
          const von = Math.max(1, Math.floor(kanten[b] / hz));
          const bis = Math.max(von + 1, Math.ceil(kanten[b + 1] / hz));
          let max = -140;
          for (let k = von; k < bis && k < n; k++) if (fft[k] > max) max = fft[k];
          const ziel = Math.min(1, Math.max(0, (max + 78) / 48));
          const k2 = ziel > st.ziel[b] ? 0.6 : 0.25;
          st.ziel[b] += (ziel - st.ziel[b]) * k2;
        }
        const mittel = st.ziel.reduce((s, v) => s + v, 0) / BAENDER;
        gesicht.pegel(mittel);
        if (t - letzterPegel > 66) { letzterPegel = t; api.pegel(mittel, st.pet ? st.ziel.slice() : undefined); }
      } else if (!a) {
        for (let i = 0; i < BAENDER; i++) st.ziel[i] *= 0.8;
      }
      for (let i = 0; i < BAENDER; i++) {
        st.pegel[i] += (st.ziel[i] - st.pegel[i]) * Math.min(1, 14 * dt);
        punktEls[i].style.height = `${(3.4 + 16 * st.pegel[i]).toFixed(1)}px`;
      }
      // the face wanders while it listens
      gesicht.zeiger({ x: 11 + 260 * Math.atanh(0.6 * Math.sin(t / 900)), y: 11 + 200 * Math.atanh(0.3 * Math.cos(t / 1300)) });
      if (st.look === 'live' || st.look === 'freihand' || st.look === 'denkt') st.lauf = requestAnimationFrame(bild);
      else st.lauf = null;
    };
    st.lauf = requestAnimationFrame(bild);
  }

  // ---- settings ----

  // lokalBereit + lokalDiktat (insel.js): dictation goes to the model on this PC → send WAV
  let lokalWav = false;
  api.onEinstellungen((e) => {
    K.an = e.toene !== false;
    lokalWav = e.lokalDiktat !== false && !!e.lokalBereit;
    st.test = !!e.testDiktat;
    const pet = !!e.petAktiv;
    if (pet !== st.pet) {
      st.pet = pet;
      document.body.classList.toggle('pet', pet);
      if (pet && st.look === 'werkzeug') look('ruhe');
      flaechenMelden();
    }
  });
  if (api.onLage) api.onLage((lage) => {
    const steno = !!(lage && lage.steno);
    gesicht.figur(steno ? 'steno' : 'space');
    const name = steno ? 'Steno' : 'SPACE';
    $('p-oeffnen').dataset.tipp = `${name} öffnen`;
    $('p-oeffnen').setAttribute('aria-label', `${name} öffnen`);
  });
  look('ruhe');

  function demoBruecke() {
    const leer = () => () => {};
    const log = (n) => (...a) => { console.log('[pille demo]', n, JSON.stringify(a).slice(0, 160)); return Promise.resolve({ ok: true }); };
    return {
      pillenFlaechen: log('flaechen'), pegel: () => Promise.resolve(), taste: log('taste'), audio: log('audio'), leer: log('leer'), oeffnen: log('oeffnen'), meldung: log('meldung'),
      onPilleZeiger: leer, onPilleStart: leer, onPilleFreihand: leer, onPilleStopp: leer, onEinstellungen: leer, onLage: leer,
    };
  }
  if (!window.spaceInsel) window.pilleDemo = { look, meldung, st };
})();
