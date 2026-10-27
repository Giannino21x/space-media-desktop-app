// PC folders for the SPACE Media App — window.spaceDateien (preload.js), «Vertrag D» in the web repo
// (docs/plans/2026-10-26-dateien.md).
//
// The person picks a folder in the system dialog; from then on the app's pages may list it, read files from it
// and watch it for changes — to sync it into «Meine Dateien» and to let the bots look into it live while the app
// is open. Read only: nothing here writes, moves or deletes a file of the person. Every path is resolved against
// the real root of the share (realpath, no «..», symlinks pointing outside are invisible), drive roots, the home
// folder (and above), hidden folders and the places where programs keep secrets (AppData, Library, this app's own
// data) cannot be shared — also not through a network path back to this computer. Hidden entries, node_modules and
// system files (Thumbs.db, desktop.ini, ~$ lock files) are never listed, read or reported.

const { randomUUID } = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const MAX_FREIGABEN = 50;
const MAX_ALLE = 10_000;
/** Directories alle() visits (and keeps waiting) at most — a huge tree must not keep the main process busy. */
const MAX_ORDNER = 50_000;
/** Entries read from one folder at most (liste shows up to this many, alle reports `abgeschnitten`). */
const MAX_EBENE = 10_000;
const MAX_LESEN_BYTES = 50 * 1024 * 1024;
const LESEN_STUECK = 1024 * 1024;
/** A dead network drive or a cloud file that never arrives must not block every later call. */
const LESEN_ZEIT_MS = 3 * 60_000;
const ALLE_ZEIT_MS = 5 * 60_000;
const ENTPRELLEN_MS = 1_000;
/** Under a steady stream of changes (copying a big folder) report at least every 5 s. */
const ENTPRELLEN_MAX_MS = 5_000;
const MAX_BEOBACHTER = 32;
const STAT_PARALLEL = 32;
/** At the same time: a page asking for many files at once must not fill the main process with 50 MB buffers. */
const LESEN_PARALLEL = 4;
const ALLE_PARALLEL = 2;

const MELDUNG = {
  laufwerk: 'Ein ganzes Laufwerk kann nicht freigegeben werden. Wähle einen Ordner darin.',
  benutzerordner: 'Der ganze Benutzerordner kann nicht freigegeben werden. Wähle einen Ordner darin, zum Beispiel «Dokumente».',
  geschuetzt: 'Dieser Ordner enthält Programm- oder Systemdaten und kann nicht freigegeben werden.',
  versteckt: 'Versteckte Ordner können nicht freigegeben werden.',
  netzwerk: 'Diese Netzwerkadresse kann nicht freigegeben werden. Wähle den Ordner direkt auf dem Laufwerk oder über eine normale Netzwerkfreigabe.',
  keinOrdner: 'Das ist kein Ordner.',
  keineDatei: 'Das ist keine Datei.',
  zuViele: `Es können höchstens ${MAX_FREIGABEN} Ordner freigegeben werden.`,
  unbekannt: 'Diese Freigabe gibt es auf diesem Rechner nicht mehr.',
  weg: 'Der freigegebene Ordner ist nicht mehr da (verschoben, umbenannt oder gelöscht). Gib ihn neu frei.',
  pfad: 'Dieser Pfad liegt nicht in der Freigabe.',
  nichtGefunden: 'Datei oder Ordner nicht gefunden.',
  zuGross: 'Die Datei ist grösser als 50 MB.',
  zugriff: 'Kein Zugriff auf diese Datei oder diesen Ordner.',
  belegt: 'Die Datei ist gerade in einem anderen Programm geöffnet.',
  zuVieleBeobachter: 'Es werden schon zu viele Ordner gleichzeitig beobachtet.',
  dialogOffen: 'Der Dialog «Ordner wählen» ist schon offen.',
  zeit: 'Der Ordner antwortet nicht (Netzlaufwerk oder Datei aus der Cloud?). Versuche es später nochmals.',
  nichtVerfuegbar: 'PC-Ordner sind hier nicht verfügbar.',
  allgemein: 'Der Ordner auf diesem PC liess sich nicht lesen.',
};

