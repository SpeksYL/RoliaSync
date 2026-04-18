/**
 * background.js — Background Script (Firefox MV2)
 * Verwaltet OAuth2 PKCE Flow, MAL API Calls, Storage und Slug-Mappings.
 */

'use strict';

// Firefox WebExtension API
const api = browser;

// ─── Konfiguration ────────────────────────────────────────────────────────────
const MAL_API_BASE           = 'https://api.myanimelist.net/v2';
const MAL_AUTH_URL           = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_TOKEN_URL          = 'https://myanimelist.net/v1/oauth2/token';
// Desktop: stabile allizom.org URI via identity.getRedirectURL()
// Android: externe URI – webNavigation fängt den Redirect ab bevor die Seite lädt
const ANDROID_REDIRECT_URI   = 'https://roliascan.com/mal-callback';
const MAX_HISTORY            = 50;
const RETRY_DELAY_MS         = 3000;

// ─── storage.sync Hilfsfunktionen ────────────────────────────────────────────
// slugMappings und mal_token liegen in storage.sync (Firefox Sync).
// Fallback auf storage.local bei Quota-Überschreitung oder fehlender Sync-Verbindung.

async function syncGet(key) {
  try {
    return await api.storage.sync.get(key);
  } catch {
    return await api.storage.local.get(key);
  }
}

async function syncSet(obj) {
  try {
    await api.storage.sync.set(obj);
  } catch {
    await api.storage.local.set(obj);
  }
}

async function syncRemove(keys) {
  // Aus sync entfernen (Fehler ignorieren falls nicht vorhanden)
  await api.storage.sync.remove(keys).catch(() => {});
  // Sicherheitshalber auch aus local entfernen (Altdaten nach Migration)
  await api.storage.local.remove(keys).catch(() => {});
}

// ─── Client-ID aus Storage lesen ─────────────────────────────────────────────
// MAL_CLIENT_ID ist nicht mehr hartcodiert – sie wird in storage.sync gespeichert
// und kann vom Nutzer in options.html eingetragen werden.

async function getClientId() {
  const { mal_client_id } = await syncGet('mal_client_id');
  if (!mal_client_id) {
    throw new Error('Keine MAL Client-ID konfiguriert – bitte in den Einstellungen eintragen');
  }
  return mal_client_id;
}

// ─── Fehlertypen ──────────────────────────────────────────────────────────────

class NotFoundError extends Error {
  constructor(slug) {
    super(`„${slug}" nicht auf MAL gefunden`);
    this.code = 'NOT_FOUND';
    this.slug = slug;
  }
}

// ─── PKCE Hilfsfunktionen ─────────────────────────────────────────────────────

function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ─── OAuth2 – Desktop (identity.launchWebAuthFlow) ───────────────────────────
// Auf Desktop: stabile allizom.org Redirect URI via browser.identity.
// Auf Android: identity.launchWebAuthFlow nicht verfügbar → Tab-basierter Flow.

async function handleOAuthCode(code) {
  try {
    await exchangeCodeForToken(code);
  } catch (err) {
    console.error('[MAL Auth] Token-Austausch fehlgeschlagen:', err.message);
    await showNotification('error', `MAL Login fehlgeschlagen: ${err.message}`);
  }
}

async function startOAuthFlowDesktop() {
  const codeVerifier = generateCodeVerifier();
  // android_redirect_uri NICHT setzen → exchangeCodeForToken nutzt identity API
  await api.storage.local.set({ pkce_verifier: codeVerifier });

  const redirectUri = api.identity.getRedirectURL();

  const authUrl = MAL_AUTH_URL + '?' + new URLSearchParams({
    response_type:         'code',
    client_id:             await getClientId(),
    redirect_uri:          redirectUri,
    code_challenge:        codeVerifier,
    code_challenge_method: 'plain',
    state:                 crypto.randomUUID(),
  }).toString();

  const responseUrl = await api.identity.launchWebAuthFlow({
    url:         authUrl,
    interactive: true,
  });

  const match = responseUrl.match(/[?&]code=([^&]+)/);
  const code  = match ? match[1] : null;

  if (!code) {
    const errMatch = responseUrl.match(/[?&]error=([^&]+)/);
    const errMsg   = errMatch ? decodeURIComponent(errMatch[1]) : 'Kein Code erhalten';
    throw new Error(`MAL Login fehlgeschlagen: ${errMsg}`);
  }

  await handleOAuthCode(code);
}

