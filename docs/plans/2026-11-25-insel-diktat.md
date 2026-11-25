# Plan: Diktat und Insel, einfacher und anpassbar (25.11.2026)

Anlass: Giannino, 25.11.2026 — «so einfach wie möglich bedienbar und mehr customizable, auch in der Insel selber».
Analyse: `docs/reviews/2026-11-25-insel-diktat/analyse.md`. Auftrag von Chief: Teil 2 (Zielbild).
Status: S1–S6 geprüft (APPROVED Runde 3) und von Chief freigegeben; S7 neu (Entscheid Chief 25.11.), Prüfung S7 Runde 3: Befunde eingearbeitet, keine weitere Runde nötig (Prüfer) (Claude-Prüfer statt Codex, Log `docs/plans/2026-11-25-insel-diktat-review-log.md`).
Wartet auf Freigabe der Scheiben durch Chief. Kein Release ohne Go.

## Ziel und Abnahme

Eine Taste, sprechen, Text ist da — ohne Einrichten. Wer etwas ändern will, findet es mit einem Rechtsklick an der Stelle,
die er gerade sieht, in einem kurzen Blatt an der Insel. Jede Zeile wirkt sofort, ohne Speichern, und hat «Standard» als
Rückweg.

Abnahme (beobachtbar):
1. Rechtsklick auf Insel oder Pille öffnet das Blatt «Diktat» an der Insel; im Pet-Menü führt «Einstellungen…» dorthin.
   Heute: die Insel schluckt den Rechtsklick (`insel-ui.js:1270`), die Pille hat keinen, «Einstellungen…» im Pet-Menü
   springt in die App (`pet-ui.js:220`).
2. Im Blatt stehen höchstens 5 Zeilen. Einstellungen gesamt 9 → 8. Bedienstellen: nach S1 noch 5 (Blatt, Infobereich,
   App-Seite, Pet-Menü, Ton-Knopf), nach dem Web-Nachzug 4 und App-Seite nur noch ein Verweis (Zahlen unten).
3. Ein Wort im Firmen-Wörterbuch (z. B. «Huber Treuhand») wird beim Diktat richtig geschrieben, ohne dass die Person
   etwas tut — auf allen Whisper-Wegen (OpenAI und Swiss/Azure).
4. «Letztes Diktat einfügen» fügt den letzten Text nochmals ein, bis 10 Min. danach; nach Neustart und nach 10 Min. ist er
   weg. Im Blatt steht nur der Titel, nie der Text (Bildschirm-Teilen).
5. «äh», «ähm», «öhm», «hm», «mhm» verschwinden aus dem Diktat. Jeder Satz ohne diese Wörter bleibt Zeichen für Zeichen
   gleich — auch «Kunden, die die Rechnung …».
6. Die Diktat-Taste lässt sich auf «Aus» stellen; die alte Schaltung `diktat: false` wird zu «Aus», und die heutige
   App-Seite (Schalter `diktat`, `hoverOeffnen`) läuft unverändert weiter.
7. Die Insel lässt sich am oberen Rand seitlich ziehen und bleibt dort, auch nach Neustart.
8. Der Hintergrund bleibt still (`insel/ruhig.test.js` grün), keine neue Netz-Anfrage im Leerlauf.

## Einstellungen vorher und nachher

Vorher: 9 Einstellungen an 5 Stellen, rund 18 Bedienelemente (Infobereich 5 Häkchen, Blatt 3 Schalter + «Diktat auf diesem
PC» + «Insel ausblenden» + Ton-Knopf im Kopf, App-Seite «Bot → Insel» 7 Schalter, Pet-Menü, Diktat-Sprache in der App).
Die 9: Insel an, Diktat an, Töne, Beim Darüberfahren öffnen, Pet, Pet-Name, Diktat auf diesem PC, Mit Windows starten, Sprache.

