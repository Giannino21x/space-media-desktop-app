# 📱 SPACE Media App — Stand & Wie weiter

**Letzter Update: 2026-05-26, autonome Session via Claude**

## ✅ Was läuft

### iOS — Listing zu 90% fertig 🆕
- **TestFlight Build 1** auf iPhone installierbar (gpeloso@outlook.com Mail mit Link)
- **App Store Connect Listing — befüllt:**
  - ✅ Name: SPACE Media
  - ✅ Untertitel: KI-Workflows für KMU
  - ✅ Promo Text (Werbetext)
  - ✅ Beschreibung (volle 1258 Zeichen DE)
  - ✅ Keywords (67 Zeichen)
  - ✅ Support URL: space-media.ch
  - ✅ Marketing URL: space-media.ch
  - ✅ Copyright: 2026 SPACE MEDIA KlG
  - ✅ Kategorien: Wirtschaft (primär) + Produktivität (sekundär)
  - ✅ Reviewer Notes (für Apple Reviewer)
  - ⚠️ Reviewer Login: `reviewer@space-media.ch` / `PLEASE-SET-DEMO-PASSWORD` → **Passwort musst du setzen**
  - ✅ Contact: Giannino Peloso, +41 79 104 22 33, info@space-media.ch
- **Privacy Setup — komplett:**
  - ✅ Datenschutz-URL: `https://space-media.ch/datenschutz` (noch deployen!)
  - ✅ Privacy Nutrition Label: 5 Datentypen konfiguriert + veröffentlicht
    - Name, E-Mail-Adresse, Benutzer-ID, Sonstige Benutzerinhalte, Kundendienst
    - Alle: App-Funktionalität, identitätsverknüpft, kein Tracking

### Android — APK fertig + Release-Infrastruktur ready 🆕
- ✅ **Codemagic Build #4** durchgelaufen (Debug APK, 6.36 MB) — siehe `downloads/app-debug.apk`
- ✅ Auto-Trigger funktioniert jetzt: Push auf master baut automatisch (Debug)
- ✅ **Release-Signing Keystore** generiert:
  - `.signing/android/spacemedia-release.jks`
  - Passwort: `nuEtsSwHP8kY1LCRMGgaaPug` (siehe `.signing/android/KEYSTORE_INFO.md`)
  - ⚠️ **WICHTIG: Backup in Password-Manager + sicheren Cloud-Speicher!**
- ✅ **Codemagic Env-Vars** gesetzt (Gruppe `play_store_credentials`):
  - ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, GOOGLE_PLAY_TRACK
- ✅ **Release Workflow** in `codemagic.yaml` (`android-release-workflow`):
  - Trigger: Tag `v*` (z.B. `git tag v1.0.0 && git push --tags`)
  - Macht: `bundleRelease` → AAB → Auto-Submit zu Play Store Track
- ✅ **mobile/android/app/build.gradle** signiert release builds via keystore.properties

### Apple Developer Setup — komplett
- Team ID: `699K5VAG3G`
- Developer ID Application Cert, Apple Distribution Cert, Provisioning Profile
- App Store Connect API Key `QDS2QA88N5`
- App-spezifisches Passwort für Notarisierung

### Privacy Policy — HTML ready 🆕
- ✅ `datenschutz.html` im Repo Root — revDSG/DSGVO-konform, ca. 5KB
- ⚠️ **Du musst die Datei auf `space-media.ch/datenschutz` deployen** (sonst Apple/Google blocken Submission)

## ⏳ Was noch fehlt — und WER es machen muss

### Du (User) — 4 Sachen für iOS Submit:
1. **`datenschutz.html` auf space-media.ch deployen** (~5 Min)
   - Datei aus Repo nehmen, auf Webserver / Vercel publishen unter `/datenschutz`
   - URL muss live + öffentlich sein
2. **Demo-Account anlegen** in deiner Web-App
   - User: `reviewer@space-media.ch`
   - Strong-Passwort generieren + in App Store Connect ersetzen (siehe Review-Info)
