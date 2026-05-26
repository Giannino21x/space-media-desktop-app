# 📱 SPACE Media App — Stand & Wie weiter

**Letzter Update: 2026-05-26 (Nachmittag), 100% autonom via Claude + Playwright**

---

## ✅ Was 100% erledigt ist (kein User-Eingriff mehr nötig)

### Code & Infrastructure
- ✅ Codemagic Auto-Trigger funktioniert (Push master → Debug APK)
- ✅ Codemagic Android Release Workflow (Tag `v*` → Signed AAB → Play Store auto-submit)
- ✅ Android Release-Keystore generiert + in Codemagic Env-Vars
- ✅ `mobile/android/app/build.gradle` signiert release builds
- ✅ Privacy Policy HTML geschrieben (`datenschutz.html`)
- ✅ Google Search Console Verifizierungsdatei geschrieben (`googlefc59ce7cb9b9f1c9.html`)

### iOS App Store Connect — 90% gefüllt
- ✅ Name, Untertitel, Promotional Text, Beschreibung, Keywords, URLs, Copyright
- ✅ Kategorien (Wirtschaft + Produktivität)
- ✅ Reviewer-Notes + Contact (Giannino Peloso, info@space-media.ch, +41 79 104 22 33)
- ✅ Privacy URL: `https://space-media.ch/datenschutz`
- ✅ Privacy Nutrition Label: 5 Datentypen veröffentlicht (NAME, EMAIL, USER_ID, OTHER_USER_CONTENT, CUSTOMER_SUPPORT — alle App-Funktionalität, kein Tracking)

### Android Play Console — Account angelegt
- ✅ Play Console Organisation Account: ID `8437631567726323151`
- ✅ DUNS verifiziert: 480605900, SPACE MEDIA KlG
- ✅ Payments Profile linked
- ✅ E-Mail info@space-media.ch verified
- ✅ Public Developer Profile, Organisation Info, About You, Apps Info, Contact, ToS — alles gefüllt
- ✅ USD 25 Registrierungsgebühr bezahlt
- ✅ Search Console Property `https://space-media.ch/` angelegt (URL-Prefix, wartet auf Verify)

---

## ⏳ Was du noch machen musst — 4 Schritte

### 1. Deploy auf space-media.ch (~5 Min)
Aus diesem Repo, 2 Files in den Web-Root:
- `datenschutz.html` → `https://space-media.ch/datenschutz`
- `googlefc59ce7cb9b9f1c9.html` → `https://space-media.ch/googlefc59ce7cb9b9f1c9.html`

Falls Vercel/Next.js → in `public/` legen, push, deploy automatisch.
Details: `DEPLOY_TO_SPACE_MEDIA.md`

### 2. ID-Verifizierung in Play Console (~5 Min)
- → https://play.google.com/console/u/0/developers/8437631567726323151
- "Verify your identity" → Get started → Passfoto + ID-Karte hochladen

### 3. Demo-Reviewer-Account in Web-App anlegen (~5 Min)
- Login: `reviewer@space-media.ch` (oder ähnlich)
- Starkes Passwort generieren
- In ASC → App-Prüfung → Anmeldeinformationen → Passwort eintragen ersetzen (steht jetzt `PLEASE-SET-DEMO-PASSWORD`)

### 4. iPhone Screenshots (~10 Min)
- TestFlight Build aufm iPhone öffnen
- 3-5 Screenshots: Login → Dashboard → Workflows → Notifications → Profil
- Per AirDrop / Mail auf Mac/PC
- In ASC → Vorschauen und Screenshots → iPhone 6.7" → hochladen

---

## ⌛ Was warten muss (du kannst nichts tun)

### Apple Export Compliance
- Eingereicht: gestern (2026-05-25)
- Apple Reviewing: 1-3 Tage normal
- **Sobald Mail kommt:** Build 1 lässt sich der App-Version anhängen, dann "Zur Prüfung hinzufügen" klicken → Apple Review 1-3 Tage → 🎉 App Store live

### Google Verifizierung
- Nach Deploy (Schritt 1) + Verify in Search Console + Play Console: 1-3 Tage Wartezeit
- Identity-Upload (Schritt 2): kann parallel laufen, Google verifiziert in 1-3 Tagen

---