Nachher: 8 Einstellungen (Insel an, Taste, Töne, Pet, Pet-Name, Diktat auf diesem PC, Mit Windows starten, Sprache) plus
die Wörter (Inhalt, kein Schalter). Hauptstelle ist das Blatt; der Infobereich behält SME öffnen, Mit Windows starten,
Insel oben anzeigen, SPACE Pet anzeigen, Beenden; Sprache bleibt in der App. Übergang nach S1: rund 16 Bedienelemente
(App-Seite noch mit 7 Schaltern); Endstand nach Web-Nachzug: rund 11.

| Zeile im Blatt | Standard | Warum sie bleibt |
|---|---|---|
| Letztes Diktat einfügen (nur sichtbar, wenn es einen gibt) | — | Rettung, wenn der Text im falschen Fenster landete |
| Taste: Strg rechts · Aus | Strg rechts | ersetzt den Schalter «Diktat an» |
| Wörter (Liste, Feld «Wort hinzufügen») | Firmen-Wörterbuch | dasselbe Wörterbuch wie bei Sitzungen, kein zweites; an der Insel nur ansehen und dazufügen |
| SPACE Pet | an | gibt es schon; zeigt «an» nur, wenn das Pet wirklich sichtbar ist; einschalten holt ein verstecktes Pet zurück |
| Diktat auf diesem PC | an (nur sichtbar, wenn das Modell da ist) | gibt es schon |
| Fuss: Dienst-Zeile + «Insel ausblenden» | — | bleibt Link, kein Schalter |

Mit S7 (Entscheid Chief, «mehr anpassbar»): +5 Einstellungen (Grösse, Aussehen, Läufe zeigen, Freigaben zeigen, Mikrofon) →
13; davon im Blatt (zwei Gruppen, je mit Standard) Taste, Mikrofon, PC, Grösse, Aussehen, Pet, Läufe, Freigaben; Töne,
Pet-Name, Mit Windows starten, Sprache und Insel an bleiben, wo sie sind. Bedienelemente im Blatt 10 + Umschalter +
«Insel ausblenden».

Ausserhalb des Blatts: Töne (Knopf im Insel-Kopf wie heute, nicht doppelt im Blatt), Pet-Name (Pet-Menü), Mit Windows
starten und Insel oben anzeigen (Infobereich), Sprache (App: sie gilt auch für Sitzungen und ändert beim Kurz-Diktat
heute nichts, weil Schweizerdeutsch und Hochdeutsch beide `de` senden — `src/lib/voice/sprache.ts`).

Gestrichen:
- «Beim Darüberfahren öffnen» (Entscheid Chief: streichen): zweiter Weg zum selben Ziel; ein Klick öffnet die Insel. Wer es an hatte, hat es danach aus.
  Die Hülle nimmt `hoverOeffnen` von der App weiter an (ohne Wirkung), bis die App-Seite nachgezogen ist.
- Schalter «Diktat an»: geht in «Taste: Aus» auf.
- Infobereich: «Diktieren mit Strg rechts», «Diktat auf diesem PC» — nur noch im Blatt. «SPACE Pet anzeigen» bleibt im
  Infobereich, weil es dort das einzige Mittel ist, ein «bis ich es zurückhole» verstecktes Pet ohne offene Insel
  zurückzuholen (`insel.js:886`).
- Shift rechts als zweite Taste (Prüfer-Befund 1): 8 s gehalten öffnet Windows die Anschlagverzögerung, der Hook kann das
  nicht verhindern, und das Einfügen würde Strg+Shift+V. Wer keine rechte Strg hat (Copilot-Laptops), lässt «Strg rechts»
  an und diktiert mit dem Knopf an der Pille oder am Pet (freihand, gibt es schon). «Aus» heisst: gar kein Diktat, auch
  die Knöpfe nicht (`insel.js:747-748`).
- Doppelwörter entfernen (Befund 2): zerstört richtiges Deutsch («die die»).
- Sprache an der Insel (Befund 4): ändert beim Diktat nichts und würde Sitzungen still umstellen.
- Wort löschen an der Insel (Befund 7): ein × löscht für die ganze Firma; Löschen bleibt in der App.
- Nicht gebaut: Live-Text, Korrigieren und Senden per Stimme, Glätten mit Modell, Lage pro Bildschirm. (Mikrofon, Grösse
  und Aussehen kommen mit S7 — Korrektur Chief: Giannino will «mehr customizable, auch in der Insel selber».)

