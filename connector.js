// SPACE Connector host — «Eigenes Claude-Abo» without a terminal.
//
// The web app (Einstellungen → Datenschutz) asks for a pairing code and hands it to this shell through
// window.spaceConnector (preload.js). We download the connector bundle from the app origin, run it with
// Electron's own Node (ELECTRON_RUN_AS_NODE) — `pair`, then `run` — and keep it alive while the app is open.
//
// Anthropic's rules (docs/plans/2026-10-21-eigenes-claude-abo.md in the web repo): the connector drives the
// unmodified `claude` binary; the person signs in to Claude Code themselves — `anmelden()` only starts Claude Code's
// own `claude auth login`, which completes in Anthropic's flow in the browser; this shell never reads, stores or
// forwards a Claude token. The only secret here is the SPACE device token, which the connector itself writes
// to config.json and which never goes to the page.

const { spawn, spawnSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CLAUDE_INSTALL_URL = 'https://claude.com/claude-code';
const BUNDLE_PATH = '/connector/space-connector.mjs';
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const CLAUDE_CHECK_TTL_MS = 30_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

const MELDUNG = {
  claudeFehlt: 'Auf diesem Rechner fehlt ein KI-Abo (Claude Code oder Codex). Installiere eines — danach verbindet sich der Rechner von selbst.',
  nichtAngemeldet: 'Claude Code ist hier nicht angemeldet. «Anmelden» öffnet die Anmeldung von Claude im Browser.',
  abgelehnt: 'Die App kennt diesen Rechner nicht mehr. Koppel ihn neu, wenn der Chat wieder über dein Abo laufen soll.',
  laden: 'Der SPACE Connector liess sich nicht laden. Prüfe die Internetverbindung und versuche es nochmals.',
  fremdeAdresse: 'Die gespeicherte Kopplung gehört zu einer anderen Adresse. Bitte neu koppeln.',
  code: 'Der Koppel-Code ist ungültig.',
  koppelnLaeuft: 'Dieser Rechner wird gerade gekoppelt.',
  anmeldungLaeuft: 'Die Anmeldung läuft schon — bestätige sie im Browser.',
  anmeldungOffen: 'Die Anmeldung bei Claude wurde nicht abgeschlossen. Versuche es nochmals.',
  anmeldungAbgebrochen: 'Anmeldung abgebrochen.',
};

// ── Pure helpers (connector.test.js) ─────────────────────────────────────────

/**
 * Origin the connector may talk to, derived from the page that asked — never from a URL the page passes in.
 * Production: only the app origins. Dev (--dev): also http://localhost / 127.0.0.1.
 */
function connectorOrigin(url, { allowed, isDev }) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (allowed.some((a) => new URL(a).origin === u.origin)) return u.origin;
  if (isDev && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
  return null;
}

/** Pairing codes look like SPACE-ABCD-EFGH; anything that could read as a CLI flag is rejected. */
function isPairingCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{7,23}$/.test(code);
}

/**
 * Where a GUI app should look for `claude`: PATH first, then the usual install locations — apps started from the
 * Dock / Start menu often get a shorter PATH than a terminal (macOS: no ~/.local/bin, no Homebrew).
 */
