// node --test connector.test.js — pure parts of connector.js (no Electron needed)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  anmeldeAdresse, anmeldungGeklappt, claudeEnv, claudeLoginArgs, claudeSearchDirs, connectorEnv, connectorEvent, connectorOrigin, isPairingCode,
  looksLikeConnector, parseAuthStatus, resolveClaudeBin, restartDelay, HOST_SCRIPT,
} = require('./connector');

const APP = ['https://app.space-media.ch', 'https://space-media-app.vercel.app'];

test('connectorOrigin: only the app origins, localhost only in dev', () => {
  assert.equal(connectorOrigin('https://app.space-media.ch/settings?tab=datenschutz', { allowed: APP, isDev: false }), 'https://app.space-media.ch');
  assert.equal(connectorOrigin('https://space-media-app.vercel.app/chat', { allowed: APP, isDev: false }), 'https://space-media-app.vercel.app');
  assert.equal(connectorOrigin('http://localhost:3100/settings', { allowed: APP, isDev: false }), null);
  assert.equal(connectorOrigin('http://localhost:3100/settings', { allowed: APP, isDev: true }), 'http://localhost:3100');
  assert.equal(connectorOrigin('https://app.space-media.ch.evil.example/', { allowed: APP, isDev: true }), null);
  assert.equal(connectorOrigin('http://app.space-media.ch/', { allowed: APP, isDev: false }), null);
  assert.equal(connectorOrigin('file:///C:/x.html', { allowed: APP, isDev: true }), null);
  assert.equal(connectorOrigin('nonsense', { allowed: APP, isDev: true }), null);
});

test('isPairingCode: accepts server codes, rejects flags and junk', () => {
  assert.equal(isPairingCode('SPACE-ABCD-EF23'), true);
  assert.equal(isPairingCode('ABCDEF23'), true);
  assert.equal(isPairingCode('--url'), false);
  assert.equal(isPairingCode('-x'), false);
  assert.equal(isPairingCode('SPACE ABCD'), false);
  assert.equal(isPairingCode(''), false);
  assert.equal(isPairingCode(undefined), false);
  assert.equal(isPairingCode('A'.repeat(40)), false);
});

test('resolveClaudeBin (Windows): native installer, npm shim, CLAUDE_BIN', () => {
  const home = 'C:\\Users\\anna';
  const has = (...files) => (p) => files.includes(p);
  // Native installer (~/.local/bin) is found even when PATH misses it
  assert.equal(resolveClaudeBin({ Path: 'C:\\Windows' }, 'win32', home, has('C:\\Users\\anna\\.local\\bin\\claude.exe')), 'C:\\Users\\anna\\.local\\bin\\claude.exe');
  // npm shim → the real binary in the package
  const npmDir = 'C:\\Users\\anna\\AppData\\Roaming\\npm';
  const native = path.win32.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  assert.equal(resolveClaudeBin({ Path: npmDir }, 'win32', home, has(path.win32.join(npmDir, 'claude.cmd'), native)), native);
  // Shim without the native binary is not good enough (never via a shell)
  assert.equal(resolveClaudeBin({ Path: npmDir }, 'win32', home, has(path.win32.join(npmDir, 'claude.cmd'))), null);
  assert.equal(resolveClaudeBin({ CLAUDE_BIN: 'D:\\c\\claude.exe' }, 'win32', home, has('D:\\c\\claude.exe')), 'D:\\c\\claude.exe');
  assert.equal(resolveClaudeBin({ CLAUDE_BIN: 'D:\\c\\claude.exe' }, 'win32', home, has()), null);
  assert.equal(resolveClaudeBin({ Path: '' }, 'win32', home, has()), null);
});