class DateienFehler extends Error {
  constructor(grund) {
    super(MELDUNG[grund] || MELDUNG.allgemein);
    this.grund = grund;
  }
}

// ── Pure helpers (dateien.test.js) ───────────────────────────────────────────

const SYSTEMDATEIEN = new Set(['node_modules', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '$recycle.bin', 'system volume information']);

/** Hidden entries, node_modules and system files are left out everywhere (list, read, watch). */
function ausgelassen(name) {
  return name.startsWith('.') || name.startsWith('~$') || SYSTEMDATEIEN.has(name.toLowerCase());
}

const WINDOWS_GERAET = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * A relative path from the page ('/' as separator, '' = root) → its segments, or null when it could leave the
 * share or name something that is left out. Windows: no «\» (second separator), no «:» (drive, alternate data
 * stream), no device names (CON, NUL, …).
 */
function pfadTeile(pfad, platform = process.platform) {
  if (typeof pfad !== 'string' || pfad.length > 4096 || pfad.includes('\0')) return null;
  const teile = pfad.split('/').filter(Boolean);
  for (const t of teile) {
    if (t === '.' || t === '..' || ausgelassen(t)) return null;
    if (platform === 'win32' && (/[\\:]/.test(t) || WINDOWS_GERAET.test(t))) return null;
  }
  return teile;
}

const pathFuer = (platform) => (platform === 'win32' ? path.win32 : path.posix);

/**
 * Windows file systems ignore case — so do the comparisons there. Elsewhere exact: on a case-sensitive volume
 * «Daten» and «daten» are two folders, and realpath already gives the spelling on disk.
 */
const vergleichbar = (p, platform) => (platform === 'win32' ? p.toLowerCase() : p);

