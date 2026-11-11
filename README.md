# DKL Geschichtenbibliothek

React-/TypeScript-Bibliothek mit Fastify-API, MariaDB/Prisma, Rollen, Buchreihen, Büchern, Rich-Text-Kapiteln, Cover-Uploads, Lesezeichen und Lesefortschritt.

## Einrichtung

Voraussetzungen: Node.js 22+, MariaDB 10.6+ und ein dauerhaft beschreibbares Upload-Verzeichnis.

```sh
cp .env.example .env
# Lokale DB-Werte, COOKIE_SECRET und Bootstrap-Werte anpassen
npm ci
npm run db:migrate
npm run bootstrap:admin
npm run dev
```

Die öffentliche Adresse ist `https://books.dkl-lab.de`; in der Beispielkonfiguration läuft die interne API auf Port `4300`. MariaDB läuft lokal auf `127.0.0.1:3306`; die Datenbank startet ohne Buchinhalte. Für die Anmeldung werden ausschließlich Benutzername und Passwort verwendet, keine E-Mail-Adresse.

## Lokale MariaDB einrichten

Als MariaDB-Administrator ausführen und `EIN_SICHERES_PASSWORT` anschließend identisch als `DB_PASSWORD` in `.env` eintragen:

```sql
CREATE DATABASE IF NOT EXISTS `dkl_books`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'dkl_books'@'localhost'
  IDENTIFIED BY 'EIN_SICHERES_PASSWORT';

ALTER USER 'dkl_books'@'localhost'
  IDENTIFIED BY 'EIN_SICHERES_PASSWORT';

REVOKE ALL PRIVILEGES, GRANT OPTION
  FROM 'dkl_books'@'localhost';

GRANT ALL PRIVILEGES ON `dkl_books`.*
  TO 'dkl_books'@'localhost';

FLUSH PRIVILEGES;
```

Da `DB_HOST=127.0.0.1` eine TCP-Verbindung verwendet, muss bei installationsabhängiger MariaDB-Hosttrennung gegebenenfalls derselbe Benutzer zusätzlich für `'dkl_books'@'127.0.0.1'` mit denselben, ausschließlich auf `dkl_books.*` begrenzten Rechten angelegt werden.

## Produktion

```sh
npm ci
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

Im lokalen Betrieb bleiben MariaDB und die API auf demselben Server. MariaDB sollte mit `bind-address = 127.0.0.1` ausschließlich an die lokale Schnittstelle gebunden sein. Die Verbindung wird über `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` und `DB_CONNECTION_LIMIT` konfiguriert; eine `DATABASE_URL` muss nicht gepflegt werden. Für eine HTTPS-Auslieferung müssen `COOKIE_SECURE=true`, eine HTTPS-Adresse in `CORS_ORIGIN`, ein zufälliges `COOKIE_SECRET` mit mindestens 32 Zeichen und ein persistentes `UPLOAD_DIR` gesetzt sein. Das Frontend wird aus `dist/` ausgeliefert; `/api` und `/uploads` werden an Fastify weitergeleitet.

Passwörter werden mit Argon2 gehasht. Rich-Text wird serverseitig auf sichere Formatierungen reduziert. Cover akzeptieren JPG, PNG und WebP bis standardmäßig 5 MiB.

## Deployment

Nach dem Anlegen von `/var/www/dkl-books/.env` kann das vollständige Deployment als root ausgeführt werden:

```sh
cd /var/www/dkl-books
chmod +x deploy.sh
sudo ./deploy.sh
```

Das Skript installiert reproduzierbar die Node-Abhängigkeiten, generiert Prisma, führt Migrationen aus, baut das Frontend, installiert die systemd- und Nginx-Konfiguration, startet `dkl-books.service` neu und prüft abschließend `/api/health` auf Port 4300.

## Nginx

Eine vollständige Konfiguration für `books.dkl-lab.de` liegt unter `deploy/nginx/books.dkl-lab.de.conf`. Sie liefert den Vite-Produktions-Build direkt aus `/var/www/dkl-books/dist/` aus und leitet `/api` sowie `/uploads` an `127.0.0.1:4300` weiter. Der Origin lauscht nur über HTTP auf Port 80; HTTPS wird durch den vorgeschalteten Cloud-Proxy bereitgestellt.
