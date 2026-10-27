# SPACE Media Desktop & Mobile

## What

Native Hüllen für die SPACE Media Web-App. Alle vier Builds laden dieselbe live laufende Vercel-App
(`https://app.space-media.ch`, Custom Domain des Vercel-Projekts; die alte `space-media-app.vercel.app` bleibt
parallel erreichbar, weil installierte Store-Apps sie fest laden) — hier liegt **keine** App-Logik, nur die Shell.
Änderungen an der Web-App sind sofort in allen Builds sichtbar; ein neuer Shell-Build ist nur nötig für
Fensterverhalten, Icons, Notifications, Auto-Update oder Capacitor-Konfiguration.

**Stack:** Electron 44 + electron-builder 26 + electron-updater 6 (Desktop) · Capacitor 8 (iOS/Android)
**CI:** GitHub Actions (Desktop) · Codemagic (Mobile)
**Sprache:** UI + Store-Texte auf Deutsch, Code + Comments auf Englisch

## Structure

```
main.js            → Electron Main: BrowserWindow (frameless), Auto-Updater, Taskbar-Badge-IPC,
                     GPU-Flags, adaptive Windows-Titlebar (capturePage-Sampling event-getrieben: Theme-/Routenwechsel,
                     Fokus, Load + 10-s-Sicherheitstick bei Fokus; wechselt erst nach 2 gleichen Samples)
preload.js         → Drag-Region (body::after, 40 px), Badge-Observer (rAF-gedrosselt), Titlebar-Resync-IPC,
                     window.__electronRestart, window.spaceConnector («Eigenes Claude-Abo»), window.spaceDateien (PC-Ordner)
insel/             → Die Insel (Desktop, Windows): SPACE oben am Bildschirmrand, auch wenn das App-Fenster zu ist —
                     Verhalten nach Coucou für Windows (MIT-Code, Louis Raillé; Figur, Icons, Töne sind UNSERE: SPACE-Helm
                     mit LED-Augen). insel.js = Main (zwei Fenster, Cursor-Poll, globaler Hook, Einfügen, App-API über die
                     App-Session), regeln.js = rein + Tests (Diktat-Taste, Lagen, Multipart), preload.js = window.spaceInsel,
                     ui/ = lokale Seiten (insel.html/-ui.js/.css, pille.html/-ui.js/.css, gesicht.js, symbole.js, klang.js)
connector.js       → SPACE Connector im Hintergrund: Bundle von <App>/connector/space-connector.mjs laden, mit
                     Electrons Node (ELECTRON_RUN_AS_NODE) `pair`/`run` starten, beim Beenden stoppen;
                     reine Teile in connector.test.js (`npm test`)
dateien.js         → PC-Ordner für «Dateien» (nur Lesen): Freigaben in <userData>/dateien.json (Dev: dateien-dev.json),
                     Pfadprüfung, liste/alle/lesen, fs.watch; dateien.test.js (`npm test`)
fenster.js         → Was im App-Fenster laden darf (window.open + will-navigate), exakte Herkunft wie bei den
                     Brücken; fenster.test.js (`npm test`)
assets/            → icon.ico, icon.png, entitlements.mac.plist (buildResources)
.github/workflows/ → build.yml — Desktop-Build + GitHub Release
codemagic.yaml     → 3 Mobile-Workflows (iOS TestFlight, Android Debug-APK, Android Release-AAB)
mobile/            → Capacitor-Projekt (eigenes package.json), ios/ + android/ + capacitor.config.ts
legal/             → datenschutz-1-pager.html, subprozessoren.html
datenschutz.html   → Pflicht-Datenschutz-Seite für beide Stores (muss auf space-media.ch liegen)
dist/, downloads/  → Build-Output bzw. abgelegte APK/AAB — gitignored bzw. untracked
.signing/          → Zertifikate, Keys, Keystore — gitignored, NIE committen
```

**Identität:** Electron `appId` = `ch.space-media.app`, Capacitor/Android `appId` = `ch.spacemedia.app`.
Die beiden sind **absichtlich verschieden** (Store-Registrierung) — beim Ändern nicht angleichen.
Session-Partition: `persist:spaceapp`. Branch: `master`.

## How

**Lokal entwickeln**
```bash
npm install
npm start            # lädt die Vercel-Produktions-URL
npm run dev          # lädt http://localhost:3000 (SPACE_DEV_URL=http://localhost:3100 für anderen Port)
npm run build:win    # NSIS-Installer → dist/
npm run build:mac    # DMG x64 + arm64 (braucht einen Mac + Apple-Zertifikate)
```

