# Prüf-Log: Plan Diktat und Insel (25.11.2026)

Rollen: Planer = diese Claude-Sitzung (Worker insel-diktat). Prüfer = frischer Claude-Subagent (general-purpose), weil Codex
bis 28.11.2026, 10:06 kein Guthaben hat (Vorgabe Chief). Codex liest das Bündel danach. Kein Bau ohne Freigabe der
Scheiben durch Chief. Höchstens 5 Runden.

## Runde 1 — REVISE

11 Befunde (3 hoch, 5 mittel, 3 tief), alle angenommen:

1. hoch — Shift rechts: 8 s gehalten öffnet Windows-Anschlagverzögerung; Einfügen würde Strg+Shift+V. → Shift gestrichen.
2. hoch — Doppelwörter entfernen zerstört «die die». → gestrichen, Testtabelle mit Relativsätzen.
3. hoch — Brücke: `!!input.wert` (`insel.js:732`, `main.js:338`), App-Seite setzt `diktat`/`hoverOeffnen`. → Enum-Prüfung,
   `diktat`→`taste`, `hoverOeffnen` ohne Wirkung angenommen, Test v4-Seite gegen v5-Hülle.
4. mittel — Sprache an der Insel ändert beim Kurz-Diktat nichts (beide `de`) und stellt Sitzungen um. → Zeile gestrichen,
   Einstellungen 9 → 8.
5. mittel — «Letztes Diktat» gibt es halb (`insel.js:424,779,800`). → wiederverwenden, Ablauf 10 Min., Fokus abgeben.
6. mittel — Whisper-Prompt-Echo, Swiss-Weg ist auch Whisper, AssemblyAI-Kurzweg ohne passendes Modell, Cache. → übernommen.
7. mittel — Löschen an der Insel löscht für die ganze Firma. → nur ansehen und dazufügen.
8. mittel — «SPACE Pet anzeigen» im Infobereich holt verstecktes Pet zurück. → bleibt; Blatt zeigt `pet && aktiv()`.
9. tief — Reihenfolge nach Abhängigkeit. → S3-Web → S4 → S1 → S2 → S3-Desktop → S5.
10. tief — S5 nur Hauptbildschirm, Zieh-Schwelle. → übernommen.
11. tief — Vorschau des Texts sichtbar beim Teilen; CLAUDE.md nennt Brücke v3 statt v4. → nur Titel; Doku mit v5.

Prüfer-Grenzen: nichts ausgeführt; Kosten von AssemblyAI-keyterms, Azure-`prompt` und Windows-Standard der
Anschlagverzögerung aus dem Gedächtnis.

## Runde 2
REVISE, 6 Befunde (4 mittel, 2 tief), alle angenommen:

1. mittel — Echo-Erkennung warf ein einzelnes diktiertes Wörterbuch-Wort weg. → Echo nur mit «Namen und Begriffe» oder ≥ 2
   Begriffen in Prompt-Reihenfolge; Test für Einzelwort.
2. mittel — `diktat` abgeleitet ohne eine Quelle; Folgen-Block `insel.js:823-828` würde bei `taste` nicht feuern. →
   `diktatAn(e)`, Block auf `taste`, `diktat` mitschreiben (Downgrade), Test.
3. mittel — deutscher Prompt zieht «Automatisch»-Diktate ins Deutsche. → nur Begriffe ohne Satz, Test.
4. mittel — Wortliste darf Diktat nie blockieren; Cache pro Instanz. → Fehler fangen, ohne Prompt weiter; POST leert Cache.
5. tief — `word_boost` im Kurzweg wirkt kaum. → gestrichen, AssemblyAI/Scribe «ohne Wörter».
6. tief — Zählungen Übergang/Endstand vermischt, Infobereich-Satz widersprüchlich. → getrennt gezählt, Satz berichtigt.

## Runde 3
APPROVED (Plan-SHA256 beginnt mit ede0d12e458ed851). Zwei tiefe Hinweise, beide übernommen ohne neue Runde (nur Klarstellung, keine
neue Regel): Migration auch `diktat === true` + `taste === 'aus'` → `strgRechts`; «Aus» heisst gar kein Diktat, auch die
Knöpfe. Danach SHA256 624749dcf38b2447 (beginnend). Codex prüft das Bündel nach dem 28.11.2026, 10:06, nochmals.

## S7 (Entscheid Chief 25.11.2026), frischer Prüfer, Runde 1 — REVISE

9 Befunde, alle angenommen: (1 hoch) `setZoomFactor` gilt je Host für alle Insel-Fenster → CSS-Faktor nur in insel.html,
Flächen in main umrechnen; (2 hoch) Infobereich-Symbol braucht die Freigaben-Liste → nur die Kopie für die Insel filtern,
`/api/runs/laufend` immer; (3) Blatt passt nicht in 320 px → Umschalter «Diktat | Insel»; (4) «wie die App» ohne Quelle →
Theme-Attribut über preload/IPC, gespeichert, sonst nativeTheme; (5) `insel:zeiger` durch Faktor teilen; (6) Streifen
unskaliert, CLAUDE.md 300×10; (7) Mikrofon: Pseudo-Geräte, Name-Abgleich, OverconstrainedError; (8) «Standard» nur an
Einstellungen; (9) `pet` bleibt Schlüssel, eigene Ausgabe für Text-Werte. Runde 2 vor dem Bau von S7.

## S3-Web Code (Commit d9511a282), frischer Prüfer — REVISE

7 Befunde, alle angenommen (879a52c74): Echo strenger (beginnt mit Einleitung oder ganze Liste), Einleitung nur am Anfang,
Wörter nur auf Whisper-Wegen mit 700 ms und Abbruch, 400 Zeichen + Priorität (von Hand, neueste), Cache räumt auf und
merkt leere Listen nur 30 s, Sprach-Tests ohne Datenbank, Wächter-Ausnahme bleibt je Datei (der Wächter kennt nichts
Feineres). Zusätzlich: S4 (Füllwörter) auch im Web, weil Chief S4 als «wirkt ohne Desktop-Release» meldet.
