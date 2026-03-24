# SPACE Media App — Desktop

Electron-Wrapper für die SPACE Media Web-App. Lädt `space-media-app.vercel.app` in einem nativen Fenster.

## Download

**Aktuelle Version: v1.5.0** — [GitHub Releases](https://github.com/Giannino21x/space-media-desktop/releases/latest)

| Plattform | Datei |
|-----------|-------|
| Windows | `SPACE-Media-App-Setup-x.x.x.exe` |
| Mac (Apple Silicon) | `SPACE-Media-App-x.x.x-arm64.dmg` |
| Mac (Intel) | `SPACE-Media-App-x.x.x-x64.dmg` |

> **Windows SmartScreen:** Beim ersten Start erscheint "Der Computer wurde durch Windows geschützt". Auf "Weitere Informationen" → "Trotzdem ausführen" klicken. Passiert nur einmal.

## Features

- Frameless Window (Notion-Style) mit nativen Fenster-Controls
- GPU-beschleunigt, smooth scrolling, high refresh rate
- Desktop-Notifications (wie Slack) für Nachrichten, Aufgaben, Kontaktanfragen
- Taskbar-Badge mit Anzahl ungelesener Benachrichtigungen
- Auto-Update: App prüft automatisch auf neue Versionen

## Auto-Update

Ab **v1.5.0** aktualisiert sich die App automatisch:

1. App prüft beim Start + alle 30 Min auf neue Releases
2. Update wird im Hintergrund heruntergeladen
3. Grünes Banner erscheint: "Update bereit — klicke zum Neustarten"
4. Klick → App startet neu mit neuer Version

**Wichtig:** Nur ab v1.5.0. Ältere Versionen müssen manuell aktualisiert werden.

## Neues Release erstellen

```bash
cd C:\Projects\space-media-desktop
# Änderungen machen + committen, dann:
git tag v1.x.x
git push origin master --tags
```

GitHub Actions baut automatisch `.exe` + `.dmg` und erstellt ein Release. Alle User mit v1.5.0+ erhalten das Update automatisch.

## Entwicklung

```bash
npm install
npm start          # Startet mit Vercel-URL
npm run dev        # Startet mit localhost:3000
```

## Architektur

```
main.js      → Electron Main Process (Fenster, Auto-Update, Taskbar Badge)
preload.js   → Drag-Region, DOM-Observer für Badge-Count, Update-Restart
assets/      → App-Icons (PNG, ICO)
.github/     → GitHub Actions Build-Workflow
```

Die Desktop-App ist nur ein Wrapper — die gesamte App-Logik läuft in der Web-App auf Vercel. Web-App Updates sind sofort sichtbar ohne Desktop-Update.

Desktop-Updates sind nur nötig für Änderungen an: Fenster-Verhalten, Icons, Notifications, Auto-Update.
