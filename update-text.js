// «Nach Update suchen» in the tray menu (Giannino 25.11.2026): one sentence for the result of a manual check.
// Pure — tested in update-text.test.js. main.js runs the check (electron-updater) and shows the sentence as a silent toast.

/**
 * @param {{ art: 'aktuell' | 'laedt' | 'bereit' | 'fehler' | 'entwicklung', version?: string, neu?: string }} e
 *   version = this app, neu = the version found or downloaded
 * @returns {{ titel: string, text: string }}
 */
function updateText(e) {
  const v = e && e.version ? e.version : '';
  switch (e && e.art) {
    case 'aktuell':
      return { titel: 'SME ist aktuell', text: `Version ${v} ist die neueste.` };
    case 'laedt':
      return { titel: `Version ${e.neu} wird geladen`, text: 'Sobald sie da ist, installiert sie sich beim nächsten Neustart von SME.' };
    case 'bereit':
      return { titel: `Version ${e.neu} ist bereit`, text: 'Hier klicken, um SME neu zu starten und sie zu installieren.' };
    case 'entwicklung':
      return { titel: 'Entwicklungsversion', text: 'Hier gibt es keine Updates.' };
    default:
      // no error sentence: say what happens next
      return { titel: 'Update-Prüfung später', text: `Version ${v} läuft weiter. SME sucht von selbst alle 30 Minuten nach einer neuen Version.` };
  }
}

/** What a check found: the version offered is newer than ours (electron-updater's isUpdateAvailable when it has one). */
function istNeuer(ergebnis, eigene) {
  if (!ergebnis || !ergebnis.updateInfo) return false;
  if (typeof ergebnis.isUpdateAvailable === 'boolean') return ergebnis.isUpdateAvailable;
  const teile = (s) => String(s || '').split('.').map((x) => parseInt(x, 10) || 0);
  const a = teile(ergebnis.updateInfo.version);
  const b = teile(eigene);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

module.exports = { updateText, istNeuer };
