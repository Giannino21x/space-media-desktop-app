# Plan: Treffen vor Ort, Diktat und Steno nach dem Vorbild aus dem Reel (25.11.2026)

Anlass: Giannino 25.11.2026: «Steno und Diktieren: das muss rein, mit Engineer Anything genau nachbauen.» Dazu: «Sauber,
dass es dann mobile auch perfekt ist.» Vorbild ist ein Reel (Instagram, 21.11.2026, bezahlte Partnerschaft). Es zeigt
Wispr Flow «Notetaker» am iPhone mit einem Connector zu Claude. Meldung mit Standbildern: `D:\sme-arbeit\reel\meldung-reel.md`.
Auftrag Chief: Item 259.

Vorgaben von Chief:
- Reihenfolge nach dem Nutzen für ein Treffen vor Ort am Handy.
- Je Fläche sagen, was die Person sieht und tut.
- Klar trennen: was eine neue Handy-Hülle braucht und was sofort über die Web-App geht.
- Die Aufnahme bei gesperrtem iPhone ist die riskanteste Stelle.
- Der Plan «Live-Text» (`docs/plans/2026-11-25-live-text.md`, APPROVED) geht hier ein.

Status: geprüft in drei Runden; nach Runde 3 laut Prüfer APPROVED (Log unten). Wartet auf Entscheid Chief. Die Prüfung macht ein frischer Claude-Prüfer (claudex-loop, Codex erst ab 28.11.), Log unten. Kein Code.

## Was das Reel zeigt (nur beobachtet)

1. In der App steht oben «Coming up» mit dem nächsten Termin. Ein runder Knopf startet die Aufnahme.
2. Die Aufnahme öffnet ein Blatt von unten. Der Text erscheint live, unten stehen Zeit und Termin, daneben ein Stopp-Knopf.
3. Bei gesperrtem iPhone läuft die Aufnahme weiter. Im Sperrbildschirm steht ein kleines Zeichen dafür.
4. Nach dem Stopp kommt eine Mitteilung «Note ready», darunter eine Zeile mit dem Entscheid und eine mit dem nächsten Schritt.
5. Beim Hinausgehen diktiert die Person mit einem Tipp eine «Notiz an mich» («Ich schulde: das Deck / Für: den Kunden»).
6. Am Mac fragt sie Claude: «Was habe ich zugesagt?» Die Antwort lautet «Das Deck, das du schicken wolltest».

## Was es bei uns schon gibt (Code origin/dev, 25.11.2026)