**Desktop-Release**
```bash
# package.json version auf x.y.z setzen + committen, dann:
git tag vx.y.z && git push origin master --tags
```
`.github/workflows/build.yml` baut Windows-`.exe` und macOS-`.dmg` (signiert + notarisiert über
GitHub-Actions-Secrets), lädt beide als Artefakte hoch und erstellt daraus ein GitHub Release.

**Auto-Update** (verifiziert in `dist/win-unpacked/resources/app-update.yml`): electron-updater zieht
Releases von `Giannino21x/space-media-desktop-app` über den GitHub-Provider. `autoDownload` ist an; die
App prüft 5 s nach Start und danach alle 30 Minuten. Ist ein Update geladen, injiziert `main.js` ein
Banner in die Seite; ein Klick ruft `window.__electronRestart()` → `autoUpdater.quitAndInstall()`.
Im Dev-Modus (`--dev`) läuft kein Update-Check.

**Mobile-Builds (Codemagic)**
- `ios-workflow` — kein Trigger im YAML, nur manuell über die Codemagic-UI starten. Signiert mit
  vorab erzeugtem Distribution-Zertifikat + Provisioning-Profil (beide als base64-Env-Vars),
  Build-Nummer wird aus App Store Connect hochgezählt, Upload nach TestFlight (`Internal Testers`).
- `ios-testflight` — Tag `testflight-*`: derselbe Build (YAML-Anker auf `ios-workflow`), lädt aber nur zu
  TestFlight (Internal Testers) hoch, ohne Review. Eingereicht wird danach in App Store Connect oder per Tag `ios-*`.
- `android-workflow` — automatisch bei Push auf `master`, liefert eine installierbare Debug-APK.
- `android-release-workflow` — Trigger `git tag v*`, baut ein signiertes AAB.
  Play-Auto-Publish ist im YAML deaktiviert (kein Service-Account) → AAB manuell in der Play Console hochladen.

## Rules

- **Ein `v*`-Tag startet zwei Pipelines**: GitHub Actions (Desktop-Release) und Codemagic
  (Android Release-AAB). Wer nur eines will, muss den anderen Build ignorieren bzw. abbrechen.
- `package.json` → `version` **vor** dem Taggen auf die Tag-Version setzen. electron-updater vergleicht
  gegen diese Zahl; ein Tag ohne passenden Version-Bump erzeugt ein Release, das niemand als Update sieht.
- Android-Versionen leben in `mobile/android/app/build.gradle` (`versionCode`/`versionName`), die
  iOS-Version im Xcode-Projekt (`MARKETING_VERSION`). Beide sind unabhängig von der Electron-Version.
  Der Codemagic-Step erhöht `versionCode` nur, wenn die Play-Abfrage klappt — sonst gilt der Wert aus `build.gradle`.
- **Keine Secrets ins Repo.** Zertifikate, Keystores und `.p8`-Keys bleiben in `.signing/` (gitignored);
  die Werte selbst gehören in GitHub-Actions-Secrets bzw. die Codemagic-Env-Groups
  (`app_store_credentials`, `play_store_credentials`).
- `preload.js` liest den Badge-Count aus dem DOM der Web-App (`.notification-bell-badge`). Wird diese
  Klasse in der Web-App umbenannt, verschwindet der Taskbar-/Dock-Badge lautlos — beides zusammen ändern.
- Externe Links werden abgefangen und im Systembrowser geöffnet (`fenster.js`, für `setWindowOpenHandler` und
  `will-navigate`): im Fenster bleibt nur die **exakte Herkunft** aus `APP_ORIGINS` (`APP_URL`, `LEGACY_APP_URL`),
  `localhost`/`127.0.0.1` nur mit `--dev` — dieselbe Regel wie die Brücken (`connectorOrigin`). Nie mit `startsWith`
  prüfen: das liess `https://app.space-media.ch.evil.com` und im gepackten Build `http://localhost` ins Fenster
  (behoben 26.10.2026). Anmeldung bei Stripe, Composio/OAuth-Anbietern und GitHub läuft deshalb im Systembrowser,
  die Rückkehr landet dort auf `app.space-media.ch`. Beim Wechsel der Produktions-URL `APP_URL` in `main.js` **und**
  `server.url` in `mobile/capacitor.config.ts` anpassen.
- `datenschutz.html` und die Google-Verifizierungsdatei müssen auf `space-media.ch` erreichbar sein
  (Pflicht für beide Stores). Details in `DEPLOY_TO_SPACE_MEDIA.md`.