/** Is `ziel` the root itself or inside it? Both are real (resolved) absolute paths. */
function istInnerhalb(wurzel, ziel, platform = process.platform) {
  const p = pathFuer(platform);
  const rel = p.relative(vergleichbar(wurzel, platform), vergleichbar(ziel, platform));
  return rel === '' || (!p.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${p.sep}`));
}

/**
 * Places nobody may share, given as real paths: where programs keep data and secrets (AppData with the browser
 * profiles, macOS Library, this app's own data with the connector's device token) and the operating system.
 */
function geschuetzteOrte({ platform, home, userData, env = {} }) {
  const p = pathFuer(platform);
  const orte = [userData];
  if (platform === 'win32') {
    orte.push(p.join(home, 'AppData'), env.SystemRoot, env.ProgramData, env.ProgramFiles, env['ProgramFiles(x86)']);
  } else {
    orte.push(p.join(home, 'Library'), '/etc', '/private', '/System', '/Library', '/usr', '/bin', '/sbin', '/var', '/proc', '/sys', '/dev');
  }
  return orte.filter(Boolean);
}

/**
 * Does a UNC host name this computer? Then `\\localhost\c$\Users\…` would reach the home folder and AppData under a
 * path the other rules do not recognise. `rechner` = this computer's host name and addresses.
 */
function eigenerRechner(host, rechner = []) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '0.0.0.0' || /^127\./.test(h)) return true;
  if (h.endsWith('.ipv6-literal.net')) return true; // \\fe80--1.ipv6-literal.net\… — an address written as a name
  return rechner.some((r) => {
    const n = String(r).toLowerCase();
    return n && (h === n || h.startsWith(`${n}.`));
  });
}

/**
 * Why a folder (real path) may not be shared — the key of the German message — or null when it may.
 * Not a drive root, not the home folder or anything above it, nothing hidden, nothing protected, no network path
 * back to this computer and no administrative share (C$, ADMIN$).
 */
function freigabeVerboten(ort, { platform = process.platform, home, userData, env = {}, rechner = [] }) {
  const p = pathFuer(platform);
  if (!p.isAbsolute(ort)) return 'keinOrdner';
  const normal = p.resolve(ort);
  if (platform === 'win32' && normal.startsWith('\\\\')) {
    const [host = '', freigabe = ''] = normal.slice(2).split('\\');
    if (host === '.' || host === '?' || freigabe.endsWith('$') || eigenerRechner(host, rechner)) return 'netzwerk';
  }
  const wurzel = p.parse(normal).root;
  if (vergleichbar(normal, platform) === vergleichbar(wurzel, platform)) return 'laufwerk';
  if (istInnerhalb(normal, home, platform)) return 'benutzerordner';
  if (p.relative(wurzel, normal).split(p.sep).some((t) => t.startsWith('.'))) return 'versteckt';
  for (const geschuetzt of geschuetzteOrte({ platform, home, userData, env })) {
    if (istInnerhalb(geschuetzt, normal, platform) || istInnerhalb(normal, geschuetzt, platform)) return 'geschuetzt';
  }
  return null;
}

/** Name of a new share: the folder name, made unique («Projekte (2)») — the sync puts it under «Meine Dateien/<Name>». */
function eindeutigerName(basis, vorhandene) {
  const belegt = new Set(vorhandene.map((n) => n.toLowerCase()));
  if (!belegt.has(basis.toLowerCase())) return basis;
  for (let i = 2; ; i++) {
    const name = `${basis} (${i})`;
    if (!belegt.has(name.toLowerCase())) return name;
  }
}

const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  zip: 'application/zip',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
};

function mimeVon(name) {
  const endung = path.extname(name).slice(1).toLowerCase();
  return MIME[endung] || 'application/octet-stream';
}

/** PcEintrag of the contract. */
function eintragVon(teile, stat) {
  const ordner = stat.isDirectory();
  return {
    pfad: teile.join('/'),
    name: teile[teile.length - 1],
    ordner,
    bytes: ordner ? 0 : stat.size,
    geaendertMs: Math.round(stat.mtimeMs),
  };
}

/** One collator for all sorting — localeCompare with options builds a new one per comparison (seconds for 50k names). */
const SORTIERUNG = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Explorer order: folders first, then by name (German collation, numbers by value). */
function sortieren(eintraege) {
  return eintraege.sort((a, b) => (a.ordner !== b.ordner ? (a.ordner ? -1 : 1) : SORTIERUNG.compare(a.name, b.name)));
}

/** A raw error → the German message for the page (never a path or a stack). */
function fehlerMeldung(err) {
  if (err instanceof DateienFehler) return err.message;
  switch (err && err.code) {
    case 'ENOENT': case 'ENOTDIR': return MELDUNG.nichtGefunden;
    case 'EACCES': case 'EPERM': return MELDUNG.zugriff;
    case 'EBUSY': return MELDUNG.belegt;
    default: return MELDUNG.allgemein;
  }
}

/**
 * At most `n` calls of the wrapped function run at once; the rest wait in order. With `zeitMs` a call that does not
 * finish in time fails with DateienFehler(grund) and frees its place; `fn` gets an AbortSignal as last argument to
 * stop its own work (a system call that hangs cannot be stopped, but it no longer blocks the calls behind it).
 */
function begrenzt(n, fn, { zeitMs = 0, grund = 'zeit' } = {}) {
  let laufend = 0;
  const wartend = [];
  const weiter = () => {
    while (laufend < n && wartend.length) {
      laufend++;
      const { args, resolve, reject } = wartend.shift();
      const abbruch = new AbortController();
      let timer = null;
      let frei = false;
      const freigeben = () => {
        if (frei) return;
        frei = true;
        clearTimeout(timer);
        laufend--;
        weiter();
      };
      if (zeitMs) {
        timer = setTimeout(() => { abbruch.abort(); reject(new DateienFehler(grund)); freigeben(); }, zeitMs);
      }
      Promise.resolve().then(() => fn(...args, abbruch.signal)).then(resolve, reject).finally(freigeben);
    }
  };
  return (...args) => new Promise((resolve, reject) => { wartend.push({ args, resolve, reject }); weiter(); });
}

function grundVon(err) {
  if (err instanceof DateienFehler) return err.grund;
  if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return 'nichtGefunden';
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return 'zugriff';
  return 'allgemein';
}

// ── Host ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} o.userDataDir   app.getPath('userData')
 * @param {boolean} o.isDev        dev keeps its own shares (dateien-dev.json)
 * @param {string} o.home          os.homedir()
 * @param {string} [o.platform]
 * @param {object} [o.env]
 * @param {string[]} [o.rechner]   this computer's host name and addresses (default: from os)
 * @param {number} [o.maxAlle]     tests only
 * @param {(ort: string) => Promise<string|null>} [o.identitaet]  tests only
 */
function createDateienHost(o) {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const maxAlle = o.maxAlle ?? MAX_ALLE;
  const p = pathFuer(platform);
  const datei = path.join(o.userDataDir, o.isDev ? 'dateien-dev.json' : 'dateien.json');
  const echt = (ort) => { try { return fs.realpathSync.native(ort); } catch { return ort; } };
  const rechner = o.rechner ?? [os.hostname(), ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map((a) => a.address)];
  const schutz = { platform, home: echt(o.home), userData: echt(o.userDataDir), env, rechner };
  const gleich = (a, b) => vergleichbar(a, platform) === vergleichbar(b, platform);

  /** Identity of a folder (device + file id), the same under every path that leads to it. */
  const identitaet = o.identitaet ?? (async (ort) => {
    try {
      const s = await fsp.stat(ort, { bigint: true });
      return s.ino ? `${s.dev}:${s.ino}` : null;
    } catch { return null; }
  });
  const vorfahren = (ort) => {
    const kette = [];
    for (let jetzt = p.resolve(ort); ; jetzt = p.dirname(jetzt)) {
      kette.push(jetzt);
      if (p.dirname(jetzt) === jetzt) return kette;
    }
  };

  /**
   * The path rules again, by identity: a share reached under another name (a network path to this computer, a mount)
   * must not be the home folder or above it, nor inside AppData/Library or another protected place.
   */
  const identitaetVerboten = async (real) => {
    const ids = async (orte) => new Set((await Promise.all(orte.map(identitaet))).filter(Boolean));
    const homeUndDarueber = await ids(vorfahren(schutz.home));
    const homeId = await identitaet(schutz.home);
    const geschuetzt = await ids(geschuetzteOrte(schutz));
    const imHomeGeschuetzt = platform === 'win32' ? 'appdata' : 'library';
    const kette = vorfahren(real);
    for (let i = 0; i < kette.length; i++) {
      const id = await identitaet(kette[i]);
      if (!id) continue;
      if (i === 0 && homeUndDarueber.has(id)) return 'benutzerordner';
      if (geschuetzt.has(id)) return 'geschuetzt';
      if (id === homeId && p.relative(kette[i], real).split(p.sep)[0].toLowerCase() === imHomeGeschuetzt) return 'geschuetzt';
    }
    return null;
  };

  /** freigabeId → Set of open watchers (closed when the share goes away) */
  const beobachter = new Map();
  let anzahlBeobachter = 0;

  const rohLaden = () => {
    try { return JSON.parse(fs.readFileSync(datei, 'utf8')) || {}; } catch { return {}; }
  };
  /** Usual folders already offered once (standardFreigeben) — a removed one is never added again. */
  const angebotenLaden = () => {
    const a = rohLaden().angeboten;
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  };
  const laden = () => {
    try {
      const daten = rohLaden();
      return (Array.isArray(daten.freigaben) ? daten.freigaben : []).filter((f) => f
        && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.ort === 'string')
        .map((f) => ({ id: f.id, name: f.name, ort: f.ort, sync: f.sync === true, live: f.live === true }));
    } catch { return []; }
  };
  const speichern = (freigaben, angeboten = angebotenLaden()) => {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    const tmp = `${datei}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, freigaben, ...(angeboten.length ? { angeboten } : {}) }, null, 2));
    fs.renameSync(tmp, datei);
  };
  const finden = (id) => {
    const f = typeof id === 'string' ? laden().find((x) => x.id === id) : null;
    if (!f) throw new DateienFehler('unbekannt');
    return f;
  };

  /** Real root of a share — refused when it moved, became a link elsewhere or is no longer allowed. */
  const wurzelVon = async (id) => {
    const f = finden(id);
    let real;
    try { real = await fsp.realpath(f.ort); } catch { throw new DateienFehler('weg'); }
    if (!gleich(real, f.ort)) throw new DateienFehler('weg');
    const verboten = freigabeVerboten(real, schutz);
    if (verboten) throw new DateienFehler(verboten);
    return { freigabe: f, wurzel: real };
  };

  /** A real path the page may see: inside the share and nothing hidden or left out on the way. */
  const sichtbar = (wurzel, real) => {
    if (!istInnerhalb(wurzel, real, platform)) return false;
    const rel = p.relative(wurzel, real);
    return !rel || !rel.split(p.sep).some(ausgelassen);
  };

  /**
   * What a path inside the share really is: stat of its target, or null when it is invisible — missing, a link
   * pointing outside the share, or (through a link) something hidden/left out.
   */
  const aufloesen = async (wurzel, teile) => {
    let real;
    try { real = await fsp.realpath(p.join(wurzel, ...teile)); } catch { return null; }
    if (!sichtbar(wurzel, real)) return null;
    try { return { real, stat: await fsp.stat(real) }; } catch { return null; }
  };

  /**
   * One level: visible files and folders, at most MAX_EBENE. Links count when their target lies inside the share.
   * The folder itself is resolved again first — swapped for a link to somewhere else in the meantime, it shows
   * nothing. Folders are resolved too: Windows junctions to «\??\Volume{…}\» look like plain folders to lstat.
   */
  const ebene = async (wurzel, verzeichnis, teile) => {
    const real = await fsp.realpath(verzeichnis);
    if (!sichtbar(wurzel, real)) return { eintraege: [], abgeschnitten: false };
    const namen = [];
    let abgeschnitten = false;
    for await (const d of await fsp.opendir(real)) {
      if (ausgelassen(d.name)) continue;
      if (namen.length >= MAX_EBENE) { abgeschnitten = true; break; }
      namen.push(d.name);
    }
    const eintraege = [];
    for (let i = 0; i < namen.length; i += STAT_PARALLEL) {
      const block = await Promise.all(namen.slice(i, i + STAT_PARALLEL).map(async (name) => {
        const kind = [...teile, name];
        const ort = p.join(real, name);
        try {
          const lstat = await fsp.lstat(ort);
          const verlinkt = lstat.isSymbolicLink() || (lstat.isDirectory() && !gleich(await fsp.realpath(ort), ort));
          if (!verlinkt) {
            return lstat.isFile() || lstat.isDirectory() ? { ...eintragVon(kind, lstat), link: false } : null;
          }
          const ziel = await aufloesen(wurzel, kind);
          if (!ziel || !(ziel.stat.isFile() || ziel.stat.isDirectory())) return null;
          return { ...eintragVon(kind, ziel.stat), link: true };
        } catch { return null; }
      }));
      eintraege.push(...block.filter(Boolean));
    }
    return { eintraege: sortieren(eintraege), abgeschnitten };
  };
  const ohneIntern = ({ link: _link, ...eintrag }) => eintrag;

  /**
   * All files below a folder: a folder's own files first, then its subfolders (explorer order), so a cut at the limit
   * keeps the upper levels. Folders reached through a link are not walked — their target is walked where it is.
   */
  const sammeln = async (wurzel, start, startTeile, max = maxAlle) => {
    const eintraege = [];
    let abgeschnitten = false;
    let besucht = 0;
    const stapel = [{ verzeichnis: start, teile: startTeile }];
    while (stapel.length && !abgeschnitten) {
      const { verzeichnis, teile } = stapel.pop();
      if (++besucht > MAX_ORDNER) { abgeschnitten = true; break; }
      let ebeneJetzt;
      try { ebeneJetzt = await ebene(wurzel, verzeichnis, teile); } catch (err) {
        if (besucht === 1) throw err;
        continue; // an unreadable subfolder is skipped, not fatal
      }
      if (ebeneJetzt.abgeschnitten) abgeschnitten = true;
      const unterordner = [];
      for (const k of ebeneJetzt.eintraege) {
        if (k.ordner) {
          if (!k.link) unterordner.push({ verzeichnis: p.join(verzeichnis, k.name), teile: [...teile, k.name] });
        } else if (eintraege.length >= max) {
          abgeschnitten = true;
          break;
        } else {
          eintraege.push(ohneIntern(k));
        }
      }
      if (stapel.length + unterordner.length > MAX_ORDNER) abgeschnitten = true;
      for (let i = unterordner.length - 1; i >= 0; i--) stapel.push(unterordner[i]);
    }
    return { eintraege, abgeschnitten };
  };

  const oeffentlich = ({ id, name, ort, sync, live }) => ({ id, name, ort, sync, live });

  const alleLesen = begrenzt(ALLE_PARALLEL, async (id) => {
    const { wurzel } = await wurzelVon(id);
    return sammeln(wurzel, wurzel, []);
  }, { zeitMs: ALLE_ZEIT_MS });

  const dateiLesen = begrenzt(LESEN_PARALLEL, async (id, teile, signal) => {
    const { wurzel } = await wurzelVon(id);
    const ziel = await aufloesen(wurzel, teile);
    if (!ziel) throw new DateienFehler('nichtGefunden');
    if (!ziel.stat.isFile()) throw new DateienFehler('keineDatei');
    if (ziel.stat.size > MAX_LESEN_BYTES) throw new DateienFehler('zuGross');
    const geprueft = await fsp.stat(ziel.real, { bigint: true });
    const handle = await fsp.open(ziel.real, 'r');
    try {
      const stat = await handle.stat({ bigint: true });
      // Still the file that was checked (nothing swapped between the check and opening)?
      if (stat.ino !== geprueft.ino || stat.dev !== geprueft.dev) throw new DateienFehler('nichtGefunden');
      if (stat.size > BigInt(MAX_LESEN_BYTES)) throw new DateienFehler('zuGross');
      // In pieces up to one byte past the limit — the size from stat can be 0 or wrong (pipes, some drives).
      const stuecke = [];
      let gelesen = 0;
      for (;;) {
        if (signal && signal.aborted) throw new DateienFehler('zeit');
        const puffer = Buffer.allocUnsafe(Math.min(LESEN_STUECK, MAX_LESEN_BYTES + 1 - gelesen));
        const { bytesRead } = await handle.read(puffer, 0, puffer.length, null);
        if (!bytesRead) break;
        gelesen += bytesRead;
        if (gelesen > MAX_LESEN_BYTES) throw new DateienFehler('zuGross');
        stuecke.push(bytesRead === puffer.length ? puffer : puffer.subarray(0, bytesRead));
      }
      const name = teile[teile.length - 1];
      return { name, mime: mimeVon(name), daten: Buffer.concat(stuecke, gelesen), geaendertMs: Math.round(Number(stat.mtimeNs) / 1e6) };
    } finally {
      await handle.close();
    }
  }, { zeitMs: LESEN_ZEIT_MS });

  const host = {
    datei,

    /** A folder the person picked in the system dialog → a share (the existing one if it is already shared). */
    async freigabeAnlegen(gewaehlt) {
      if (typeof gewaehlt !== 'string' || !p.isAbsolute(gewaehlt)) throw new DateienFehler('keinOrdner');
      let real;
      try { real = await fsp.realpath(gewaehlt); } catch { throw new DateienFehler('nichtGefunden'); }
      const stat = await fsp.stat(real);
      if (!stat.isDirectory()) throw new DateienFehler('keinOrdner');
      const verboten = freigabeVerboten(real, schutz) || await identitaetVerboten(real);
      if (verboten) throw new DateienFehler(verboten);

      const freigaben = laden();
      const vorhanden = freigaben.find((f) => gleich(f.ort, real));
      if (vorhanden) return oeffentlich(vorhanden);
      if (freigaben.length >= MAX_FREIGABEN) throw new DateienFehler('zuViele');
      const freigabe = {
        id: randomUUID(),
        name: eindeutigerName(p.basename(real), freigaben.map((f) => f.name)),
        ort: real,
        sync: false,
        live: false,
      };
      speichern([...freigaben, freigabe]);
      return oeffentlich(freigabe);
    },

    freigaben() {
      return laden().map(oeffentlich);
    },

    /**
     * «Done for you» (27.10.2026, Giannino: «jemand kommt, die lokalen Dateien sind verbunden»): the person's usual
     * folders (Documents, Desktop, Downloads) are shared once — live only: the bots look in while the app is open,
     * nothing is copied. Each folder is offered once; one the person removes never comes back. Missing or not
     * allowed folders are skipped silently. Returns how many shares were added.
     */
    async standardFreigeben(orte) {
      const angeboten = angebotenLaden();
      const schon = new Set(angeboten.map((a) => vergleichbar(a, platform)));
      let neu = 0;
      for (const eintrag of Array.isArray(orte) ? orte : []) {
        // { ort, name } — name is how the bots address it («PC/Dokumente/…»), in the person's language
        const ort = typeof eintrag === 'string' ? eintrag : eintrag && eintrag.ort;
        const name = eintrag && typeof eintrag.name === 'string' ? eintrag.name : null;
        if (typeof ort !== 'string' || !ort || schon.has(vergleichbar(ort, platform))) continue;
        schon.add(vergleichbar(ort, platform));
        angeboten.push(ort);
        try {
          const vorher = laden().length;
          const f = await host.freigabeAnlegen(ort);
          if (laden().length > vorher) {
            const freigaben = laden();
            const g = freigaben.find((x) => x.id === f.id);
            g.live = true;
            if (name) g.name = eindeutigerName(name, freigaben.filter((x) => x.id !== f.id).map((x) => x.name));
            speichern(freigaben, angeboten);
            neu++;
          }
        } catch { /* missing, not a folder or not allowed — skip */ }
      }
      speichern(laden(), angeboten);
      return neu;
    },

    freigabeAendern(id, felder) {
      const freigaben = laden();
      const f = typeof id === 'string' ? freigaben.find((x) => x.id === id) : null;
      if (!f) throw new DateienFehler('unbekannt');
      if (felder && typeof felder.sync === 'boolean') f.sync = felder.sync;
      if (felder && typeof felder.live === 'boolean') f.live = felder.live;
      speichern(freigaben);
      return oeffentlich(f);
    },

    /** Forget the share on this computer (the folder itself stays untouched); its watchers stop. */
    freigabeEntfernen(id) {
      const freigaben = laden();
      const rest = freigaben.filter((f) => f.id !== id);
      if (rest.length !== freigaben.length) speichern(rest);
      for (const abmelden of [...(beobachter.get(id) || [])]) abmelden();
    },

    async liste(id, unterpfad) {
      const teile = pfadTeile(unterpfad ?? '', platform);
      if (!teile) throw new DateienFehler('pfad');
      const { wurzel } = await wurzelVon(id);
      const ziel = teile.length ? await aufloesen(wurzel, teile) : { real: wurzel, stat: await fsp.stat(wurzel) };
      if (!ziel) throw new DateienFehler('nichtGefunden');
      if (!ziel.stat.isDirectory()) throw new DateienFehler('keinOrdner');
      return (await ebene(wurzel, ziel.real, teile)).eintraege.map(ohneIntern);
    },

    alle(id) {
      return alleLesen(id);
    },

    async lesen(id, pfad) {
      const teile = pfadTeile(pfad, platform);
      if (!teile) throw new DateienFehler('pfad');
      if (!teile.length) throw new DateienFehler('keineDatei');
      return dateiLesen(id, teile);
    },

    /**
     * fs.watch (recursive) on the share, debounced 1 s. Reports files that changed or appeared as «geaendert»
     * (a folder moved in is reported file by file), anything that is gone as «geloescht» (that can be a folder:
     * everything below it is gone). pfad '' = «look at everything again» (the OS gave no name, too many changes)
     * or, with «geloescht», the shared folder itself is gone. Returns abmelden.
     */
    async beobachten(id, melden) {
      const { wurzel } = await wurzelVon(id);
      if (anzahlBeobachter >= MAX_BEOBACHTER) throw new DateienFehler('zuVieleBeobachter');

      const offen = new Map(); // os-relative path → 'rename' | 'change'
      let alles = false;
      let timer = null;
      let erstesMs = 0;
      let zu = false;
      let watcher = null;
      let neustarts = 0;
      let kette = Promise.resolve(); // one evaluation at a time, in order

      const abmelden = () => {
        if (zu) return;
        zu = true;
        clearTimeout(timer);
        try { watcher.close(); } catch { /* already closed */ }
        anzahlBeobachter--;
        const set = beobachter.get(id);
        if (set) { set.delete(abmelden); if (!set.size) beobachter.delete(id); }
      };
      const senden = (aenderungen) => { if (!zu && aenderungen.length) try { melden(aenderungen); } catch { /* window gone */ } };
      const wurzelDa = () => fsp.access(wurzel).then(() => true, () => false);

      const auswerten = async () => {
        if (zu) return;
        const pfade = [...offen];
        offen.clear();
        if (!(await wurzelDa())) {
          senden([{ pfad: '', art: 'geloescht' }]);
          return abmelden();
        }
        if (alles) { alles = false; return senden([{ pfad: '', art: 'geaendert' }]); }
        const aenderungen = new Map();
        for (const [rel, ereignis] of pfade) {
          const teile = rel.split(/[\\/]/).filter(Boolean);
          if (!teile.length || teile.some(ausgelassen)) continue;
          const ziel = await aufloesen(wurzel, teile);
          const pfad = teile.join('/');
          if (!ziel) { aenderungen.set(pfad, 'geloescht'); continue; }
          if (ziel.stat.isFile()) { aenderungen.set(pfad, 'geaendert'); continue; }
          // A folder: «change» is only its timestamp (a file inside is reported on its own); «rename» = it
          // appeared or was moved here → its files.
          if (!ziel.stat.isDirectory() || ereignis !== 'rename') continue;
          const { eintraege, abgeschnitten } = await sammeln(wurzel, ziel.real, teile, maxAlle - aenderungen.size);
          if (abgeschnitten) return senden([{ pfad: '', art: 'geaendert' }]);
          for (const e of eintraege) aenderungen.set(e.pfad, 'geaendert');
        }
        if (aenderungen.size > maxAlle) return senden([{ pfad: '', art: 'geaendert' }]);
        senden([...aenderungen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([pfad, art]) => ({ pfad, art })));
      };

      const jetztAuswerten = () => {
        clearTimeout(timer);
        timer = null;
        erstesMs = 0;
        kette = kette.then(auswerten).catch(() => { /* next change tries again */ });
        return kette;
      };
      const vormerken = () => {
        const jetzt = Date.now();
        if (!erstesMs) erstesMs = jetzt;
        clearTimeout(timer);
        const warten = Math.max(0, Math.min(ENTPRELLEN_MS, erstesMs + ENTPRELLEN_MAX_MS - jetzt));
        timer = setTimeout(jetztAuswerten, warten);
      };

      const starten = () => {
        watcher = fs.watch(wurzel, { recursive: true, persistent: false }, (ereignis, name) => {
          if (zu) return;
          if (!name || offen.size >= maxAlle) alles = true;
          else if (offen.get(String(name)) !== 'rename') offen.set(String(name), ereignis);
          vormerken();
        });
        // Windows reports the shared folder itself going away as an error of the watcher. Gone → «geloescht»
        // (auswerten); still there → watch again and have everything looked at, since changes may be lost.
        watcher.on('error', () => {
          if (zu) return;
          try { watcher.close(); } catch { /* already closed */ }
          alles = true;
          void jetztAuswerten().then(() => {
            if (zu) return;
            if (neustarts++ >= 3) return abmelden();
            try { starten(); } catch { abmelden(); }
          });
        });
      };
      starten();

      anzahlBeobachter++;
      if (!beobachter.has(id)) beobachter.set(id, new Set());
      beobachter.get(id).add(abmelden);
      return abmelden;
    },

    /** App quit: close every watcher. */
    shutdown() {
      for (const set of [...beobachter.values()]) for (const abmelden of [...set]) abmelden();
    },
  };
  return host;
}

module.exports = {
  DateienFehler,
  begrenzt,
  MAX_ALLE,
  MAX_LESEN_BYTES,
  MELDUNG,
  ausgelassen,
  createDateienHost,
  eigenerRechner,
  eindeutigerName,
  fehlerMeldung,
  freigabeVerboten,
  grundVon,
  istInnerhalb,
  mimeVon,
  pfadTeile,
};
