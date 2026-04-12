# Roliascan → MAL Sync (Firefox)

Automatischer Manga-Chapter-Sync von [roliascan.com](https://roliascan.com) auf [MyAnimeList](https://myanimelist.net).

## Was macht die Extension?

Synct automatisch gelesene Manga-Chapter von roliascan.com auf MyAnimeList. Sobald ein Chapter geöffnet wird, erkennt die Extension den Manga und die Chapter-Nummer und aktualisiert den Lesefortschritt auf MAL – ohne manuelles Eingreifen.

## Installation

### Option A: Signierte XPI (empfohlen – UUID bleibt stabil)

Signierte Extensions behalten ihre feste UUID (`roliascan-mal-sync@nimo`) über alle Neuinstallationen hinweg. Die OAuth-Redirect URI ändert sich nie.

**Schritt 1 – AMO API-Schlüssel holen:**
1. Auf [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key) einloggen
2. **JWT issuer** und **JWT secret** kopieren

**Schritt 2 – Signieren:**
```bash
cd rolia-to-mal-firefox
npm install
npx web-ext sign \
  --api-key="user:DEIN_JWT_ISSUER" \
  --api-secret="DEIN_JWT_SECRET" \
  --channel=unlisted
```

Nach dem Signieren liegt eine `.xpi`-Datei im `web-ext-artifacts/` Ordner.

**Schritt 3 – XPI installieren:**
1. Firefox öffnen → `about:addons`
2. Zahnrad-Icon → **"Add-on aus Datei installieren"**
3. Die `.xpi`-Datei auswählen

Die Extension ist nun dauerhaft installiert und überlebt Neustarts.

---

### Option B: Temporär laden (ohne Signierung)

1. `about:debugging` in die Adressleiste eingeben
2. **"Dieser Firefox"** → **"Temporäres Add-on laden"**
3. `manifest.json` aus diesem Ordner auswählen

> Temporäre Add-ons werden beim Neustart entfernt und erhalten bei jeder Installation eine neue UUID. Die OAuth-Redirect URI muss danach neu bei MAL eingetragen werden.

### Firefox Android (Nightly)

1. [Firefox Nightly](https://play.google.com/store/apps/details?id=org.mozilla.fenix) installieren
2. Am PC: `about:debugging` → Gerät per USB verbinden
3. Add-on auf das verbundene Gerät laden

## Einrichtung

1. **MAL App registrieren** unter [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig):
   - App Type: `other`
   - Redirect URI: Die Extension zeigt sie in den Einstellungen an.
     Format: `https://<hash>.extensions.allizom.org/` (bei signierten XPIs stabil)

2. **Extension öffnen** → Einstellungen (⚙️) → Client-ID eintragen → Speichern

3. **Mit MAL anmelden** über den Login-Button im Popup

## Features

- ✅ Automatischer Sync beim Öffnen eines Chapters
- 🔍 Manuelle Manga-Zuordnung bei nicht gefundenen Titeln (`mapping.html`)
- 📋 Sync-Verlauf der letzten 50 Chapter
- 🔄 Mapping-Sync über Firefox Sync auf alle Geräte (`storage.sync`)
- ⏭️ Duplikat- und Rückschritt-Erkennung: bereits gesyncte oder ältere Chapter werden übersprungen
- 🔁 Force-Sync im Verlauf: übersprungene Einträge können manuell nachgesynct werden
- 🔒 Kein externer Server – alle Daten lokal oder über Firefox Sync

## URL-Pattern

```
https://roliascan.com/read/{manga-slug}/ch{nummer}-{id}/
```

Beispiel: `https://roliascan.com/read/spy-x-family/ch1-57261/`

## Datenschutz

- Keine externen Server
- Alle Daten lokal im Browser oder über Firefox Sync
- Verbindungen nur zu `myanimelist.net` und `api.myanimelist.net`
- Quellcode vollständig einsehbar

## Entwicklung

Erstellt mit [Claude Code](https://claude.ai/code).
