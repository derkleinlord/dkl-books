# Meine Geschichtenbibliothek

Responsive React-Bibliothek mit Vite, Online-Reader, PDF-Leseproben, Lesezeichen und lokaler Verwaltung.

## Start

```sh
npm ci --cache /tmp/dkl-npm-cache
npm run dev -- --port 5173
```

`npm run build` erstellt die Produktionsdateien unter `dist/`. `npm run preview` startet die Vorschau des Builds.

Buchdaten, Lesezeichen und Lesestände werden in localStorage gespeichert. Die Texte sind exemplarische Leseproben. Die Verwaltung ist eine lokale Demo ohne Anmeldung: Für produktiven Mehrbenutzerbetrieb sind Backend, Authentifizierung und persistente Datenbank zu ergänzen. PDF-Dateien werden lokal generiert.

## Browserprüfung

Bei laufendem Entwicklungsserver: `npm test`. Der Smoke-Test verwendet `/usr/bin/chromium` und prüft Reader, persistierten Lesestand, Lesezeichen, PDF-Download, Erstellen/Bearbeiten/Löschen im Adminbereich sowie mobile Navigation und Seitenüberlauf.
