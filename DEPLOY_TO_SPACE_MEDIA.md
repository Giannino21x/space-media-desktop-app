# 🚀 Deployment auf space-media.ch — was wir brauchen

Wir haben jetzt **3 Dateien**, die auf `space-media.ch` deployed werden müssen, damit iOS App Store + Google Play Store die App verifizieren können.

## Dateien aus diesem Repo

| Datei | Ziel-URL | Zweck |
|---|---|---|
| `datenschutz.html` | `https://space-media.ch/datenschutz` (oder `/datenschutz.html`) | Datenschutzerklärung — Pflicht für iOS + Play Store |
| `googlefc59ce7cb9b9f1c9.html` | `https://space-media.ch/googlefc59ce7cb9b9f1c9.html` | Google Search Console Verifizierung |

## Anleitung

### Wenn space-media.ch via Vercel/Next.js läuft

In den `public/` Ordner deines Web-App-Repos kopieren:

```bash
cp datenschutz.html /pfad/zu/space-media-website/public/datenschutz.html
cp googlefc59ce7cb9b9f1c9.html /pfad/zu/space-media-website/public/googlefc59ce7cb9b9f1c9.html
git add public/datenschutz.html public/googlefc59ce7cb9b9f1c9.html
git commit -m "feat: add privacy policy + google search console verification"
git push
```

Vercel deployt automatisch in ~1 Min.

### Wenn space-media.ch via WordPress / anderer CMS läuft

Beide HTML-Dateien direkt in den Web-Root (z.B. via FTP / SFTP / cPanel) hochladen.

## Verifizierung nach Deployment

### 1. Datenschutz testen:
```
https://space-media.ch/datenschutz
```
Sollte die Datenschutzerklärung anzeigen (kein 404).

### 2. Google Verifizierung testen:
```
https://space-media.ch/googlefc59ce7cb9b9f1c9.html
```
Sollte die Datei zeigen mit Inhalt: `google-site-verification: googlefc59ce7cb9b9f1c9.html`

### 3. In Google Search Console: "VERIFY" klicken
- https://search.google.com/search-console (Tab im Browser ist offen)
- Property `https://space-media.ch/` → VERIFY-Knopf

### 4. Im Google Play Console: Verification Request senden
- https://play.google.com/console/u/0/developers/8437631567726323151
- Verify your organisation's website → Send verification request

## Alternative: Meta-Tag Methode

Falls du keine separate Datei deployen willst, kannst du auch nur einen meta-Tag in die Homepage einfügen:

```html
<head>
  <meta name="google-site-verification" content="xGvudZGu3xJCLMEBAmCgefudVM21Xa3LNmwJXt2xhOI" />
  ...
</head>
```

(Aber die Datenschutz-Seite musst du trotzdem deployen.)

## Alternative: DNS TXT Record

Wenn du Zugriff auf DNS für space-media.ch hast:

```
Typ: TXT
Name: @
Wert: google-site-verification=xGvudZGu3xJCLMEBAmCgefudVM21Xa3LNmwJXt2xhOI
```

Dann in Search Console "Domain"-Verifizierung statt "URL-Prefix" verwenden.

---

**Welche Methode auch immer — die `datenschutz.html` ist Pflicht**, ohne die blocken iOS + Play Store die Submission.