## Scheiben (je einzeln veröffentlichbar)

Reihenfolge nach Nutzen und Abhängigkeit: **S3-Web → S4 → S1 → S2 → S3-Desktop → S5 → S7**; S6 (Messen) freigegeben, nur
wenn Giannino > 5 Min. weg ist, sonst weggelassen und im Bericht gesagt. S3-Web: kein echter Dienst-Lauf (Entscheid Chief),
nur Double.
S3-Web, S4, S5 und S6 brauchen das Blatt nicht. S2 und S3-Desktop brauchen S1.

### S3-Web — Wörterbuch wirkt beim Diktat (nur Web, 0 Klicks)
- `src/lib/ai/voice.ts` `transcribeAudio` bekommt optional `userId` (gibt es schon in den Optionen) → Wörter aus
  `listWoerter(await woerterScopeFor(userId))`, im Prozess je Scope 5 Min. gemerkt (jede Sprach-Route nutzt diese
  Funktion; Chat, Kamera, WhatsApp profitieren mit).
- Whisper (OpenAI `whisper-1` und Swiss `transcribeSwissShort`, Azure OpenAI Whisper — `src/lib/ai/speech-ch.ts`):
  `prompt` als kurzer Satz «Namen und Begriffe: A, B, C.», höchstens ~200 Token, Reihenfolge wie `keytermsBegrenzen`.
  Als Echo (Diktat gilt als leer) zählt nur: das Ergebnis enthält «Namen und Begriffe» oder zwei und mehr Begriffe in der
  Reihenfolge des Prompts. Ein einzelnes diktiertes Wort aus dem Wörterbuch bleibt (Test).
- Sprache «Automatisch» (`sprachcode` null): nur die Begriffe ohne deutschen Satz, damit Whisper englische oder französische
  Diktate nicht ins Deutsche zieht (Test).
- Fällt `listWoerter`/`woerterScopeFor` aus: ohne Prompt transkribieren und loggen — das Diktat scheitert nie an der
  Wortliste. Der Cache gilt pro Server-Instanz; `POST /api/meetings/woerter` leert ihn in derselben Instanz, sonst wirkt
  ein neues Wort spätestens nach 5 Min. (im Bericht sagen).
- AssemblyAI-Kurzweg und Scribe: unverändert, im Bericht als «ohne Wörter» genannt (`word_boost` wirkt bei neueren Modellen
  nicht, `voice.ts:280`; `keyterms_prompt` braucht ein Modell, das der Kurzweg nicht setzt).
- Kosten: `prompt` kostet nichts extra (vor dem Bau in der Doku beider Dienste bestätigen und im Bericht
  verlinken; stimmt das nicht → Chief fragen).
- Tests: rein (Prompt-Bildung, Echo-Erkennung, Cache) mit Double. Ein echter Dienst-Lauf kostet Guthaben → nur mit Go von
  Chief, sonst «ungeprüft mit echtem Dienst».

### S4 — Füllwörter weg (nur Desktop, keine Einstellung)
- `regeln.js` `aufraeumen(text)`: entfernt alleinstehende «äh», «ähm», «öhm», «hm», «mhm» samt dem Komma, das sie
  abtrennt, und doppelte Leerzeichen; grosser Anfang bleibt gross. Sonst nichts.
- Gilt für beide Wege (App-Dienst und PC-Modell), vor `werfen`/`einfuegen`; `letztesDiktat` speichert den aufgeräumten Text.
- Tests: Tabelle mit ausgedachten Sätzen (keine Kundendaten), dazu Sätze ohne Füllwort, auch «die die», «das das»,
  «Hmmm» als Name im Satz → gleich wie vorher.

### S1 — Ein Blatt, Rechtsklick (nur Desktop)
- `insel/ui/insel-ui.js` + `insel.html`/`.css`: Ansicht `einstellungen` wird das Blatt «Diktat» (Zeilen oben). Zeile =
  Titel links, Wert rechts (Segment für Taste, Schalter für Pet/PC). «Standard» erscheint nur an einer Zeile, die vom
  Standard abweicht.
