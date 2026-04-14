![Firefox](https://img.shields.io/badge/Firefox-142%2B-FF7139?logo=firefox-browser&logoColor=white)
![Lizenz](https://img.shields.io/badge/Lizenz-MIT-green)
![Version](https://img.shields.io/badge/Version-1.1.3-blue)
![GitHub Stars](https://img.shields.io/github/stars/SpeksYL/RoliaSync?style=flat)

# RoliaSync

> Firefox-Extension die gelesene Manga-Chapter von [roliascan.com](https://roliascan.com) automatisch auf [MyAnimeList](https://myanimelist.net) synct.

![RoliaSync Popup](icons/icon128.png)

---

## ✨ Features

- **Automatischer Sync** – Chapter wird beim Öffnen erkannt und sofort auf MAL gespeichert
- **Rückschritt-Erkennung** – liegt der gelesene Chapter hinter dem MAL-Stand, erscheint eine Benachrichtigung; manueller Force-Sync direkt im Verlauf möglich
- **Duplikat-Schutz** – bereits gesyncte Chapter werden lautlos übersprungen
- **Manuelles Manga-Mapping** – Manga der auf MAL nicht automatisch gefunden wird, kann manuell zugewiesen werden
- **Firefox Sync** – Manga-Mappings werden über `storage.sync` auf alle Geräte synchronisiert
- **Sync-Verlauf** – die letzten 50 Chapter sind einsehbar und können bei Bedarf nachgesynct werden
- **Stabile Redirect URI** – an die Gecko-ID gebunden, ändert sich nie
- **Keine externen Server** – alle Daten liegen lokal oder via Firefox Sync; Verbindungen nur zu `myanimelist.net`

---

## 📦 Installation

### Firefox Desktop

**Option A – AMO (empfohlen)**

> AMO-Review ausstehend — Link folgt nach Freigabe.

**Option B – Manuell via XPI**

1. Die neueste `.xpi`-Datei aus [Releases](../../releases) herunterladen
2. Firefox öffnen → `about:addons`
3. Zahnrad-Icon → **„Add-on aus Datei installieren"**
4. `.xpi`-Datei auswählen

### Firefox Android

Nach einem AMO-Review automatisch in Firefox für Android verfügbar.  
Aktuell nur temporär über `about:debugging` + USB testbar.

---

## ⚙️ Einrichtung

### 1. MAL API App registrieren

Unter [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) eine neue App anlegen:

| Feld | Wert |
|---|---|
| App Type | `other` |
| Redirect URI | *(wird in Schritt 4 aus der Extension kopiert)* |
| Commercial / Non-Commercial | `non-commercial` |

Nach dem Speichern die **Client ID** kopieren.

### 2. Extension installieren

Siehe [Installation](#-installation) oben.

### 3. Client ID eintragen

Extension-Icon klicken → Einstellungen (⚙️) → Client ID einfügen → **Speichern**.

### 4. Redirect URI bei MAL eintragen

In den Einstellungen der Extension wird die Redirect URI angezeigt.  
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
git clone https://github.com/SpeksYL/RoliaSync.git
cd RoliaSync
npm install
```

### Befehle

```bash
# Linting
npx web-ext lint

# Lokaler Test in Firefox
npx web-ext run

# ZIP bauen
npx web-ext build

# AMO-Signierung (unlisted)
npx web-ext sign \
  --api-key="user:DEIN_JWT_ISSUER" \
  --api-secret="DEIN_JWT_SECRET" \
  --channel=unlisted
```

API-Schlüssel unter [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key) erstellen.

### Projektstruktur

```
RoliaSync/
│
├── manifest.json          Manifest V2 – Permissions, Icons, Hintergrundscript
├── background.js          OAuth2 PKCE Flow, MAL API, Sync-Logik, Storage
├── content.js             Injiziert auf roliascan.com – erkennt URL und triggert Sync
│
├── popup.html / .js       Browser-Action Popup – Login-Status, letzter Sync
├── options.html / .js     Einstellungsseite – Client ID, Redirect URI
├── history.html / .js     Sync-Verlauf – letzte 50 Einträge, Force-Sync
├── mapping.html / .js     Manuelles Manga-Mapping – MAL-Suche und Zuweisung
│
├── icons/                 Extension-Icons (16 / 32 / 48 / 128 / 512 px)
│
├── package.json           web-ext als devDependency
└── web-ext-config.json    Build- und Sign-Konfiguration
```

---

## 🔒 Datenschutz

- **Keine externen Server** – die Extension kommuniziert ausschließlich mit `api.myanimelist.net` und `myanimelist.net`
- **Lokale Datenhaltung** – Token, Verlauf und letzte Sync-Info liegen in `storage.local`
- **Firefox Sync** – Manga-Mappings und Client ID werden über `storage.sync` geräteübergreifend synchronisiert
- **Client ID** – wird verschlüsselt im Firefox-Profil gespeichert und nicht an Dritte weitergegeben
- **Quellcode** – vollständig einsehbar in diesem Repository

---

## 📝 Lizenz

[MIT](LICENSE)

---

## 🙏 Credits

- Erstellt mit [Claude Code](https://claude.ai/code) von [Anthropic](https://anthropic.com)
- Icon: Flux 1.1 Pro by Black Forest Labs
- Dragon-Design inspiriert von [Roliascan.com](https://roliascan.com)
