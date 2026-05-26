# 📱 SPACE Media App — Stand & Wie weiter

**Update am 2026-05-26** — Während du im Garten warst hab ich die Build-Automatisierung umgebaut und alle Store-Texte vorbereitet.

## ✅ Was läuft

### iOS — PRODUKTIONSREIF
- **TestFlight Build 1** auf deinem iPhone installierbar
- Apple-Mail an `gpeloso@outlook.com` mit TestFlight-Einladungslink
- → Install [TestFlight](https://apps.apple.com/app/testflight/id899247664) auf iPhone, Mail öffnen, akzeptieren, App laden
- Bundle ID: `ch.spacemedia.app`
- App Store Connect App ID: `6773051956`
- Codemagic iOS-Workflow funktioniert (Trigger weiterhin manuell — bewusst so gelassen wegen Apple-Compliance-Review)

### Apple Developer Setup — komplett
- Team ID: `699K5VAG3G`
- Developer ID Application Cert (gültig 5 Jahre)
- Apple Distribution Cert (gültig 1 Jahr)
- Provisioning Profile "SPACE Media App Store" (gültig 1 Jahr)
- App Store Connect API Key `QDS2QA88N5`
- App-spezifisches Passwort für Notarisierung
- Compliance bei Apple eingereicht — wartet auf Approval (1-3 Tage)

### Android — Build läuft automatisch 🆕
- Capacitor Android-Projekt komplett aufgesetzt mit `ch.spacemedia.app`
- Codemagic yaml fertig + `chmod +x ./gradlew` Fix
- **NEU (2026-05-26):** `triggering` block hinzugefügt → Push auf master startet Build automatisch
- **Commit `468887a` wurde gepusht** → Codemagic baut gerade Android APK
- → Check https://codemagic.io/app/6a14617c1bd8ed4acd8711e1/builds (Build sollte gerade laufen oder fertig sein)

### Store-Listings — alle Texte fertig 🆕
- `STORE_LISTING.md` — App Store + Play Store Texte auf Deutsch + Englisch
  - App-Name, Untertitel, Beschreibung, Keywords, Promo Text
  - Inkl. Privacy Label / Datensicherheit Antworten
  - Ready to copy-paste in App Store Connect + Play Console
- `PLAY_STORE_SETUP.md` — Schritt-für-Schritt Anleitung von "Debug APK" zu "Production Release"
  - Google Play Console Account ($25, D-U-N-S Nummer-Check)
  - Release-Keystore-Erstellung
  - Service Account für Auto-Publishing
  - Codemagic yaml erweitert für `bundleRelease` + Auto-Submit

## ⏳ Was offen ist

### iOS App Store Submission — geblockt bis Apple Compliance approved
- Apple Mail abwarten (1-3 Tage)
- Dann: 3-5 Screenshots vom iPhone (TestFlight Build) machen
- App Store Connect Listing füllen (Texte stehen in `STORE_LISTING.md`)
- Privacy Policy URL braucht's noch → `https://space-media.ch/datenschutz` muss live sein

### Android APK — wenn Codemagic Build durch ist
1. Codemagic Web-UI öffnen, neuesten Build prüfen
2. APK runterladen (Artifact)
3. Aufs Android-Phone übertragen (USB / Google Drive / Mail)
4. Installation erlauben in "Unbekannte Quellen"
5. App testen

### Play Store — frühestens nächste Woche (siehe `PLAY_STORE_SETUP.md`)
- Google Play Console Account (USD 25, evtl. D-U-N-S Wartezeit)
- Release-Keystore generieren + sichern
- Service Account in Google Cloud
- Codemagic-yaml umbauen auf `bundleRelease` + Google-Play Publishing

### Mac DMG (signiert + notarisiert) — pausiert
- GitHub Actions workflow + p12 + alle Secrets bereit
- Hängte beim letzten Test 22 Min ohne Output → wurde gecancelt
- Niedrige Priorität (DMG-Build funktioniert auch unsigned, gibt nur Gatekeeper-Warning)

## 🚀 Empfohlene Reihenfolge — Heute

### 1. Android-Build prüfen (5 Min)
- https://codemagic.io/app/6a14617c1bd8ed4acd8711e1/builds
- Wenn ✅: APK runterladen + auf Phone installieren
- Wenn ❌: Logs ansehen, mir Screenshot/Fehlertext zeigen

### 2. Apple-Mail checken
- Wenn Compliance approved: weiter mit Punkt 3
- Wenn noch nicht: einfach warten

### 3. Privacy Policy auf space-media.ch publizieren
- Pflicht für beide Stores
- Inhalt: Cookies, Login-Daten, Hosting in CH, FADP-Konformität, Kontakt
- Ideal: Eigene Seite `/datenschutz` im Web-App-Repo deployen

### 4. iOS App Store Listing füllen (wenn Compliance da)
- App Store Connect → SPACE Media öffnen
- "Vertrieb" / "1.0 Prepare for Submission"
- Texte aus `STORE_LISTING.md` kopieren
- Screenshots hochladen
- "Zur Überprüfung einreichen"

## 🔑 Wichtige Files & Pfade

| Wofür | Pfad |
|---|---|
| **Store-Texte (App Store + Play Store)** | `STORE_LISTING.md` 🆕 |
| **Play Store Setup-Anleitung** | `PLAY_STORE_SETUP.md` 🆕 |
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
- **Google Play Console:** https://play.google.com/console (Account muss noch angelegt werden)

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

## 🆕 Heute geändert (2026-05-26)

| Commit | Was |
|---|---|
| `468887a` | `ci(android): auto-trigger workflow on push to master` — Codemagic baut Android jetzt automatisch bei Push |
| (new file) | `STORE_LISTING.md` — Komplette Texte für iOS App Store + Play Store |
| (new file) | `PLAY_STORE_SETUP.md` — Step-by-step Play Store Setup-Anleitung |

## ⚠️ Browser-Automation-Notes
- Chrome läuft NICHT mehr auf `localhost:9222` (war zu beim Resume-Check)
- Profile in `.browser-automation/chrome-profile/` (Login bleibt erhalten)
- Falls Browser-Automation gebraucht: neu öffnen mit Args aus chrome-profile