| Schritt | Heute | Stelle |
|---|---|---|
| Nächster Termin | Karte «Jetzt» auf «Heute», am Handy und am Desktop. Zustände: vorbei / Diktat fehlt, läuft, in X Min. Daneben der Knopf «Jetzt diktieren» mit Termin. «Vorbei» kommt vor «läuft» | `m2/steno/StenoHeute.tsx:50,83,132–139`, `components/steno/StenoHeuteDesktop.tsx:51`, `lib/m2/jetzt.ts:48–56` |
| Start vor Ort | `DiktatBlatt`: Termin, Vorlage, «Ganze Sitzung» mit Einwilligung. Die Einwilligung wird je Sitzung gespeichert (`einwilligung: 'verbal_at_start'`) | `m2/steno/DiktatBlatt.tsx:46–61,167,398,415,483–507` |
| Aufnahme | Status, Titel, Zeit, Pegel, Pause, Fertig; Hinweis «Lass Steno offen, der Bildschirm bleibt an»; **kein Live-Text** | `DiktatBlatt.tsx:556–640,610–612` |
| Web-Weg | Wake Lock, alle 30 s ein Teil hoch, Warteschlange in IndexedDB | `lib/…/useRecording.ts:4–9,155,171` |
| Hülle-Weg | Setzt die Hülle `data-native-aufnahme="1"`, nimmt die Seite **immer** nativ auf (`kannImHintergrundAufnehmen()`) | `useRecording.ts:378` |
| Gesperrt iOS | `NativeAufnahme.swift` (AVAudioRecorder, Teile alle 30 s, Fertig in der Dynamic Island, Reste beim Neustart), Live Activity, `UIBackgroundModes audio` | Hülle 1.0.6 (TestFlight). **Nicht im Store:** Das Tag `ios-1.0.5` hat weder `NativeAufnahme.swift` noch `NativePush.swift` |
| Notschalter | `HUELLE_NIMMT_AUF` steht in CLAUDE.md, ist aber **nicht** in `src/` | – |
| Gesperrt Android | **nicht möglich**: kein Foreground-Service, nur `RECORD_AUDIO` | `AndroidManifest.xml:35–37` |
| Mitteilung | Server-Text «{Vorlage} bereit: {Titel}» mit der Zahl der Pendenzen und Entscheide; Versand über Web Push und APNs (`sendNativePush`) | `lib/meetings/extract.ts:318–323,600`, `lib/notifications/create.ts:102–125` |
| APNs am iPhone | erst mit Hülle 1.0.6 (`NativePush.swift`) | – |
| Android-Push | **fehlt** (kein FCM) | `mobile/package.json` |
| Protokoll | `decisions`, `pendenzen`, `naechste_schritte`, `folge_mail` | `lib/meetings/dokument-vertrag.ts:394–414` |
| Pendenzen → To-dos | nur `source_type = 'meeting'`. «Ich» gilt nur für die Person, der die Sitzung gehört (`pendenzPerson`). Felder `assignee_email` / `assignee_name`, kein `wer` | `lib/todos/pendenzen-todos.ts:220`, `types/pendenzen.ts` |
| Notiz an mich | keine eigene Art; am nächsten kommt die Vorlage «Aktennotiz» | `DiktatBlatt.tsx:49` |
| Bot | `SPACE_SITZUNGEN_LIST` (Suche nur im Titel, `:66`), `SPACE_SITZUNG_LESEN`, `SPACE_TODO_LIST` (nur Tabelle `todos`) | `bot/capabilities/sitzungen.capability.ts:60–100`, `dashboard.capability.ts:115–126,324` |
| Insel | holt nur `/api/profile`, `team`, `runs/laufend`, `approvals`, `voice/*`, `mail/send`, `meetings/woerter`; keinen Kalender, keine Sitzungsinhalte | `insel/insel.js` |
| Hülle-Knopf | Hülle 1.0.6 hat den runden Diktier-Kreis unten rechts (`placement: trailing`) | CLAUDE.md, iOS 1.0.6 |

## Was Hülle braucht und was Web allein kann

| Teil | Nur Web-App (sofort live nach Push auf main) | Braucht neue Hülle |
|---|---|---|
| 1 Start mit einem Tipp | Karte und Knopf in Safari und in jeder Hülle | Kreis der Hülle als Start: geht mit 1.0.6, keine neue Hülle |
| 2 Aufnahme gesperrt, iOS | – | **ja: Hülle 1.0.6 muss durch die App-Store-Prüfung.** Vorher Gerätetest in TestFlight |
| 2 Notschalter | ja (Konstante bzw. `NEXT_PUBLIC_*`, wirkt nach einem neuen Deployment, siehe Teil 2) | – |
| 2 Aufnahme gesperrt, Android | – | **ja:** Foreground-Service, neues AAB, Play von Hand |
| 3 Text der Mitteilung | ja (Server) | APNs am iPhone erst mit 1.0.6 im Store; bis dahin nur Web Push und die Glocke |
| 3 Android-Push | – | **ja:** FCM, neues AAB |
| 4 Notiz an mich | ja | – |
| 5 Bot «Was habe ich zugesagt?» | ja | – |
| 6 Live-Text Handy | nur in Safari ohne Hülle | in der Hülle siehe Teil 6, Entscheid nötig |
| 6 Live-Text Insel | – | neuer Desktop-Release (Auto-Update, keine Store-Prüfung) |