async function startOAuthFlowAndroid() {
  const codeVerifier = generateCodeVerifier();

  // Redirect URI mitspeichern damit exchangeCodeForToken sie beim Token-Austausch kennt
  await api.storage.local.set({
    pkce_verifier:        codeVerifier,
    android_redirect_uri: ANDROID_REDIRECT_URI,
  });

  const authUrl = MAL_AUTH_URL + '?' + new URLSearchParams({
    response_type:         'code',
    client_id:             await getClientId(),
    redirect_uri:          ANDROID_REDIRECT_URI,
    code_challenge:        codeVerifier,
    code_challenge_method: 'plain',
    state:                 crypto.randomUUID(),
  }).toString();

  // Beide Listener gleichzeitig – webNavigation ist schneller, tabs.onUpdated Fallback.
  // Listener VOR dem Tab-Öffnen registrieren damit kein Event verpasst wird.

  let handled = false;

  function cleanup(tabId) {
    api.webNavigation.onBeforeNavigate.removeListener(navListener);
    api.tabs.onUpdated.removeListener(tabListener);
    if (tabId) api.tabs.remove(tabId).catch(() => {});
  }

  function extractAndHandle(url, tabId) {
    if (handled) return;
    const match = url.match(/[?&]code=([^&]+)/);
    const code  = match ? match[1] : null;
    if (!code) return;
    handled = true;
    cleanup(tabId);
    handleOAuthCode(code);
  }

  // Listener 1: webNavigation (schneller, fängt Navigation vor dem Laden ab)
  const navListener = (details) => {
    if (details.url.includes('mal-callback') || details.url.includes('code=')) {
      extractAndHandle(details.url, details.tabId);
    }
  };

  api.webNavigation.onBeforeNavigate.addListener(navListener, {
    url: [{ urlContains: 'roliascan.com' }],
  });

  // Listener 2: tabs.onUpdated (Fallback falls webNavigation zu spät feuert)
  const tabListener = (tabId, changeInfo) => {
    if (changeInfo.url &&
        (changeInfo.url.includes('mal-callback') || changeInfo.url.includes('code='))) {
      extractAndHandle(changeInfo.url, tabId);
    }
  };

  api.tabs.onUpdated.addListener(tabListener);

  await api.tabs.create({ url: authUrl });
}

async function startOAuthFlow() {
  const hasWebAuthFlow = typeof api.identity !== 'undefined' &&
                         typeof api.identity.launchWebAuthFlow === 'function';
  if (hasWebAuthFlow) {
    return startOAuthFlowDesktop();
  }
  return startOAuthFlowAndroid();
}

