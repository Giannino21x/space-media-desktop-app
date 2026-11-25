# Diktat und Insel: Analyse gegen Aqua Voice (25.11.2026)

Modus: Clean room. Aqua wurde nur von aussen angeschaut: öffentliche Seiten und Bilder von aquavoice.com, Changelog,
Fensterliste von Windows (nur Lage und Grösse). Nichts entpackt, nichts dekompiliert, kein Konto, keine Diktate, keine
Einstellungen von Giannino gelesen. Aqua nicht bedient: Giannino war die ganze Zeit am Rechner (`GetLastInputInfo` = 0 ms),
und ein Probelauf mit der Taste hätte in seinem Aqua-Verlauf einen Eintrag hinterlassen. Craft Anything im Clean room: die
Werkzeuge, die ein Programm starten oder in seinen Bildschirm schauen (`native-window-capture`, `runtime-ui-read`), habe ich
nicht benutzt; das erste startet Aqua neu, das zweite liest Fensterinhalte (Verlauf). Kein Schritt «Deep».

Unsere Seite: Code im Worktree (insel/, main.js, lokal.js) und Web-Repo `origin/dev` b2d9f32fa (Transkription, Wörterbuch,
Diktat-Sprache). Bilder unserer Insel aus dem Demo-Modus der Seiten (agent-browser, eigene Sitzung, keine echten Daten).

## Bilder

Aqua (öffentliche Bilder von aquavoice.com, Mac-Version 0.22.15, nur zum Vergleich, nicht im Repo):

- Einstellungen «Dictation»: `D:/sme-arbeit/insel-diktat/aqua-oeffentlich/desktop-dictation-settings.jpg`
- Einstellungen «Keybindings»: `D:/sme-arbeit/insel-diktat/aqua-oeffentlich/desktop-keybindings.jpg`
- Einstellungen «Features» (Sprache, Kontext, Bearbeiten, Senden): `D:/sme-arbeit/insel-diktat/aqua-oeffentlich/desktop-dictation-features.jpg`
- Pet: `D:/sme-arbeit/insel-diktat/aqua-oeffentlich/pet.jpg` · Mikrofon-Start Windows: `.../windows-microphone-startup.png` · Leiste Mac: `.../liquid-glass.png`

Unsere Insel heute (im Repo, `docs/reviews/2026-11-25-insel-diktat/`):

- `insel-einstellungen.png` — Blatt «Insel» hinter dem Regler-Symbol: 3 Schalter + «Insel ausblenden»
- `insel-uebersicht.png` — Insel offen: Lauf, Chat, Mail, Sitzung, Aktivität
- `pille-live.png` — Pille unten Mitte beim Sprechen (Pegel)
- `pille-werkzeug.png` — Pille beim Darüberfahren (Diktieren, Sitzung, SME öffnen)
- `pet-menue.png` — Rechtsklick aufs Pet

## 1. Gleiche Tabelle, beide Apps