## Teile in der Reihenfolge von Chief

Jeder Teil hat drei Flächen: **Insel** (Desktop-Hülle Windows), **Web Desktop** (1440 px), **Handy** (Web bei 390 px und die
Hülle). Bilder für die Abnahme macht Playwright gegen den Dev-Server mit Fixture-Sitzung, bei 390 und 1440, hell und dunkel,
abgelegt im Web-Repo unter `docs/reviews/2026-11-25-treffen/<teil>/`.

### 1. Start mit einem Tipp vom nächsten Termin

- **Welcher Termin:** Ein neuer reiner Selektor `aufnahmeTermin(events, diktiert, jetzt)` mit eigenem Test liefert nur einen Termin, der läuft oder in 15 Minuten beginnt. Er ist unabhängig von `jetztKarte`, denn dort kommt «vorbei» vor «läuft» (`lib/m2/jetzt.ts:50–56`). Ein vergangener Termin ohne Diktat behält seinen heutigen Knopf «Jetzt diktieren», bekommt aber keinen Aufnahme-Knopf. Läuft daneben ein anderer Termin, hat dieser trotzdem den Aufnahme-Knopf. So landet eine neue Aufnahme nie unter einem alten Titel.
- **Handy, Hülle 1.0.6:**
  - Der runde Kreis unten rechts startet direkt «Ganze Sitzung» zum laufenden oder baldigen Termin. Er sitzt im Daumenbereich.
  - Ohne Termin startet er wie heute das Diktat.
  - Im Web ist das eine Änderung, was der Kreis-Tipp tut. Der Tipp kommt über `__nativeNavigate` und dann `aktionAusloesen` (`components/m2/blaetter.ts:45`, `NativeChromeBridge.tsx:351`). Die Hülle bleibt gleich.
- **Handy, Web (Safari, ältere Hülle):** Die Karte «Jetzt» bekommt einen runden Aufnahme-Knopf. Am Handy liegt sie als schwebender Knopf unten über der Tab-Leiste, nicht oben in der Karte.
- **Einwilligung, jedes Mal:**
  - Ein kurzes Blatt fragt: «Alle einverstanden mit der Aufnahme?» Grundlage: StGB 179ter, wie heute bei «Ganze Sitzung».
  - Bei Ja startet die Aufnahme. Die Einwilligung wird wie heute je Aufnahme gespeichert (`einwilligung`) und nie auf die nächste Aufnahme übertragen.
  - Weg von heute: vier Schritte (Jetzt diktieren, Ganze Sitzung, Einwilligung, Mikrofon). Neu: zwei Tipps (Knopf, Ja).
- **Titel und Vorlage:** Der Titel ist der Termin, die Vorlage «Protokoll». Eine Regel wie «Kunde → Besuchsbericht» gibt es nicht: Termine kennen keinen Kunden.
- **Tastatur:** Das Blatt hat kein Textfeld, es öffnet sich also keine Tastatur.
- **Web Desktop:** `StenoHeuteDesktop` zeigt dieselbe Karte mit demselben Knopf, bedient mit der Maus.
- **Insel:**
  - Neu holt die Insel den nächsten Termin über die neue Route `GET /api/m2/steno/jetzt` im selben 5-Min.-Takt wie `/api/profile`.
    - Die Route nutzt den Selektor `aufnahmeTermin` und gibt Titel, Beginn und `meetLink` zurück (`types/calendar.ts:30`).
    - Dazu kommt das Feld `letzteFertig: { id, titel, entschieden, alsNaechstes }` für Teil 3.
    - `/api/m2/steno/heute` lässt den Kalender bewusst weg (`heute/route.ts:3`), deshalb braucht es eine eigene Route.
  - Steht ein Termin ohne Meeting-Link in 10 Minuten an, zeigt die Insel «Kaffee mit Kunde · in 10 Min.» und «Aufnehmen».
  - Der Knopf öffnet das Blatt in der App, die Insel nimmt nicht selbst auf.