- `dist/`, `downloads/` und `node_modules/` gehören nicht in Commits.
- **Insel (insel/, seit 27.10.2026, nur Windows):** zwei transparente, nie fokussierte Fenster (`focusable: false`,
  `type: 'toolbar'`, `alwaysOnTop 'screen-saver'`). Insel oben Mitte: versteckt ein 240×6-Streifen, der die Maus nimmt
  (Windows hält Fenster ≥ ~38 px hoch → der Streifen hängt über den Rand, nur 6 px sichtbar; `streifenSetzen`), sichtbar ein
  720×320-Panel; Durchklicken entscheidet der 16-ms-Cursor-Poll im Main im selben Takt (nie im Renderer per IPC — verliert
  Klicks), Rand 14 px; solange die linke Taste im Panel gedrückt ist, nimmt es die Maus (sonst findet ein Explorer-Drag kein
  Ziel). Pille unten Mitte über der Taskleiste (520×170, Ruhe 44×8). Diktat: `uiohook-napi` (N-API-Prebuilds, deshalb
  `npmRebuild: false` — electron-builder kennt die ABI von Electron 44 nicht), rechte Strg halten ≥ 0,28 s / zweimal tippen
  freihändig / Esc / andere Taste = Kürzel → verworfen (Regeln in `regeln.js`), Aufnahme im Pillen-Fenster (Session `insel`,
  nur Mikrofon, nur file://), Transkription über `POST /api/voice/transcribe` der App mit der App-Session (KI-Option gilt),
  Einfügen = Zwischenablage → Strg+V (uiohook `keyTap`) → alte Zwischenablage (Text/HTML/RTF/Bild) nach 700 ms zurück, nur
  wenn unverändert. Der Hook beobachtet nur, speichert und sendet keine Tasten (deshalb kann er nichts schlucken: rechte Strg + Esc öffnet zusätzlich das Startmenü, wie bei Coucou; aus Explorer kopierte Dateien in der Zwischenablage gehen beim Einfügen verloren — Electron kann sie nicht zurückschreiben). Daten: `/api/profile` + `/api/team` alle
  5 Min., `/api/runs/laufend` alle 20 s (offen 6 s), `/api/approvals` nur bei offenen Freigaben. Abgelegte Datei → «Im Chat
  fragen» legt sie in main.js bereit, das App-Fenster holt sie einmal über `window.spaceInselDatei.nehmen()` (Web:
  `desktopDateiNehmen` in `lib/insel/ablage.ts`, Ereignis `insel:datei`). Infobereich: Gesicht (`assets/tray.ico`, bernstein
  `tray-wartet.ico` bei Freigaben), Menü «Insel oben anzeigen» / «Diktieren mit Strg rechts». Einstellungen in
  `<userData>/insel.json`. Das App-Fenster darf jetzt das Mikrofon (nur Ton, nur App-Origin) — vorher war jede `media`-Anfrage
  abgelehnt. Tests: `npm test` (regeln), Demo-Daten nur ungepackt mit `SPACE_INSEL_DEMO=1` (`window.inselDemo`), fester
  Diktat-Text ungepackt mit `SPACE_INSEL_TEST_TEXT`. Nie einen Einfüge-Test laufen lassen, ohne vorher zu prüfen, welches Fenster
  vorne ist (Strg+V landet sonst in der App der Person).
- **«Eigenes Claude-Abo» (connector.js):** nur die unveränderte `claude`-Binary, die Person meldet sich selbst in
  Claude Code an, die Hülle liest von `claude auth status` nur `loggedIn` und sieht nie ein Claude-Token. Die IPC
  `connector:*` nimmt die Adresse aus dem anfragenden Frame (nur `APP_URL`/`LEGACY_APP_URL`, localhost nur mit
  `--dev`). Kopplung + Gerätetoken liegen in `<userData>/connector/` (Dev: `connector-dev/`), Protokoll dort in
  `connector.log`. Der Connector selbst (CLI, Bundle) lebt im Web-Repo unter `src/lib/connector/client/`.
- **PC-Ordner (dateien.js, `window.spaceDateien`):** Vertrag «D» im Web-Repo (`docs/plans/2026-10-26-dateien.md`) ist die
  einzige Schnittstelle — neue Felder oder Methoden nur mit Versionssprung und Eintrag dort. Nur Lesen; nur Ordner, die
  die Person im System-Dialog gewählt hat (`ordnerWaehlen` nur direkt nach einem Klick, `navigator.userActivation`);
  jeder Pfad gegen die echte Wurzel aufgelöst (`realpath`, Links nach draussen unsichtbar, Wurzel ersetzt → «weg»).
  Nie freigebbar: Laufwerkswurzeln (auch `\\server\share`), Benutzerordner und darüber, versteckte Ordner,
  AppData/Library, der eigene Datenordner (Gerätetoken des Connectors!), Systemordner, Netzwerkpfade zurück auf diesen
  PC (`\\localhost\c$\…` — sonst AppData über die Hintertür) und `$`-Freigaben; zusätzlich Vergleich über die
  Datei-Identität (dev/ino). Versteckte Einträge, node_modules, Thumbs.db, desktop.ini, `~$…` erscheinen nirgends.
  Windows-Junctions auf `\??\Volume{…}` sieht `lstat` nicht als Link — Ordner darum immer per `realpath` prüfen. IPC `dateien:*` wie beim Connector nur für die App-Seiten; Antworten `{ ok, wert }` /
  `{ ok: false, meldung }`, damit die Seite die deutsche Meldung bekommt. Watcher gehören der Seite: Neuladen,
  Navigation, Absturz und Fenster-Ende räumen sie weg.

## Current State

- **PC-Ordner, Brücke `window.spaceDateien` v1 (26.10.2026, released mit Desktop `v1.0.11`):** `ordnerWaehlen`,
  `freigaben`, `freigabeAendern`, `freigabeEntfernen`, `liste`, `alle`, `lesen`, `beobachten` nach Vertrag D. Gegenstück im
  Web-Repo: Teil E (Sync in «Meine Dateien», Live-Zugriff der Bots, `PcBruecke`, `/api/pc/*`). Geprüft mit `node --test` und
  `electron . --dev` gegen eine Testseite (Playwright, Dialog im Main-Prozess ersetzt): Wählen nur nach Klick,
  Liste/Lesen/Ausbruch, Änderungen entprellt, Neuladen räumt Watcher weg.
- **Desktop:** letztes veröffentlichtes GitHub Release ist `v1.0.11` (26.10.2026: PC-Ordner für «Dateien» — Brücke
  `window.spaceDateien` v1, nur Lesen; das App-Fenster prüft die Herkunft exakt (`fenster.js`) statt mit `startsWith`).
  Davor `v1.0.10` (23.10.2026: läuft im Hintergrund — X versteckt das
  Fenster (Windows), Symbol im Infobereich mit «SPACE öffnen» / «Mit Windows starten» / «Beenden»; Koppeln schaltet den
  Start mit Windows ein (`--im-hintergrund`, startet versteckt); `before-quit` lässt «Beenden» und Updates wirklich schliessen;
  einmaliger Hinweis, Merker in `<userData>/hintergrund.json`). Davor `v1.0.9` (23.10.2026: die App öffnet Anthropics Anmeldeseite
  selbst — `claude auth login` mit `BROWSER` = App-exe, die zweite Instanz reicht die Adresse per `second-instance` an
  die laufende App, die sie mit `shell.openExternal` aus dem Vordergrund öffnet; vorher kam der Browser über rundll32
  im Hintergrund und blieb hinter den Fenstern. Neu: nur eine App pro Benutzer (`requestSingleInstanceLock`, gepackt),
  `SPACE_USER_DATA` für Tests, Brücke v4 `anmeldeseiteOeffnen()`). Davor `v1.0.8` (23.10.2026: «Claude-Abo verbinden» öffnet immer
  Anthropics Seite «Autorisieren», auch wenn Claude Code schon angemeldet ist; nur «Autorisieren» zählt — Brücke v3,
  `anmelden({ immer: true })`). Davor `v1.0.7` (22.10.2026: «Claude-Abo verbinden» startet bei Bedarf
  die Anmeldung von Claude Code selbst — `claude auth login` öffnet Anthropics Seite im Browser, «Autorisieren», fertig;
  Brücke v2 mit `anmelden()`/`anmeldenAbbrechen()`). Davor `v1.0.6` (22.10.2026: «Eigenes Claude-Abo» ohne Terminal —
  `connector.js` koppelt diesen Rechner aus Einstellungen → Datenschutz und lässt den SPACE Connector laufen, solange die
  App offen ist). Davor `v1.0.5` (13.10.2026: Fenster, Verknüpfung und Installer heissen
  «SPACE Media Engine», der Fenstertitel folgt nicht mehr der Webseite). Davor `v1.0.4` (13.10.2026, neues App-Icon wie auf dem Handy: SPACE Bot
  im blauen Ring, aus `mobile/assets/icon-foreground.png`; `build.publish` steht jetzt in `package.json`, sonst fehlt
  `app-update.yml` im Build und die App findet keine Updates mehr). Davor `v1.0.3` (17.09.2026, Update-Banner-Neustart via
  `contextBridge` gefixt). Lokal gebaut, Release per `gh release create --target <sha>` → das neue Tag hat die
  GitHub-Actions-Pipeline gestartet (sofort per `gh run cancel` abgebrochen, sonst überschreibt deren Release-Job
  die Assets ohne passendes `latest.yml`) und Codemagic `android-release-workflow` (harmlos, kein Auto-Publish).
  Nutzer auf ≤1.0.2: Banner-Klick tut nichts → App über X schliessen installiert das Update.
- **iOS:** `master` steht auf `MARKETING_VERSION` 1.0.4 (Commit 51a9b7f, 25.09.2026): echtes Liquid Glass wie in
  der Sport-Nexus-Hülle — `UIGlassContainerEffect` + `cornerConfiguration(.capsule)`, kein `clipsToBounds` (1.0.3
  hatte das Glas abgeschnitten → matte Pille), Theme-fähig (hell/dunkel inkl. Status-Leiste), alle Glas-Parameter
  kommen aus `NativeChromeBridge.tsx` der Web-App (`glass`-Feld) — nachjustieren ohne Store-Durchlauf; optional
  Apples System-Tab-Bar unten (`useSystemTabBar`). **Codemagic `ios-workflow` manuell starten**, dann TestFlight
  testen, dann ASC 1.0.4 einreichen. Store: 1.0.3 live seit 21.08.2026 (Build 19). Die Tastatur handhabt die Web-App
  selbst (`KeyboardViewport` + `keyboard-mobile.css` im Web-Repo).
- **iOS 1.0.5 — Tab-Leiste aus der Web-App (11.10.2026):** die Hülle setzt `html[data-native-tabs]` und nimmt das
  Feld `tabs` ([{id, symbol, label, action?}]) der nativeChrome-Meldung an → Apples echte `UITabBarController`-Leiste
  unten mit genau diesen Tabs, oben nichts Natives. Welche Tabs: `src/lib/navigation/mobile-tabs.ts` im Web-Repo (pro
  Paket: SPACE Bot vs. Betrieb). `action` = Aktions-Tab (Diktat, blauer Kreis, wählt nicht aus). Ohne `tabs` gilt das
  alte Verhalten (Pille oben). Gebaut + eingereicht per Tag `ios-*` (Codemagic `ios-workflow`, `submit_to_app_store`,
  «Neu in dieser Version» aus `release_notes.json`).
- **iOS 1.0.5 (11.10.2026): Live Activity «Aufnahme läuft»** in Dynamic Island + Sperrbildschirm.
  Widget-Erweiterung `SpaceLiveActivity` (eigenes Target, Bundle-ID `ch.spacemedia.app.LiveActivity`, ab iOS 16.2,
  von Hand in `project.pbxproj` eingetragen — IDs `A71CE…`), gemeinsame `Shared/AufnahmeAttributes.swift` in beiden
  Targets, `App/LiveActivityBridge.swift` (Kanal `webkit.messageHandlers.liveActivity`, Gegenstück
  `src/lib/mobile/live-activity.ts` + `useRecording.ts` im Web-Repo). «Stopp» öffnet die App über
  `spacemedia://aufnahme/stopp` (AppDelegate → `window.__nativeAufnahme('stopp')`). Info.plist: `NSSupportsLiveActivities`,
  URL-Schema `spacemedia`, `UIBackgroundModes` audio (damit die WebView-Aufnahme bei gesperrtem Telefon weiterlaufen
  kann — auf dem Gerät prüfen, ob wirklich Ton ankommt). Signieren: der Codemagic-Schritt legt App-ID
  `ch.spacemedia.app.LiveActivity` + App-Store-Profil selbst an (`app-store-connect fetch-signing-files --create`, ASC-Key
  aus `app_store_credentials`, Schlüssel des vorhandenen Verteilungs-Zertifikats); ein vorgegebenes Profil in
  `IOS_LIVEACTIVITY_PROFILE_BASE64` hat Vorrang.
- **iOS 1.0.6 (Branch `huelle-1.0.6`, noch nicht eingereicht) — Mobile 2.0, Bauplan Etappe 3:**
  - Insel «Steno schreibt» / «Protokoll bereit» (`html[data-native-insel="2"]`), «Fertig» als App Intent
    (`AufnahmeFertigIntent`), Links `spacemedia://oeffne?pfad=…` und `spacemedia://konto/…`.
  - **Aufnahme bei gesperrtem iPhone:** `App/NativeAufnahme.swift` (Kanal `nativeAufnahme`, Flag
    `html[data-native-aufnahme="1"]`, Gegenstück `src/lib/mobile/native-recorder.ts` + `useRecording.ts`).
    `AVAudioRecorder` schreibt AAC in ADTS-Rahmen (`.aac`, 48 kbit/s Mono); alle 30 s gehen die neuen Bytes als Teil
    an `audio/upload`, am Ende `audio/finalize` — beides mit einem Aufnahme-Ticket der Web-App
    (`Authorization: Bearer`, `POST /api/meetings/[id]/audio/ticket`), nicht mit der Sitzung der WebView. Stand und
    Teile liegen in Application Support/Aufnahmen/<sitzung>; nach einem Absturz gehen sie beim nächsten Start hoch.
    Die Hülle führt die Insel während ihrer Aufnahme selbst. Notschalter im Web (`HUELLE_NIMMT_AUF`).
  - **Diktier-Kreis:** `html[data-native-kreis="1"]` — ein Aktions-Tab mit `placement: "trailing"` wird unter
    iOS 26 ein `UISearchTab` (Apples abgesetzter Kreis rechts neben der Leiste), nie ausgewählt
    (`shouldSelectTab`), gezeichnet in den `farben` der Web-App (Steno-Gelb bzw. Ring aus den Bot-Farben);
    Grössen über `glass.aktionKreis` / `glass.aktionSymbol` nachjustierbar. Vor iOS 26: Tab in der Leiste.
  - **Aktionsleiste in Liquid Glass:** `html[data-native-aktionen="1"]`, Feld `aktionen` ({text?, knoepfe:[{id, label,
    stil: haupt|neben, aus?}], akzent?, tinte?} | null) → `App/NativeAktionsleiste.swift` (iOS 26: `.glass()` /
    `.prominentGlass()` über weichem Rand; davor Material). Tipp → `window.__nativeAktion(id)`, Höhe →
    `--native-aktionen-h`. Gegenstück `src/lib/mobile/native-aktionen.ts` + `useNativeAktionsleiste` (Dokument).
    Apples Tab-Leiste geht ab iOS 18 mit `setTabBarHidden(_:animated:)` weg (Chat, Dokument).
  - **Prüfen ohne Mac:** `.github/workflows/ios-pruefen.yml` kompiliert bei Push auf `huelle-*` für den
    Simulator, ohne Signatur und ohne App Store (12.10.2026: grün mit Xcode 26.3, keine Warnungen in den eigenen
    Dateien; `UITab.selectedImage` kennt dieses SDK noch nicht). Danach Tags `testflight-1.0.6`, `testflight-1.0.6-2` (mit Aktionsleiste) → nur TestFlight.
    Auf dem Gerät prüfen: Ton bei gesperrtem iPhone, «Fertig» in der Insel, Kreis tippbar und Farben,
    Anruf während der Aufnahme, Neustart der App mitten in einer Aufnahme.
- **Android:** Store hat `versionCode 4` / 1.0.3 (gebaut vor dem `resizeOnFullScreen`-Fix — Tastatur
  überdeckt dort den WebView). `master` steht auf `versionCode 5` / `versionName 1.0.4`; AAB via
  Codemagic gebaut (`downloads/app-release-v1.0.4.aab`), Play-Upload läuft manuell.
- **Eigenes Claude-Abo ohne Terminal (22.10.2026):** `connector.js` + Brücke `window.spaceConnector`, released mit
  Desktop `v1.0.6`, Anmeldung bei Claude aus der App seit `v1.0.7` (nur Claude Codes eigener Login, die Ausgabe wird
  nicht gelesen; Ergebnis kommt aus `claude auth status`). Gegenstück im Web: Karte `ClaudeAboKarte.tsx` und der Connector mit `windowsHide` (ohne das öffnet
  jeder Lauf unter Windows ein Konsolenfenster) — beide müssen live sein. Mac: noch kein DMG mit diesem Stand.
- Offene Punkte und die manuellen Store-Schritte sind in `RESUME.md` dokumentiert, die fertigen
  Store-Texte in `STORE_LISTING.md`, das Play-Setup in `PLAY_STORE_SETUP.md`.