- Rechtsklick: Insel (`contextmenu` öffnet das Blatt statt `preventDefault`); Pille → neuer Kanal `pille:blatt` → main
  klappt die Insel auf (`insel:aufklappen`) und zeigt das Blatt; Pet-Menü «Einstellungen…» → dasselbe statt
  `/settings?tab=bot`.
- `insel.js`: neuer Schlüssel `taste: 'strgRechts' | 'aus'` in `STANDARD`. Migration beim Lesen: `diktat === false` → `taste:
  'aus'`; `diktat === true` und `taste === 'aus'` → `taste: 'strgRechts'` (die alte Version hat es wieder
  eingeschaltet; Test). Eine Quelle: jede Abfrage läuft über `diktatAn(e)` in `regeln.js` (heute direkt `einstellungen.diktat` in
  `insel.js:229,459,748`); der Block mit den Folgen (Aufnahme abbrechen, Taste zurücksetzen, Pille verstecken,
  `insel.js:823-828`) reagiert auf `taste`. `diktat` wird in `insel.json` mitgeschrieben, damit ein Zurück auf 1.0.15 das
  Diktat nicht wieder einschaltet. Test: `taste: 'aus'` versteckt die Pille und setzt die Taste zurück.
- Brücke und IPC (Befund 3): heute machen `insel:einstellung` (`insel.js:731-732`) und `insel:app-einstellung`
  (`main.js:338`) aus jedem Wert ein Boolean, und unbekannte Schlüssel werden abgewiesen. Neu:
  - `setzen('taste', 'strgRechts' | 'aus')` mit geprüfter Liste (rein in `regeln.js`: `einstellungPruefen(schluessel, wert)`).
  - `setzen('diktat', bool)` von der heutigen App-Seite → `taste` `strgRechts`/`aus`.
  - `setzen('hoverOeffnen', bool)` → angenommen, gespeichert, ohne Wirkung (die App-Seite zeigt keinen kaputten Schalter).
  - `spaceInselApp.version` 4 → 5 (`preload.js`); CLAUDE.md nennt heute v3 — mit v5 berichtigen.
  - Test: Aufrufe der v4-Seite (`diktat`, `hoverOeffnen`, `toene`, `pet`, `lokalDiktat`, `an`) gegen die neue Hülle.
- Pet-Zeile (Befund 8): zeigt `pet && pet.aktiv()`; einschalten setzt `petVersteckt: 0` (wie `insel.js:894`).
- Infobereich (`main.js` `trayMenue`): «Diktieren mit Strg rechts» und «Diktat auf diesem PC» weg.
- Web-Nachzug, eigener kleiner Schritt im Web-Repo nach S1: App-Seite zeigt «Taste» statt Schalter, «Darüberfahren» weg,
  Vertrag `lib/insel/desktop.ts` v5. Bis dahin läuft die alte Seite (siehe oben).
- Tests: `regeln.test.js` (Taste, Migration, Prüfung der Werte), `ruhig.test.js` unverändert grün.

### S2 — Letztes Diktat einfügen (nur Desktop, braucht S1)
- Gibt es halb: `letztesDiktat` + Kanal `pille:nochmals` (`insel.js:424,779,800`, `preload.js:31`), ohne Oberfläche und ohne
  Ablauf. Neu: Ablauf nach 10 Min. (`letztesDiktatGueltig(gemerktUm, jetzt)` rein in `regeln.js`), nie auf Platte.
- Zeile oben im Blatt «Letztes Diktat einfügen» (nur Titel) und Eintrag im Pet-Menü. Klick → Blatt zu, die Insel gibt den
  Fokus ab (`insel:fokus` false, `insel.js:672` — wichtig, weil das Wörter-Feld in S3 den Fokus nimmt), dann der
  bestehende Weg `einfuegen()`.