function claudeSearchDirs(env, platform, home) {
  const win = platform === 'win32';
  const { delimiter, join } = win ? path.win32 : path.posix;
  const fromPath = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const extra = win
    ? [join(home, '.local', 'bin'), env.APPDATA && join(env.APPDATA, 'npm')]
    : [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  return [...new Set([...fromPath, ...extra.filter(Boolean)])];
}

/**
 * Is Codex (OpenAI, ChatGPT subscription) installed? Since connector 0.3.0 a computer with only Codex can serve the chat
 * too — the connector finds the binary itself (web repo, src/lib/connector/client/agenten.ts); here only: is it there.
 */
function codexInstalled(env, platform, home, exists = fs.existsSync) {
  if (env.CODEX_BIN) return exists(env.CODEX_BIN);
  const win = platform === 'win32';
  const { join } = win ? path.win32 : path.posix;
  return claudeSearchDirs(env, platform, home).some((dir) => (win
    ? exists(join(dir, 'codex.exe')) || exists(join(dir, 'codex.cmd'))
    : exists(join(dir, 'codex'))));
}

/** Same rules as resolveClaudeBin in the connector (web repo, src/lib/connector/client/claude.ts) + extra dirs. */
function resolveClaudeBin(env, platform, home, exists = fs.existsSync) {
  if (env.CLAUDE_BIN) return exists(env.CLAUDE_BIN) ? env.CLAUDE_BIN : null;
  const win = platform === 'win32';
  const { join } = win ? path.win32 : path.posix;
  for (const dir of claudeSearchDirs(env, platform, home)) {
    if (win) {
      if (exists(join(dir, 'claude.exe'))) return join(dir, 'claude.exe');
      // npm shim (claude.cmd): the real binary sits in the package next to it
      if (exists(join(dir, 'claude.cmd'))) {
        const native = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
        if (exists(native)) return native;
      }
    } else if (exists(join(dir, 'claude'))) {
      return join(dir, 'claude');
    }
  }
  return null;
}

/**
 * `claude auth status --json` → signed in? Only `loggedIn` is read; the rest (e-mail, org) is never kept.
 * null = unknown (older Claude Code without `auth status`).
 */
function parseAuthStatus(stdout) {
  try {
    const json = JSON.parse(String(stdout).trim());
    return typeof json.loggedIn === 'boolean' ? json.loggedIn : null;
  } catch {
    return null;
  }
}

/** Environment of the connector process. Uses the PATH key the platform already has (Windows: «Path»). */
function connectorEnv(base, { platform, home, connectorHome, bundle, claudeBin }) {
  const env = { ...base };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = claudeSearchDirs(env, platform, home).join(platform === 'win32' ? ';' : ':');
  env.ELECTRON_RUN_AS_NODE = '1';
  env.SPACE_CONNECTOR_HOME = connectorHome;
  env.SPACE_CONNECTOR_BUNDLE = bundle;
  if (claudeBin) env.CLAUDE_BIN = claudeBin;
  // An API key would bill the API instead of the subscription (the connector strips it too).
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/** Environment for running `claude` itself: like the connector's, but without Electron's node mode. */
function claudeEnv(base, opts) {
  const env = connectorEnv(base, opts);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SPACE_CONNECTOR_BUNDLE;
  return env;
}

/**
 * Claude Code's own sign-in with the Claude subscription. The unmodified binary opens Anthropic's page in the
 * browser and receives the result on its own localhost callback — no code to copy, nothing passes through us.
 */
function claudeLoginArgs() {
  return ['auth', 'login', '--claudeai'];
}

/**
 * Did the sign-in work? A forced sign-in (the person clicked «Claude-Abo verbinden», Claude Code may already be
 * signed in) only counts when they confirmed on Anthropic's page — `claude auth login` ended with 0. Otherwise a
 * «Ablehnen» or a closed tab would pass because of the earlier sign-in.
 */
function anmeldungGeklappt({ exitCode, angemeldet, immer, abgebrochen }) {
  if (abgebrochen || angemeldet !== true) return false;
  return immer ? exitCode === 0 : true;
}

/**
 * Anthropic's sign-in page among the arguments of a second app start (BROWSER = this app, see main.js).
 * Only https on claude.com / claude.ai / anthropic.com — anything else is ignored.
 */
function anmeldeAdresse(argv) {
  for (const arg of argv || []) {
    let u;
    try { u = new URL(arg); } catch { continue; }
    if (u.protocol === 'https:' && /(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/i.test(u.hostname)) return u.href;
  }
  return null;
}

/** Does a download look like the connector bundle (and not an error or login page)? */
function looksLikeConnector(text) {
  return typeof text === 'string'
    && text.length > 0 && text.length < MAX_BUNDLE_BYTES
    && text.includes('SPACE Connector')
    && /export\s*\{[^}]*\bmain\b/.test(text);
}

/** The connector's stdout lines that change what the settings card shows. */
function connectorEvent(line) {
  const text = String(line).trim();
  if (/ läuft\. Verbunden mit /.test(text)) return { type: 'laeuft' };
  if (/kennt diesen Rechner nicht mehr/.test(text)) return { type: 'abgelehnt' };
  if (/«claude» wurde nicht gefunden|Weder «claude»/.test(text)) return { type: 'claude-fehlt' };
  if (text === 'Gekoppelt.') return { type: 'gekoppelt' };
  const fail = /^Koppeln fehlgeschlagen: (.+)$/.exec(text);
  if (fail) return { type: 'koppeln-fehler', meldung: fail[1] };
  return null;
}

/** Back-off after an unexpected exit: 5 s, 10 s, 20 s, 40 s, then every 60 s. */
function restartDelay(failures) {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, Math.min(failures - 1, 4)));
}

/**
 * Started with Electron's Node. Ends the connector when the app goes away (stdin closes) so no connector
 * outlives the app (crash, Task Manager). The path contains «space-connector», so the bundle starts itself
 * exactly as with `node space-connector.mjs …`.
 */
const HOST_SCRIPT = `// Written by the SPACE Media desktop app — runs the SPACE Connector with Electron's Node.
import { pathToFileURL } from 'node:url'
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  process.emit('SIGTERM')
  setTimeout(() => process.exit(0), 3000).unref()
}
process.stdin.on('end', stop).on('close', stop).on('error', stop).resume()
process.stdin.unref()
// Claude Code and anything it starts must not inherit Electron's node mode.
delete process.env.ELECTRON_RUN_AS_NODE
await import(pathToFileURL(process.env.SPACE_CONNECTOR_BUNDLE).href)
`;

// ── Process management ───────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} o.userDataDir   app.getPath('userData')
 * @param {boolean} o.isDev
 * @param {string[]} o.allowedOrigins
 * @param {(url: string) => Promise<string>} o.fetchText
 * @param {string} o.execPath      process.execPath (Electron)
 * @param {string} o.home          os.homedir()
 * @param {string} o.deviceName
 * @param {(status: object) => void} o.onChange
 */
function createConnectorHost(o) {
  const platform = o.platform ?? process.platform;
  const baseEnv = o.env ?? process.env;
  const dir = path.join(o.userDataDir, o.isDev ? 'connector-dev' : 'connector');
  const files = {
    config: path.join(dir, 'config.json'),
    prefs: path.join(dir, 'desktop.json'),
    bundle: path.join(dir, 'space-connector.mjs'),
    host: path.join(dir, 'space-connector-host.mjs'),
    log: path.join(dir, 'connector.log'),
  };

  let child = null;
  let zustand = 'aus';
  let meldung = null;
  let failures = 0;
  let restartTimer = null;
  let healthyTimer = null;
  let starting = null;
  let pairing = false;
  let shuttingDown = false;
  let claude = { at: 0, gefunden: false, angemeldet: null, bin: null };
  let logStarted = false;
  let login = null; // running `claude auth login`: { proc, abbrechen, url }

  const log = (line) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const entry = `[${new Date().toISOString()}] ${line}\n`;
      if (logStarted) fs.appendFileSync(files.log, entry);
      else { fs.writeFileSync(files.log, entry); logStarted = true; }
    } catch { /* logging must never break the connector */ }
  };

  const readConfig = () => {
    try {
      const c = JSON.parse(fs.readFileSync(files.config, 'utf8'));
      return c && typeof c.url === 'string' && typeof c.deviceId === 'string' && typeof c.token === 'string' && c.token.startsWith('spcdev_')
        ? { url: c.url, deviceId: c.deviceId }
        : null;
    } catch { return null; }
  };
  const readPrefs = () => {
    try { return JSON.parse(fs.readFileSync(files.prefs, 'utf8')) || {}; } catch { return {}; }
  };
  const writePrefs = (prefs) => {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(files.prefs, JSON.stringify(prefs)); } catch { /* best effort */ }
  };

  const snapshot = () => {
    const cfg = readConfig();
    return {
      version: 1,
      claude: { gefunden: claude.gefunden, angemeldet: claude.angemeldet },
      gekoppelt: Boolean(cfg),
      deviceId: cfg ? cfg.deviceId : null,
      zustand: cfg || zustand === 'koppelt' ? zustand : 'aus',
      meldung,
      installUrl: CLAUDE_INSTALL_URL,
      /** `claude auth login` waits for the person to confirm in the browser */
      anmeldung: Boolean(login),
      /** the app knows the sign-in page and can open it again (v4) */
      anmeldeseite: Boolean(login && login.url),
    };
  };
  const set = (z, m = null) => {
    zustand = z;
    meldung = m;
    try { o.onChange?.(snapshot()); } catch { /* window gone */ }
  };

  const checkClaude = async (fresh) => {
    if (!fresh && claude.at && Date.now() - claude.at < CLAUDE_CHECK_TTL_MS) return claude;
    const bin = resolveClaudeBin(baseEnv, platform, o.home);
    let angemeldet = null;
    if (bin) {
      angemeldet = await new Promise((resolve) => {
        const env = claudeEnv(baseEnv, { platform, home: o.home, connectorHome: dir, bundle: files.bundle });
        execFile(bin, ['auth', 'status', '--json'], { timeout: 20_000, windowsHide: true, env },
          (_err, stdout) => resolve(parseAuthStatus(stdout)));
      });
    }
    claude = { at: Date.now(), gefunden: Boolean(bin), angemeldet, bin };
    return claude;
  };

  /** Fresh bundle from the app; the last good copy if the app is unreachable. */
  const prepare = async (origin) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(files.host, HOST_SCRIPT);
    try {
      const text = await o.fetchText(`${origin}${BUNDLE_PATH}`);
      if (!looksLikeConnector(text)) throw new Error('unerwarteter Inhalt');
      const tmp = `${files.bundle}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, files.bundle);
    } catch (err) {
      log(`Bundle laden fehlgeschlagen (${err.message})`);
      if (!fs.existsSync(files.bundle)) throw err;
    }
  };

  const spawnConnector = (args) => {
    const proc = spawn(o.execPath, [files.host, ...args], {
      cwd: dir,
      env: connectorEnv(baseEnv, { platform, home: o.home, connectorHome: dir, bundle: files.bundle, claudeBin: claude.bin }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // POSIX: own process group, so stopping also ends a running `claude` job
      detached: platform !== 'win32',
    });
    const onLine = (handler) => (line) => { log(line); handler?.(line); };
    return { proc, lines: (handler) => {
      readline.createInterface({ input: proc.stdout }).on('line', onLine(handler));
      readline.createInterface({ input: proc.stderr }).on('line', onLine(handler));
    } };
  };

  const killTree = (proc) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    try {
      if (platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 });
      else process.kill(-proc.pid, 'SIGTERM');
    } catch {
      try { proc.kill(); } catch { /* already gone */ }
    }
  };

  const stopChild = async () => {
    clearTimeout(restartTimer); restartTimer = null;
    clearTimeout(healthyTimer); healthyTimer = null;
    const proc = child;
    child = null;
    if (!proc) return;
    const exited = new Promise((resolve) => { if (proc.exitCode !== null) resolve(); else proc.once('exit', resolve); });
    killTree(proc);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  };

  const scheduleRestart = () => {
    failures++;
    const wait = restartDelay(failures);
    set('startet', `Der Connector wurde unterbrochen — neuer Start in ${Math.round(wait / 1000)} s.`);
    restartTimer = setTimeout(() => { restartTimer = null; void start(); }, wait);
  };

  const start = () => {
    if (starting) return starting;
    starting = (async () => {
      if (child || shuttingDown) return;
      const cfg = readConfig();
      if (!cfg) return set('aus');
      const origin = connectorOrigin(cfg.url, { allowed: o.allowedOrigins, isDev: o.isDev });
      if (!origin) return set('fehler', MELDUNG.fremdeAdresse);
      const c = await checkClaude(!claude.at);
      if (!c.gefunden && !codexInstalled(baseEnv, platform, o.home)) return set('fehler', MELDUNG.claudeFehlt);
      set('startet');
      try { await prepare(origin); } catch { return scheduleRestart(); }
      if (shuttingDown || readPrefs().pausiert) return;

      const { proc, lines } = spawnConnector(['run']);
      child = proc;
      let ende = null;
      lines((line) => {
        const ev = connectorEvent(line);
        if (!ev) return;
        if (ev.type === 'laeuft') {
          set('laeuft');
          // Running for a minute counts as healthy again: the next hiccup restarts quickly.
          healthyTimer = setTimeout(() => { failures = 0; }, 60_000);
        } else if (ev.type === 'abgelehnt' || ev.type === 'claude-fehlt') {
          ende = ev.type;
        }
      });
      proc.on('error', (err) => log(`Start fehlgeschlagen: ${err.message}`));
      proc.on('exit', (code) => {
        log(`Connector beendet (Code ${code})`);
        if (child !== proc) return; // stopped on purpose
        child = null;
        clearTimeout(healthyTimer);
        if (shuttingDown) return;
        if (ende === 'abgelehnt') {
          try { fs.rmSync(files.config, { force: true }); } catch { /* ignore */ }
          return set('aus', MELDUNG.abgelehnt);
        }
        if (ende === 'claude-fehlt') { claude.at = 0; return set('fehler', MELDUNG.claudeFehlt); }
        scheduleRestart();
      });
    })().finally(() => { starting = null; });
    return starting;
  };

  /**
   * Sign in to Claude Code without a terminal: start the unmodified `claude auth login`, which opens Anthropic's
   * sign-in in the browser; resolves once the person confirmed there (or cancelled / 10 min passed). Its output
   * is not read — the result comes from `claude auth status` (loggedIn only).
   */
  const anmelden = async ({ immer = false } = {}) => {
    if (login) return { ok: false, meldung: MELDUNG.anmeldungLaeuft, status: snapshot() };
    const c = await checkClaude(true);
    if (!c.gefunden) return { ok: false, grund: 'claude-fehlt', meldung: MELDUNG.claudeFehlt, status: snapshot() };
    // `immer`: always show Anthropic's page, even when Claude Code is already signed in
    if (c.angemeldet === true && !immer) return { ok: true, status: snapshot() };

    let abgebrochen = false;
    const env = claudeEnv(baseEnv, { platform, home: o.home, connectorHome: dir, bundle: files.bundle });
    // Windows: Claude Code opens the page via rundll32 from a background process — the browser then opens behind
    // other windows. With BROWSER = this app, the URL comes back here (second instance) and the app opens it itself.
    if (o.browserHelper) env.BROWSER = o.browserHelper;
    const proc = spawn(c.bin, claudeLoginArgs(), {
      env,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    const ende = new Promise((resolve) => {
      proc.on('error', () => resolve(-1));
      proc.on('exit', (code) => resolve(code ?? -1));
    });
    login = { proc, url: null, abbrechen: () => { abgebrochen = true; killTree(proc); } };
    const timer = setTimeout(() => login && login.abbrechen(), LOGIN_TIMEOUT_MS);
    set(zustand, meldung);
    const code = await ende;
    clearTimeout(timer);
    login = null;
    const nach = await checkClaude(true);
    log(`Claude-Anmeldung beendet (Code ${code}, angemeldet: ${nach.angemeldet})`);
    set(zustand, meldung);
    if (anmeldungGeklappt({ exitCode: code, angemeldet: nach.angemeldet, immer, abgebrochen })) return { ok: true, status: snapshot() };
    return { ok: false, meldung: abgebrochen ? MELDUNG.anmeldungAbgebrochen : MELDUNG.anmeldungOffen, status: snapshot() };
  };

  /** Pair with a fresh code from the app (POST /api/connector/pairing), then start. */
  const koppeln = async (code, origin) => {
    if (pairing) return { ok: false, meldung: MELDUNG.koppelnLaeuft, status: snapshot() };
    if (!isPairingCode(code)) return { ok: false, meldung: MELDUNG.code, status: snapshot() };
    pairing = true;
    try {
      const c = await checkClaude(true);
      const codex = codexInstalled(baseEnv, platform, o.home);
      if (!c.gefunden && !codex) return { ok: false, grund: 'claude-fehlt', meldung: MELDUNG.claudeFehlt, status: snapshot() };
      if (c.gefunden && c.angemeldet === false && !codex) return { ok: false, grund: 'nicht-angemeldet', meldung: MELDUNG.nichtAngemeldet, status: snapshot() };

      set('koppelt');
      await starting;
      await stopChild();
      try { await prepare(origin); } catch {
        set(readConfig() ? 'fehler' : 'aus', MELDUNG.laden);
        return { ok: false, meldung: MELDUNG.laden, status: snapshot() };
      }

      const { proc, lines } = spawnConnector(['pair', code, '--url', origin, '--name', o.deviceName, '--no-run']);
      let fehler = null;
      lines((line) => { const ev = connectorEvent(line); if (ev?.type === 'koppeln-fehler') fehler = ev.meldung; });
      const exitCode = await new Promise((resolve) => {
        proc.on('error', () => resolve(1));
        proc.on('exit', (c2) => resolve(c2 ?? 1));
      });
      if (exitCode !== 0 || !readConfig()) {
        const text = `Koppeln fehlgeschlagen: ${fehler ?? 'unbekannter Fehler'}`;
        set(readConfig() ? 'startet' : 'aus', text);
        if (readConfig() && !readPrefs().pausiert) void start();
        return { ok: false, meldung: text, status: snapshot() };
      }

      writePrefs({ ...readPrefs(), pausiert: false });
      failures = 0;
      await start();
      try { o.onGekoppelt?.(); } catch { /* optional */ }
      return { ok: true, status: snapshot() };
    } finally {
      pairing = false;
    }
  };

  return {
    files,
    async status({ frisch = false } = {}) {
      await checkClaude(frisch);
      return snapshot();
    },
    koppeln,
    anmelden,
    /** Second app start with Anthropic's page as argument: open it from here, only while a sign-in waits. */
    anmeldeseiteAnnehmen(url) {
      if (!login || !url || anmeldeAdresse([url]) !== url) return false;
      login.url = url;
      log('Anmeldeseite geöffnet');
      try { o.openExternal?.(url); } catch { /* browser missing */ }
      set(zustand, meldung);
      return true;
    },
    /** «Seite nochmals öffnen» — the URL never goes to the page, only to the system browser. */
    anmeldeseiteOeffnen() {
      if (!login || !login.url) return false;
      try { o.openExternal?.(login.url); } catch { /* browser missing */ }
      return true;
    },
    anmeldenAbbrechen() {
      if (login) login.abbrechen();
      return snapshot();
    },
    async starten() {
      writePrefs({ ...readPrefs(), pausiert: false });
      failures = 0;
      await start();
      return snapshot();
    },
    async stoppen() {
      writePrefs({ ...readPrefs(), pausiert: true });
      await starting;
      await stopChild();
      set(readConfig() ? 'gestoppt' : 'aus');
      return snapshot();
    },
    /** Local only: forget the pairing on this computer. The card removes the device in the app. */
    async entkoppeln() {
      await starting;
      await stopChild();
      try { fs.rmSync(files.config, { force: true }); } catch { /* ignore */ }
      writePrefs({ ...readPrefs(), pausiert: false });
      set('aus');
      return snapshot();
    },
    /** App start: run again if this computer is paired and the person did not stop it. */
    autostart() {
      if (readConfig() && !readPrefs().pausiert) void start();
      else if (readConfig()) set('gestoppt');
    },
    /** App quit: synchronous, so the installer of an update never finds a running connector. */
    shutdown() {
      shuttingDown = true;
      if (login) login.abbrechen();
      clearTimeout(restartTimer);
      clearTimeout(healthyTimer);
      killTree(child);
      child = null;
    },
  };
}

module.exports = {
  CLAUDE_INSTALL_URL,
  HOST_SCRIPT,
  anmeldeAdresse,
  anmeldungGeklappt,
  claudeEnv,
  claudeLoginArgs,
  codexInstalled,
  claudeSearchDirs,
  connectorEnv,
  connectorEvent,
  connectorOrigin,
  createConnectorHost,
  isPairingCode,
  looksLikeConnector,
  parseAuthStatus,
  resolveClaudeBin,
  restartDelay,
};
