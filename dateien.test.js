// node --test dateien.test.js — window.spaceDateien (dateien.js) without Electron: path rules on their own, then
// the host against real folders in the temp directory (escape via «..» and links, roots, system files, watch).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  MAX_LESEN_BYTES, MELDUNG, ausgelassen, begrenzt, createDateienHost, eigenerRechner, eindeutigerName, fehlerMeldung,
  freigabeVerboten, istInnerhalb, mimeVon, pfadTeile,
} = require('./dateien');

// ── Pure rules ───────────────────────────────────────────────────────────────

test('ausgelassen: hidden, node_modules and system files', () => {
  for (const name of ['.git', '.env', '.DS_Store', 'node_modules', 'Thumbs.db', 'thumbs.db', 'desktop.ini', 'DESKTOP.INI', '~$Offerte.docx', '$RECYCLE.BIN']) {
    assert.equal(ausgelassen(name), true, name);
  }
  for (const name of ['Offerte.pdf', 'Thumbs.db.txt', 'Plan ~$1.docx', 'modules']) assert.equal(ausgelassen(name), false, name);
});

test('pfadTeile: relative paths only, no way out of the share', () => {
  assert.deepEqual(pfadTeile('', 'win32'), []);
  assert.deepEqual(pfadTeile('Projekte/2026/Plan.pdf', 'win32'), ['Projekte', '2026', 'Plan.pdf']);
  assert.deepEqual(pfadTeile('/Projekte//Plan.pdf/', 'win32'), ['Projekte', 'Plan.pdf']);
  for (const boese of ['..', '../geheim', 'a/../../geheim', 'a/./b', '.git/config', 'a/.env', 'node_modules/x', '~$Brief.docx', 'a\0b']) {
    assert.equal(pfadTeile(boese, 'win32'), null, boese);
    assert.equal(pfadTeile(boese, 'darwin'), null, boese);
  }
  // Windows: second separator, drive letters, alternate data streams, device names
  for (const boese of ['a\\..\\..\\geheim', '..\\geheim', 'C:', 'C:\\Windows', 'Plan.pdf:geheim', 'CON', 'nul.txt', 'com1', 'LPT9.log']) {
    assert.equal(pfadTeile(boese, 'win32'), null, boese);
  }
  // macOS/Linux: «\» is just a character in a name
  assert.deepEqual(pfadTeile('a\\b', 'darwin'), ['a\\b']);
  assert.equal(pfadTeile(undefined, 'win32'), null);
  assert.equal(pfadTeile(42, 'win32'), null);
  assert.equal(pfadTeile('a/'.repeat(3000), 'win32'), null);
});

test('istInnerhalb: same folder or below, case-insensitive on Windows', () => {
  assert.equal(istInnerhalb('C:\\Daten', 'C:\\Daten', 'win32'), true);
  assert.equal(istInnerhalb('C:\\Daten', 'c:\\daten\\Plan.pdf', 'win32'), true);
  assert.equal(istInnerhalb('C:\\Daten', 'C:\\Daten-Privat\\x', 'win32'), false);
  assert.equal(istInnerhalb('C:\\Daten', 'C:\\', 'win32'), false);
  assert.equal(istInnerhalb('C:\\Daten', 'D:\\Daten', 'win32'), false);
  assert.equal(istInnerhalb('/Users/anna/Daten', '/Users/anna/Daten/..x', 'linux'), true);
  assert.equal(istInnerhalb('/Users/anna/Daten', '/Users/anna', 'linux'), false);
  assert.equal(istInnerhalb('/home/anna/Daten', '/home/anna/daten', 'linux'), false);
  // macOS: a case-sensitive volume has «Daten» and «daten» as two folders
  assert.equal(istInnerhalb('/Volumes/Daten/Projekt', '/Volumes/Daten/projekt/x', 'darwin'), false);
});

