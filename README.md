# Lash Booking Studio

Ein modernes Buchungssystem fuer ein Wimpern-Studio mit:

- Admin Login nur fuer die Betreiberin
- oeffentlicher Terminbuchung ohne Kundenkonto
- Pflege freier und gesperrter Tage
- iPhone-kompatiblem Kalenderfeed per ICS
- anpassbarem Branding, Texten und Kontaktdaten

## Schnellstart

1. `copy .env.example .env`
2. In `.env` einen eigenen `SESSION_SECRET` setzen
3. `npm.cmd install`
4. `npm.cmd start`
5. Im Browser `http://localhost:3000` oeffnen

## Kostenlos online stellen

Die App ist jetzt fuer einen kostenlosen Start auf `Render` vorbereitet.

### Bereits vorbereitet

- `render.yaml` fuer den Deploy auf Render
- `PORT`-kompatibler Start fuer Hosting-Plattformen
- `Healthcheck` unter `/health`
- `Git`-freundliche `.gitignore`
- sichere Session-Cookies im Produktionsmodus

### Datenbank fuer den Live-Betrieb

Die App ist jetzt fuer `Postgres` vorbereitet. Fuer einen kostenlosen Start passt `Supabase` gut.

- Lokal ohne `DATABASE_URL` nutzt die App weiter `data/store.json`
- Online mit `DATABASE_URL` nutzt die App automatisch `Postgres`
- Beim ersten Start werden die benoetigten Tabellen automatisch erstellt

### Grober Deploy-Ablauf

1. Projekt auf GitHub hochladen
2. Kostenloses Postgres-Projekt bei `Supabase` anlegen
3. Die `DATABASE_URL` in Render setzen
4. Bei Render ein neues Web Service aus dem GitHub-Repo erstellen
5. Render erkennt `render.yaml` automatisch
6. Nach dem ersten Deploy die URL testen
7. Danach Admin-Login und Buchung pruefen

## Standard Login

- E-Mail: `admin@vk-lash-atelier.de`
- Passwort: `change-me-now`

Wichtig: Nach dem ersten Login im Admin-Bereich direkt E-Mail und Passwort aendern.

## Daten

Lokal werden Daten in `data/store.json` gespeichert, solange keine `DATABASE_URL` gesetzt ist.

Sobald `DATABASE_URL` vorhanden ist, nutzt die App automatisch `Postgres`.

### Wichtige Umgebungsvariablen

- `SESSION_SECRET`: fuer sichere Sessions
- `DATABASE_URL`: Postgres-Verbindung fuer den Online-Betrieb
- `DATABASE_SSL=true`: fuer gehostete Postgres-Anbieter wie Supabase sinnvoll

## iPhone Kalender

Im Admin-Bereich wird eine private `ICS`-URL angezeigt. Diese kann auf dem iPhone unter:

`Einstellungen > Kalender > Accounts > Account hinzufuegen > Anderer > Kalenderabo hinzufuegen`

eingetragen werden.

## Branding

- Logo austauschen: `public/brand/vk-lash-atelier.png`
- Farben anpassen: `public/css/styles.css`
- Texte, Kontaktdaten, Terminlaenge: im Admin-Dashboard
