// Preload — drag region + taskbar badge observer + titlebar theme resync + bridges (spaceConnector, spaceDateien)

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