- **Abnahme:**
  - Bilder 390 und 1440 von «Heute» in vier Lagen: mit laufendem Termin, mit nur einem vergangenen Termin (kein Aufnahme-Knopf), «vorbei» und «läuft» zugleich (Knopf beim laufenden), ohne Termin. Dazu das Bild während der Aufnahme.
  - Der Playwright-Test zählt 2 Tipps bis «läuft».
  - Der Knopf liegt bei 390×844 in den unteren 40 %.
  - Die gespeicherte Einwilligung steht im Datensatz.

### 2. Aufnahme sicher, auch gesperrt (riskanteste Stelle)

- **Stand:** Jede Person mit TestFlight 1.0.6 nimmt **schon heute** nativ auf (`useRecording.ts:378`). Am echten iPhone ist das nicht geprüft.
- **Zuerst ein Notschalter (Web, ½ Tag):**
  - Er betrifft nur den **Start**. Neu ist `nativStartErlaubt()` im Start-Zweig (`useRecording.ts:378`).
  - `kannImHintergrundAufnehmen()` bleibt unverändert, denn es steuert auch Pause, Weiter, Stopp, Nochmal, Verwerfen und Stand einer laufenden nativen Aufnahme (`native-recorder.ts:71,78`, `useRecording.ts:477–714`). Würde es false liefern, liesse sich eine laufende Aufnahme nicht mehr stoppen, und Teile auf dem iPhone kämen nie hoch.
  - Eine Flag-Mechanik gibt es in `src/` nicht. Darum dient eine Konstante bzw. `NEXT_PUBLIC_HUELLE_NIMMT_AUF`; das Umschalten braucht ein neues Deployment (wenige Minuten).
  - Bei Schalter aus startet die Seite auch in der Hülle über den Web-Weg (Wake Lock, Hinweis, Teile alle 30 s).
  - Test:
    - Bei Schalter aus nimmt der Start den Web-Weg.
    - `stopp` und `nochmal` erreichen die Hülle weiterhin.
- **Gerätetest durch Giannino (TestFlight 1.0.6), je 30 Minuten:**
  1. Mit gesperrtem Bildschirm. Ton über die ganze Länge, alle Teile auf dem Server.
  2. Mit einem Anruf mittendrin.
  3. Mit 5 Minuten Flugmodus. Die Teile sollen danach nachkommen.
  4. App in der App-Auswahl wegwischen.
  5. iPhone mitten in der Aufnahme neu starten.

  Schlägt etwas fehl: Notschalter an, Fehler in der Hülle beheben, neuer TestFlight-Build. Erst wenn alles grün ist, geht 1.0.6 in die App-Store-Prüfung.
- **Handy, Web ohne Hülle:** Hier bleibt es wie heute. Wake Lock, Teile und Hinweis sind schon da (`DiktatBlatt.tsx:610–612`). Neu ist nur ein Satz: «Nicht sperren, sonst stoppt die Aufnahme». Die heutige Zeile sagt das nicht ausdrücklich.
- **Handy, Android (Teil 2b, eigener Build):** Foreground-Service mit der Mitteilung «Aufnahme läuft», dazu die Rechte `FOREGROUND_SERVICE_MICROPHONE` und `POST_NOTIFICATIONS` und eine native Aufnahme wie unter iOS.
- **Web Desktop / Insel:** Hier ändert sich nichts.
- **Abnahme:**
  - Notschalter-Test grün (Web).
  - Protokoll aus 30 Minuten Aufnahme bei gesperrtem iPhone: Die Dauer im Dokument entspricht der Aufnahme ± 1 Min. Das kann **nur Giannino** am Gerät prüfen. Ich kann den Simulator kompilieren (`ios-pruefen.yml`) und die Teile-Logik gegen einen Test-Server prüfen.

### 3. Mitteilung mit Entscheid und nächstem Schritt

