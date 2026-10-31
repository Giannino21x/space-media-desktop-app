// Rules for commands a bot may run on this computer — «Vertrag E» (web repo, docs/plans/2026-10-31-pc-befehle.md).
// Pure, no I/O. The SAME rules live 1:1 in the web repo (src/lib/pc/befehle-regeln.ts): the bot's tool refuses before
// it even asks the person, this file refuses again on the computer (defence in depth). Change both together.
//
// A command runs only after the person confirmed it in the chat, only in a shared folder, with a small environment,
// a time limit and an output limit (dateien.js, ausfuehren). What it may never do, whatever the person confirms:
// delete or format in bulk, touch the system (registry, services, accounts), raise rights, install software, reach
// for credentials or program data, hide what it does (encoded or piped-in code), open remote access.

const MAX_BEFEHL_ZEICHEN = 2000;

/** [grund, muster] — the first match wins. */
const VERBOTEN = [
  ['loeschen', /\b(?:rm|rmdir)\s+(?:-[a-z]*r|--recursive)|\brd\s+\/s|\bdel\s+\/[sq]|\bRemove-Item\b[^|]*-Recurse|\bformat\s+[a-z]:|\bdiskpart\b|\bmkfs\b|\bdd\s+if=/i],
  ['system', /\breg(?:edit)?\s+(?:add|delete|import)|\bregedit\b|\bsc\s+(?:create|delete|config|stop|start)\b|\bnet\s+(?:user|localgroup|share)\b|\bschtasks\b|\bbcdedit\b|\bshutdown\b|\bsystemctl\b|\blaunchctl\b|\bcrontab\b/i],
  ['rechte', /\bsudo\b|\brunas\b|(?:^|[\s;|&])su(?:\s|$)|-Verb\s+RunAs|\bdoas\b/i],
  ['installieren', /\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bwinget\s+install|\bchoco\s+install|\bbrew\s+install|\bapt(?:-get)?\s+install|\bmsiexec\b|\bInstall-Module\b/i],
  ['zugangsdaten', /\.ssh\b|\.aws\b|\.gnupg\b|\bAppData\b|\bLibrary[\\/]Keychains|\bid_rsa\b|\bcredential|\bpasswor[dt]|\bcmdkey\b|\bsecurity\s+find-/i],
  ['verschleiert', /-EncodedCommand|\s-e(?:nc)?\s+[A-Za-z0-9+/=]{20,}|\bbase64\s+(?:-d|--decode)|\biex\b|Invoke-Expression|\b(?:curl|wget)\b[^|]*\|\s*(?:sh|bash|powershell|cmd)\b|\bcertutil\b/i],
  ['netz', /\bnetsh\b|\bssh\s|\bscp\s|\brsync\b|\bftp\b|(?:^|[\s;|&])nc(?:at)?\s|\btelnet\b|\bInvoke-WebRequest\b|\bStart-BitsTransfer\b/i],
];

const MELDUNG_BEFEHL = {
  leer: 'Der Befehl fehlt.',
  zuLang: `Ein Befehl hat höchstens ${MAX_BEFEHL_ZEICHEN} Zeichen.`,
  mehrzeilig: 'Ein Befehl steht auf einer Zeile.',
  loeschen: 'Befehle, die Dateien oder Laufwerke löschen oder formatieren, führt der Bot nicht aus.',
  system: 'Befehle an System, Registry, Dienste oder Konten führt der Bot nicht aus.',
  rechte: 'Befehle mit erhöhten Rechten führt der Bot nicht aus.',
  installieren: 'Programme oder Pakete installiert der Bot nicht.',
  zugangsdaten: 'Befehle, die an Zugangsdaten oder Programmdaten gehen, führt der Bot nicht aus.',
  verschleiert: 'Verschleierte oder nachgeladene Befehle führt der Bot nicht aus.',
  netz: 'Netzwerk- und Fernzugriffs-Befehle führt der Bot nicht aus.',
};

/** Why the command may not run, or null. */
function befehlVerboten(befehl) {
  if (typeof befehl !== 'string' || !befehl.trim()) return 'leer';
  if (befehl.length > MAX_BEFEHL_ZEICHEN) return 'zuLang';
  if (/[\r\n]/.test(befehl)) return 'mehrzeilig';
  for (const [grund, muster] of VERBOTEN) if (muster.test(befehl)) return grund;
  return null;
}

module.exports = { MAX_BEFEHL_ZEICHEN, MELDUNG_BEFEHL, VERBOTEN, befehlVerboten };
