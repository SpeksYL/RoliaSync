# RoliaSync

[![Mozilla Add-on](https://img.shields.io/amo/v/34d392fd972b4568940c?label=Firefox%20Add-on)](https://addons.mozilla.org/firefox/addon/roliasync/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Firefox extension that automatically syncs your manga reading progress from [roliascan.com](https://roliascan.com) to [MyAnimeList](https://myanimelist.net).

<!-- Screenshot placeholder -->
<!-- ![Popup screenshot](docs/screenshot-popup.png) -->

---

## Features

- **Chapter sync** — automatically updates MAL when you open a chapter on roliascan.com
- **Status sync** — detects reading status changes on manga detail pages and mirrors them to MAL
- **Auto reading status** — sets *reading* on first chapter, *completed* or *on hold* on last chapter
- **Bulk import** — import your entire roliascan bookmarks library to MAL in one click
- **Mappings tab** — review, edit, and delete slug→MAL mappings; per-manga sync toggle
- **Sync history** — last 50 chapter and status syncs with force-sync option for skipped entries
- **Skipped-chapter detection** — warns when MAL is already ahead, with manual override
- **Cross-device sync** — mappings and settings sync via Firefox Sync
- **Android support** — works on Firefox for Android (tab-based OAuth flow)

---

## Installation

### Firefox Desktop & Android

→ **[Install from Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/roliasync/)**

Or install manually:
1. Download the latest `.xpi` from [Releases](https://github.com/SpeksYL/RoliaSync/releases)
2. Firefox → `about:addons` → ⚙️ → *Install Add-on From File…*

---

## Setup

### 1 — Create a MAL API app

Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) and create a new application:

| Field | Value |
|---|---|
| App Type | `other` |
| App Redirect URL | *(leave blank for now — fill in after step 3)* |

### 2 — Enter your Client ID

Open the extension settings (click the extension icon → Settings, or `about:addons`):

- Paste your **Client ID** → click **Save**

### 3 — Add the Redirect URI

The settings page shows two redirect URIs:

| URI | Platform |
|---|---|
| **Firefox Redirect URI** | Desktop Firefox — copy this into your MAL app config |
| **Android Redirect URI** (`https://roliascan.com/mal-callback`) | Firefox for Android |

The redirect URI tells MAL where to send the login token after you authorize the extension.
You only need to configure this once — it never changes.

### 4 — Sign in

Click **Sign in with MAL** in the popup. A login window opens — authorize the app and you're done.

---

## How it works

- **Chapter sync**: the content script reads the chapter number from the URL (`/read/{slug}/ch{N}-{page}`) and calls `PATCH /v2/manga/{id}/my_list_status` via the MAL API.
- **Status sync**: a script injected into manga detail pages (`/manga/{slug}/`) intercepts `POST /auth/manga-status` and mirrors the new status to MAL — only if it actually changed.
- **Slug mapping**: roliascan slugs are matched to MAL IDs via the MAL search API. Confirmed mappings are stored in `storage.sync` and reused on every subsequent sync.
- **No server**: all data stays in your browser. The extension only communicates with `api.myanimelist.net`.

---

## Privacy

- No data is sent to any server other than `api.myanimelist.net`
- Your MAL token is stored locally in `storage.sync` (synced via Firefox Sync if enabled)
- No analytics, no tracking, no external requests except MAL API calls

---

## Changelog

| Version | Highlights |
|---|---|
| **v1.3.9** | Code cleanup, popup size fix (380×500px), README + AMO description |
| **v1.3.8** | Fetch interceptor via page-world script injection (fixes content script isolation) |
| **v1.3.7** | Fetch interceptor: slug extracted from page URL instead of POST body |
| **v1.3.6** | Fetch interceptor scoped to manga detail pages (`/manga/{slug}/`) |
| **v1.3.5** | Full status sync, per-manga sync toggle, status entries in history |
| **v1.3.4** | AMO linter fixes: inline scripts extracted, `innerHTML` replaced with DOM clone |
| **v1.3.1** | Unified options page — 5 tabs: General, Notifications, Auto Status, Import, Mappings |
| **v1.3.0** | Bulk import from bookmarks, status sync (Rolia→MAL), auto reading status |
| **v1.2.4** | Notification settings: browser notifications + in-page toast, errors-only mode |
| **v1.0.0** | Initial release: chapter sync, OAuth2 PKCE, slug mappings, sync history |

---

## AMO Description

RoliaSync automatically syncs your manga reading progress from roliascan.com to your MyAnimeList account — no manual updates needed.

**Chapter sync**
Every time you open a chapter on roliascan.com, RoliaSync automatically updates your MAL reading progress. Duplicate syncs and backwards navigation are detected and skipped — with a manual force-sync option when needed.

**Status sync**
When you change the reading status of a manga on its detail page (e.g. from *Reading* to *Completed*), RoliaSync detects the change and mirrors it to MAL in real time.

**Auto reading status**
RoliaSync can automatically set your MAL status to *Reading* on the first chapter, and *Completed* or *On Hold* when you reach the last chapter — depending on whether the manga is finished or ongoing.

**Bulk import**
Import your entire roliascan bookmarks library to MAL in one click. RoliaSync matches each manga to its MAL entry, shows confidence badges (✅ Matched / ⚠️ Approximate / ❌ Not found), and lets you correct any mismatch before importing.

**Mappings**
The Mappings tab shows all saved slug→MAL assignments. You can search for the correct MAL title, edit or delete existing mappings, and toggle sync on or off per manga.

**Privacy**
RoliaSync does not use any server. All data is stored locally in your browser. The only external communication is with api.myanimelist.net using your own MAL API key.

**Setup**
1. Create a MAL API app at myanimelist.net/apiconfig (App Type: other)
2. Open the extension settings, enter your Client ID, and copy the Redirect URI shown there into your MAL app config
3. Click "Sign in with MAL" in the popup

Works on Firefox Desktop and Firefox for Android.

---

## License

MIT
