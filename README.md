# RoliaSync

[![Mozilla Add-on](https://img.shields.io/amo/v/34d392fd972b4568940c?label=Firefox%20Add-on)](https://addons.mozilla.org/firefox/addon/34d392fd972b4568940c/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Firefox extension that automatically syncs your manga reading progress from [roliascan.com](https://roliascan.com) to [MyAnimeList](https://myanimelist.net).

![Icon](icons/icon128.png)

## Features

- Auto-sync when opening a chapter
- Skips duplicate syncs
- Detects chapter rollbacks with manual force-sync option
- Manual manga mapping for unrecognized titles
- Sync history (last 50 chapters)
- Mappings sync across devices via Firefox Sync

## Installation

→ [Install from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/34d392fd972b4568940c/)

## Setup

1. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) and create a new app
   - App Type: `other`
   - Redirect URI: *(copy from extension settings — see step 3)*
2. Open extension settings → enter your **Client ID** → Save
3. Copy the **Redirect URI** shown in settings → paste into your MAL app config
4. Click **Sign in with MAL** in the popup

## License

MIT
