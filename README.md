# Roliascan → MAL Sync

> Firefox-Extension die gelesene Manga-Chapter von [roliascan.com](https://roliascan.com) automatisch auf [MyAnimeList](https://myanimelist.net) synct.

<!-- Screenshot: Popup -->
<!-- ![Popup](docs/screenshot-popup.png) -->

---

## ✨ Features

- **Automatischer Sync** – Chapter wird beim Öffnen erkannt und sofort auf MAL gespeichert
- **URL-Erkennung** – Pattern: `roliascan.com/read/{manga}/ch{nr}-{id}/`
- **Duplikat-Schutz** – bereits gesyncte Chapter werden lautlos übersprungen
- **Rückschritt-Erkennung** – wenn der gelesene Chapter hinter dem MAL-Stand liegt, erscheint eine Notification; manuelles Syncen im Verlauf möglich
- **Manuelles Manga-Mapping** – Manga der auf MAL nicht automatisch gefunden wird, kann manuell zugewiesen werden
- **Firefox Sync** – Manga-Mappings werden über `storage.sync` auf alle Geräte synchronisiert
- **Sync-Verlauf** – die letzten 50 Chapter sind einsehbar und können bei Bedarf nachgesynct werden
- **Kein externer Server** – alle Daten liegen lokal oder via Firefox Sync; Verbindungen nur zu `myanimelist.net`

---

## 📦 Installation

### Firefox Desktop

1. Die neueste `.xpi`-Datei aus [Releases](../../releases) herunterladen
2. Firefox öffnen → `about:addons`
3. Zahnrad-Icon → **„Add-on aus Datei installieren"**
4. `.xpi`-Datei auswählen

> Die Extension ist selbst-signiert (unlisted). Eine öffentliche AMO-Veröffentlichung erfordert ein Review durch Mozilla.

### Firefox Android

Aktuell nur über `about:debugging` mit USB-Verbindung testbar (temporäres Add-on).  
Nach einem AMO-Review wäre eine permanente Installation in Firefox für Android möglich.

---

## ⚙️ Einrichtung

### 1. MAL API App registrieren

Unter [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) eine neue App anlegen:

| Feld | Wert |
|---|---|
| App Type | `other` |
| Redirect URI | *(wird in Schritt 4 aus der Extension kopiert)* |

Nach dem Speichern die **Client ID** kopieren.

### 2. Extension installieren

Siehe [Installation](#-installation) oben.

### 3. Client ID eintragen

Extension-Icon klicken → Einstellungen (⚙️) → Client ID einfügen → **Speichern**.

### 4. Redirect URI bei MAL eintragen

In den Einstellungen der Extension wird die Redirect URI angezeigt (Format: `https://…extensions.allizom.org/`).  
Diese URI in der [MAL App-Konfiguration](https://myanimelist.net/apiconfig) im Feld **Redirect URI** eintragen und speichern.

> Die URI ist an die Gecko-ID der signierten Extension gebunden und ändert sich nicht.

### 5. Mit MAL anmelden

Popup öffnen → **„Mit MAL anmelden"** klicken → Browser-Tab öffnet sich → MAL-Login bestätigen.

---

## 🔧 Entwicklung

### Voraussetzungen

- Firefox 142+
- Node.js + npm
- [web-ext](https://github.com/mozilla/web-ext)

### Setup

```bash
git clone <repo>
cd rolia-to-mal-firefox
npm install
```

### Lint

```bash
npx web-ext lint
```

### Temporär in Firefox laden

```bash
npx web-ext run
```

oder manuell: `about:debugging` → **„Temporäres Add-on laden"** → `manifest.json` auswählen.

### Signieren (AMO – unlisted)

```bash
npx web-ext sign \
  --api-key="user:DEIN_JWT_ISSUER" \
  --api-secret="DEIN_JWT_SECRET" \
  --channel=unlisted
```

API-Schlüssel unter [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key) erstellen.

### Projektstruktur

```
rolia-to-mal-firefox/
│
├── manifest.json          Manifest V2 – Permissions, Icons, Hintergrundscript
├── background.js          OAuth2 PKCE Flow, MAL API, Sync-Logik, Storage
├── content.js             Injiziert auf roliascan.com – erkennt URL und triggert Sync
│
├── popup.html / .js       Browser-Action Popup – Login-Status, Abmelden
├── options.html / .js     Einstellungsseite – Client ID, Redirect URI
├── history.html / .js     Sync-Verlauf – letzte 50 Einträge, Force-Sync
├── mapping.html / .js     Manuelles Manga-Mapping – MAL-Suche und Zuweisung
│
├── icons/                 Extension-Icons (16 / 48 / 128 px)
│
├── package.json           web-ext als devDependency
└── web-ext-config.json    Build- und Sign-Konfiguration
```

---

## 🔒 Datenschutz

- **Keine externen Server** – die Extension kommuniziert ausschließlich mit `api.myanimelist.net` und `myanimelist.net`
- **Lokale Datenhaltung** – Token, Verlauf und letzte Sync-Info liegen in `storage.local`
- **Firefox Sync** – Manga-Mappings und Client ID werden über `storage.sync` geräteübergreifend synchronisiert (optional, abhängig von Firefox-Sync-Einstellungen)
- **Client ID** – wird verschlüsselt im Firefox-Profil gespeichert und nicht an Dritte weitergegeben
- **Quellcode** – vollständig einsehbar in diesem Repository

---

## 📝 Lizenz

[MIT](LICENSE)

---

## 🙏 Credits

Erstellt mit [Claude Code](https://claude.ai/code) von [Anthropic](https://anthropic.com).
