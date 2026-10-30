const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HALTEN_MIN_MS, DOPPEL_MS, MAX_AUFNAHME_MS,
  diktatTaste, inselRahmen, pillenRahmen, imRechteck, inselLage, multipart, diktatFehler,
} = require('./regeln');

const ab = (taste, folge) => folge.map(([art, zeit]) => taste.ereignis({ art, zeit }));

test('hold right Ctrl, speak, let go → paste', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['diktatRunter', 30], ['diktatHoch', HALTEN_MIN_MS + 500]]), [['aufnahmeStart'], [], ['senden']]);
  assert.equal(t.zustand, 'ruhe');
});

test('a short tap alone is thrown away after the double-tap window', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['diktatHoch', 90], ['takt', 90 + DOPPEL_MS - 1], ['takt', 90 + DOPPEL_MS]]), [['aufnahmeStart'], [], [], ['verwerfen']]);
});

test('two quick taps → hands-free, one more tap sends', () => {
  const t = diktatTaste();
  const r = ab(t, [['diktatRunter', 0], ['diktatHoch', 80], ['diktatRunter', 200], ['diktatHoch', 260], ['andere', 900], ['diktatRunter', 5000], ['diktatHoch', 5080]]);
  assert.deepEqual(r, [['aufnahmeStart'], [], ['freihand'], [], [], ['senden'], []]);
  assert.equal(t.zustand, 'ruhe');
});

test('right Ctrl as part of a shortcut is dropped silently', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['andere', 40], ['diktatHoch', 900]]), [['aufnahmeStart'], ['verwerfen'], []]);
});

test('Esc cancels while holding and hands-free', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['esc', 1500]]), [['aufnahmeStart'], ['abbrechen']]);
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['diktatHoch', 50], ['diktatRunter', 150], ['esc', 3000]]), [['aufnahmeStart'], [], ['freihand'], ['abbrechen']]);
  assert.deepEqual(ab(t, [['esc', 10]]), [[]]);
});

test('a recording never runs forever', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['takt', MAX_AUFNAHME_MS]]), [['aufnahmeStart'], ['senden']]);
  // still holding the key: its release must not start anything
  assert.deepEqual(ab(t, [['diktatHoch', MAX_AUFNAHME_MS + 10]]), [[]]);
  assert.equal(t.zustand, 'ruhe');
});

test('windows sit top centre and above the taskbar', () => {
  assert.deepEqual(inselRahmen({ x: 0, y: 0, width: 1920, height: 1080 }, 680, 300), { x: 620, y: 0, width: 680, height: 300 });
  assert.deepEqual(inselRahmen({ x: -1920, y: 0, width: 1920, height: 1080 }, 680, 300), { x: -1300, y: 0, width: 680, height: 300 });
  assert.deepEqual(pillenRahmen({ x: 0, y: 0, width: 1920, height: 1040 }, 320, 120, 8), { x: 800, y: 912, width: 320, height: 120 });
});

test('point in rectangle with margin', () => {
  const r = { x: 100, y: 0, width: 200, height: 40 };
  assert.equal(imRechteck({ x: 100, y: 0 }, r), true);
  assert.equal(imRechteck({ x: 300, y: 10 }, r), false);
  assert.equal(imRechteck({ x: 305, y: 10 }, r, 6), true);
  assert.equal(imRechteck({ x: 5, y: 5 }, null), false);
});

