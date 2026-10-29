// «KI auf dem Gerät» on the PC (29.10.2026): the same bridge `window.spaceLokal` the phone app has (contract
// lib/lokal/bruecke.ts in the web repo, v1), so the camera mode, dictation and reading aloud of the web app run with
// the LFM3 model on this computer — picture and sound never leave it.
//
// How: the model files (LFM3-Omni-2B, Q4_0 + mmproj, 1,3 GB, catalogue 1:1 from the web repo) go to
// <userData>/lokal/modelle/, llama.cpp's official Windows release (pinned tag + sha256) to <userData>/lokal/bin/, and
// `llama-server.exe` runs on 127.0.0.1 with a random port and a random API key for as long as something asks — one
// slot, OpenAI-compatible API (picture as data URL, sound as WAV base64 `input_audio`). After 15 minutes of silence
// the server stops and frees the memory. Vulkan first (NVIDIA, AMD, Intel without a vendor runtime); if that build
// cannot start, the CPU build, remembered in <userData>/lokal/lokal.json.
//
// Why not llama-cpp-pro's `./desktop`: its sidecar is a 5 MB own build of an older llama.cpp (LFM2 yes, LFM3 no —
// cpp/llama-arch.h of 0.2.4) with its own load API and no upstream parity; the official release has LFM3 since
// b11960 (v0.8.0, 28.10.2026) and the stable OpenAI API. Pure parts in lokal-regeln.js (`npm test`).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const R = require('./lokal-regeln');
const { istWav } = require('./lokal-wav');

const HEALTH_MS = 300;
const START_TIMEOUT_MS = 180_000;
const ANTWORT_TIMEOUT_MS = 120_000;
const LEERLAUF_MS = 15 * 60_000;
const FORTSCHRITT_MS = 500;
const MAX_WAV_BYTES = 50_000_000;

class LokalFehler extends Error {
  constructor(grund, meldung) {
    super(meldung || R.MELDUNG[grund] || R.MELDUNG.antwort);
    this.grund = grund;
  }
}