- **Server (Web):** Die Push-Nachricht «Protokoll bereit» bekommt zwei Zeilen statt der Zahlen:
  - «Entschieden: Pilot startet im Januar»: der erste Eintrag aus `decisions`.
  - «Als Nächstes: Kunde schickt Brand-Guide»: die erste eigene Pendenz, sonst die erste Zeile aus `naechste_schritte`.
  - Jede Zeile ist höchstens 80 Zeichen lang. Ein Tipp öffnet die Sitzung.
- **Sperrbildschirm und Datenschutz:** iOS zeigt die Vorschau von Haus aus immer. Die zwei Zeilen stehen also offen auf dem Sperrbildschirm und laufen über Apple (APNs) bzw. über Google und Mozilla (Web Push). Darum:
  - **Nur mit Einwilligung:** Die Person schaltet «Inhalt in Mitteilungen zeigen» ein. Von Haus aus ist es aus.
  - Bei «Nur Schweiz» und «Sichere Cloud» ist der Schalter gesperrt. Dort bleibt die Zeile mit den Zahlen.
  - Wo es gebaut wird:
    - `extract.ts` kennt die Option (`provider`, Z. 153) und baut beide Texte: den vollen für die Glocke und den für den Push (mit Inhalt oder nur mit Zahlen).
    - `CreateNotificationParams` bekommt ein optionales `pushBody`. `create.ts:104–123` schickt es an Web Push und APNs, die Glocke behält `body`.
    - Der Schalter liegt als neue Spalte im Profil, mit Migration, und erscheint unter Einstellungen → Mitteilungen.
- **Handy iOS:** APNs erst mit Hülle 1.0.6 im Store. Vorher gibt es in Safari und in der Store-Hülle Web Push (wenn erlaubt) und die Glocke.
- **Handy Android:** Bis Teil 3b (FCM) gibt es nur die Glocke in der App.
- **Web Desktop:** Die Glocke zeigt dieselben zwei Zeilen, ebenso «Protokoll bereit» im Faden. In der eigenen App gelten sie immer, unabhängig vom Schalter.
- **Insel:** Neu holt sie Titel und die zwei Zeilen der letzten fertigen Sitzung (derselbe neue Endpunkt wie in Teil 1). «Protokoll bereit» in der Insel zeigt sie.
- **Abnahme:**
  - Ein reiner Test für den Text: Entscheid, Pendenz, beides leer, zu lang, Umlaute, Schalter aus, Schweiz-Option.
  - Ein Test, der die mitgeschnittenen Nutzlasten von `sendWebPush` und `sendNativePush` prüft: Bei Schalter aus zeigt die Glocke den Inhalt, der Push nur die Zahlen.
  - Bilder der Glocke bei 390 und 1440.
  - Bild der Insel aus den Demo-Daten.
  - Glocke in der Android-Hülle (Rückfall) bei 390.
  - Ungeprüft bleibt das Aussehen auf dem echten Sperrbildschirm.

### 4. Notiz an mich als Pendenz