test('freigabeVerboten (Windows): drive roots, home and above, hidden, AppData, the system', () => {
  const schutz = {
    platform: 'win32',
    home: 'C:\\Users\\anna',
    userData: 'C:\\Users\\anna\\AppData\\Roaming\\SPACE Media Engine',
    env: { SystemRoot: 'C:\\Windows', ProgramData: 'C:\\ProgramData', ProgramFiles: 'C:\\Program Files' },
  };
  assert.equal(freigabeVerboten('C:\\', schutz), 'laufwerk');
  assert.equal(freigabeVerboten('D:\\', schutz), 'laufwerk');
  assert.equal(freigabeVerboten('\\\\server\\share\\', schutz), 'laufwerk');
  assert.equal(freigabeVerboten('C:\\Users\\anna', schutz), 'benutzerordner');
  assert.equal(freigabeVerboten('c:\\users\\ANNA', schutz), 'benutzerordner');
  assert.equal(freigabeVerboten('C:\\Users', schutz), 'benutzerordner');
  assert.equal(freigabeVerboten('C:\\Users\\anna\\.ssh', schutz), 'versteckt');
  assert.equal(freigabeVerboten('D:\\.backup\\Projekte', schutz), 'versteckt');
  assert.equal(freigabeVerboten('C:\\Users\\anna\\AppData', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('C:\\Users\\anna\\AppData\\Local\\Google\\Chrome', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('C:\\Users\\anna\\AppData\\Roaming\\SPACE Media Engine\\connector', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('C:\\Windows\\System32', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('C:\\Program Files', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('Dokumente', schutz), 'keinOrdner');
  assert.equal(freigabeVerboten('C:\\Users\\anna\\Documents', schutz), null);
  assert.equal(freigabeVerboten('C:\\Users\\anna\\OneDrive - Firma\\Projekte', schutz), null);
  assert.equal(freigabeVerboten('D:\\Projekte', schutz), null);
  assert.equal(freigabeVerboten('\\\\server\\share\\Projekte', schutz), null);
});

test('freigabeVerboten (Windows): no network path back to this computer, no administrative shares', () => {
  const schutz = { platform: 'win32', home: 'C:\\Users\\anna', userData: 'C:\\Users\\anna\\AppData\\Roaming\\SPACE', rechner: ['PC-ANNA', '192.168.1.20'] };
  for (const ort of [
    '\\\\localhost\\c$\\Users\\anna', '\\\\localhost\\Users\\anna\\AppData', '\\\\127.0.0.1\\Daten\\x', '\\\\127.1.2.3\\Daten',
    '\\\\[::1]\\Daten', '\\\\pc-anna\\Daten', '\\\\PC-ANNA.fritz.box\\Daten', '\\\\192.168.1.20\\Users\\anna',
    '\\\\fe80--1.ipv6-literal.net\\Daten', '\\\\server\\c$\\Projekte', '\\\\server\\ADMIN$\\x', '\\\\?\\C:\\Projekte', '\\\\.\\C:\\Projekte',
  ]) assert.equal(freigabeVerboten(ort, schutz), 'netzwerk', ort);
  assert.equal(freigabeVerboten('\\\\server\\Projekte\\2026', schutz), null);
  assert.equal(freigabeVerboten('\\\\pc-annabelle\\Projekte\\2026', schutz), null);
  // The root of a network share is like a drive root (a mapped drive Z:\ resolves to it)
  assert.equal(freigabeVerboten('\\\\server\\Projekte', schutz), 'laufwerk');
  assert.equal(eigenerRechner('LOCALHOST'), true);
  assert.equal(eigenerRechner('nas', ['pc-anna']), false);
});

test('freigabeVerboten (macOS): root, home and above, Library, system folders', () => {
  const schutz = { platform: 'darwin', home: '/Users/anna', userData: '/Users/anna/Library/Application Support/SPACE Media Engine' };
  assert.equal(freigabeVerboten('/', schutz), 'laufwerk');
  assert.equal(freigabeVerboten('/Users/anna', schutz), 'benutzerordner');
  assert.equal(freigabeVerboten('/Users', schutz), 'benutzerordner');
  assert.equal(freigabeVerboten('/Users/anna/Library/Keychains', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('/private/etc', schutz), 'geschuetzt');
  assert.equal(freigabeVerboten('/Users/anna/.claude', schutz), 'versteckt');
  assert.equal(freigabeVerboten('/Users/anna/Documents', schutz), null);
  assert.equal(freigabeVerboten('/Volumes/USB/Projekte', schutz), null);
});

test('eindeutigerName, mimeVon, fehlerMeldung', () => {
  assert.equal(eindeutigerName('Projekte', []), 'Projekte');
  assert.equal(eindeutigerName('Projekte', ['projekte']), 'Projekte (2)');
  assert.equal(eindeutigerName('Projekte', ['Projekte', 'Projekte (2)']), 'Projekte (3)');
  assert.equal(mimeVon('Offerte.PDF'), 'application/pdf');
  assert.equal(mimeVon('Plan.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(mimeVon('ohne-endung'), 'application/octet-stream');
  // Raw errors never carry a path to the page
  const roh = Object.assign(new Error("EACCES: permission denied, open 'C:\\Users\\anna\\geheim.txt'"), { code: 'EACCES' });
  assert.equal(fehlerMeldung(roh), MELDUNG.zugriff);
  assert.equal(fehlerMeldung(new Error('C:\\x')), MELDUNG.allgemein);
});

test('begrenzt: at most n at once, the rest in order, errors passed on', async () => {
  let laufend = 0;
  let hoechstens = 0;
  const reihenfolge = [];
  const arbeit = begrenzt(2, async (i) => {
    laufend++;
    hoechstens = Math.max(hoechstens, laufend);
    await new Promise((r) => setTimeout(r, 20));
    laufend--;
    reihenfolge.push(i);
    if (i === 3) throw new Error('drei');
    return i * 10;
  });
  const ergebnisse = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => arbeit(i)));
  assert.equal(hoechstens, 2);
  assert.deepEqual(ergebnisse.map((e) => e.status === 'fulfilled' ? e.value : e.reason.message), [10, 20, 'drei', 40, 50]);
  assert.deepEqual(reihenfolge, [1, 2, 3, 4, 5]);
});

test('begrenzt: a call that hangs times out and frees its place', async () => {
  let abgebrochen = false;
  const arbeit = begrenzt(1, (wert, signal) => {
    if (wert === 'haengt') {
      signal.addEventListener('abort', () => { abgebrochen = true; });
      return new Promise(() => {});
    }
    return wert;
  }, { zeitMs: 50 });
  const haengt = arbeit('haengt');
  const danach = arbeit('danach');
  await assert.rejects(haengt, (err) => err.grund === 'zeit' && err.message === MELDUNG.zeit);
  assert.equal(await danach, 'danach');
  assert.equal(abgebrochen, true);
});

// ── Host against real folders ────────────────────────────────────────────────

function aufbauen() {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'space-dateien-')));
  const home = path.join(tmp, 'home');
  const userDataDir = path.join(tmp, 'userData');
  const freigabe = path.join(home, 'Dokumente', 'Projekte');
  const draussen = path.join(tmp, 'geheim');
  const schreiben = (datei, inhalt = 'x') => { fs.mkdirSync(path.dirname(datei), { recursive: true }); fs.writeFileSync(datei, inhalt); };
  schreiben(path.join(freigabe, 'Offerte.pdf'), '%PDF-1.7 Offerte');
  schreiben(path.join(freigabe, 'Notizen.txt'), 'Hallo');
  schreiben(path.join(freigabe, 'Unterordner', 'Plan.docx'), 'Plan');
  schreiben(path.join(freigabe, 'Unterordner', 'Tief', 'Skizze.png'), 'png');
  for (const versteckt of ['.git/config', '.env', 'node_modules/x/index.js', 'Thumbs.db', 'desktop.ini', '~$Offerte.docx', 'Unterordner/.DS_Store']) {
    schreiben(path.join(freigabe, versteckt));
  }
  schreiben(path.join(draussen, 'passwort.txt'), 'geheim');
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const host = createDateienHost({ userDataDir, isDev: false, home, env: {} });
  return { tmp, home, userDataDir, freigabe, draussen, schreiben, host };
}

/** Directory link that works without admin rights on Windows (junction). */
const ordnerLink = (ziel, link) => fs.symlinkSync(ziel, link, process.platform === 'win32' ? 'junction' : 'dir');

const abweisen = (promise, grund) => assert.rejects(promise, (err) => {
  assert.equal(err.grund, grund, `${err.grund}: ${err.message}`);
  return true;
});

test('freigabeAnlegen: picked folder → share with a stable id, stored, unique name', async (t) => {
  const { tmp, home, userDataDir, freigabe, host, schreiben } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const f = await host.freigabeAnlegen(freigabe);
  assert.match(f.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...f, id: undefined }, { id: undefined, name: 'Projekte', ort: freigabe, sync: false, live: false });
  // The same folder again → the same share
  assert.equal((await host.freigabeAnlegen(path.join(freigabe, '.'))).id, f.id);
  assert.deepEqual(host.freigaben(), [f]);

  // Same folder name elsewhere → unique name
  const zweite = path.join(tmp, 'Laufwerk', 'Projekte');
  fs.mkdirSync(zweite, { recursive: true });
  assert.equal((await host.freigabeAnlegen(zweite)).name, 'Projekte (2)');

  // Survives a restart (new host, same data folder); dev keeps its own list
  const neu = createDateienHost({ userDataDir, isDev: false, home, env: {} });
  assert.deepEqual(neu.freigaben().map((x) => x.id), host.freigaben().map((x) => x.id));
  assert.ok(fs.existsSync(path.join(userDataDir, 'dateien.json')));
  assert.deepEqual(createDateienHost({ userDataDir, isDev: true, home, env: {} }).freigaben(), []);

  // Not allowed: home, above home, drive root, hidden, the app's own data, a file
  await abweisen(host.freigabeAnlegen(home), 'benutzerordner');
  await abweisen(host.freigabeAnlegen(path.dirname(home)), 'benutzerordner');
  await abweisen(host.freigabeAnlegen(path.parse(tmp).root), 'laufwerk');
  await abweisen(host.freigabeAnlegen(path.join(home, '.ssh')), 'versteckt');
  fs.mkdirSync(path.join(home, 'AppData', 'Local', 'Google'), { recursive: true });
  await abweisen(host.freigabeAnlegen(path.join(home, 'AppData', 'Local', 'Google')), 'geschuetzt');
  schreiben(path.join(userDataDir, 'connector', 'config.json'), '{}');
  await abweisen(host.freigabeAnlegen(path.join(userDataDir, 'connector')), 'geschuetzt');
  await abweisen(host.freigabeAnlegen(path.join(freigabe, 'Offerte.pdf')), 'keinOrdner');
  await abweisen(host.freigabeAnlegen('Dokumente'), 'keinOrdner');
  await abweisen(host.freigabeAnlegen(path.join(tmp, 'gibt-es-nicht')), 'nichtGefunden');
  // A link to a forbidden place counts as that place
  ordnerLink(home, path.join(tmp, 'zu-home'));
  await abweisen(host.freigabeAnlegen(path.join(tmp, 'zu-home')), 'benutzerordner');
});

test('freigabeAnlegen: the home folder under another name (same identity) is refused, AppData in it too', async (t) => {
  const { tmp, home, userDataDir } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // «alias» stands for a network path that leads to the home folder: a different path, the same folder
  const alias = path.join(tmp, 'alias');
  fs.mkdirSync(path.join(alias, 'AppData', 'Local'), { recursive: true });
  fs.mkdirSync(path.join(alias, 'Dokumente'), { recursive: true });
  const id = (ort) => {
    try { const s = fs.statSync(ort, { bigint: true }); return `${s.dev}:${s.ino}`; } catch { return null; }
  };
  const host = createDateienHost({
    userDataDir, isDev: false, home, env: {}, rechner: [],
    identitaet: async (ort) => (path.relative(alias, ort) === '' ? id(home) : id(ort)),
  });
  await abweisen(host.freigabeAnlegen(alias), 'benutzerordner');
  await abweisen(host.freigabeAnlegen(path.join(alias, 'AppData', 'Local')), 'geschuetzt');
  assert.equal((await host.freigabeAnlegen(path.join(alias, 'Dokumente'))).name, 'Dokumente');
});

test('freigabeAendern / freigabeEntfernen', async (t) => {
  const { tmp, freigabe, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const f = await host.freigabeAnlegen(freigabe);
  assert.deepEqual(host.freigabeAendern(f.id, { sync: true }), { ...f, sync: true });
  assert.deepEqual(host.freigabeAendern(f.id, { live: true, sync: 'ja', ort: 'C:\\' }), { ...f, sync: true, live: true });
  assert.deepEqual(host.freigaben(), [{ ...f, sync: true, live: true }]);
  assert.throws(() => host.freigabeAendern('gibt-es-nicht', { sync: true }), (err) => err.grund === 'unbekannt');
  host.freigabeEntfernen(f.id);
  host.freigabeEntfernen(f.id); // twice is fine
  assert.deepEqual(host.freigaben(), []);
  await abweisen(host.liste(f.id, ''), 'unbekannt');
  assert.ok(fs.existsSync(path.join(freigabe, 'Offerte.pdf')), 'the folder itself stays');
});

test('liste: one level, folders first, without hidden and system files', async (t) => {
  const { tmp, freigabe, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);

  const wurzel = await host.liste(id, '');
  assert.deepEqual(wurzel.map((e) => e.pfad), ['Unterordner', 'Notizen.txt', 'Offerte.pdf']);
  const offerte = wurzel.find((e) => e.name === 'Offerte.pdf');
  assert.deepEqual(Object.keys(offerte).sort(), ['bytes', 'geaendertMs', 'name', 'ordner', 'pfad']);
  assert.equal(offerte.ordner, false);
  assert.equal(offerte.bytes, 16);
  assert.ok(Number.isInteger(offerte.geaendertMs) && offerte.geaendertMs > 0);
  assert.equal(wurzel[0].ordner, true);
  assert.equal(wurzel[0].bytes, 0);

  assert.deepEqual((await host.liste(id, 'Unterordner')).map((e) => e.pfad), ['Unterordner/Tief', 'Unterordner/Plan.docx']);
  assert.deepEqual((await host.liste(id, 'Unterordner/Tief/')).map((e) => e.pfad), ['Unterordner/Tief/Skizze.png']);

  await abweisen(host.liste(id, '..'), 'pfad');
  await abweisen(host.liste(id, '../../../geheim'), 'pfad');
  await abweisen(host.liste(id, 'Unterordner/../../..'), 'pfad');
  await abweisen(host.liste(id, '.git'), 'pfad');
  await abweisen(host.liste(id, 'node_modules'), 'pfad');
  await abweisen(host.liste(id, 'Offerte.pdf'), 'keinOrdner');
  await abweisen(host.liste(id, 'Fehlt'), 'nichtGefunden');
  if (process.platform === 'win32') {
    await abweisen(host.liste(id, 'Unterordner\\..\\..\\..'), 'pfad');
    await abweisen(host.liste(id, path.join(tmp, 'geheim')), 'pfad');
  }
});

test('links: inside the share they work, pointing outside they are invisible', async (t) => {
  const { tmp, freigabe, draussen, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);

  ordnerLink(draussen, path.join(freigabe, 'Abkürzung'));        // → outside
  ordnerLink(path.join(freigabe, 'Unterordner'), path.join(freigabe, 'Kurz')); // → inside
  ordnerLink(path.join(freigabe, '.git'), path.join(freigabe, 'Konfig'));     // → hidden inside
  let dateiLink = true;
  try { fs.symlinkSync(path.join(draussen, 'passwort.txt'), path.join(freigabe, 'passwort.txt'), 'file'); } catch { dateiLink = false; }

  const namen = (await host.liste(id, '')).map((e) => e.name);
  assert.deepEqual(namen, ['Kurz', 'Unterordner', 'Notizen.txt', 'Offerte.pdf']);
  assert.deepEqual((await host.liste(id, 'Kurz')).map((e) => e.pfad), ['Kurz/Tief', 'Kurz/Plan.docx']);
  assert.equal(Buffer.from((await host.lesen(id, 'Kurz/Plan.docx')).daten).toString(), 'Plan');

  await abweisen(host.liste(id, 'Abkürzung'), 'nichtGefunden');
  await abweisen(host.lesen(id, 'Abkürzung/passwort.txt'), 'nichtGefunden');
  await abweisen(host.liste(id, 'Konfig'), 'nichtGefunden');
  await abweisen(host.lesen(id, 'Konfig/config'), 'nichtGefunden');
  if (dateiLink) await abweisen(host.lesen(id, 'passwort.txt'), 'nichtGefunden');
  else t.diagnostic('file symlinks need developer mode on Windows — file link case skipped');

  // alle: every file once, never through a link
  const { eintraege } = await host.alle(id);
  assert.deepEqual(eintraege.map((e) => e.pfad), ['Notizen.txt', 'Offerte.pdf', 'Unterordner/Plan.docx', 'Unterordner/Tief/Skizze.png']);
});

const JUNCTION_PS1 = String.raw`param([string]$Link, [string]$Target)
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Runtime.InteropServices; using System.Text;
public static class J {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inb, int inl, IntPtr outb, int outl, out int ret, IntPtr ov);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static void Make(string link, string target) {
    Directory.CreateDirectory(link);
    IntPtr h = CreateFileW(link, 0x40000000, 0x7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
    byte[] sub = Encoding.Unicode.GetBytes(target);
    int dataLen = 8 + sub.Length + 2 + sub.Length + 2;
    byte[] buf = new byte[8 + dataLen];
    BitConverter.GetBytes(0xA0000003u).CopyTo(buf, 0);
    BitConverter.GetBytes((ushort)dataLen).CopyTo(buf, 4);
    BitConverter.GetBytes((ushort)sub.Length).CopyTo(buf, 10);
    BitConverter.GetBytes((ushort)(sub.Length + 2)).CopyTo(buf, 12);
    BitConverter.GetBytes((ushort)sub.Length).CopyTo(buf, 14);
    sub.CopyTo(buf, 16); sub.CopyTo(buf, 16 + sub.Length + 2);
    int ret; bool ok = DeviceIoControl(h, 0x000900A4, buf, buf.Length, IntPtr.Zero, 0, out ret, IntPtr.Zero);
    CloseHandle(h);
    if (!ok) throw new Exception("ioctl " + Marshal.GetLastWin32Error());
  }
}
"@
[J]::Make($Link, $Target)
`;

/** Windows: a junction to «\??\Volume{GUID}\…» — no admin rights needed, and lstat calls it a plain folder. */
function volumeJunction(tmp, link, ziel) {
  const root = path.parse(ziel).root;
  const volume = spawnSync('mountvol', [root, '/L'], { encoding: 'utf8' }).stdout.trim();
  if (!/^\\\\\?\\Volume\{[0-9a-f-]+\}\\$/i.test(volume)) return false;
  const skript = path.join(tmp, 'junction.ps1');
  fs.writeFileSync(skript, JUNCTION_PS1);
  const nt = `\\??\\${volume.slice(4)}${path.relative(root, ziel)}`;
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, link, nt], { encoding: 'utf8' });
  return r.status === 0 && fs.existsSync(link);
}

test('Windows: junctions to «\\??\\Volume{…}» count as links (hidden target invisible, no loop)', { skip: process.platform !== 'win32' }, async (t) => {
  const { tmp, freigabe, draussen, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);
  if (!volumeJunction(tmp, path.join(freigabe, 'vgit'), path.join(freigabe, '.git'))) return t.skip('volume junction not available here');
  assert.equal(fs.lstatSync(path.join(freigabe, 'vgit')).isSymbolicLink(), false, 'lstat does not see it as a link');
  assert.ok(volumeJunction(tmp, path.join(freigabe, 'Kreis'), freigabe));
  assert.ok(volumeJunction(tmp, path.join(freigabe, 'Raus'), draussen));

  assert.deepEqual((await host.liste(id, '')).map((e) => e.name), ['Kreis', 'Unterordner', 'Notizen.txt', 'Offerte.pdf']);
  await abweisen(host.liste(id, 'vgit'), 'nichtGefunden');
  await abweisen(host.lesen(id, 'vgit/config'), 'nichtGefunden');
  await abweisen(host.liste(id, 'Raus'), 'nichtGefunden');
  await abweisen(host.lesen(id, 'Raus/passwort.txt'), 'nichtGefunden');
  const { eintraege, abgeschnitten } = await host.alle(id);
  assert.equal(abgeschnitten, false);
  assert.deepEqual(eintraege.map((e) => e.pfad), ['Notizen.txt', 'Offerte.pdf', 'Unterordner/Plan.docx', 'Unterordner/Tief/Skizze.png']);
});

test('the shared folder replaced by a link elsewhere → refused', async (t) => {
  const { tmp, home, draussen, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ort = path.join(home, 'Bilder');
  fs.mkdirSync(ort);
  const { id } = await host.freigabeAnlegen(ort);
  fs.rmSync(ort, { recursive: true });
  await abweisen(host.liste(id, ''), 'weg');
  ordnerLink(draussen, ort);
  await abweisen(host.liste(id, ''), 'weg');
  await abweisen(host.lesen(id, 'passwort.txt'), 'weg');
  await abweisen(host.alle(id), 'weg');
});

test('alle: files only, recursive, hidden and system files left out, cut at the limit', async (t) => {
  const { tmp, home, userDataDir, freigabe, host, schreiben } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);
  const alle = await host.alle(id);
  assert.equal(alle.abgeschnitten, false);
  assert.deepEqual(alle.eintraege.map((e) => e.pfad), ['Notizen.txt', 'Offerte.pdf', 'Unterordner/Plan.docx', 'Unterordner/Tief/Skizze.png']);
  assert.ok(alle.eintraege.every((e) => e.ordner === false));

  for (let i = 0; i < 5; i++) schreiben(path.join(freigabe, 'Viele', `Datei ${i}.txt`));
  const knapp = createDateienHost({ userDataDir, isDev: false, home, env: {}, maxAlle: 9 });
  assert.equal((await knapp.alle(id)).abgeschnitten, false);
  const geschnitten = await createDateienHost({ userDataDir, isDev: false, home, env: {}, maxAlle: 6 }).alle(id);
  assert.equal(geschnitten.abgeschnitten, true);
  assert.equal(geschnitten.eintraege.length, 6);
});

test('lesen: content, name, mime, time — at most 50 MB, only files inside', async (t) => {
  const { tmp, freigabe, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);

  const datei = await host.lesen(id, 'Offerte.pdf');
  assert.equal(datei.name, 'Offerte.pdf');
  assert.equal(datei.mime, 'application/pdf');
  assert.equal(Buffer.from(datei.daten).toString(), '%PDF-1.7 Offerte');
  assert.equal(datei.geaendertMs, Math.round(fs.statSync(path.join(freigabe, 'Offerte.pdf')).mtimeMs));
  assert.equal((await host.lesen(id, 'Unterordner/Plan.docx')).mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  await abweisen(host.lesen(id, ''), 'keineDatei');
  await abweisen(host.lesen(id, 'Unterordner'), 'keineDatei');
  await abweisen(host.lesen(id, '.env'), 'pfad');
  await abweisen(host.lesen(id, '.git/config'), 'pfad');
  await abweisen(host.lesen(id, 'Thumbs.db'), 'pfad');
  await abweisen(host.lesen(id, '~$Offerte.docx'), 'pfad');
  await abweisen(host.lesen(id, '../../../geheim/passwort.txt'), 'pfad');
  await abweisen(host.lesen(id, 'Fehlt.pdf'), 'nichtGefunden');

  const gross = path.join(freigabe, 'Gross.bin');
  fs.writeFileSync(gross, '');
  fs.truncateSync(gross, MAX_LESEN_BYTES);
  assert.equal((await host.lesen(id, 'Gross.bin')).daten.length, MAX_LESEN_BYTES);
  fs.truncateSync(gross, MAX_LESEN_BYTES + 1);
  await abweisen(host.lesen(id, 'Gross.bin'), 'zuGross');
});

/** Next report of a watcher, or null after `ms`. */
function naechsteMeldung(postfach, ms = 6000) {
  if (postfach.meldungen.length) return Promise.resolve(postfach.meldungen.shift());
  return new Promise((resolve) => {
    const timer = setTimeout(() => { postfach.warten = null; resolve(null); }, ms);
    postfach.warten = (m) => { clearTimeout(timer); postfach.warten = null; resolve(m); };
  });
}
function postfachAnlegen() {
  const postfach = { meldungen: [], warten: null };
  postfach.melden = (aenderungen) => {
    if (postfach.warten) postfach.warten(aenderungen);
    else postfach.meldungen.push(aenderungen);
  };
  return postfach;
}

test('beobachten: changes debounced and reported, system files ignored, abmelden stops it', { timeout: 60_000 }, async (t) => {
  const { tmp, freigabe, host, schreiben } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);
  const postfach = postfachAnlegen();
  const abmelden = await host.beobachten(id, postfach.melden);
  t.after(abmelden);
  await new Promise((r) => setTimeout(r, 300));

  // Three files in a row → one report after the quiet second
  const start = Date.now();
  schreiben(path.join(freigabe, 'Neu 1.txt'), 'a');
  schreiben(path.join(freigabe, 'Neu 2.txt'), 'b');
  schreiben(path.join(freigabe, 'Unterordner', 'Neu 3.txt'), 'c');
  schreiben(path.join(freigabe, 'node_modules', 'y.js'));
  schreiben(path.join(freigabe, '.git', 'HEAD'));
  schreiben(path.join(freigabe, '~$Neu 1.docx'));
  const erste = await naechsteMeldung(postfach);
  assert.ok(Date.now() - start >= 900, 'debounced');
  assert.deepEqual(erste, [
    { pfad: 'Neu 1.txt', art: 'geaendert' },
    { pfad: 'Neu 2.txt', art: 'geaendert' },
    { pfad: 'Unterordner/Neu 3.txt', art: 'geaendert' },
  ]);

  fs.rmSync(path.join(freigabe, 'Neu 2.txt'));
  assert.deepEqual(await naechsteMeldung(postfach), [{ pfad: 'Neu 2.txt', art: 'geloescht' }]);

  // A folder moved into the share → its files
  schreiben(path.join(tmp, 'Eingang', 'A.txt'));
  schreiben(path.join(tmp, 'Eingang', 'Innen', 'B.txt'));
  fs.renameSync(path.join(tmp, 'Eingang'), path.join(freigabe, 'Eingang'));
  const verschoben = await naechsteMeldung(postfach);
  assert.deepEqual(verschoben.filter((a) => a.pfad.startsWith('Eingang/')), [
    { pfad: 'Eingang/A.txt', art: 'geaendert' },
    { pfad: 'Eingang/Innen/B.txt', art: 'geaendert' },
  ]);

  // Only system files → nothing to report
  schreiben(path.join(freigabe, 'Thumbs.db'), 'neu');
  schreiben(path.join(freigabe, 'node_modules', 'z.js'));
  assert.equal(await naechsteMeldung(postfach, 2500), null);

  abmelden();
  schreiben(path.join(freigabe, 'Nach dem Abmelden.txt'));
  assert.equal(await naechsteMeldung(postfach, 2500), null);
});

test('beobachten: removing the share stops its watchers', { timeout: 30_000 }, async (t) => {
  const { tmp, freigabe, host, schreiben } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { id } = await host.freigabeAnlegen(freigabe);
  const postfach = postfachAnlegen();
  await host.beobachten(id, postfach.melden);
  host.freigabeEntfernen(id);
  schreiben(path.join(freigabe, 'Neu.txt'));
  assert.equal(await naechsteMeldung(postfach, 2500), null);
  await abweisen(host.beobachten(id, postfach.melden), 'unbekannt');
});

test('beobachten: the shared folder itself deleted → pfad «» geloescht, watcher gone', { timeout: 30_000 }, async (t) => {
  const { tmp, home, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ort = path.join(home, 'Weg');
  fs.mkdirSync(path.join(ort, 'Innen'), { recursive: true });
  fs.writeFileSync(path.join(ort, 'Innen', 'A.txt'), 'a');
  const { id } = await host.freigabeAnlegen(ort);
  const postfach = postfachAnlegen();
  await host.beobachten(id, postfach.melden);
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(ort, { recursive: true, force: true });
  let meldung = await naechsteMeldung(postfach);
  // Some systems first report the files inside, then the folder
  while (meldung && !(meldung.length === 1 && meldung[0].pfad === '')) meldung = await naechsteMeldung(postfach);
  assert.deepEqual(meldung, [{ pfad: '', art: 'geloescht' }]);
  assert.equal(await naechsteMeldung(postfach, 2000), null);
});

test('standardFreigeben: usual folders shared once, live only; removed ones never come back', async (t) => {
  const { tmp, home, userDataDir, host } = aufbauen();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dokumente = path.join(home, 'Documents');
  const schreibtisch = path.join(home, 'Desktop');
  fs.mkdirSync(dokumente, { recursive: true });
  fs.mkdirSync(schreibtisch, { recursive: true });
  const fehlt = path.join(home, 'Downloads');

  assert.equal(await host.standardFreigeben([{ ort: dokumente, name: 'Dokumente' }, { ort: schreibtisch, name: 'Schreibtisch' }, fehlt, home]), 2);
  const freigaben = host.freigaben();
  assert.deepEqual(freigaben.map((f) => [f.name, f.sync, f.live]), [['Dokumente', false, true], ['Schreibtisch', false, true]]);

  // Removed by the person → not added again, also not after a restart; a folder that appears later is not added either
  host.freigabeEntfernen(freigaben[0].id);
  fs.mkdirSync(fehlt, { recursive: true });
  const neu = createDateienHost({ userDataDir, isDev: false, home, env: {} });
  assert.equal(await neu.standardFreigeben([dokumente, schreibtisch, fehlt]), 0);
  assert.deepEqual(neu.freigaben().map((f) => f.name), ['Schreibtisch']);

  // A folder the person shared before keeps its own settings
  const zweiter = createDateienHost({ userDataDir: path.join(tmp, 'zweite-app'), isDev: false, home, env: {} });
  const eigene = await zweiter.freigabeAnlegen(dokumente);
  zweiter.freigabeAendern(eigene.id, { sync: true });
  assert.equal(await zweiter.standardFreigeben([dokumente]), 0);
  assert.deepEqual(zweiter.freigaben().map((f) => [f.sync, f.live]), [[true, false]]);
});
