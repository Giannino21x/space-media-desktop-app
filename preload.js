// Preload — drag region + taskbar badge observer + titlebar theme resync + bridges (spaceConnector, spaceDateien, spaceLokal)

const { contextBridge, ipcRenderer } = require('electron');

// Expose restart function for auto-updater banner. With contextIsolation the
// preload's `window` is not the page's `window`, so the banner (injected via
// executeJavaScript into the main world) can only see it through contextBridge.
contextBridge.exposeInMainWorld('__electronRestart', () => ipcRenderer.send('restart-for-update'));

// «Eigenes Claude-Abo»: the settings card (web app, ClaudeAboKarte.tsx) pairs this computer with one click and
// the SPACE Connector runs in the background while the app is open (main.js → connector.js). Without this
// bridge (browser) the card shows the terminal command instead.
contextBridge.exposeInMainWorld('spaceConnector', {
  version: 4,
  status: (opts) => ipcRenderer.invoke('connector:status', opts),
  koppeln: (code, url) => ipcRenderer.invoke('connector:koppeln', { code, url }),
  // v2: Claude Code's own sign-in — opens Anthropic's page in the browser, resolves when confirmed.
  // v3: anmelden({ immer: true }) shows the page even when Claude Code is already signed in.
  anmelden: (opts) => ipcRenderer.invoke('connector:anmelden', opts),
  anmeldenAbbrechen: () => ipcRenderer.invoke('connector:anmelden-abbrechen'),
  // v4: the app opens Anthropic's page itself (in front); «Seite nochmals öffnen» while a sign-in waits
  anmeldeseiteOeffnen: () => ipcRenderer.invoke('connector:anmeldeseite-oeffnen'),
  starten: () => ipcRenderer.invoke('connector:starten'),
  stoppen: () => ipcRenderer.invoke('connector:stoppen'),
  entkoppeln: () => ipcRenderer.invoke('connector:entkoppeln'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('connector:changed', listener);
    return () => ipcRenderer.removeListener('connector:changed', listener);
  },
});

// «Dateien»: PC folders for the web app — the page «Dateien», the sync into «Meine Dateien» and the bots' live
// access while the app is open. main.js → dateien.js does the reading: only folders the person picked in the system
// dialog, never writing. Contract «Vertrag D» in the web repo (docs/plans/2026-10-26-dateien.md). Main answers
// { ok, wert } / { ok: false, meldung }, so a refusal reaches the page as an Error with the German message.
const dateienAufruf = async (kanal, ...args) => {
  const antwort = await ipcRenderer.invoke(kanal, ...args);
  if (antwort && antwort.ok) return antwort.wert;
  throw new Error((antwort && antwort.meldung) || 'Der Ordner auf diesem PC liess sich nicht lesen.');
};

contextBridge.exposeInMainWorld('spaceDateien', {
  version: 1,
  ordnerWaehlen: async () => {
    // Only right after a click or key press of the person — no page pops the dialog up on its own.
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      throw new Error('Ordner wählen geht nur direkt nach einem Klick.');
    }
    return dateienAufruf('dateien:ordner-waehlen');
  },
  freigaben: () => dateienAufruf('dateien:freigaben'),
  freigabeAendern: (id, felder) => dateienAufruf('dateien:freigabe-aendern', id, felder),
  freigabeEntfernen: async (id) => { await dateienAufruf('dateien:freigabe-entfernen', id); },
  liste: (id, unterpfad) => dateienAufruf('dateien:liste', id, unterpfad),
  alle: (id) => dateienAufruf('dateien:alle', id),
  lesen: async (id, pfad) => {
    const datei = await dateienAufruf('dateien:lesen', id, pfad);
    const bytes = datei.daten; // a Buffer in main arrives as Uint8Array
    return { ...datei, daten: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  },
  beobachten: (id, melden) => {
    const abo = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let aktiv = true;
    const listener = (_event, nachricht) => {
      if (aktiv && nachricht && nachricht.abo === abo) melden(nachricht.aenderungen);
    };
    ipcRenderer.on('dateien:aenderungen', listener);
    // A share that is gone (or forgotten on this computer) is reported like a deleted folder.
    const angemeldet = ipcRenderer.invoke('dateien:beobachten', { id, abo }).then((antwort) => {
      if (antwort && antwort.ok) return true;
      if (aktiv && antwort && (antwort.grund === 'weg' || antwort.grund === 'unbekannt')) melden([{ pfad: '', art: 'geloescht' }]);
      else console.warn(`SPACE Dateien: ${(antwort && antwort.meldung) || 'Beobachten geht nicht.'}`);
      return false;
    }, () => false);
    return () => {
      if (!aktiv) return;
      aktiv = false;
      ipcRenderer.removeListener('dateien:aenderungen', listener);
      // After the subscription stands, so main never keeps a watcher nobody listens to.
      void angemeldet.then((ok) => ok && ipcRenderer.invoke('dateien:beobachten-ende', { abo }));
    };
  },
});