- **Daten:** Jede Notiz legt eine Zeile in `meetings` an. Die Art ist neu (`modus: 'notiz'` oder eine eigene Vorlage) und erzeugt kein Protokoll. Damit greifen `source_type = 'meeting'` und `pendenzPerson` ohne Änderung, denn die Notiz gehört der Person.
  - Daraus werden ein bis drei Pendenzen, Feld für Feld:
    - `todo`: was
    - `assignee_email` / `assignee_name`: die Person selbst
    - Text «für …»: für wen
    - Frist: bis wann
  - Sie erscheinen von selbst in den To-dos.
  - Die Notiz hängt am Termin, wenn er gerade lief oder in den letzten 2 Stunden vorbei war. Dann zeigt die Sitzung des Termins sie unter «Notizen». Sonst steht die Notiz allein, in der Liste der Sitzungen leise (eigene Kennzeichnung).
  - Folgen der neuen Art, alle im selben Teil:
    - **Migration:** `document_template` / `capture_mode` haben CHECK-Regeln (`supabase/migrations/20260929_meeting_templates.sql:21–27`). Die Art `notiz` muss dort hinein.
    - **Status:** Eine Notiz hat weder Ton noch Protokoll. `dokStatus` gäbe heute `leer` oder `schreibt` (`lib/meetings/dok-status.ts:125–133`). Nötig ist ein eigener Status `notiz`, und «Heute» sowie «Dokumente» (`/api/m2/steno/heute`, `dokumente`) zeigen sie nie als hängend.
    - **Zählung:** Notizen zählen nie als Protokoll. Das betrifft die Erinnerung in der Probezeit (`lib/billing/probezeit-erinnerung-lauf.ts:269`) und `tag30` (`:47`). Dort kommt ein Filter auf die Art dazu.
    - **Cron:** `auto-finalize` fasst nur Zeilen mit `audio_last_chunk_at` an (`:81–86`). Die Notiz setzt dieses Feld nie, so bleibt sie draussen; ein Test hält das fest.
    - **Termin:** Die Notiz ist über `source_event_id` mit dem Termin verknüpft. `proTermin` / `diktiert` (`heute/route.ts:31–36`, `StenoHeute.tsx:56`) und `aufnahmeTermin` zählen Zeilen der Art `notiz` nicht mit. Sonst gälte der Termin als diktiert, und der Aufnahme-Knopf oder «Diktat fehlt» verschwände.
- **Einwilligung:** Keine Abfrage, weil nur die Person spricht. Das Blatt sagt: «Nur du sprichst. Sind andere in Hörweite, warte kurz.»
- **Handy:**
  - Nach dem Stopp einer Aufnahme zeigt das Ende-Blatt «Notiz an mich».
  - Auf «Heute» steht ein zweiter, kleiner Knopf.
  - Ein Tipp startet, ein zweiter Tipp beendet.
  - Danach steht da: «Zusage: Deck schicken · für Kunde · bis Freitag», mit «Rückgängig».
- **Web Desktop:** Derselbe Knopf steht in der Sitzung und in den To-dos.
- **Insel:**
  - Neu gibt es den Eintrag «Notiz an mich» im Pet-Menü und im Panel der Insel.
  - Die Pille nimmt auf. Der Text wird **nicht eingefügt**, sondern geht an die App (neue Route `POST /api/notizen`).
  - Die Insel zeigt die Zusage. Eine eigene Taste gibt es nicht.
- **Abnahme:**
  - Ein reiner Test, der die Zusagen aus Beispielsätzen liest, mit einem Double statt des echten Modells.
  - Die Pendenz erscheint in `GET /api/todos` als `pendenz:<id>`.
  - In «Heute» und «Dokumente» erscheint die Notiz nie als «schreibt» oder «leer».
  - Die Probezeit-Zählung zählt die Notiz nicht (Test).
  - Eine Notiz am laufenden Termin lässt den Aufnahme-Knopf stehen; ein vergangener Termin behält «Diktat fehlt» (Test).
  - Bilder 390 und 1440.

### 5. Bot: «Was habe ich zugesagt?»

- Neue Fähigkeit `SPACE_ZUSAGEN`:
  - Sie liefert offene Pendenzen der Person (dieselbe Regel wie `pendenzPerson`) aus allen Sitzungen und Notizen.
  - Filter: Zeitraum, Text (in `todo` und im Sitzungstitel), offen oder erledigt.
  - Jede Zeile nennt die Quelle: Sitzung, Datum und Link.
- `SPACE_TODO_LIST` zeigt neu auch die Pendenz-To-dos (heute fehlen sie, `dashboard.capability.ts:324`).
- **Alle Flächen:** Die Frage geht im Chat: am Handy, im Web und über «Im Chat fragen» an der Insel.
- **Abnahme:**
  - Test der Fähigkeit mit Fixture-Daten: zwei Sitzungen, eine Notiz, Pendenzen anderer erscheinen nicht.
  - Antwort des Bots gegen eine Attrappe des Modells.
  - Bilder 390 und 1440 vom Chat.