test('island state from the app answers', () => {
  const lage = inselLage({
    laufend: { laufend: [{ id: 'r1', titel: 'Offerte prüfen', bot: 'Offerten-Bot', start: '2026-10-27T10:00:00Z' }], fertig: [], freigaben: 2 },
    freigaben: { approvals: [{ id: 'a1', title: 'Mail an Huber', summary: 'Antwort auf die Offerte', kind: 'email_send', bot_id: 'b1' }] },
    team: { bots: [{ id: 'b1', name: 'SPACE Bot', color: 'sky', isDefault: true }, { id: 'b2', name: 'Alt', color: 'red', archivedAt: '2026-01-01' }] },
    profil: { access: { plan: 'standard' }, nickname: 'Giannino' },
  });
  assert.equal(lage.angemeldet, true);
  assert.equal(lage.steno, false);
  assert.equal(lage.name, 'Giannino');
  assert.equal(lage.laufend.length, 1);
  assert.equal(lage.freigabenZahl, 2);
  assert.equal(lage.freigaben[0].titel, 'Mail an Huber');
  assert.deepEqual(lage.team.map((b) => b.id), ['b1']);
  const leer = inselLage();
  assert.equal(leer.angemeldet, false);
  assert.deepEqual(leer.laufend, []);
  assert.equal(inselLage({ profil: { access: { plan: 'spacebot' } } }).steno, true);
});

test('multipart body carries the file', () => {
  const { typ, koerper } = multipart('audio', 'diktat.webm', 'audio/webm', Buffer.from('abc'));
  const grenze = typ.split('boundary=')[1];
  const text = koerper.toString();
  assert.ok(text.startsWith(`--${grenze}\r\n`));
  assert.ok(text.includes('name="audio"; filename="diktat.webm"'));
  assert.ok(text.includes('Content-Type: audio/webm\r\n\r\nabc\r\n'));
  assert.ok(text.endsWith(`--${grenze}--\r\n`));
});

test('dictation errors in German', () => {
  assert.equal(diktatFehler(401, null), 'Bitte zuerst in SPACE anmelden.');
  assert.equal(diktatFehler(403, { error: 'Sprache ist mit «Nur Schweiz» gesperrt.' }), 'Sprache ist mit «Nur Schweiz» gesperrt.');
  assert.equal(diktatFehler(500, {}), 'Das Diktat liess sich nicht lesen.');
});

test('the pill buttons: dictate hands-free, finish', () => {
  const t = diktatTaste();
  assert.deepEqual(t.freihand(0), ['aufnahmeStart', 'freihand']);
  assert.deepEqual(t.freihand(10), []);
  assert.deepEqual(t.ereignis({ art: 'andere', zeit: 500 }), []);
  assert.deepEqual(t.fertig(), ['senden']);
  assert.equal(t.zustand, 'ruhe');
  assert.deepEqual(t.fertig(), []);
});

// ---- the SPACE Pet ----

const {
  DOESEN_MS, SCHLAFEN_MS, REAKTION_PAUSE_MS, WURF_MS,
  petRahmen, petLage, petArbeitsbereich, TASKLEISTE_DIP, inEcke, petVersteckBis, petVersteckt, petWachheit, petReaktion,
  lokalerTag, naechsterTag, petZaehlen, petLevel, petTooltip, wurfBogen, wurfText, petFarbe,
} = require('./regeln');

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const FENSTER = { breite: 400, hoehe: 230 };
const FIGUR = { x: 320, y: 110, width: 52, height: 114 }; // window-local body of the figure

test('pet: bottom right by default, a remembered spot is kept, the figure never leaves the work area', () => {
  assert.deepEqual(petRahmen(WA, 400, 230), { x: 1520, y: 810, width: 400, height: 230 });
  assert.deepEqual(petLage(null, WA, FENSTER, FIGUR), { x: 1520, y: 810 });
  assert.deepEqual(petLage({ x: 'a', y: 5 }, WA, FENSTER, FIGUR), { x: 1520, y: 810 });
  assert.deepEqual(petLage({ x: 600, y: 300 }, WA, FENSTER, FIGUR), { x: 600, y: 300 });
  // pushed past the left edge: the body stops at the edge (the window may hang over)
  assert.deepEqual(petLage({ x: -2000, y: -500 }, WA, FENSTER, FIGUR), { x: -320, y: -110 });
  // pushed past the bottom right: the body stops in the corner
  assert.deepEqual(petLage({ x: 5000, y: 5000 }, WA, FENSTER, FIGUR), { x: 1920 - 372, y: 1040 - 224 });
});