// ─── Token-Austausch ─────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const clientId = await getClientId();
  const stored   = await api.storage.local.get(['pkce_verifier', 'android_redirect_uri']);
  const pkce_verifier = stored.pkce_verifier;

  // Android Flow speichert Redirect URI; Desktop nutzt identity.getRedirectURL()
  let redirectUri;
  if (stored.android_redirect_uri) {
    redirectUri = stored.android_redirect_uri;
  } else if (api.identity && api.identity.getRedirectURL) {
    redirectUri = api.identity.getRedirectURL();
  } else {
    throw new Error('Redirect URI nicht verfügbar – bitte erneut anmelden');
  }

  if (!pkce_verifier) {
    throw new Error('PKCE-Verifier nicht im Storage – bitte erneut anmelden');
  }

  const body = new URLSearchParams({
    client_id:     clientId,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    code_verifier: pkce_verifier,
  });

  const res = await fetch(MAL_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token-Austausch fehlgeschlagen: ${res.status} – ${text}`);
  }

  const data = await res.json();
  await saveToken(data);
  await api.storage.local.remove(['pkce_verifier', 'android_redirect_uri']);
}

// ─── Token-Verwaltung ─────────────────────────────────────────────────────────

async function refreshAccessToken() {
  const clientId      = await getClientId();
  const { mal_token } = await syncGet('mal_token');
  if (!mal_token?.refresh_token) throw new Error('Kein Refresh-Token vorhanden');

  const body = new URLSearchParams({
    client_id:     clientId,
    grant_type:    'refresh_token',
    refresh_token: mal_token.refresh_token,
  });

  const res = await fetch(MAL_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) throw new Error(`Token-Refresh fehlgeschlagen: ${res.status}`);

  const data = await res.json();
  await saveToken(data);
}

async function saveToken(data) {
  const token = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    Date.now() + data.expires_in * 1000,
  };
  await syncSet({ mal_token: token });
}

async function getValidToken() {
  const { mal_token } = await syncGet('mal_token');
  if (!mal_token) throw new Error('Nicht eingeloggt');

  if (Date.now() >= mal_token.expires_at - 60_000) {
    await refreshAccessToken();
    const { mal_token: refreshed } = await syncGet('mal_token');
    return refreshed.access_token;
  }

  return mal_token.access_token;
}

// ─── MAL API ──────────────────────────────────────────────────────────────────

async function malRequest(method, path, body = null, retry = true) {
  let token;
  try {
    token = await getValidToken();
  } catch {
    throw new Error('Nicht eingeloggt');
  }

  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` },
  };

  if (body) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(body).toString();
  }

  const res = await fetch(`${MAL_API_BASE}${path}`, options);

  if (res.status === 401 && retry) {
    await refreshAccessToken();
    return malRequest(method, path, body, false);
  }

  return res;
}

async function searchMangaPublic(query) {
  const clientId = await getClientId();
  const res = await fetch(
    `${MAL_API_BASE}/manga?q=${encodeURIComponent(query)}&limit=10&fields=id,title`,
    { headers: { 'X-MAL-CLIENT-ID': clientId } }
  );
  if (!res.ok) throw new Error(`MAL-Suche fehlgeschlagen: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).map(item => ({
    id:    item.node.id,
    title: item.node.title,
  }));
}

async function searchMangaAuth(slug) {
  const query = slug.replace(/-/g, ' ');
  const res   = await malRequest(
    'GET',
    `/manga?q=${encodeURIComponent(query)}&limit=5&fields=id,title`
  );

  if (!res.ok) throw new Error(`MAL-Suche fehlgeschlagen: ${res.status}`);

  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;

  return { id: data.data[0].node.id, title: data.data[0].node.title };
}

async function updateMangaProgress(malId, chapterNum) {
  const res = await malRequest(
    'PATCH',
    `/manga/${malId}/my_list_status`,
    { num_chapters_read: chapterNum, status: 'reading' }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MAL-Update fehlgeschlagen: ${res.status} – ${text}`);
  }

  return res.json();
}

async function getMALUsername() {
  const res = await malRequest('GET', '/users/@me?fields=name');
  if (!res.ok) return null;
  const data = await res.json();
  return data.name ?? null;
}

// ─── MAL Listen-Status ────────────────────────────────────────────────────────