3. **Screenshots vom iPhone aufnehmen** (~10 Min)
   - TestFlight Build aufm iPhone öffnen
   - 3-5 Screenshots: Login → Dashboard → Workflows → Notifications → Profil
   - In App Store Connect hochladen (iPhone 6.7" PFLICHT)
4. **Apple-Mail check** — Apple Compliance Approval kommt 1-3 Tage
   - Gestern eingereicht, sollte morgen/übermorgen kommen
5. → **"Zur Prüfung hinzufügen"** klicken (iOS Submit, 1-3 Tage Apple Review)

### Du (User) — Für Android Play Store live:
1. **Google Play Console Account** (~15 Min + 1-3 Tage Verifizierung)
   - https://play.google.com/console
   - USD 25 Registrierungsgebühr
   - Organisation: SPACE MEDIA KlG (D-U-N-S Check)
2. **Service Account JSON** anlegen (Google Cloud Console) + in Codemagic env-var `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` ablegen
   - Anleitung: siehe `PLAY_STORE_SETUP.md` Phase 2
3. **App in Play Console anlegen** mit `ch.spacemedia.app`
   - Listing-Texte aus `STORE_LISTING.md` kopieren
   - Privacy Policy URL: `https://space-media.ch/datenschutz` (gleich wie iOS)
   - Screenshots vom Android-Phone (TestFlight-Pendant: hat man nicht, einfach App-Screenshots vom Phone)
4. **Tag pushen für Release-Build:**
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
   → Codemagic baut signierten AAB + lädt automatisch zu Play Store Track `internal`

## 🔑 Wichtige Files & Pfade

| Wofür | Pfad |
|---|---|
| **Privacy Policy HTML (deploy mich!)** | `datenschutz.html` |
| **Store Listing Texte** | `STORE_LISTING.md` |
| **Play Store Setup-Anleitung** | `PLAY_STORE_SETUP.md` |
| **Android Keystore + Passwort** | `.signing/android/KEYSTORE_INFO.md` (NIE COMMITTEN) |
| **Android Debug APK** | `downloads/app-debug.apk` |
| Apple Credentials | `.browser-automation/apple-credentials.md` |
| iOS Distribution P12 | `.signing/apple_distribution.p12` |
| iOS Provisioning Profile | `.signing/space_media_app_store.mobileprovision` |
| App Store Connect API Key | `.signing/AuthKey_QDS2QA88N5.p8` |
| Capacitor Konfiguration | `mobile/capacitor.config.ts` |
| iOS Xcode-Projekt | `mobile/ios/App/App.xcodeproj` |
| Android Gradle-Projekt | `mobile/android/` |
| Codemagic Pipeline | `codemagic.yaml` |

## 📊 Wichtige URLs

- **GitHub Repo:** https://github.com/Giannino21x/space-media-desktop-app
- **Codemagic:** https://codemagic.io/app/6a14617c1bd8ed4acd8711e1
- **App Store Connect (Listing):** https://appstoreconnect.apple.com/apps/6773051956/distribution/ios/version/inflight
- **App Store Connect (App-Info):** https://appstoreconnect.apple.com/apps/6773051956/distribution/info
- **App Store Connect (Privacy):** https://appstoreconnect.apple.com/apps/6773051956/distribution/privacy
- **Apple Developer:** https://developer.apple.com/account
- **Google Play Console:** https://play.google.com/console (Account fehlt noch)

## 🆕 Heute gemacht (2026-05-26)

| Commit | Was |
|---|---|
| `468887a` | `ci(android): auto-trigger workflow on push to master` |
| `066a309` | `docs: add store-listing content + play-store setup guide [skip ci]` |
| `2fe6a4e` | `feat(android): release signing config + play-store publishing workflow [skip ci]` |
| (UI work in Codemagic) | Added env-vars: ANDROID_KEYSTORE_BASE64, _PASSWORD, _KEY_ALIAS, _KEY_PASSWORD, GOOGLE_PLAY_TRACK in `play_store_credentials` group |
| (UI work in ASC) | Filled entire App Store listing + Privacy Nutrition Label + Privacy URL |
| (locally) | Generated Android release JKS keystore in `.signing/android/` |

## 🎯 Reihenfolge wenn du wieder dran bist

1. **`datenschutz.html` deployen** (5 Min) ← Pflicht für beide Stores
2. **Apple-Mail checken** (Compliance approved?)
3. **Demo-Reviewer-Account anlegen** in Web-App + Passwort in ASC ersetzen (5 Min)
4. **iPhone Screenshots aufnehmen** + in App Store Connect hochladen (15 Min)
5. **"Zur Prüfung hinzufügen"** klicken (iOS → Apple Review, 1-3 Tage)
6. **Google Play Console Account anlegen** ($25, 1-3 Tage Verifizierung)
7. Während Google Play wartet: Demo-Account + Test, Screenshots fürs Phone
8. **Service Account in Codemagic einrichten** (siehe PLAY_STORE_SETUP.md)
9. **Tag pushen** → Codemagic baut signierten AAB + lädt zu Play Store
10. **Production-Release in Play Console** auslösen → Google Review 1-7 Tage

## ⚠️ Browser-Automation-Notes

- Chrome läuft auf `localhost:9222` mit Profile in `.browser-automation/chrome-profile/`
- Codemagic + Apple beide eingeloggt
- Wenn Chrome zu: neu starten via:
  ```
  "C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:/Projects/space-media-desktop/.browser-automation/chrome-profile"
  ```