test('pet: only the corner itself opens the hide menu', () => {
  const standard = petLage(null, WA, FENSTER, FIGUR);   // the figure sits 28 px from the right edge
  assert.equal(inEcke(standard, WA, FIGUR), false);
  assert.equal(inEcke({ x: 1920 - 372, y: 1040 - 224 }, WA, FIGUR), true);
  assert.equal(inEcke({ x: 1920 - 372 - 5, y: 1040 - 224 - 5 }, WA, FIGUR), true);
  assert.equal(inEcke({ x: 1920 - 372 - 20, y: 1040 - 224 }, WA, FIGUR), false);
  assert.equal(inEcke({ x: 1920 - 372, y: 1040 - 224 - 20 }, WA, FIGUR), false);
});

test('pet: hidden for a minute, an hour, or until brought back', () => {
  const t = 1_000_000;
  assert.equal(petVersteckBis('1min', t), t + 60_000);
  assert.equal(petVersteckBis('1std', t), t + 3_600_000);
  assert.equal(petVersteckBis('immer', t), -1);
  assert.equal(petVersteckBis('abbrechen', t), 0);
  assert.equal(petVersteckt(0, t), false);
  assert.equal(petVersteckt(t + 1, t), true);
  assert.equal(petVersteckt(t - 1, t), false);
  assert.equal(petVersteckt(-1, t), true);
  assert.equal(petVersteckt(undefined, t), false);
});

test('pet: dozes after 2 minutes, sleeps after 10', () => {
  assert.equal(petWachheit(0), 'wach');
  assert.equal(petWachheit(DOESEN_MS - 1), 'wach');
  assert.equal(petWachheit(DOESEN_MS), 'doest');
  assert.equal(petWachheit(SCHLAFEN_MS - 1), 'doest');
  assert.equal(petWachheit(SCHLAFEN_MS), 'schlaeft');
});

test('pet: reactions to what was said, at most one every 30 s', () => {
  assert.equal(petReaktion('Vielen Dank für die Offerte.', 5, null, 1000), 'herz');
  assert.equal(petReaktion('merci vilmal', 2, null, 1000), 'herz');
  assert.equal(petReaktion('Kommst du morgen?', 3, null, 1000), 'frage');
  assert.equal(petReaktion('Das Protokoll ist fertig', 4, null, 1000), 'huepfer');
  assert.equal(petReaktion('Erledigt.', 1, null, 1000), 'huepfer');
  assert.equal(petReaktion('Wort '.repeat(80), 80, null, 1000), 'daumen');
  assert.equal(petReaktion('Wort '.repeat(79), 79, null, 1000), null);
  assert.equal(petReaktion('Dankbarkeit ist fertigdankend', 3, null, 1000), null); // whole words only
  // priority: thanks before a question before done
  assert.equal(petReaktion('Danke, ist das fertig?', 4, null, 1000), 'herz');
  assert.equal(petReaktion('Ist das fertig?', 3, null, 1000), 'frage');
  // the pause
  assert.equal(petReaktion('Danke', 1, 1000, 1000 + REAKTION_PAUSE_MS - 1), null);
  assert.equal(petReaktion('Danke', 1, 1000, 1000 + REAKTION_PAUSE_MS), 'herz');
});