async function getMalListStatus(malId) {
  const token = await getValidToken();
  const res   = await fetch(
    `${MAL_API_BASE}/manga/${malId}?fields=my_list_status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`MAL Status-Abfrage fehlgeschlagen: ${res.status}`);
  const data = await res.json();
  return data.my_list_status?.num_chapters_read ?? 0;
}

// ─── Slug-Mapping ─────────────────────────────────────────────────────────────

async function getMalId(slug) {
  const { slugMappings = {} } = await syncGet('slugMappings');

  if (slugMappings[slug]) {
    const mapping = slugMappings[slug];
    return { malId: mapping.id, malTitle: mapping.title };
  }

  const result = await searchMangaAuth(slug);
  if (result) {
    return { malId: result.id, malTitle: result.title };
  }

  throw new NotFoundError(slug);
}

async function saveSlugMapping(slug, malId, malTitle) {
  const { slugMappings = {} } = await syncGet('slugMappings');
  slugMappings[slug] = { id: malId, title: malTitle };
  await syncSet({ slugMappings });
}

// ─── Sync-Logik ───────────────────────────────────────────────────────────────

async function syncChapter(slug, chapter) {
  const chapterNum = Number(chapter);

  // Duplikat-Schutz: gleicher Chapter wie zuletzt gesynct → lautlos überspringen
  const { last_sync } = await api.storage.local.get('last_sync');
  if (last_sync?.slug === slug && String(last_sync?.chapter) === String(chapter)) {
    return;
  }

  const historyEntry = {
    manga:     slug,
    malTitle:  null,
    chapter,
    timestamp: Date.now(),
    status:    'pending',
    errorMsg:  null,
  };

  const handleNotFound = async () => {
    historyEntry.status   = 'not_found';
    historyEntry.errorMsg = 'Nicht auf MAL gefunden – Manuell zuweisen';
    await api.storage.local.set({ pending_sync: { slug, chapter } });
    api.notifications.create(`not_found_${slug}`, {
      type:     'basic',
      iconUrl:  'icons/icon48.png',
      title:    '⚠️ RoliaSync',
      message:  `${slug} nicht auf MAL gefunden – Manuell zuweisen?`,
      priority: 1,
    });
  };

  const doSync = async () => {
    const { malId, malTitle } = await getMalId(slug);
    historyEntry.malTitle = malTitle;

    // Aktuellen MAL-Fortschritt abrufen
    const currentChapter = await getMalListStatus(malId);

    if (chapterNum === currentChapter) {
      return 'skip';
    }

    if (chapterNum < currentChapter) {
      // Rückschritt → überspringen, Nutzer informieren
      api.notifications.create(`skipped_${slug}`, {
        type:    'basic',
        iconUrl: 'icons/icon48.png',
        title:   '⏭️ Sync übersprungen',
        message: `Ch.${chapter} bereits auf MAL vorhanden (Ch.${currentChapter}). Im Verlauf kannst du den Sync manuell auslösen.`,
      });
      historyEntry.status   = 'skipped';
      historyEntry.malId    = malId;
      historyEntry.errorMsg = `MAL-Stand: Ch.${currentChapter}`;
      return 'skipped';
    }

    // Normaler Vorwärts-Sync
    await updateMangaProgress(malId, chapterNum);
    historyEntry.status = 'success';
    await api.storage.local.set({ last_sync: { slug, chapter: String(chapter) } });
    await showNotification('success', `${malTitle} – Chapter ${chapter} auf MAL gespeichert`);
    return 'synced';
  };

  let result;
  try {
    result = await doSync();
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      await handleNotFound();
      await addHistoryEntry(historyEntry);
      return;
    }

    console.warn(`[MAL Sync] Fehler, Retry in ${RETRY_DELAY_MS}ms:`, err.message);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

    try {
      result = await doSync();
    } catch (retryErr) {
      if (retryErr.code === 'NOT_FOUND') {
        await handleNotFound();
      } else {
        historyEntry.status   = 'error';
        historyEntry.errorMsg = retryErr.message;
        await showNotification('error', `Sync fehlgeschlagen: ${retryErr.message}`);
      }
    }
  }

  // 'skip' → kein History-Eintrag
  if (result === 'skip') return;

  await addHistoryEntry(historyEntry);
}

// ─── History ──────────────────────────────────────────────────────────────────

async function addHistoryEntry(entry) {
  const { sync_history = [] } = await api.storage.local.get('sync_history');
  sync_history.unshift(entry);
  if (sync_history.length > MAX_HISTORY) sync_history.length = MAX_HISTORY;
  await api.storage.local.set({ sync_history });
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function showNotification(type, message) {
  api.notifications.create({
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   type === 'success' ? '✅ RoliaSync' : '⚠️ RoliaSync',
    message,
  });
}

api.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('not_found_')) {
    const slug = notificationId.slice('not_found_'.length);
    api.tabs.create({
      url: api.runtime.getURL(`mapping.html?slug=${encodeURIComponent(slug)}`),
    });
    api.notifications.clear(notificationId);
  }

  if (notificationId.startsWith('skipped_')) {
    api.tabs.create({ url: api.runtime.getURL('history.html') });
    api.notifications.clear(notificationId);
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const action = msg.type ?? msg.action;

  switch (action) {

    case 'SYNC_CHAPTER':
      syncChapter(msg.slug, msg.chapter)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'FORCE_SYNC':
      // Synct ohne MAL-Fortschritt-Prüfung (ausgelöst aus Verlauf)
      (async () => {
        try {
          const { manga, chapter, malId, malTitle } = msg;
          await updateMangaProgress(malId, Number(chapter));
          await api.storage.local.set({ last_sync: { slug: manga, chapter: String(chapter) } });
          await showNotification('success', `${malTitle} – Chapter ${chapter} auf MAL gespeichert`);
          await addHistoryEntry({
            manga, malTitle, chapter,
            timestamp: Date.now(),
            status:    'success',
            errorMsg:  null,
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'START_LOGIN':
      startOAuthFlow()
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
      return true;

    // Fallback: Authorization Code aus options.html ?code= Parameter
    case 'OAUTH_CODE':
      exchangeCodeForToken(msg.code)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'LOGOUT':
      (async () => {
        try {
          await syncRemove('mal_token');          // Token aus sync + local
          await api.storage.local.remove('last_sync');
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'GET_STATUS':
      (async () => {
        const { mal_token } = await syncGet('mal_token');
        const loggedIn = !!mal_token;
        let username = null;
        if (loggedIn) {
          try { username = await getMALUsername(); } catch { /* ignorieren */ }
        }
        const { sync_history = [] } = await api.storage.local.get('sync_history');
        sendResponse({ ok: true, loggedIn, username, lastEntry: sync_history[0] ?? null });
      })();
      return true;

    case 'GET_HISTORY':
      (async () => {
        const { sync_history = [] } = await api.storage.local.get('sync_history');
        sendResponse({ ok: true, history: sync_history });
      })();
      return true;

    case 'SEARCH_MAL':
      searchMangaPublic(msg.query)
        .then(results => sendResponse({ ok: true, results }))
        .catch(err    => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'SAVE_MAPPING':
      (async () => {
        try {
          await saveSlugMapping(msg.slug, msg.malId, msg.malTitle);
          const { pending_sync } = await api.storage.local.get('pending_sync');
          if (pending_sync && pending_sync.slug === msg.slug) {
            await api.storage.local.remove(['pending_sync', 'last_sync']);
            await syncChapter(msg.slug, pending_sync.chapter);
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'GET_MAPPINGS':
      (async () => {
        const { slugMappings = {} } = await syncGet('slugMappings');
        sendResponse({ ok: true, mappings: slugMappings });
      })();
      return true;

    case 'GET_CONFIG':
      (async () => {
        const { mal_client_id } = await syncGet('mal_client_id');
        // identity.getRedirectURL() nicht auf Android verfügbar → try/catch
        let firefoxRedirect = null;
        try {
          if (api.identity && api.identity.getRedirectURL) {
            firefoxRedirect = api.identity.getRedirectURL();
          }
        } catch { /* nicht verfügbar */ }
        sendResponse({
          ok:              true,
          clientId:        mal_client_id ?? '',
          firefoxRedirect,
          androidRedirect: ANDROID_REDIRECT_URI,
        });
      })();
      return true;

    case 'SAVE_CONFIG':
      (async () => {
        try {
          const id = (msg.clientId ?? '').trim();
          if (!id) throw new Error('Client-ID darf nicht leer sein');
          await syncSet({ mal_client_id: id });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    default:
      sendResponse({ ok: false, error: 'Unbekannte Nachricht' });
  }
});

// ─── Erster Start: Einstellungsseite öffnen wenn Client-ID fehlt ─────────────

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const { mal_client_id } = await syncGet('mal_client_id');
    if (!mal_client_id) {
      api.tabs.create({ url: api.runtime.getURL('options.html') });
    }
  }
});
