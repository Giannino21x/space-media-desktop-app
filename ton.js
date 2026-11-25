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

module.exports = { NACHLAUF_MS, tonStumm };