### S3-Desktop — Wörter an der Insel (braucht S1)
- Zeile «Wörter»: die ersten Wörter als ruhige Liste, «+N» öffnet die Wörterbuch-Seite der App; Feld «Wort hinzufügen»
  → `POST /api/meetings/woerter` über die App-Session. Kein Löschen an der Insel.
- Das Feld holt sich den Fokus wie das Namensfeld des Pets (`pet:fokus`); Enter oder Klick daneben gibt ihn zurück.
- Diktat auf diesem PC: Wörter im System-Prompt nur, wenn das Web-Repo `lib/lokal` mitzieht (1:1-Regel) — sonst in dieser
  Scheibe weglassen und im Bericht nennen.

### S5 — Insel seitlich ziehen (nur Desktop)
- Ziehen an der kompakten Insel: erst ab 6 px Bewegung ist es Ziehen, darunter ein Klick. Main bewegt das Fenster im Poll
  wie beim Pet, nur waagrecht, geklemmt in den Arbeitsbereich des Hauptbildschirms (die Insel nutzt nur
  `getPrimaryDisplay()`). Lage `inselX` (Anteil 0–1) in `insel.json`; der versteckte Streifen folgt.
- Tests: `inselRahmen` mit Anteil (rein).

### S6 — Messen (vor jeder Änderung am Mikrofon)
- «Taste bis Pegel» und «Loslassen bis Text» mit eigenem Profil, nur wenn Giannino nicht am Rechner ist, Freigabe Chief.
  Über 200 ms bis Pegel → eigener Vorschlag (nie ein dauernd offenes Mikrofon).

### S7 — Anpassen an der Insel (nur Desktop, braucht S1; Entscheid Chief 25.11.2026, Prüfung Runde 1 eingearbeitet)

Im selben Blatt zwei Gruppen, je eine Ansicht: Umschalter «Diktat | Insel» im Kopf des Blatts (das Panel ist 320 px hoch,
9 Zeilen + Titel passen nicht übereinander; ein nie fokussiertes Fenster scrollen ist ungeprüft). «Diktat»: Letztes Diktat,
Taste, Mikrofon, Wörter, Diktat auf diesem PC. «Insel»: Grösse, Aussehen, Zeigt (Pet · Laufende Arbeit · Freigaben).
Bedienelemente: 10 (Letztes Diktat 1, Taste 1, Mikrofon 1, Wörter-Feld 1, PC 1, Grösse 1, Aussehen 1, Zeigt 3) + Umschalter
+ «Insel ausblenden». «Standard» nur an Einstellungen (Taste, Mikrofon, PC, Grösse, Aussehen, Zeigt), nicht an «Letztes
Diktat» (Handlung) und «Wörter» (Inhalt). Die Zeile «SPACE Pet» aus S1 geht in «Zeigt» auf; gespeichert bleibt der Schlüssel
`pet` (die App ruft `setzen('pet')` seit v3).

- **Grösse** (`inselGroesse: 'klein' | 'normal' | 'gross'`, Standard normal; Faktor 0,85 / 1 / 1,2): NICHT über
  `setZoomFactor` — Chromium zoomt je Host, und Insel, Pille, Pet und Wurf laden alle `file://` in der Session `insel`.
  Stattdessen CSS-Faktor nur in `insel.html` (`--groesse` auf `<html>`, `zoom`), Fenster PANEL × Faktor (`Math.round`).
  Main rechnet die Trefferflächen beim Eintreffen (`insel.js` `kanal('insel:flaechen')`) einmal in Fenster-px um
  (`flaecheSkalieren` rein in `regeln.js`); damit stimmen Poll, `ZIEH_RAND` und Aussen-Klick. `insel:zeiger` wird durch den
  Faktor geteilt. Der Weck-Streifen bleibt unskaliert (300×10). Nach jedem Laden und nach `render-process-gone` setzt die Seite
  den Faktor aus den Einstellungen neu. Arbeitsbereich < 1280 px: «gross» wird «normal». Sichtprüfung: `getBoundingClientRect`
  mit CSS-`zoom` im Demo-Modus messen; diese eine Messung entscheidet Flächen UND Zeiger zusammen (Chromium ab 128 rechnet
  `zoom` standardisiert; liefert `getBoundingClientRect` schon Fenster-px, fallen beide Umrechnungen weg). `--groesse` gilt nur,
  solange das Panel offen ist (sonst wüchse der Griff im 300×10-Streifen mit).