| Punkt | Aqua Voice (Windows, laut öffentlicher Doku) | SPACE Insel heute (Code) |
|---|---|---|
| Erster Start | Installer, Anmelden, Schritt Mikrofon + Taste mit geführtem Beispiel (prüft, dass beides geht) | Kurze Begrüssung der Insel (einmal); kein Mikrofon-Test, kein Probediktat |
| Taste | Alt rechts (Standard), frei wählbar, mehrere Tasten, auch Maustaste 3/4/5 | Strg rechts, fest; nur an/aus |
| Halten / Freihand | Halten = sprechen; zweimal tippen oder Taste + Leertaste = freihand; Taste nochmals = fertig | Halten ≥ 0,28 s = sprechen; zweimal tippen = freihand; Taste nochmals = fertig; Esc bricht ab; andere Taste = war ein Kürzel, verworfen |
| Anzeige beim Sprechen | «Floating bar» unten Mitte (zeigen/verstecken), Pegel; Pet sitzt an derselben Stelle, Grösse klein/normal, blendet nach 30 s/5 min/10 min aus | Pille unten Mitte mit Pegel (9 Bänder), Insel oben zeigt «hört»; mit Pet zeigt das Pet die Pille |
| Wie der Text ankommt | Einfügen an der Schreibmarke; «Instant» = am Ende, «Realtime» = Wörter live (Max-Abo) | Am Ende: Zwischenablage → Strg+V → alte Zwischenablage zurück; mit Pet fliegt eine Blase zum Zeiger, dann Einfügen |
| Korrigieren | Text markieren, Taste halten, Änderung sagen («kürzer», «auf Englisch»); kein Rückgängig per Stimme | keine |
| Letztes Diktat nochmals | eigene Taste «Paste last transcript», Verlauf mit Wiedergabe | im Code da (`letztesDiktat`, `pille:nochmals`), aber ohne Knopf und ohne Ablauf — für die Person heute unerreichbar |
| Fehler | Mikrofon blockiert → Hinweis auf Windows-Einstellung; Changelog nennt Fixes für verschwundene Leiste bei Skalierung | Mikrofon fehlt → Meldung an der Pille; Dienst fehlt → «Kein Transkriptionsdienst hinterlegt»; zu kurz → still verworfen |
| Sprache | Liste mit «Auto-Detect» | Schweizerdeutsch / Hochdeutsch / Automatisch — existiert, aber nur in der App (Einstellungen), nicht an der Insel |
| Stil | «Instructions» als freier Text (Pro), «Casual messaging» (klein in Chats) | Whisper roh, kein Aufräumen |
| Eigene Wörter | Wörterbuch + Ersetzungen (Pro) | Firmen-Wörterbuch gibt es (`/api/meetings/woerter`), wirkt aber nur bei Sitzungen, **nicht** beim Diktat |
| Aussehen / Lage | Hell/Dunkel/System, Leiste an/aus, Pet-Grösse | Insel fest oben Mitte, Pet frei ziehbar, Pille fest unten Mitte |
| Ton | in der Doku nicht gefunden | Töne an/aus (Insel-Kopf und Blatt) |
| Mikrofon | Wahl in «Audio», virtuelle Eingänge sperren | Windows-Standard, keine Wahl |
| Wo die Einstellungen sind | ein Fenster, 6 Bereiche links, «Reset to defaults» je Bereich | an **vier** Stellen: Infobereich (5 Häkchen), Blatt an der Insel (3 Schalter + 1), App-Seite «Bot → Insel» (7 Schalter), Pet-Menü («Einstellungen…» öffnet die App-Seite); Sprache an einer fünften (App, Diktat-Sprache) |
| Klicks bis zur Einstellung | Infobereich → Fenster → Bereich → Schalter: 3–4 | Insel: Rand oben → Regler → Schalter: 3; Sprache: App öffnen → Einstellungen → Bereich → Liste: 4+ |

### Zeiten

| Messung | Aqua | Insel |
|---|---|---|
| Taste bis Mikrofon bereit | 122 ms (Windows, eigene Angabe im Changelog 0.19.14, vorher 298 ms) | nicht gemessen. Die Aufnahme startet beim ersten Tastendruck, aber das Mikrofon wird jedes Mal kalt geöffnet (`getUserMedia` in `pille-ui.js:129`); auf Windows typisch 100–400 ms, die erste Silbe kann fehlen |
| Loslassen bis Text da | nicht veröffentlicht | nicht gemessen. Weg: Upload → `whisper-1` (oder AssemblyAI) → Antwort → 40 ms → Strg+V |

Beide Zeiten brauchen einen Probelauf mit Ton. **Frage an Chief:** darf ich messen, wenn Giannino nicht am Rechner ist
(`GetLastInputInfo` > 5 min), mit eigenem Profil, `"diktat"` über die Pillen-Taste statt der rechten Strg, und einer
Testdatei über ein virtuelles Mikrofon? Aqua messe ich dabei nicht (sein Verlauf), ausser du sagst anders.

## 2. Was Leute sagen (last30days, 26.10.–25.11.2026, plus Web-Ergänzung)

Ehrlich: im 30-Tage-Fenster kam wenig. Reddit lieferte keine Daten (Abruf gescheitert), X ist aus. Was belegt ist:

- Aqua-Overlay stört andere Programme: ein durchsichtiges Vollbild-Fenster immer oben wird von Bildschirm-Werkzeugen als
  Ziel genommen ([Snapzy #753](https://github.com/duongductrong/Snapzy/issues/753), 16.11.). Dasselbe sehe ich hier: Aqua
  hält zwei Fenster mit 4096×1151 offen. Unsere Insel macht das nicht (kleine Fenster, Durchklicken pro Pixel) — so lassen.
- Leute vergleichen Diktat-Apps beim Beantworten und Freigeben von Prompts für Coding-Agenten per Stimme
  ([figg #99](https://github.com/adamclark64/figg/issues/99), 19.11.) — «Senden per Stimme» ist ein Thema.
- Wispr Flow: Freihand lässt sich nur über Adressen ein- und ausschalten, kein Umschalten; eine frische Installation hat die
  Freihand-Taste nicht gesetzt ([idvorkin/Settings #151](https://github.com/idvorkin/Settings/pull/151), 21.11.).
- Wispr Flow: Sorge, dass die App Tasten auch ausserhalb des Diktats liest; Support antwortet spät; Trustpilot 2,5/5
  ([Trustpilot](https://no.trustpilot.com/review/wisprflow.ai), Datum der Einträge gemischt). Für uns: der Hook beobachtet
  nur — das sagen, nicht verstecken.
- Superwhisper: Ton standardmässig auf Platte, Schlüssel im Klartext, Zwischenablage überschrieben (oberste Wünsche auf
  dem eigenen Board, zitiert in [blazingfasttranscription](https://blazingfasttranscription.com/blog/superwhisper-review),
  älter als 30 Tage); Namen und Fachwörter schwach; steile Lernkurve
  ([Medium](https://medium.com/ai-tools-tips-and-news/i-spent-a-week-in-superwhispers-settings-here-s-my-honest-take-2b16515dfafd)).
- Superwhisper → Hex: gratis, auf dem Gerät, Mac/Windows/Linux
  ([saucy-tech #372](https://github.com/saucy-tech/personal-site/pull/372), 11.11.).
- Aqua gelobt für Namen, Fachwörter und Code; kritisiert: nur Cloud, kein Offline, kleines Gratis-Kontingent
  ([dev.to](https://dev.to/eliaslarsen/aqua-voice-review-2026-the-230-wpm-dictation-apps-plans-limits-and-trade-offs-o2j),
  [getvoibe](https://www.getvoibe.com/resources/aqua-voice-review/); beide älter als 30 Tage, Verfasser teils Konkurrenz).

Muster: Gelobt wird, wenn Namen stimmen und es ohne Einrichten geht. Gehasst wird, wenn die Zwischenablage leidet, Daten
liegen bleiben, die Einrichtung Tasten verlangt, oder Einstellungen zum Dickicht werden. Unser Vorteil: Diktat auf dem PC
(offline) gibt es schon; die Zwischenablage kommt zurück.

## 3. Lücken nach Nutzen

| # | Lücke | Heute | Danach |
|---|---|---|---|
| 1 | Namen und Fachwörter falsch | Firmen-Wörterbuch wirkt nur bei Sitzungen; beim Diktat: nichts zu tun möglich | Wörter, die schon im Wörterbuch stehen, wirken sofort, 0 Klicks. Neues Wort: Rechtsklick Insel → «Wörter» → tippen → Enter (2 Klicks + Tippen) |
| 2 | Einstellungen an vier Stellen | Infobereich, Blatt, App-Seite, Pet-Menü; Sprache in der App (4+ Klicks, App muss offen sein) | Rechtsklick auf Insel, Pille oder Pet → ein Blatt mit allem (1 Klick), jede Zeile wirkt sofort, «Standard» je Zeile |
| 3 | Text ins falsche Fenster | unerreichbar (kein Knopf) | Rechtsklick → «Letztes Diktat einfügen» (2 Klicks), 10 Min. im Speicher, nie auf Platte |
| 4 | Taste fest (viele neue Laptops haben statt Strg rechts die Copilot-Taste) | Tray-Häkchen an/aus | Blatt → Taste: Strg rechts · Aus (2 Klicks). Keine zweite Taste: der Hook kann nichts schlucken — Maus-Seitentaste = «Zurück» im Browser, Alt rechts öffnet auf US-Tastaturen das Menü, Shift rechts 8 s gehalten öffnet die Windows-Anschlagverzögerung. Ohne rechte Strg: Knopf an Pille oder Pet (freihand) |
| 5 | «äh», «ähm» | stehen im Text | weg, ohne Modell, ohne Einstellung (Doppelwörter bleiben: «die die» ist richtiges Deutsch) |
| 6 | Sprache nur in der App | App öffnen → Einstellungen → Sprache: 4+ Klicks | bleibt in der App: beim Kurz-Diktat senden Schweizerdeutsch und Hochdeutsch beide `de`, und die Einstellung steuert auch Sitzungen |
| 7 | Insel fest oben Mitte (bei 4096 px Breite weit weg) | nichts zu tun möglich | Insel am oberen Rand ziehen, Lage bleibt, 0 Einstellungen |
| 8 | Erste Silbe fehlt evtl. | unklar (nicht gemessen) | erst messen, dann entscheiden |

Nicht übernommen (fast niemand braucht es oder es kostet): Mikrofon-Wahl (Windows-Standard reicht; kommt, wenn jemand
fragt), Live-Text beim Sprechen (braucht Streaming-Dienst, kostet laufend), Korrigieren per Stimme und «Senden» per Stimme
(Modell-Lauf pro Diktat → Geld, eigener Auftrag), Grösse der Insel (die Trefferflächen sind auf eine Grösse abgestimmt),
Aussehen hell/dunkel (Insel ist dunkel wie die Taskleiste), «Beim Darüberfahren öffnen» (siehe Plan), Glätten mit Modell
(kostet pro Diktat; nur mit Entscheid Chief).
