// The live line while dictating (Plan docs/plans/2026-11-25-live-text.md): the end of what was heard, one line, calm.
// Shared by the pill (pille-ui.js) and the pet's pill (pet-ui.js). The words come from main (insel.js → live.js);
// the line is only decoration — what is pasted is always the final text.
//
// Calm, no jumping: the stable start of the line keeps its place and only the new end fades in (liveStabil in
// regeln.js); the strip's width follows the measured text with a short ease-out; a new partial arrives at most every
// ~60 ms on screen (the service sends several per second).

(function () {
  const R = window.SpaceRegeln;

  function erstellen({ zeile, stabil, neu, schrift, rand, beiAenderung }) {
    // the room the line has (its CSS max-width): words drop off the front until the line fits — never cut at the end
    const platz = () => parseFloat(getComputedStyle(zeile).maxWidth) || 476;
    const mess = document.createElement('canvas').getContext('2d');
    mess.font = schrift;
    let gezeigt = '';
    let wartend = null;
    let uhr = null;
    let an = false;

    function setzen(text) {
      let z = R.liveZeile(text);
      for (let i = 0; i < 40 && Math.ceil(mess.measureText(z).width) + rand > platz(); i++) {
        const rest = z.replace(/^… /, '');
        const leer = rest.indexOf(' ');
        if (leer < 0) {
          // one word wider than the room: cut it from the front, keep its end (where the new letters come)
          let wort = rest;
          while (wort.length > 4 && Math.ceil(mess.measureText(`…${wort}`).width) + rand > platz()) wort = wort.slice(1);
          z = `…${wort}`;
          break;
        }
        z = `… ${rest.slice(leer + 1)}`;
      }
      if (z === gezeigt) return;
      const { stabil: s, neu: n } = R.liveStabil(gezeigt, z);
      stabil.textContent = s;
      // a fresh element restarts the fade only for the new end
      const frisch = neu.cloneNode(false);
      frisch.textContent = n;
      neu.replaceWith(frisch);
      neu = frisch;
      gezeigt = z;
      const breite = Math.ceil(mess.measureText(z).width) + rand;
      zeile.style.width = `${breite}px`;
      if (!an && z) { an = true; zeile.classList.add('an'); if (beiAenderung) beiAenderung(true); }
      else if (beiAenderung) beiAenderung(an);
    }

    return {
      /** A new partial (or the final text): shown at most every 60 ms, the latest wins. */
      zeigen(text) {
        if (typeof text !== 'string' || !text.trim()) return;
        wartend = text;
        if (uhr) return;
        setzen(wartend); wartend = null;
        uhr = setTimeout(function weiter() {
          uhr = null;
          if (wartend !== null) { setzen(wartend); wartend = null; uhr = setTimeout(weiter, 60); }
        }, 60);
      },
      leeren() {
        clearTimeout(uhr); uhr = null; wartend = null;
        if (!an && !gezeigt) return;
        an = false;
        gezeigt = '';
        zeile.classList.remove('an');
        if (beiAenderung) beiAenderung(false);
        // the text goes after the fade, so the strip does not shrink while it fades
        setTimeout(() => { if (!an) { stabil.textContent = ''; neu.textContent = ''; zeile.style.width = ''; } }, 200);
      },
      sichtbar() { return an; },
    };
  }

  window.SpaceLiveZeile = { erstellen };
})();