- **Aussehen** (`inselAussehen: 'app' | 'hell' | 'dunkel'`, Standard app): Quelle ist `data-theme` auf `<html>` der App-Seite
  (`liquid-glass` = hell, `dark` = dunkel; «Automatisch» löst die App selbst schon in einen der beiden Werte auf —
  `src/lib/theme/provider.tsx`), nicht die gemessene Titelleiste (40×28 px, nicht bei verstecktem Fenster). `preload.js`
  beobachtet das Attribut schon (`titlebar-resync`) und sendet neu den Wert selbst per IPC `app:aussehen` — einmal beim
  `DOMContentLoaded` (das Inline-Skript setzt ihn vorher) und dann bei jeder Änderung, nur `dark` oder `liquid-glass`; main nimmt ihn nur
  von App-Origin (wie `connector:*`); main speichert den letzten
  Wert in `insel.json` (`appAussehen`). Noch kein Wert (Start im Hintergrund): `nativeTheme.shouldUseDarkColors`. Main
  schickt `insel:aussehen` an Insel, Pille, Pet und Wurf; die Seiten setzen `data-aussehen` auf `<html>`; hell = zweiter Satz
  Farb-Tokens in `insel.css`, `pille.css`, `pet.css`, `wurf.css` (Kontrast ≥ 4,5:1 nachgerechnet). Der Helm bleibt gleich.
- **Zeigt** (`pet` wie heute, `zeigtLaeufe`, `zeigtFreigaben`, Standard alle an): gefiltert wird nur die Kopie für die
  Insel-Fenster, nach `beiLage` (`lageFuerInsel(l, zeigt)` rein in `regeln.js`); der Infobereich nimmt weiter die volle
  Lage — das bernsteinfarbene Symbol bleibt bei Freigaben immer; dafür liest `beiLage` in `main.js` neu
  `lage.freigabenZahl` statt `lage.freigaben.length` (Symbol und Tooltip, Test: Freigaben aus, Zahl > 0 → bernstein).
  Gefiltert wird nach `lageMitApp`, an allen drei Stellen, die die Lage senden (`lageSenden` und beim Laden von Insel und
  Pille, `insel.js` `did-finish-load`) über eine Hilfe `lageFuerFenster()`; «Laufende Arbeit» aus blendet auch «Antwort im Chat» und die fertigen Läufe aus.
  Abfragen: `/api/runs/laufend` läuft immer (ausser Steno, wie heute; billig, trägt die Zahl der Freigaben); `/api/approvals` nur, wenn `zeigtFreigaben` an ist und Freigaben offen sind
  (`lageAbfragen(zeigt, zahl)` rein, Test). Freigaben aus → keine Karte, die Insel klappt bei einer Freigabe nicht auf.
- **Mikrofon** (`mikrofon: null` = Standard des Systems, sonst `{ id, name }`): Liste aus `enumerateDevices()` im
  Insel-Fenster; Pseudo-Geräte `default` und `communications` gehen in «Standard» auf; ohne Namen (keine Erlaubnis) «Mikrofon
  1, 2 …». Die Pille nimmt `deviceId: { exact: id }`; fehlt die ID, sucht sie das Gerät über den Namen und speichert die neue
  ID (IDs sind je Session gesalzen); `OverconstrainedError` → einmal ohne `deviceId` (Standard), die Zeile zeigt «Headset
  (nicht verbunden)». `devicechange` aktualisiert. Kein Probe-Pegel im Blatt. Namen bleiben lokal in `insel.json`.
  `enumerateDevices` öffnet kein Mikrofon (`ruhig.test.js` unberührt). S6 misst den Start mit gewähltem Gerät mit.
- Brücke `spaceInselApp`: `fuerApp` macht heute alles zu Boolean (`insel.js` `fuerApp`); die neuen Text-Schlüssel bekommen
  eine eigene, nur lesbare Ausgabe.
