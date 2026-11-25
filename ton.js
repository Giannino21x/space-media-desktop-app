// When the app window may make a sound. Pure, tested in ton.test.js; main.js feeds it the window's state.
//
// Rule (Giannino, 25.11.2026: the sound «der immer kam, auch wenn die App nicht offen war» must go, the sounds in the
// app stay): only the window in front makes a sound. Hidden in the tray, minimised or without focus, the page is muted.
// A conversation, reading aloud or a recording that is running must not break off: a recording (microphone open)
// keeps the sound, and sound that is playing keeps it until NACHLAUF_MS of silence — read-aloud pauses between
// parts. Once muted the page stays muted until the window comes to the front again: a new sound from a page
// in the background (a chime for a message) never unmutes it.

// Long enough for read-aloud fetching its next part or a voice reply being thought up (both sound again soon).
const NACHLAUF_MS = 10000;

/**
 * @param {{ stumm: boolean, vorne: boolean, aufnahme: boolean, hoerbar: boolean, stilleMs: number }} z
 *   stumm     muted right now
 *   vorne     window visible, not minimised and focused
 *   aufnahme  the page holds an open microphone
 *   hoerbar   the page plays sound right now
 *   stilleMs  how long it has been silent (Infinity when it never played)
 * @returns {boolean} muted from now on
 */
function tonStumm({ stumm, vorne, aufnahme, hoerbar, stilleMs }) {
  if (vorne) return false;
  if (stumm) return true;
  if (aufnahme || hoerbar) return false;
  return !(stilleMs < NACHLAUF_MS);
}

/**
 * Hangs the rule on a window: muted while it is not in front, on again when it comes back.
 * @param win  BrowserWindow (or a fake with the same calls: on, isDestroyed, isVisible, isMinimized, isFocused,
 *             webContents { on, isAudioMuted, setAudioMuted, isCurrentlyAudible })
 * @param uhr  { jetzt, warten, abbrechen } — Date.now/setTimeout/clearTimeout, replaceable in tests
 * @returns {{ aufnahme(an: boolean): void, pruefen(): void }}
 */
function tonWache(win, uhr = { jetzt: () => Date.now(), warten: setTimeout, abbrechen: clearTimeout }) {
  const wc = win.webContents;
  let hoerbar = !!wc.isCurrentlyAudible();
  let aufnahme = false;
  let stilleSeit = 0;
  let timer = null;
  const pruefen = () => {
    if (win.isDestroyed()) return;
    if (timer) { uhr.abbrechen(timer); timer = null; }
    const vorne = win.isVisible() && !win.isMinimized() && win.isFocused();
    const stilleMs = hoerbar ? 0 : stilleSeit ? uhr.jetzt() - stilleSeit : Infinity;
    const stumm = tonStumm({ stumm: wc.isAudioMuted(), vorne, aufnahme, hoerbar, stilleMs });
    if (stumm !== wc.isAudioMuted()) wc.setAudioMuted(stumm);
    // just went quiet in the background: look again once the pause is long enough
    if (!stumm && !vorne && !hoerbar && stilleMs < NACHLAUF_MS) timer = uhr.warten(pruefen, NACHLAUF_MS - stilleMs + 50);
  };
  for (const name of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.on(name, pruefen);
  wc.on('audio-state-changed', (event) => {
    hoerbar = !!(event && event.audible);
    if (!hoerbar) stilleSeit = uhr.jetzt();
    pruefen();
  });
  // a new page has no recording yet
  wc.on('did-navigate', () => { aufnahme = false; pruefen(); });
  win.on('closed', () => { if (timer) uhr.abbrechen(timer); });
  pruefen();
  return {
    aufnahme(an) { aufnahme = !!an; pruefen(); },
    pruefen,
  };
}

module.exports = { NACHLAUF_MS, tonStumm, tonWache };
