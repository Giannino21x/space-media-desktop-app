# 🤖 Play Store Setup — Schritt für Schritt

> Vom aktuellen "Debug APK"-Stand zum produktiven Play-Store-Release.
> Dauer: ~2-3 Stunden verteilt über mehrere Tage (wegen Google Reviews).

---

## Phase 0 — Voraussetzungen (15 Min)

### 0.1 Google Play Console Account anlegen

1. https://play.google.com/console
2. Mit Google-Account einloggen (z.B. info@space-media.ch — neuen Account anlegen falls nötig)
3. **Account-Typ wählen: "Organisation"** (nicht "Privat")
4. Firmendaten eingeben:
   - Firmenname: `SPACE MEDIA KlG`
   - Adresse: `Hanfroosenweg 11a, 8615 Wermatswil, ZÜRICH, Schweiz`
   - Telefon: `+41 79 104 22 33`
   - Website: `https://space-media.ch`
5. **Einmalige Registrierungsgebühr:** USD 25 (via Kreditkarte)
6. **D-U-N-S Nummer:** Brauchen wir vermutlich (für Organisations-Konten verlangt Google das seit 2023). Falls noch nicht vorhanden:
   - Kostenlos beantragen via https://www.upik.de/duns_anfordern.html
   - Dauer: 1-7 Werktage
   - SPACE MEDIA KlG hat eventuell schon eine — bei UID/Handelsregisteramt anfragen
7. Google verifiziert den Account: 1-3 Tage warten

> 💡 **Während Google verifiziert:** Mit Phase 1 (Signing) weitermachen — das blockt sich nicht.

---

## Phase 1 — Release-Signing Keystore (5 Min)

Ein Release-Build muss mit einem **persistenten** Keystore signiert werden, nicht mit dem Debug-Keystore. Den Keystore NIE verlieren — sonst kann man die App nie wieder updaten.

### 1.1 Keystore generieren

Lokal in Git-Bash oder PowerShell ausführen:

```bash
cd C:/Projects/space-media-desktop
mkdir -p .signing/android

keytool -genkey -v \
  -keystore .signing/android/spacemedia-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias spacemedia
```

**Wird gefragt:**
- Keystore-Passwort: **NEU und stark wählen** — z.B. via `openssl rand -base64 24` generieren
- Wiederholung
- Vor- und Nachname: `SPACE Media`
- Organisationseinheit: `Mobile`
- Organisation: `SPACE MEDIA KlG`
- Stadt: `Wermatswil`
- Bundesland: `Zürich`
- Ländercode (zweistellig): `CH`
- Alle Angaben korrekt? `ja`
- Schlüsselpasswort = Keystore-Passwort? **Enter** (gleich lassen — einfacher)

### 1.2 Passwort + Backup sichern

⚠️ **KRITISCH** — diese Datei in einen Passwort-Manager (1Password, Bitwarden) speichern:

```
.signing/android/spacemedia-release.jks  ← Backup an SICHEREN Ort
Keystore-Passwort: <NEUES PASSWORT>
Key-Alias: spacemedia
Key-Passwort: <gleiches Passwort>
SHA-1 Fingerprint: keytool -list -v -keystore .signing/android/spacemedia-release.jks
```

> ⚠️ Falls dieser Keystore verloren geht: App muss als NEU im Play Store eingereicht werden, alle bestehenden User können nicht mehr updaten. Lieber 3 Backups.

### 1.3 Base64 für Codemagic

```bash
# Mac/Linux:
base64 -i .signing/android/spacemedia-release.jks -o .signing/android/keystore-base64.txt

# Windows PowerShell:
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".signing/android/spacemedia-release.jks")) > .signing/android/keystore-base64.txt
```

---

## Phase 2 — Google Play Service Account (10 Min)

Für **automatische Submissions via Codemagic** brauchen wir einen Service Account, den Google Play Console kennt.

### 2.1 Google Cloud Service Account anlegen

1. https://console.cloud.google.com/
2. **Neues Projekt:** "SPACE Media Play Store"
3. **APIs aktivieren:**
   - Google Play Android Developer API
   - Google Play Developer Reporting API
