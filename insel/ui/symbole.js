// Icons of the island — our own line set (24 grid, 1.9 stroke, round caps), drawn to sit next to the SPACE face.
// Classic script → window.SpaceSymbole: name → SVG string.

(function () {
  const svg = (inhalt, extra) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ''}>${inhalt}</svg>`;

  window.SpaceSymbole = {
    // the tabs: a small helmet (overview), a speech bubble with a visor line (ask), a tray with an arrow (drop)
    uebersicht: svg('<path d="M5 15.5V12a7 7 0 0 1 14 0v3.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 15.5Z"/><path d="M8.5 12.5h7"/><path d="M18.5 9.5 20 6"/>'),
    fragen: svg('<path d="M4.5 12a7.5 7.5 0 1 1 3.6 6.4L4.5 19.5l1-3.4A7.4 7.4 0 0 1 4.5 12Z"/><path d="M9 11.5v1M15 11.5v1"/>'),
    ablage: svg('<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M4.5 14.5v2A2.5 2.5 0 0 0 7 19h10a2.5 2.5 0 0 0 2.5-2.5v-2"/>'),
    einstellungen: svg('<path d="M4 8h8.5M17.5 8H20M4 16h2.5M11.5 16H20"/><circle cx="15" cy="8" r="2.5"/><circle cx="9" cy="16" r="2.5"/>'),
    tonAn: svg('<path d="M5 9.5h2.5L12 6v12l-4.5-3.5H5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>'),
    tonAus: svg('<path d="M5 9.5h2.5L12 6v12l-4.5-3.5H5Z"/><path d="m16 10 4 4M20 10l-4 4"/>'),
    zuklappen: svg('<path d="m7 14.5 5-5 5 5"/>'),
    oeffnen: svg('<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M17 14v3.5A1.5 1.5 0 0 1 15.5 19h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7H10"/>'),
    senden: svg('<path d="M12 18V6"/><path d="m6.5 11.5 5.5-5.5 5.5 5.5"/>'),
    mikrofon: svg('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>'),
    aufnahme: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
    mail: svg('<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>'),
    chat: svg('<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3v-3H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z"/>'),
    check: svg('<path d="m5.5 12.5 4 4 9-9"/>', ' stroke-width="2.4"'),
    kreuz: svg('<path d="m7 7 10 10M17 7 7 17"/>', ' stroke-width="2.2"'),
    datei: svg('<path d="M7 3.5h6.5l4.5 4.5v11A1.5 1.5 0 0 1 16.5 20.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M13.5 3.5V8H18"/>'),
    glocke: svg('<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14Z"/><path d="M10.5 20.5h3"/>'),
    zurueck: svg('<path d="m14.5 6-6 6 6 6"/>'),
  };
})();