const schlafen = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * @param o.userDataDir  app.getPath('userData')
 * @param o.herunterladen fetch for the downloads (main: net.fetch, so the system proxy applies)
 * @param o.lokalFetch   fetch for 127.0.0.1 (default: Node's — never through a proxy)
 * @param o.onStand      something changed (download progress, server up/down, error) → the page gets 'lokal-stand-geaendert'
 * @param o.spawnServer  tests: replaces spawning llama-server.exe
 * @param o.prozessName  tests: image name of a PID (default: tasklist), for the orphan check at start
 * @param o.leerlaufMs   tests: idle time before the server stops
 * @param o.modelle, o.llama  tests: a small catalogue / release table instead of the real ones
 */
function createLokalHost(o) {
  const platform = o.platform || process.platform;
  const dir = path.join(o.userDataDir, 'lokal');
  const modelleDir = path.join(dir, 'modelle');
  const binDir = path.join(dir, 'bin');
  const einstellungenDatei = path.join(dir, 'lokal.json');
  const serverDatei = path.join(dir, 'server.json');
  const logDatei = path.join(dir, 'lokal.log');
  const herunterladen = o.herunterladen || ((url, init) => fetch(url, init));
  const lokalFetch = o.lokalFetch || ((url, init) => fetch(url, init));
  const spawnServer = o.spawnServer || ((exe, args, opts) => spawn(exe, args, opts));
  const leerlaufMs = o.leerlaufMs || LEERLAUF_MS;
  const MODELLE = o.modelle || R.MODELLE;
  const LLAMA = o.llama || R.LLAMA;

  let einstellungen = { beschleunigung: R.STANDARD_VARIANTE };
  try {
    const e = JSON.parse(fs.readFileSync(einstellungenDatei, 'utf8'));
    if (e && LLAMA.varianten[e.beschleunigung]) einstellungen.beschleunigung = e.beschleunigung;
  } catch { /* first start */ }
  const speichern = () => {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(einstellungenDatei, JSON.stringify(einstellungen, null, 2)); } catch { /* best effort */ }
  };

  const log = (zeile) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logDatei, `[${new Date().toISOString()}] ${zeile}\n`);
    } catch { /* logging never breaks the model */ }
    if (o.log) o.log(zeile);
  };

  /** running download: { art, bytes: { datei → bytes }, zip: { geladen, bytes } | null, abbruch, abgebrochen } */
  let download = null;
  /** art → German message of the last failure (download, start, answer) */
  const fehler = {};
  /** running llama-server: { proc, port, schluessel, art, variante, fertig, bereit, ausgabe, leerlauf } */
  let server = null;
  let serverStart = null;
  let laufend = 0;
  let reihe = Promise.resolve();
  let beendet = false;

  const standMelden = () => { if (!beendet && o.onStand) o.onStand(); };

  // ── an orphan from the last run ────────────────────────────────────────────────────────────────────────────────────
  // The app died hard (crash, task killed): will-quit never ran and llama-server kept the model in memory. Its PID is
  // in server.json; if that PID is still llama-server.exe (and not a process that reused the number), it goes now.

  const prozessName = o.prozessName || ((pid) => {
    if (platform !== 'win32') return null;
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    const m = /^"([^"]+)"/.exec((r.stdout || '').trim());
    return m ? m[1] : null;
  });
  function verwaistenBeenden() {
    let alt = null;
    try { alt = JSON.parse(fs.readFileSync(serverDatei, 'utf8')); } catch { return; }
    fs.rmSync(serverDatei, { force: true });
    if (!alt || !Number.isInteger(alt.pid) || alt.pid <= 0 || alt.pid === process.pid) return;
    const name = prozessName(alt.pid);
    if (!name || name.toLowerCase() !== R.SERVER_EXE) return;
    try { process.kill(alt.pid); log(`verwaister llama-server (PID ${alt.pid}) beendet`); } catch { /* already gone */ }
  }
  verwaistenBeenden();

  // ── files ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** { name → bytes } of the finished model files (a download in progress is «.teil» and does not count). */
  function vorhandene() {
    const r = {};
    try {
      for (const e of fs.readdirSync(modelleDir, { withFileTypes: true })) {
        if (!e.isFile() || !e.name.endsWith('.gguf')) continue;
        try { r[e.name] = fs.statSync(path.join(modelleDir, e.name)).size; } catch { /* vanished */ }
      }
    } catch { /* no folder yet */ }
    return r;
  }
  const modellVon = (art) => {
    const m = MODELLE[art];
    if (!m) throw new LokalFehler('unbekannt');
    return m;
  };
  const istVorhanden = (m) => R.vollstaendig(m, vorhandene());
  const pfadVon = (m, rolle) => path.join(modelleDir, m.dateien.find((d) => d.rolle === rolle).datei);

  // ── downloads ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** sha256 of the file into a running hash, without loading it whole. */
  function hashVonDatei(pfad, hash) {
    return new Promise((res, rej) => {
      fs.createReadStream(pfad).on('data', (c) => hash.update(c)).on('end', res).on('error', rej);
    });
  }

  /**
   * One file to disk: «<ziel>.teil» while loading (resumed with Range after a break), size and — when known — sha256
   * checked, then renamed. Progress every 500 ms.
   */
  async function dateiLaden(url, ziel, { bytes, sha256, signal, beiFortschritt }) {
    const teil = `${ziel}.teil`;
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    let start = 0;
    let hash = sha256 ? crypto.createHash('sha256') : null;
    try {
      const size = fs.statSync(teil).size;
      if (bytes && size > 0 && size < bytes) {
        start = size;
        if (hash) await hashVonDatei(teil, hash);
      } else {
        fs.rmSync(teil, { force: true });
      }
    } catch { /* no partial file */ }

    let res;
    try {
      res = await herunterladen(url, { headers: start ? { range: `bytes=${start}-` } : {}, signal, cache: 'no-store' });
    } catch (err) {
      if (signal.aborted) throw new LokalFehler('abgebrochen');
      throw new LokalFehler('netz', `${R.MELDUNG.netz} (${err.message})`);
    }
    if (start && res.status !== 206) {
      // the host ignored the range: start over
      start = 0;
      hash = sha256 ? crypto.createHash('sha256') : null;
    }
    if (!res.ok) throw new LokalFehler('netz', `${R.MELDUNG.netz} (HTTP ${res.status})`);
    if (!res.body) throw new LokalFehler('netz');

    const fd = fs.openSync(teil, start ? 'a' : 'w');
    let geladen = start;
    let letzte = 0;
    try {
      for await (const chunk of res.body) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        fs.writeSync(fd, b);
        if (hash) hash.update(b);
        geladen += b.length;
        const jetzt = Date.now();
        if (jetzt - letzte >= FORTSCHRITT_MS) { letzte = jetzt; beiFortschritt(geladen); }
      }
    } catch (err) {
      if (signal.aborted) throw new LokalFehler('abgebrochen');
      throw new LokalFehler('netz', `${R.MELDUNG.netz} (${err.message})`);
    } finally {
      fs.closeSync(fd);
    }
    beiFortschritt(geladen);
    if (bytes && geladen !== bytes) {
      if (geladen > bytes) fs.rmSync(teil, { force: true });
      throw new LokalFehler('unvollstaendig');
    }
    if (hash && hash.digest('hex') !== sha256) {
      fs.rmSync(teil, { force: true });
      throw new LokalFehler('pruefsumme');
    }
    fs.rmSync(ziel, { force: true });
    fs.renameSync(teil, ziel);
  }

  /** Hugging Face tells the sha256 of every LFS file; best effort — without it only the size is checked. */
  async function shaErmitteln(url, signal) {
    const baum = R.hfBaum(url);
    if (!baum) return null;
    try {
      const res = await herunterladen(baum.api, { signal, cache: 'no-store' });
      if (!res.ok) return null;
      return R.hfSha256(await res.json(), baum.datei);
    } catch {
      return null;
    }
  }

  /** llama-server.exe of a variant — downloads and unpacks the pinned release when it is missing. */
  async function binSichern(variante, lauf) {
    const v = LLAMA.varianten[variante];
    const zielDir = path.join(binDir, `${LLAMA.tag}-${variante}`);
    const exe = path.join(zielDir, R.SERVER_EXE);
    if (fs.existsSync(exe)) return exe;
    const zipPfad = path.join(binDir, v.datei);
    lauf.zip = { geladen: 0, bytes: v.bytes };
    log(`llama.cpp ${LLAMA.tag} (${variante}) laden`);
    await dateiLaden(v.url, zipPfad, {
      bytes: v.bytes,
      sha256: v.sha256,
      signal: lauf.abbruch.signal,
      beiFortschritt: (g) => { lauf.zip.geladen = g; standMelden(); },
    });
    const eintraege = R.zipEintraege(fs.readFileSync(zipPfad));
    fs.mkdirSync(zielDir, { recursive: true });
    let n = 0;
    for (const e of eintraege) {
      if (!R.benoetigteDatei(e.name)) continue;
      fs.writeFileSync(path.join(zielDir, path.basename(e.name)), e.daten);
      n++;
    }
    fs.rmSync(zipPfad, { force: true });
    if (!fs.existsSync(exe)) throw new LokalFehler('server', `${R.SERVER_EXE} fehlt im Archiv.`);
    log(`llama.cpp ${LLAMA.tag} (${variante}) bereit, ${n} Dateien`);
    return exe;
  }

  // ── llama-server ───────────────────────────────────────────────────────────────────────────────────────────────────

  function leerlaufPlanen(s) {
    if (s.leerlauf) clearTimeout(s.leerlauf);
    s.leerlauf = setTimeout(() => { if (server === s && laufend === 0) void serverStoppen(); }, leerlaufMs);
    if (s.leerlauf.unref) s.leerlauf.unref();
  }

  async function serverStoppen() {
    const s = server;
    if (!s) return;
    server = null;
    if (s.leerlauf) clearTimeout(s.leerlauf);
    if (s.proc.exitCode === null && s.proc.signalCode === null) {
      log(`llama-server (${s.variante}, Port ${s.port}) stoppen`);
      try { s.proc.kill(); } catch { /* already gone */ }
      await Promise.race([s.ende, schlafen(3000)]);
    }
    standMelden();
  }

  /** Start llama-server for the model with one variant and wait until /health answers. */
  async function serverStarten(m, variante) {
    const exe = o.serverExe || await binSichern(variante, download || { bytes: {}, zip: null, abbruch: new AbortController() });
    const port = R.portVorschlag(Math.random());
    const schluessel = crypto.randomBytes(16).toString('hex');
    const args = R.serverArgs({
      modell: pfadVon(m, 'modell'),
      projektor: pfadVon(m, 'projektor'),
      port,
      schluessel,
      variante,
      threads: R.threadsFuer(os.cpus().length),
    });
    const proc = spawnServer(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { proc, port, schluessel, art: m.art, variante, fertig: false, ausgabe: [], leerlauf: null, ende: null };
    server = s;
    try { fs.writeFileSync(serverDatei, JSON.stringify({ pid: proc.pid, port })); } catch { /* best effort */ }
    const merken = (zeile) => {
      if (!zeile.trim()) return;
      s.ausgabe.push(zeile);
      if (s.ausgabe.length > 40) s.ausgabe.shift();
      if (!s.fertig || /error|fail|warn/i.test(zeile)) log(`server: ${zeile}`);
    };
    if (proc.stdout) readline.createInterface({ input: proc.stdout }).on('line', merken);
    if (proc.stderr) readline.createInterface({ input: proc.stderr }).on('line', merken);
    let beendetMit = null;
    s.ende = new Promise((res) => {
      proc.on('error', (err) => { merken(`start: ${err.message}`); beendetMit = { code: -1 }; res(beendetMit); });
      proc.on('exit', (code, signal) => {
        beendetMit = { code, signal };
        fs.rmSync(serverDatei, { force: true });
        if (server === s) {
          server = null;
          log(`llama-server beendet (${code ?? signal})`);
          standMelden();
        }
        res(beendetMit);
      });
    });

    const bis = Date.now() + START_TIMEOUT_MS;
    try {
      while (Date.now() < bis) {
        if (beendetMit) {
          const ausgabe = s.ausgabe.join('\n');
          const art = R.startFehlerArt(ausgabe, variante);
          const letzte = s.ausgabe.filter((z) => /error|fail|cannot|not found|unable/i.test(z)).pop() || s.ausgabe[s.ausgabe.length - 1] || '';
          const e = art === 'modell'
            ? new LokalFehler('modellKaputt')
            : new LokalFehler('server', letzte ? `${R.MELDUNG.server} (${letzte.slice(0, 160)})` : R.MELDUNG.server);
          // died before it listened and the files are fine: with the GPU build that is the driver → try the CPU build
          e.gpu = art !== 'modell' && variante !== 'cpu';
          throw e;
        }
        try {
          const r = await lokalFetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
          if (r.status === 200) { s.fertig = true; break; }
        } catch { /* not listening yet */ }
        await schlafen(HEALTH_MS);
      }
      if (!s.fertig) throw new LokalFehler('server', 'llama-server hat nicht geantwortet.');
    } catch (err) {
      if (server === s) server = null;
      try { proc.kill(); } catch { /* already gone */ }
      throw err;
    }
    leerlaufPlanen(s);
    log(`llama-server ${LLAMA.tag} (${variante}) läuft auf Port ${port} mit ${m.name}`);
    standMelden();
    return s;
  }

  /** The running server for the model — starts it when it is missing (one model in memory, like on the phone). */
  function serverSichern(m) {
    if (server && server.art === m.art && server.fertig) return Promise.resolve(server);
    if (serverStart) return serverStart;
    serverStart = (async () => {
      try {
        if (!istVorhanden(m)) throw new LokalFehler('nichtGeladen', `${m.name} ist auf diesem PC noch nicht geladen.`);
        await serverStoppen();
        const variante = einstellungen.beschleunigung;
        try {
          return await serverStarten(m, variante);
        } catch (err) {
          if (variante === 'cpu' || !err.gpu || beendet) throw err;
          log(`${variante} gescheitert (${err.message}) → CPU-Build`);
          einstellungen.beschleunigung = 'cpu';
          speichern();
          return await serverStarten(m, 'cpu');
        }
      } catch (err) {
        fehler[m.art] = err.message;
        throw err;
      } finally {
        serverStart = null;
        standMelden();
      }
    })();
    return serverStart;
  }

  /** One request at a time — the server has one slot, and a second picture would only wait there. */
  function inReihe(fn) {
    const p = reihe.then(fn, fn);
    reihe = p.catch(() => undefined);
    return p;
  }

  async function chat(m, { system, text, bild, wavBase64 }) {
    const s = await serverSichern(m);
    laufend++;
    if (s.leerlauf) clearTimeout(s.leerlauf);
    try {
      const res = await lokalFetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${s.schluessel}` },
        body: JSON.stringify(R.chatKoerper({ system, text, bild, wavBase64 })),
        signal: AbortSignal.timeout(ANTWORT_TIMEOUT_MS),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        log(`antwort HTTP ${res.status}: ${t.slice(0, 300)}`);
        throw new LokalFehler('antwort');
      }
      delete fehler[m.art];
      return R.antwortText(await res.json());
    } catch (err) {
      if (err instanceof LokalFehler) throw err;
      log(`antwort: ${err.message}`);
      throw new LokalFehler('antwort');
    } finally {
      laufend--;
      if (server === s) leerlaufPlanen(s);
    }
  }

  // ── the bridge (lib/lokal/bruecke.ts v1) ───────────────────────────────────────────────────────────────────────────

  const standard = () => MODELLE[R.STANDARD_MODELL];

  return {
    LokalFehler,

    async stand() {
      const m = standard();
      const vorhanden = istVorhanden(m);
      // the camera opens → warm up now, so the first answer does not wait for the model to load (like the phone)
      if (vorhanden && !server && !serverStart && !download && !fehler[m.art] && !beendet) void serverSichern(m).catch(() => { /* in fehler */ });
      return R.standAus({
        modell: m,
        vorhanden,
        fehler: fehler[m.art],
        laedt: download ? R.gesamtFortschritt(MODELLE[download.art], download.bytes, download.zip && download.zip.geladen, download.zip && download.zip.bytes) : undefined,
        platform,
      });
    },

    /** Question about a picture (data URL) — the camera mode. */
    async frage(e) {
      const bild = R.bildDataUrl(e && e.bild);
      if (!bild) throw new LokalFehler('bild');
      const m = standard();
      if (!m.kann.sehen) throw new LokalFehler('keinBild');
      const text = String((e && e.text) || 'Was ist das?').slice(0, 2000);
      const start = Date.now();
      const antwort = await inReihe(() => chat(m, { system: R.SYSTEM_FRAGE, text, bild }));
      return { antwort: antwort || 'Dazu kann ich nichts sagen.', dauerMs: Date.now() - start };
    },

    /** Sound → text. WAV only (16 kHz mono from lokal-wav.js); the renderer decodes anything else first. */
    async hoerenWav(bytes) {
      const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
      if (b.length < 44 || b.length > MAX_WAV_BYTES || !istWav(b)) throw new LokalFehler('ton');
      const m = standard();
      if (!m.kann.hoeren) throw new LokalFehler('keinTon');
      const antwort = await inReihe(() => chat(m, { system: R.SYSTEM_HOEREN, text: R.HOEREN_FRAGE, wavBase64: b.toString('base64') }));
      return { text: R.diktatText(antwort) };
    },

    async modelle() {
      return Object.values(MODELLE).map((m) => R.modellStand(m, {
        vorhanden: istVorhanden(m),
        geladen: !!(server && server.fertig && server.art === m.art),
        laedtBytes: download && download.art === m.art ? download.bytes : null,
        fehler: fehler[m.art],
      }));
    },

    /** Download the model's files (resumable), then the server, then straight into memory. Resolves quietly on abort. */
    async laden(art) {
      if (download) throw new LokalFehler('laedtSchon');
      const m = modellVon(art);
      const lauf = { art, bytes: {}, zip: null, abbruch: new AbortController(), abgebrochen: false };
      download = lauf;
      delete fehler[art];
      standMelden();
      try {
        const da = vorhandene();
        for (const d of m.dateien) {
          if (lauf.abgebrochen) return;
          if (da[d.datei] === d.bytes) { lauf.bytes[d.datei] = d.bytes; continue; }
          const sha256 = await shaErmitteln(d.url, lauf.abbruch.signal);
          log(`${d.datei} laden (${sha256 ? 'sha256 bekannt' : 'nur Grösse'})`);
          await dateiLaden(d.url, path.join(modelleDir, d.datei), {
            bytes: d.bytes,
            sha256,
            signal: lauf.abbruch.signal,
            beiFortschritt: (g) => { lauf.bytes[d.datei] = g; standMelden(); },
          });
          lauf.bytes[d.datei] = d.bytes;
        }
        if (lauf.abgebrochen) return;
        await binSichern(einstellungen.beschleunigung, lauf);
        if (lauf.abgebrochen) return;
        log(`${m.name} vollständig`);
        await serverSichern(m);
      } catch (err) {
        if (lauf.abgebrochen || (err && err.grund === 'abgebrochen')) return;
        const meldung = err instanceof LokalFehler ? err.message : `${R.MELDUNG.netz} (${err && err.message})`;
        fehler[art] = meldung;
        log(`laden ${m.name}: ${meldung}`);
        throw new LokalFehler(err.grund || 'netz', meldung);
      } finally {
        if (download === lauf) download = null;
        standMelden();
      }
    },

    async abbrechen(art) {
      const d = download;
      if (!d || d.art !== art) return;
      d.abgebrochen = true;
      d.abbruch.abort();
      log(`laden ${art} abgebrochen`);
    },

    /** Delete the model's files from this PC (and stop the server if it runs with them). */
    async entfernen(art) {
      const m = modellVon(art);
      if (download && download.art === art) await this.abbrechen(art);
      if (server && server.art === art) await serverStoppen();
      for (const d of m.dateien) {
        const p = path.join(modelleDir, d.datei);
        fs.rmSync(p, { force: true });
        fs.rmSync(`${p}.teil`, { force: true });
      }
      delete fehler[art];
      log(`${m.name} entfernt`);
      standMelden();
    },

    /** For the island, synchronously: can dictation go through the model on this PC right now? */
    bereit() {
      const m = standard();
      return !beendet && m.kann.hoeren && istVorhanden(m) && !fehler[m.art];
    },

    /** The settings card may show which build runs. */
    get beschleunigung() { return einstellungen.beschleunigung; },
    get laeuft() { return !!(server && server.fertig); },

    shutdown() {
      beendet = true;
      if (download) { download.abgebrochen = true; download.abbruch.abort(); }
      const s = server;
      server = null;
      if (s) {
        if (s.leerlauf) clearTimeout(s.leerlauf);
        log(`llama-server (Port ${s.port}) endet mit der App`);
        try { s.proc.kill(); } catch { /* already gone */ }
      }
    },
  };
}

module.exports = { createLokalHost, LokalFehler };
