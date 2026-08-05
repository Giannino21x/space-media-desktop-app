# SPACE Media Desktop & Mobile

## What

Native Hüllen für die SPACE Media Web-App. Alle vier Builds laden dieselbe live laufende Vercel-App
(`https://space-media-app.vercel.app`) — hier liegt **keine** App-Logik, nur die Shell.
Änderungen an der Web-App sind sofort in allen Builds sichtbar; ein neuer Shell-Build ist nur nötig für
Fensterverhalten, Icons, Notifications, Auto-Update oder Capacitor-Konfiguration.

**Stack:** Electron 28 + electron-builder 26 + electron-updater 6 (Desktop) · Capacitor 8 (iOS/Android)
**CI:** GitHub Actions (Desktop) · Codemagic (Mobile)
**Sprache:** UI + Store-Texte auf Deutsch, Code + Comments auf Englisch

## Structure

```
main.js            → Electron Main: BrowserWindow (frameless), Auto-Updater, Taskbar-Badge-IPC,
                     GPU-Flags, adaptive Windows-Titlebar (capturePage-Sampling alle 2 s)
preload.js         → Drag-Region (body::after, 40 px), Badge-Observer, window.__electronRestart
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
npm run dev          # lädt http://localhost:3000
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
- Externe Links werden abgefangen und im Systembrowser geöffnet; nur `APP_URL` und `localhost` dürfen
  im Fenster navigieren. Beim Wechsel der Produktions-URL `APP_URL` in `main.js` **und** `server.url`
  in `mobile/capacitor.config.ts` anpassen.
- `datenschutz.html` und die Google-Verifizierungsdatei müssen auf `space-media.ch` erreichbar sein
  (Pflicht für beide Stores). Details in `DEPLOY_TO_SPACE_MEDIA.md`.
- `dist/`, `downloads/` und `node_modules/` gehören nicht in Commits.

## Current State

- **Desktop:** letztes veröffentlichtes GitHub Release ist `v1.0.1` (15.06.2026). Der Tag `v1.0.2`
  existiert remote, hat aber kein Release — der Build ist dort nicht durchgelaufen. `package.json`
  auf `master` steht auf `1.0.1`.
- **iOS:** `MARKETING_VERSION` 1.0.2, App bei Apple eingereicht und freigegeben (Details in `RESUME.md`).
- **Android:** `versionCode 3` / `versionName 1.0.2`, Keystore vorhanden, Play-Auto-Upload noch nicht
  konfiguriert — AAB-Uploads laufen manuell.
- Offene Punkte und die manuellen Store-Schritte sind in `RESUME.md` dokumentiert, die fertigen
  Store-Texte in `STORE_LISTING.md`, das Play-Setup in `PLAY_STORE_SETUP.md`.