test('resolveClaudeBin (macOS): GUI PATH without ~/.local/bin or Homebrew', () => {
  const home = '/Users/anna';
  const has = (...files) => (p) => files.includes(p);
  assert.equal(resolveClaudeBin({ PATH: '/usr/bin:/bin' }, 'darwin', home, has('/Users/anna/.local/bin/claude')), '/Users/anna/.local/bin/claude');
  assert.equal(resolveClaudeBin({ PATH: '/usr/bin:/bin' }, 'darwin', home, has('/opt/homebrew/bin/claude')), '/opt/homebrew/bin/claude');
  // PATH wins over the fallbacks
  assert.equal(resolveClaudeBin({ PATH: '/custom' }, 'darwin', home, has('/custom/claude', '/usr/local/bin/claude')), '/custom/claude');
});

test('claudeSearchDirs: PATH first, no duplicates', () => {
  const dirs = claudeSearchDirs({ PATH: '/usr/local/bin:/usr/bin' }, 'darwin', '/Users/anna');
  assert.deepEqual(dirs.slice(0, 2), ['/usr/local/bin', '/usr/bin']);
  assert.equal(dirs.filter((d) => d === '/usr/local/bin').length, 1);
  assert.ok(dirs.includes('/Users/anna/.local/bin'));
});

test('parseAuthStatus reads only loggedIn', () => {
  assert.equal(parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.ch"}'), true);
  assert.equal(parseAuthStatus('{"loggedIn":false,"authMethod":"none"}\n'), false);
  assert.equal(parseAuthStatus('error: unknown command auth'), null);
  assert.equal(parseAuthStatus(''), null);
  assert.equal(parseAuthStatus('{"authMethod":"claude.ai"}'), null);
});

test('connectorEnv: Electron node mode, connector home, Windows Path key kept, no API keys', () => {
  const env = connectorEnv(
    { Path: 'C:\\Windows', ANTHROPIC_API_KEY: 'sk-ant-api', ANTHROPIC_AUTH_TOKEN: 'x', USERPROFILE: 'C:\\Users\\anna' },
    { platform: 'win32', home: 'C:\\Users\\anna', connectorHome: 'C:\\data\\connector', bundle: 'C:\\data\\connector\\space-connector.mjs', claudeBin: 'C:\\Users\\anna\\.local\\bin\\claude.exe' },
  );
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.SPACE_CONNECTOR_HOME, 'C:\\data\\connector');
  assert.equal(env.SPACE_CONNECTOR_BUNDLE, 'C:\\data\\connector\\space-connector.mjs');
  assert.equal(env.CLAUDE_BIN, 'C:\\Users\\anna\\.local\\bin\\claude.exe');
  assert.equal(env.PATH, undefined, 'no second PATH key next to «Path»');
  assert.ok(env.Path.startsWith('C:\\Windows;'));
  assert.ok(env.Path.includes('C:\\Users\\anna\\.local\\bin'));
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
});