- Tests: `regeln.test.js` (Werte prüfen, `flaecheSkalieren`, Klemmen, `lageFuerInsel`, `lageAbfragen`), `ruhig.test.js` grün,
  Sichtprüfung beider Aussehen und aller Grössen im Demo-Modus. CLAUDE.md: Weck-Streifen 300×10 (dort steht noch 240×6).

## Später entscheiden (nicht bauen, Entscheid Chief)

**Live-Text beim Sprechen.** Aufwand: Streaming-Transkription über einen Server-Token (WebSocket), Teiltext in der Pille,
am Ende einfügen; rund 4–6 Tage Desktop + Web, plus Mundart-Prüfung. Kosten je Diktat (30 s): rund 0,1–0,3 Rappen bei
AssemblyAI-/OpenAI-Streaming (Listenpreise aus dem Gedächtnis, vor Entscheid prüfen) — ähnlich wie heute, aber jede
Sekunde Halten kostet, auch ohne Text. Diktat auf diesem PC: Live geht mit LFM3 nicht (kein Streaming-Hören).

**Glätten mit Modell.** Aufwand: ein Modell-Lauf nach der Transkription (Kommas, Grossschreibung, Satzbau, ohne Inhalt zu
ändern), Schalter «Glätten» im Blatt, Prompt-Test; rund 2 Tage Web + 1 Tag Desktop. Kosten je Diktat (~150 Wörter, ~1000
Token rein, ~250 raus) mit Claude Haiku 5.5 ($0.10 / $0.50 pro Mio. Token): rund 0,02 Rappen; bei «Eigenes Claude-Abo»
gratis. Dazu 0,5–1,5 s mehr Wartezeit nach dem Loslassen. Tests nur über Abo (Regel 21.11.).

## Gestaltung des Blatts

Gleiche Sprache wie die Insel (`insel.css`: `--karte`, `--ink`, Segoe UI Variable, dunkles Glas). Kein neues Farbsystem.
Das eine, das man sich merkt: die Taste als kleine Tastenkappe «Strg» mit leichtem Rand unten, nicht als Text. Sonst
ruhig: Zeilen ohne Karten-in-Karten, Wert rechtsbündig, kein Grossbuchstaben-Label, keine Nummern.

```
┌ Diktat ─────────────────────────────────────── ✕ ┐
│ Letztes Diktat einfügen                        ↵  │  (nur wenn da)
│ Taste                               [Strg]   Aus  │
│ Wörter   Huber Treuhand  Tremola  +3   Wort dazu  │
│ SPACE Pet                                  (●  )  │
│ Diktat auf diesem PC                       (●  )  │
│ Zu Text durch … · Schweiz       Insel ausblenden  │
└───────────────────────────────────────────────────┘
```

Höhe: heute 228 px (+40 mit «Diktat auf diesem PC»); 5 Zeilen passen in dieselbe Höhe.

## Annahmen und Risiken

- Whisper `prompt` steuert die Schreibweise, ist aber kein Versprechen; kurz halten, nur Wörter.
- Azure-Whisper nimmt `prompt` (vor dem Bau in der Azure-Doku bestätigen).
- Brücke v5 läuft mit der heutigen App-Seite (Abnahme 6, Test in S1).
- Neuer Text in der Oberfläche auf Deutsch, Code-Kommentare Englisch.

## Prüfung

- Desktop: `npm test` (regeln, ruhig, paket) grün.
- Web (S3-Web): `npm run pruefen -- --tsc` im Web-Worker, Jest der betroffenen Dateien.
- Sichtprüfung im Demo-Modus der Seiten (agent-browser, eigene Sitzung): Blatt in jeder Variante, Bild vorher/nachher.
- Ein Lauf `electron . --dev` mit `SPACE_USER_DATA` (eigenes Profil mit `"taste": "aus"`, damit die rechte Strg von Giannino
  nicht mithört) für Rechtsklick, Pet-Menü und Ziehen — nur wenn er nicht am Rechner ist.
- Film (Abnahme-Paket) je Scheibe mit sichtbarer Änderung.