// The island (insel/insel.js) hands a dropped file to the chat: main says it is ready, the chat takes it once
// (lib/insel/ablage.ts desktopDateiNehmen in the web app, on the event 'insel:datei').
contextBridge.exposeInMainWorld('spaceInselDatei', {
  version: 1,
  nehmen: async () => {
    const d = await ipcRenderer.invoke('insel:datei-nehmen');
    if (!d) return null;
    const bytes = d.daten;
    return { name: d.name, type: d.type, daten: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  },
});
ipcRenderer.on('insel:datei-bereit', () => window.dispatchEvent(new Event('insel:datei')));

// The island shows the bot the person is talking to in the chat, and whether it is writing (web: lib/insel/desktop.ts).
// Version 2: the island's switches for Einstellungen → Bot → Insel (null where there is no island).
// v3 (SPACE Pet, 30.10.2026): einstellungen() also carries `pet` (switch) and `petName`; setzen('pet', bool) brings a
// hidden pet back too, setzen('petName', string) renames it. Web: lib/insel/desktop.ts.
contextBridge.exposeInMainWorld('spaceInselApp', {
  version: 3,
  einstellungen: () => ipcRenderer.invoke('insel:app-einstellungen'),
  setzen: (schluessel, wert) => ipcRenderer.invoke('insel:app-einstellung', {
    schluessel: String(schluessel),
    wert: schluessel === 'petName' ? String(wert == null ? '' : wert).slice(0, 24) : !!wert,
  }),
  beobachten: (melden) => {
    const listener = (_event, e) => { if (e && typeof e === 'object') melden(e); };
    ipcRenderer.on('insel:app-einstellungen', listener);
    return () => ipcRenderer.removeListener('insel:app-einstellungen', listener);
  },
  aktiverBot: (bot) => {
    if (!bot || typeof bot.id !== 'string') return;
    ipcRenderer.send('insel:aktiver-bot', {
      id: bot.id.slice(0, 64),
      name: String(bot.name || '').slice(0, 40),
      farbe: String(bot.farbe || 'sky').slice(0, 16),
      schreibt: !!bot.schreibt,
    });
  },
});

// «KI auf dem Gerät» on this PC (main.js → lokal.js): the same bridge the phone app has — contract lib/lokal/bruecke.ts
// v1 in the web repo (stand, frage, hoeren, modelle, laden, abbrechen, entfernen; `sprechen` stays with the browser's
// voice, like on the phone). The camera mode, dictation and the settings card work with it unchanged. Windows only
// (llama.cpp's Windows release); on a Mac the bridge is missing and the page shows the phone hint. Main answers
// { ok, wert } / { ok: false, meldung } so the German message reaches the page. Sound arrives as WebM/Opus and is
// decoded to WAV 16 kHz here (lokal-wav.js) — the model hears WAV only.
if (process.platform === 'win32') {
  // The renderer is sandboxed: this preload cannot require local files, so the encoder of lokal-wav.js lives here a
  // second time (same bytes out — lokal-regeln.test.js checks pcmZuWav there; keep both in step).
  const WAV_RATE = 16000;
  const istWav = (b) => b.length >= 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WAVE';
  const pcmZuWav = (samples) => {
    const n = samples.length;
    const v = new DataView(new ArrayBuffer(44 + n * 2));
    const text = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    text(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, WAV_RATE, true);
    v.setUint32(28, WAV_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(v.buffer);
  };
  const aufMonoUndRate = (kanaele, rate) => {
    const laenge = kanaele[0].length;
    const mono = new Float32Array(laenge);
    for (const k of kanaele) for (let i = 0; i < laenge; i++) mono[i] += k[i] / kanaele.length;
    if (rate === WAV_RATE) return mono;
    const f = rate / WAV_RATE;
    const out = new Float32Array(Math.floor(laenge / f));
    for (let i = 0; i < out.length; i++) { const p = i * f; const a = Math.floor(p); const b = Math.min(laenge - 1, a + 1); out[i] = mono[a] + (mono[b] - mono[a]) * (p - a); }
    return out;
  };
  const aufnahmeZuWav = async (audio) => {
    const roh = new Uint8Array(audio);
    if (istWav(roh)) return roh;
    const ctx = new AudioContext();
    try {
      const d = await ctx.decodeAudioData(audio.slice(0));
      const kanaele = [];
      for (let c = 0; c < d.numberOfChannels; c++) kanaele.push(d.getChannelData(c));
      if (!kanaele.length) throw new Error('leer');
      return pcmZuWav(aufMonoUndRate(kanaele, d.sampleRate));
    } catch {
      throw new Error('Die Aufnahme konnte nicht gelesen werden.');
    } finally {
      ctx.close().catch(() => {});
    }
  };
  const lokalAufruf = async (kanal, ...args) => {
    const antwort = await ipcRenderer.invoke(kanal, ...args);
    if (antwort && antwort.ok) return antwort.wert;
    throw new Error((antwort && antwort.meldung) || 'Die KI auf diesem PC hat nicht geantwortet.');
  };
  contextBridge.exposeInMainWorld('spaceLokal', {
    version: 1,
    stand: () => lokalAufruf('lokal:stand'),
    frage: (e) => lokalAufruf('lokal:frage', { bild: e && e.bild, text: e && e.text }),
    hoeren: async (e) => {
      if (!e || !(e.audio instanceof ArrayBuffer)) throw new Error('Die Aufnahme konnte nicht gelesen werden.');
      const wav = await aufnahmeZuWav(e.audio);
      return lokalAufruf('lokal:hoeren', wav);
    },
    modelle: () => lokalAufruf('lokal:modelle'),
    laden: (art) => lokalAufruf('lokal:laden', String(art)),
    abbrechen: (art) => lokalAufruf('lokal:abbrechen', String(art)),
    entfernen: (art) => lokalAufruf('lokal:entfernen', String(art)),
  });
  // download progress, server up or down, an error: the page re-reads stand()/modelle()
  ipcRenderer.on('lokal:stand', () => window.dispatchEvent(new CustomEvent('lokal-stand-geaendert')));
}

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    /* Drag region via body::after — doesn't conflict with body::before (nebula) */
    body::after {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      -webkit-app-region: drag;
      z-index: 99999;
    }

    /* Clickable elements in the top bar must override drag */
    button, a, input, select, textarea, [role="button"], [onclick] {
      -webkit-app-region: no-drag;
    }

    /* Hide PWA install prompts */
    [data-pwa-install], .pwa-install-prompt {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  // Watch for notification badge changes in the DOM.
  // The web app renders .notification-bell-badge with the unread count.
  // React mutates the DOM constantly (streaming chat, lists); the observer
  // callback is coalesced to one DOM query per animation frame instead of
  // one per mutation batch, so it never competes with rendering.
  let lastCount = 0;
  let badgeCheckScheduled = false;
  const readBadge = () => {
    badgeCheckScheduled = false;
    const badge = document.querySelector('.notification-bell-badge');
    const count = badge ? parseInt(badge.textContent || '0', 10) || 0 : 0;
    if (count !== lastCount) {
      lastCount = count;
      ipcRenderer.send('set-badge-count', count);
    }
  };
  const observer = new MutationObserver(() => {
    if (badgeCheckScheduled) return;
    badgeCheckScheduled = true;
    requestAnimationFrame(readBadge);
  });

  // Start observing once the app has loaded
  const startObserving = () => {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    readBadge();
  };

  // Wait a bit for the app to render
  setTimeout(startObserving, 3000);

  // Titlebar theme: the main process samples the pixels under the native
  // window controls. Instead of polling every second it now resamples when
  // something that can change the top-bar colour actually happens — theme /
  // brand switch (data-theme / data-brand on <html>). Route changes are caught
  // in main.js via 'did-navigate-in-page' — patching history.pushState here
  // would only patch the isolated preload world, not the page.
  const requestTitlebarSync = () => ipcRenderer.send('titlebar-resync');
  new MutationObserver(requestTitlebarSync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-brand', 'class', 'style'],
  });
});
