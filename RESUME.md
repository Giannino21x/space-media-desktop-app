# 📱 SPACE Media App — Stand & Wie weiter

**Pause am 2026-05-25, 19:50 CEST**

## ✅ Was läuft

### iOS — PRODUKTIONSREIF
- **TestFlight Build 1** auf deinem iPhone installierbar
- Apple-Mail an `gpeloso@outlook.com` mit TestFlight-Einladungslink
- → Install [TestFlight](https://apps.apple.com/app/testflight/id899247664) auf iPhone, Mail öffnen, akzeptieren, App laden
- Bundle ID: `ch.spacemedia.app`
- App Store Connect App ID: `6773051956`
- Codemagic iOS-Workflow funktioniert bei jedem Push auf `master` (Trigger manuell via Web-UI)

### Apple Developer Setup — komplett
- Team ID: `699K5VAG3G`
- Developer ID Application Cert (gültig 5 Jahre)
- Apple Distribution Cert (gültig 1 Jahr)
- Provisioning Profile "SPACE Media App Store" (gültig 1 Jahr)
- App Store Connect API Key `QDS2QA88N5`
- App-spezifisches Passwort für Notarisierung
- Compliance bei Apple eingereicht — wartet auf Approval (1-3 Tage)

## ⏳ Was offen ist

### Android — fast fertig, 1 Build-Iteration noch nötig
- Capacitor Android-Projekt komplett aufgesetzt mit `ch.spacemedia.app`
- Codemagic yaml fertig (Mac-Runner statt Linux wegen Free Tier)
- **Letzter Fehler:** `gradlew` permission denied
- **Fix bereits im Code:** `chmod +x ./gradlew` vor `./gradlew assembleDebug`
- **TO-DO:** Yaml committen + pushen, dann Build #4 triggern → APK installierbar

### App Store Submission (iOS)
- App Store Listing fehlt noch: Screenshots, Beschreibung, Privacy Policy URL
- Submission ist **geblockt** bis Apple Compliance approved (siehe ⏳)

### Mac DMG (signiert + notarisiert) — pausiert
- GitHub Actions workflow + p12 + alle Secrets bereit
- Hängte beim letzten Test 22 Min ohne Output → wurde gecancelt
- Niedrige Priorität (DMG-Build funktioniert auch unsigned, gibt nur Gatekeeper-Warning)

## 🚀 Morgen — empfohlene Reihenfolge

### 1. Android-Build fertigstellen (~5 Min)
```bash
cd C:/Projects/space-media-desktop
git add codemagic.yaml
git commit -m "fix(android): chmod gradlew before build"
git push origin master
```
Dann in Codemagic Web-UI:
- App Settings → "Check for configuration files"
- Branch auf `master`
- "Start new build" → Workflow `android-workflow` wählen → Start
- APK Download wenn fertig (~5 Min)
- Auf Android-Phone installieren (Settings → "Install from unknown sources")

### 2. Wenn Apple Compliance approved (Mail check)
- App Store Listing ausfüllen (Apple App Store Connect → SPACE Media → "Vertrieb")
- Submission to App Store Review (1-3 Tage Apple-Review)

### 3. Google Play Store (wenn ernst gemeint)
- Google Play Console Account ($25 einmalig): https://play.google.com/console
- Service Account JSON für Codemagic (für auto-submission)
- Android Release-Signing Keystore in Codemagic
- yaml umbauen: `assembleDebug` → `bundleRelease` + publishing block

## 🔑 Wichtige Files & Pfade

| Wofür | Pfad |
|---|---|
| Apple Credentials | `.browser-automation/apple-credentials.md` |
| iOS Distribution P12 | `.signing/apple_distribution.p12` |
| iOS Provisioning Profile | `.signing/space_media_app_store.mobileprovision` |
| App Store Connect API Key | `.signing/AuthKey_QDS2QA88N5.p8` |
| Capacitor Konfiguration | `mobile/capacitor.config.ts` |
| iOS Xcode-Projekt | `mobile/ios/App/App.xcodeproj` |
| Android Gradle-Projekt | `mobile/android/` |
| Codemagic Pipeline | `codemagic.yaml` |
| GitHub Actions (Desktop) | `.github/workflows/build.yml` |
| Browser Profile (Chrome Login) | `.browser-automation/chrome-profile/` |

## 📊 Wichtige URLs

- **GitHub Repo:** https://github.com/Giannino21x/space-media-desktop-app
- **Codemagic:** https://codemagic.io/app/6a14617c1bd8ed4acd8711e1
- **App Store Connect:** https://appstoreconnect.apple.com/apps/6773051956
- **Apple Developer:** https://developer.apple.com/account

## 🔐 GitHub Secrets gesetzt
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `MAC_CERTIFICATE_BASE64`, `MAC_CERTIFICATE_PASSWORD`

## 🔐 Codemagic Env Vars (Gruppe `app_store_credentials`)
- `APP_STORE_CONNECT_KEY_IDENTIFIER` = `QDS2QA88N5`
- `APP_STORE_CONNECT_ISSUER_ID` = `29695811-6f23-44c1-8bd4-590243b7fe82`
- `APP_STORE_CONNECT_PRIVATE_KEY` = `.p8` Inhalt
- `IOS_DISTRIBUTION_CERT_BASE64` = base64 von p12
- `IOS_DISTRIBUTION_CERT_PASSWORD` = `mtaZR7TaGVxdh1MkzHnWKQcxTyy28xOU`
- `IOS_PROVISIONING_PROFILE_BASE64` = base64 von mobileprovision

## ⚠️ Browser-Automation-Notes
- Chrome läuft auf `localhost:9222` (Debug Port)
- Profile in `.browser-automation/chrome-profile/`
- Falls morgen Browser closed: neu öffnen mit den Args aus `chrome-profile` (Apple Login bleibt erhalten)