test('claude itself runs without Electron node mode and without API keys', () => {
  const env = claudeEnv(
    { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-api', ELECTRON_RUN_AS_NODE: '1' },
    { platform: 'darwin', home: '/Users/anna', connectorHome: '/data/connector', bundle: '/data/connector/space-connector.mjs' },
  );
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
  assert.equal('SPACE_CONNECTOR_BUNDLE' in env, false);
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.ok(env.PATH.includes('/Users/anna/.local/bin'));
});

test('forced sign-in only counts when confirmed on Anthropic\'s page', () => {
  // Normal: signed in afterwards is enough
  assert.equal(anmeldungGeklappt({ exitCode: 0, angemeldet: true, immer: false, abgebrochen: false }), true);
  // Forced: «Autorisieren» (exit 0) yes; «Ablehnen» (exit 1) no, even though the old sign-in is still there
  assert.equal(anmeldungGeklappt({ exitCode: 0, angemeldet: true, immer: true, abgebrochen: false }), true);
  assert.equal(anmeldungGeklappt({ exitCode: 1, angemeldet: true, immer: true, abgebrochen: false }), false);
  // Cancelled or not signed in: never
  assert.equal(anmeldungGeklappt({ exitCode: 0, angemeldet: true, immer: false, abgebrochen: true }), false);
  assert.equal(anmeldungGeklappt({ exitCode: 0, angemeldet: false, immer: false, abgebrochen: false }), false);
});

test('anmeldeAdresse: only Anthropic sign-in pages from a second app start', () => {
  const auth = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A64608%2Fcallback';
  assert.equal(anmeldeAdresse(['C:\\app\\SPACE Media Engine.exe', auth]), new URL(auth).href);
  assert.equal(anmeldeAdresse(['x.exe', 'https://claude.ai/oauth/authorize?a=1']), 'https://claude.ai/oauth/authorize?a=1');
  assert.equal(anmeldeAdresse(['x.exe', 'https://evil.example/claude.com']), null);
  assert.equal(anmeldeAdresse(['x.exe', 'https://claude.com.evil.example/']), null);
  assert.equal(anmeldeAdresse(['x.exe', 'http://claude.com/']), null);
  assert.equal(anmeldeAdresse(['x.exe', '--dev']), null);
  assert.equal(anmeldeAdresse(undefined), null);
});

test('sign-in is Claude Code\'s own subscription login, nothing else', () => {
  assert.deepEqual(claudeLoginArgs(), ['auth', 'login', '--claudeai']);
});

test('looksLikeConnector: bundle yes, login page or empty no', () => {
  const bundle = '#!/usr/bin/env node\nconst HELP = `SPACE Connector ${v}`\nexport {\n  CONNECTOR_VERSION,\n  main\n};\n';
  assert.equal(looksLikeConnector(bundle), true);
  assert.equal(looksLikeConnector('<!DOCTYPE html><title>Login</title>'), false);
  assert.equal(looksLikeConnector(''), false);
  assert.equal(looksLikeConnector('SPACE Connector' + ' '.repeat(3 * 1024 * 1024) + 'export { main }'), false);
});

test('connectorEvent: the lines the card cares about', () => {
  assert.deepEqual(connectorEvent('SPACE Connector 0.1.0 läuft. Verbunden mit https://app.space-media.ch. Beenden mit Ctrl+C.'), { type: 'laeuft' });
  assert.deepEqual(connectorEvent('Die App kennt diesen Rechner nicht mehr. Koppeln mit: space-connector pair <CODE> --url <ADRESSE>'), { type: 'abgelehnt' });
  assert.deepEqual(connectorEvent('«claude» wurde nicht gefunden. Installiere Claude Code …'), { type: 'claude-fehlt' });
  assert.deepEqual(connectorEvent('Gekoppelt.'), { type: 'gekoppelt' });
  assert.deepEqual(connectorEvent('Koppeln fehlgeschlagen: Code ungültig oder abgelaufen'), { type: 'koppeln-fehler', meldung: 'Code ungültig oder abgelaufen' });
  assert.equal(connectorEvent('[21:04:11] Auftrag 1a2b3c4d (sonnet)'), null);
});

test('restartDelay backs off to a minute', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(restartDelay), [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
});

test('host script keeps the bundle self-starting and drops node mode for claude', () => {
  assert.match(HOST_SCRIPT, /process\.env\.SPACE_CONNECTOR_BUNDLE/);
  assert.match(HOST_SCRIPT, /delete process\.env\.ELECTRON_RUN_AS_NODE/);
  assert.match(HOST_SCRIPT, /process\.stdin\.on\('end'/);
});

test('codexInstalled: Codex alone is enough to run the connector (since 0.3.0)', () => {
  const { codexInstalled } = require('./connector');
  const home = 'C:\\Users\\p';
  const env = { PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\p\\AppData\\Roaming' };
  const shim = path.win32.join(env.APPDATA, 'npm', 'codex.cmd');
  assert.equal(codexInstalled(env, 'win32', home, (p) => p === shim), true);
  assert.equal(codexInstalled(env, 'win32', home, () => false), false);
  assert.equal(codexInstalled({ PATH: '/usr/bin' }, 'linux', '/home/p', (p) => p === '/usr/bin/codex'), true);
});