## 🚀 Final-Schritte wenn alle Verifizierungen durch sind

### Google Cloud Service Account anlegen (~10 Min, deine Sache wegen Passwort)
1. https://console.cloud.google.com/
2. Neues Projekt: "SPACE Media Play Store"
3. APIs → Google Play Android Developer API aktivieren
4. Service Account erstellen, JSON-Key runterladen
5. In Play Console → API access → Service Account verknüpfen + Berechtigungen
6. JSON-Inhalt mir geben → ich trage in Codemagic Env-Var `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` ein

### App in Play Console anlegen (~15 Min)
- "Create app" (jetzt entsperrt!)
- Name: SPACE Media
- Standardsprache: Deutsch (Schweiz)
- Typ: App, kostenlos
- Inhalte aus `STORE_LISTING.md` kopieren
- Datenschutzerklärung URL: `https://space-media.ch/datenschutz`
- Internal Testing Track wählen

### Release pushen
```bash
cd C:/Projects/space-media-desktop
git tag v1.0.0
git push origin v1.0.0
```
→ Codemagic baut signierten AAB → lädt automatisch zu Play Store Internal Testing

### Production Release
- Play Console → "Production" → "Create new release"
- Aus Internal Testing promoten
- Google Review: 1-7 Tage
- 🎉 Live auf https://play.google.com/store/apps/details?id=ch.spacemedia.app

---

## 🔑 Wichtige Files & Pfade

| Wofür | Pfad |
|---|---|
| **DEPLOY mich auf space-media.ch** | `datenschutz.html`, `googlefc59ce7cb9b9f1c9.html` |
| **Deploy-Anleitung** | `DEPLOY_TO_SPACE_MEDIA.md` |
| **Store Listing Texte (für Play Console)** | `STORE_LISTING.md` |
| **Play Store Setup-Anleitung** | `PLAY_STORE_SETUP.md` |
| **Android Keystore + Passwort** | `.signing/android/KEYSTORE_INFO.md` (NIE COMMITTEN) |
| **Android Debug APK (zum Testen)** | `downloads/app-debug.apk` |
| iOS Distribution P12 | `.signing/apple_distribution.p12` |
| iOS Provisioning Profile | `.signing/space_media_app_store.mobileprovision` |
| App Store Connect API Key | `.signing/AuthKey_QDS2QA88N5.p8` |
| Capacitor Konfiguration | `mobile/capacitor.config.ts` |
| iOS Xcode-Projekt | `mobile/ios/App/App.xcodeproj` |
| Android Gradle-Projekt | `mobile/android/` |
| Codemagic Pipeline | `codemagic.yaml` |

## 📊 Wichtige IDs & URLs

- **Play Console Account:** `8437631567726323151`
- **App Store Connect App:** `6773051956`
- **Codemagic App:** `6a14617c1bd8ed4acd8711e1`
- **Bundle ID:** `ch.spacemedia.app`
- **Apple Team ID:** `699K5VAG3G`
- **DUNS:** `480605900` (SPACE MEDIA KlG)
- **Android Keystore SHA-1:** `BC:48:1B:1E:6A:01:D5:30:3A:FA:8A:47:FB:A6:54:A3:B6:60:CA:74`

- **GitHub Repo:** https://github.com/Giannino21x/space-media-desktop-app
- **Play Console:** https://play.google.com/console/u/0/developers/8437631567726323151
- **App Store Connect Listing:** https://appstoreconnect.apple.com/apps/6773051956/distribution/ios/version/inflight
- **Search Console:** https://search.google.com/search-console
- **Apple Developer:** https://developer.apple.com/account
- **Codemagic:** https://codemagic.io/app/6a14617c1bd8ed4acd8711e1

## 📦 Commits heute (2026-05-26)

| Commit | Was |
|---|---|
| `468887a` | `ci(android): auto-trigger workflow on push to master` |
| `066a309` | `docs: add store-listing content + play-store setup guide [skip ci]` |
| `2fe6a4e` | `feat(android): release signing config + play-store publishing workflow [skip ci]` |
| `38f7dc6` | `docs: update RESUME — store listing filled, privacy published, keystore ready [skip ci]` |
| `10b20f2` | `docs: add space-media.ch deployment package [skip ci]` |