### 6. Live-Text

- **Insel:** Plan `docs/plans/2026-11-25-live-text.md`, Stufe 1. Der Live-Text läuft über Scribe Live mit dem Socket im Main-Prozess. Den Token holt die Insel erst nach 0,28 s, sonst nimmt sie den heutigen Weg. Gilt nur bei «Standard».
- **Handy:** In der Hülle 1.0.6 gewinnt immer der native Weg (`useRecording.ts:378`). Live-Text gibt es heute also nur in Safari. **Entscheid für Chief:**
  - (a) In der Hülle kein Live-Text. Das ist mein Vorschlag: Sicherheit beim Sperren geht vor.
  - (b) Die Seite nimmt bei offenem Bildschirm den Web-Weg mit Live-Text. Dann ist die Aufnahme beim Sperren nicht mehr sicher.
  - (c) Die Hülle streamt den Ton zusätzlich an die Seite. Dafür braucht es neue Hülle-Arbeit und eine App-Store-Prüfung.
- **Handy in Safari und Web Desktop:** Bei «Ganze Sitzung» ist der Live-Text eine Option, die von selbst aus ist. Er kostet bei Scribe 0,22 USD/h zusätzlich zu AssemblyAI für das Protokoll.
- **Datenschutz:** Bei «Nur Schweiz» gibt es keinen Live-Text. Er käme erst mit Stufe 3 des Live-Text-Plans (Azure CH).

## Clean room und craft-anything

- **Nur beobachten:** Wispr Flow sehen wir nur auf den Bildern aus dem Reel. Nichts wird installiert, nichts ausgepackt, kein Konto angelegt.
- **Nichts übernehmen:** kein Code, kein Logo, kein Bild, kein Ton, kein Text, kein Name. Figuren, Farben und Wörter sind unsere (SPACE, Steno, Pendenz).
- **Was craft-anything misst** (Modus Clean room):
  - Die Zahl der Tipps bis «läuft»: im Reel 1, bei uns heute 4, das Ziel 2 wegen der Einwilligung.
  - Die Lage der Teile in der Aufnahme-Ansicht: Blatt unten, Zeit und Titel unten, Stopp rechts. Verglichen wird Bild gegen Bild, nur die Lage in Prozent der Höhe bei 390 px, nicht das Aussehen.
  - Die Länge der Mitteilung: zwei Zeilen unter dem Titel.
  - Die Belege kommen ins Projekt von craft-anything (Brief, Befunde, Übergabe).
- **Gestaltung:** Vor jedem Teil mit Oberfläche lade ich die Design-Skills (`interface-design`, `frontend-design`). Die Richtung bleibt das bestehende m2 (Liquid Glass, Steno-Gelb).

## Prüfen

- **Jeder Teil:**
  - `npm run pruefen`, die ganze Suite und `tsc`.
  - Bilder bei 390 und 1440, hell und dunkel.
  - Ein frischer Prüfer liest das Delta, danach braucht es ein Go von Chief für dev.
- **Insel-Teile:** `npm test` und ein Lauf am gebauten Paket wie bei 1.0.16/1.0.17.
- **Ungeprüft bleibt alles, was nur am echten iPhone geht.** Diese Liste steht in der Abnahme jedes Teils für Giannino:
  - Aufnahme bei gesperrtem Bildschirm, 30 Min., mit Anruf, Flugmodus, Wegwischen und Neustart.
  - Aussehen der Mitteilung auf dem Sperrbildschirm.
  - Live Activity und Dynamic Island.
  - Ob der Daumen den Knopf in der Hand erreicht.
  - Der Hintergrund unter Android nach Teil 2b.

## Aufwand (geschätzt)