test('pet: words today, words ever, a streak of days, a level', () => {
  assert.equal(lokalerTag(new Date(2026, 9, 30, 23, 59)), '2026-10-30');
  assert.equal(naechsterTag('2026-10-31'), '2026-11-01');
  assert.equal(naechsterTag('2026-12-31'), '2027-01-01');
  assert.equal(naechsterTag('kaputt'), null);
  let z = petZaehlen(undefined, 12, '2026-10-30');
  assert.deepEqual(z, { tag: '2026-10-30', heute: 12, gesamt: 12, streak: 1 });
  z = petZaehlen(z, 8, '2026-10-30');
  assert.deepEqual(z, { tag: '2026-10-30', heute: 20, gesamt: 20, streak: 1 });
  z = petZaehlen(z, 5, '2026-10-31');                       // the next day: the streak grows
  assert.deepEqual(z, { tag: '2026-10-31', heute: 5, gesamt: 25, streak: 2 });
  z = petZaehlen(z, 0, '2026-11-02');                       // a new day, nothing said yet: today 0, streak untouched
  assert.deepEqual(z, { tag: '2026-10-31', heute: 0, gesamt: 25, streak: 2 });
  z = petZaehlen(z, 3, '2026-11-03');                       // a day skipped: back to 1
  assert.deepEqual(z, { tag: '2026-11-03', heute: 3, gesamt: 28, streak: 1 });
  assert.deepEqual(petZaehlen({ tag: '2026-11-03', heute: 'x', gesamt: -4, streak: 1.7 }, 2, '2026-11-03'), { tag: '2026-11-03', heute: 2, gesamt: 2, streak: 1 });
  assert.equal(petLevel(0), 1);
  assert.equal(petLevel(999), 1);
  assert.equal(petLevel(1000), 2);
  assert.equal(petLevel(5000), 3);
  assert.equal(petLevel(25_000), 4);
  assert.equal(petLevel(100_000), 5);
  assert.equal(petLevel(1e9), 5);
  assert.equal(petTooltip({ heute: 320, gesamt: 1200, streak: 4 }), 'Heute 320 Wörter · Level 2 · 4 Tage');
  assert.equal(petTooltip({ heute: 1, gesamt: 1, streak: 1 }, 'Pixel'), 'Pixel · Heute 1 Wort · Level 1 · 1 Tag');
  assert.equal(petTooltip(null, '  '), 'Heute 0 Wörter · Level 1 · 0 Tage');
});

test('pet: the throw flies in an arc from the pet to the pointer and lands within 450 ms', () => {
  assert.ok(WURF_MS <= 450);
  const von = { x: 1800, y: 900 };
  const nach = { x: 600, y: 300 };
  assert.deepEqual(wurfBogen(von, nach, 0), von);
  assert.deepEqual(wurfBogen(von, nach, 1), nach);
  const mitte = wurfBogen(von, nach, 0.5);
  assert.equal(mitte.x, 1200);
  assert.ok(mitte.y < 600 - 100, 'the arc rises above the straight line');
  assert.ok(mitte.y >= 600 - 160);
  // a tiny throw still lifts a little
  assert.ok(wurfBogen({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5).y <= -36);
  assert.deepEqual(wurfBogen(von, nach, 1.5), nach);
  assert.equal(wurfText('Guten Tag Herr Huber, danke für die Offerte'), 'Guten Tag Herr Huber, …');
  assert.equal(wurfText('  Hallo  '), 'Hallo');
  assert.equal(wurfText('Donaudampfschifffahrtsgesellschaft'), 'Donaudampfschifffahrtsg…');
  assert.equal(wurfText(''), '');
});

test('pet: wears the colour of the bot in the chat, else the default bot', () => {
  assert.equal(petFarbe({ aktiverBot: { farbe: 'amber' }, team: [{ standard: true, farbe: 'red' }] }), '251,191,36');
  assert.equal(petFarbe({ team: [{ farbe: 'red' }, { standard: true, farbe: 'emerald' }] }), '52,211,153');
  assert.equal(petFarbe({ aktiverBot: { farbe: 'neon' } }), '51,170,255');
  assert.equal(petFarbe(null), '51,170,255');
});

test('pet: an auto-hidden taskbar (work area = display) costs 48 DIP at the bottom, a visible one nothing', () => {
  assert.deepEqual(petArbeitsbereich(WA, { x: 0, y: 0, width: 1920, height: 1080 }), WA);
  assert.deepEqual(petArbeitsbereich({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }), { x: 0, y: 0, width: 1920, height: 1080 - TASKLEISTE_DIP });
  assert.deepEqual(petArbeitsbereich(WA, null), WA);
});