4. **Service Account erstellen:**
   - "IAM & Admin" → "Service Accounts" → "Create"
   - Name: `codemagic-play-publisher`
   - Rolle: Keine (wird über Play Console verwaltet)
5. **JSON-Key erstellen:**
   - Service Account anklicken → "Keys" → "Add Key" → "JSON"
   - Datei runterladen → speichern als `.signing/android/play-service-account.json`

### 2.2 Service Account mit Play Console verknüpfen

1. Play Console öffnen
2. "Settings" → "API access"
3. Service Account aus Liste auswählen (gleiche E-Mail wie in JSON)
4. "Grant access"
5. Berechtigungen setzen:
   - **App permissions:** "All apps" (oder nur SPACE Media nach Erstellung)
   - **Account permissions:**
     - View app information and download bulk reports ✅
     - Manage testing tracks and edit tester lists ✅
     - Manage production releases ✅
     - Manage store presence ✅

---

## Phase 3 — Codemagic Konfiguration (10 Min)

### 3.1 Environment Variables in Codemagic

In Codemagic Web-UI: `App Settings → Environment variables → Add variable group`

**Neue Gruppe:** `play_store_credentials`

| Variable | Wert |
|---|---|
| `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` | Inhalt von `play-service-account.json` (komplette JSON) |
| `ANDROID_KEYSTORE_BASE64` | Inhalt von `keystore-base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore-Passwort |
| `ANDROID_KEY_ALIAS` | `spacemedia` |
| `ANDROID_KEY_PASSWORD` | Key-Passwort (= Keystore-Passwort) |
| `GOOGLE_PLAY_TRACK` | `internal` (für Internal Testing) |

⚠️ Alle als **"Secure"** markieren (nicht im Build-Log sichtbar).

### 3.2 codemagic.yaml erweitern

Wenn du soweit bist, hier ist der neue `android-workflow` Block, der das aktuelle ersetzt:

```yaml
  android-workflow:
    name: Android (Play Store Release)
    instance_type: mac_mini_m2
    max_build_duration: 60
    triggering:
      events:
        - push
      branch_patterns:
        - pattern: master
          include: true
          source: true
    environment:
      groups:
        - play_store_credentials
      android_signing:
        - spacemedia_keystore
      vars:
        PACKAGE_NAME: ch.spacemedia.app
      node: 22
      java: 21
    scripts:
      - name: Install npm dependencies
        script: |
          cd mobile && npm ci --no-audit --no-fund
      - name: Capacitor sync Android
        script: |
          cd mobile && npx cap sync android
      - name: Set Android SDK location
        script: |
          echo "sdk.dir=$ANDROID_SDK_ROOT" > "$CM_BUILD_DIR/mobile/android/local.properties"
      - name: Set up signing keystore
        script: |
          echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > /tmp/keystore.jks
          cat >> "$CM_BUILD_DIR/mobile/android/keystore.properties" <<EOF
          storeFile=/tmp/keystore.jks
          storePassword=$ANDROID_KEYSTORE_PASSWORD
          keyAlias=$ANDROID_KEY_ALIAS
          keyPassword=$ANDROID_KEY_PASSWORD
          EOF
      - name: Increment version
        script: |
          cd mobile/android
          # Auto-increment versionCode based on Play Store latest
          LATEST_BUILD=$(google-play get-latest-build-number \
            --package-name "$PACKAGE_NAME" \
            --tracks internal production 2>/dev/null || echo "0")
          NEW_BUILD=$(($LATEST_BUILD + 1))
          sed -i "" "s/versionCode .*/versionCode $NEW_BUILD/" app/build.gradle
      - name: Build release AAB
        script: |
          cd mobile/android
          chmod +x ./gradlew
          ./gradlew bundleRelease
    artifacts:
      - mobile/android/app/build/outputs/bundle/release/*.aab
    publishing:
      google_play:
        credentials: $GCLOUD_SERVICE_ACCOUNT_CREDENTIALS
        track: $GOOGLE_PLAY_TRACK
        submit_as_draft: false
```

> 💡 Erst NACH dem ersten manuellen Play Console Setup aktivieren. Sonst schlägt der Publishing-Schritt fehl, weil die App noch nicht angelegt ist.

### 3.3 Android Build-Gradle anpassen

In `mobile/android/app/build.gradle` (kann Codemagic erst nach `cap sync` lesen — also lokal machen oder via Script in yaml):

```gradle
android {
    ...
    signingConfigs {
        release {
            def keystorePropertiesFile = rootProject.file("keystore.properties")
            def keystoreProperties = new Properties()
            keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

---

## Phase 4 — App in Play Console anlegen (15 Min)

1. Play Console → "Create app"
2. **App-Details:**
   - App-Name: `SPACE Media`
   - Standardsprache: Deutsch (Schweiz)
   - App oder Spiel: App
   - Kostenpflichtig oder kostenlos: Kostenlos
   - Bestätigungen: Programmrichtlinien, US-Exportgesetze ✅
3. **Dashboard-Aufgaben durchklicken:**
   - App-Zugriff: Anmeldedaten für Reviewer angeben (Test-Account anlegen!)
   - Werbeanzeigen: Enthält keine
   - Inhaltsangaben: Fragebogen ausfüllen (alles "Nein" → Für alle)
   - Zielgruppe: 18+
   - Datensicherheit: siehe `STORE_LISTING.md`
   - Regierungs-App: Nein
4. **Store-Eintrag ausfüllen:**
   - Texte aus `STORE_LISTING.md` kopieren
   - Grafiken hochladen (App-Icon, Feature-Grafik, Screenshots)

---

## Phase 5 — Erster Release (Internal Testing) (30 Min)

### 5.1 AAB hochladen

Option A — **Manuell** (für ersten Test):
1. Codemagic build laufen lassen (Push auf master) → AAB-Artefakt runterladen
2. Play Console → "Internal testing" → "Create new release"
3. AAB hochladen
4. Release-Notes:
   ```
   Erste Version der SPACE Media App.
   ```
5. "Save" → "Review release" → "Start rollout"

Option B — **Automatisch via Codemagic** (nach erstem manuellen Upload):
- `publishing.google_play` Block in yaml ist aktiv (siehe Phase 3.2)
- Codemagic lädt jedes neue Build direkt in den Internal Testing Track hoch

### 5.2 Tester einladen

1. Play Console → "Internal testing" → "Testers"
2. **E-Mail-Liste erstellen:** Eigene E-Mail + alle Testpersonen
3. **Opt-in URL** kopieren → an Tester senden
4. Tester öffnen URL → werden Tester → können App via Play Store installieren

> ⚡ **Wartezeit:** ~5-10 Min nach Upload, bis App via Play Store-Link erscheint.

---

## Phase 6 — Produktions-Release (1-7 Tage Google Review)

Nach erfolgreichem Internal Testing:

1. Play Console → "Production" → "Create new release"
2. Aus Internal Testing **promoten** (gleicher AAB-Build)
3. Release-Notes überprüfen
4. Rollout-Strategie wählen:
   - **Staged rollout:** 5% → 20% → 50% → 100% (sicher für erstes Release)
   - **Vollständig:** 100% sofort
5. "Start rollout"
6. **Google Review:** 1-7 Tage
7. App erscheint im Play Store unter `https://play.google.com/store/apps/details?id=ch.spacemedia.app`

---

## 🔥 Sofort-To-dos für den User

Heute / Morgen:
1. **Codemagic Build abwarten** (~5 Min) — APK runterladen, auf Android-Phone installieren, testen
2. **Google Play Console Account anlegen** (15 Min + 1-3 Tage Verifizierung)
3. **D-U-N-S Nummer prüfen** (eventuell bei SPACE Media KlG schon vorhanden)
4. **Privacy Policy auf space-media.ch publizieren** — sowohl für iOS als auch Android Pflicht

Diese Woche:
5. iOS App Store Listing füllen (sobald Apple Compliance approved)
6. Release-Keystore generieren (Phase 1)
7. Service Account anlegen (Phase 2)

Nächste Woche:
8. Erste Play Console App + Internal Test
9. Produktions-Release einreichen