| Teil | Web | Hülle | Insel |
|---|---|---|---|
| 1 Start | 1,5–2 Tage (Selektor, Knopf, Route `steno/jetzt`) | – (Kreis über das Web) | 1 Tag (Anzeige) |
| 2 Gesperrt | ½ Tag Notschalter, ¼ Tag Text | iOS: Gerätetest durch Giannino, Fehler offen; Android 2b: 2–3 Tage + Play | – |
| 3 Mitteilung | 1,5 Tage (Text, `pushBody`, Spalte + Migration, Einstellung) | Android 3b (FCM): 2 Tage; iOS: 1.0.6 im Store | ½ Tag |
| 4 Notiz an mich | 3 Tage (inkl. Migration, Status, Zählfilter) | – | 1 Tag |
| 5 Bot | 1 Tag | – | – |
| 6 Live-Text | 1 Tag (Safari/Web-Option) | je nach Entscheid | 4–5 Tage (Plan Live-Text) |

## Offene Entscheide für Chief

1. Einwilligung beim Start jedes Mal fragen und je Aufnahme speichern? Mein Vorschlag: ja.
2. Android 2b und 3b jetzt oder erst nach iOS?
3. Live-Text in der Hülle: (a), (b) oder (c)? Mein Vorschlag: (a).
4. Inhalt in Mitteilungen auf dem Sperrbildschirm nur auf Wunsch und bei den Schweiz-Optionen gesperrt? Mein Vorschlag: ja.
5. «Notiz an mich» an der Insel nur über Menü und Panel? Mein Vorschlag: ja, keine eigene Taste.

## Prüf-Log

- Runde 1 (frischer Claude-Prüfer, 25.11.2026): REVISE. Eingearbeitet:
  - (1) iOS-APNs und die Aufnahme bei gesperrtem Gerät erst mit 1.0.6 im Store; `ios-1.0.5` hat beides nicht.
  - (2) Der native Weg läuft in TestFlight schon; neu kommt zuerst ein Notschalter.
  - (3) Live-Text in der Hülle als Entscheid (a/b/c).
  - (4) Die Notiz legt eine `meetings`-Zeile an; Felder `assignee_*` statt `wer`.
  - (5) Für den Aufnahme-Knopf nur `laeuft`/`bald`.
  - (6) Die Einwilligung wird je Aufnahme gespeichert.
  - (7) Inhalt in Mitteilungen nur auf Wunsch, bei den Schweiz-Optionen gesperrt.
  - (8) Was schon da ist, belegt: Hinweis, Wake Lock, Teile, Desktop-Karte.
  - (9) Der Kreis der Hülle ist der Start mit einem Tipp.
  - (10) Keine Regel «Kunde → Besuchsbericht»; die Insel braucht einen Endpunkt, mehr Aufwand.
  - (11) Abnahme für den Android-Rückfall und für die gespeicherte Einwilligung.
- Runde 2 (frischer Claude-Prüfer): REVISE. Eingearbeitet:
  - (1) Der Notschalter betrifft nur den Start (`nativStartErlaubt`); Stopp und Nochmal bleiben; Konstante bzw. `NEXT_PUBLIC_*`.
  - (2) Eigener Selektor `aufnahmeTermin`, dazu ein Bild «vorbei + läuft».
  - (3) Notiz: Migration, Status, Zählfilter, Cron.
  - (4) Push: Texte in `extract.ts`, `pushBody`, Spalte im Profil.
  - (5) Route `GET /api/m2/steno/jetzt`.
  - (6) Kreis über `__nativeNavigate` / `aktionAusloesen`.
  - (7) Status-Zeile.
  - (8)/(9) Abnahmen ergänzt.
- Runde 3 (frischer Claude-Prüfer): REVISE mit einem Blocker und einer Kleinigkeit. Der Prüfer schrieb: Nach dem Einarbeiten gilt der Plan als APPROVED, keine vierte Runde nötig. Eingearbeitet:
  - (1) Die Notiz ist über `source_event_id` mit dem Termin verknüpft und zählt nicht als «diktiert»; Abnahme ergänzt.
  - (2) `letzteFertig` in `steno/jetzt`.
