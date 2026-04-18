/**
 * background.js — Background Script (Firefox MV2)
 * Manages OAuth2 PKCE flow, MAL API calls, storage, and slug mappings.
 */

'use strict';

// Firefox WebExtension API
const api = browser;

// ─── Configuration ────────────────────────────────────────────────────────────
const MAL_API_BASE           = 'https://api.myanimelist.net/v2';
const MAL_AUTH_URL           = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_TOKEN_URL          = 'https://myanimelist.net/v1/oauth2/token';
// Desktop: stable allizom.org URI via identity.getRedirectURL()
// Android: external URI — webNavigation intercepts the redirect before the page loads
const ANDROID_REDIRECT_URI   = 'https://roliascan.com/mal-callback';
const MAX_HISTORY            = 50;
const RETRY_DELAY_MS         = 3000;

// ─── storage.sync helpers ─────────────────────────────────────────────────────
// slugMappings and mal_token are stored in storage.sync (Firefox Sync).
// Falls back to storage.local on quota exceeded or missing sync connection.

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
  // Remove from sync (ignore error if not present)
  await api.storage.sync.remove(keys).catch(() => {});
  // Also remove from local (legacy data after migration)
  await api.storage.local.remove(keys).catch(() => {});
}

// ─── Client ID ────────────────────────────────────────────────────────────────
// MAL_CLIENT_ID is not hardcoded — stored in storage.sync and set by the user in options.html.

async function getClientId() {
  const { mal_client_id } = await syncGet('mal_client_id');
  if (!mal_client_id) {
    throw new Error('No MAL Client ID configured — please enter one in the settings');
  }
  return mal_client_id;
}

// ─── Error types ──────────────────────────────────────────────────────────────

class NotFoundError extends Error {
  constructor(slug) {
    super(`"${slug}" not found on MAL`);
    this.code = 'NOT_FOUND';
    this.slug = slug;
  }
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

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

// ─── OAuth2 — Desktop (identity.launchWebAuthFlow) ───────────────────────────
// Desktop: stable allizom.org redirect URI via browser.identity.
// Android: identity.launchWebAuthFlow not available → tab-based flow.

async function handleOAuthCode(code) {
  try {
    await exchangeCodeForToken(code);
  } catch (err) {
    console.error('[MAL Auth] Token exchange failed:', err.message);
    await showNotification('error', `MAL login failed: ${err.message}`);
  }
}

async function startOAuthFlowDesktop() {
  const codeVerifier = generateCodeVerifier();
  // Do NOT set android_redirect_uri → exchangeCodeForToken uses identity API
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
    const errMsg   = errMatch ? decodeURIComponent(errMatch[1]) : 'No code received';
    throw new Error(`MAL login failed: ${errMsg}`);
  }

  await handleOAuthCode(code);
}

async function startOAuthFlowAndroid() {
  const codeVerifier = generateCodeVerifier();

  // Store redirect URI so exchangeCodeForToken knows it during token exchange
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

  // Both listeners registered simultaneously — webNavigation is faster, tabs.onUpdated is the fallback.
  // Register listeners BEFORE opening the tab so no event is missed.

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

  // Listener 1: webNavigation (faster, intercepts navigation before the page loads)
  const navListener = (details) => {
    if (details.url.includes('mal-callback') || details.url.includes('code=')) {
      extractAndHandle(details.url, details.tabId);
    }
  };

  api.webNavigation.onBeforeNavigate.addListener(navListener, {
    url: [{ urlContains: 'roliascan.com' }],
  });

  // Listener 2: tabs.onUpdated (fallback in case webNavigation fires too late)
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

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const clientId = await getClientId();
  const stored   = await api.storage.local.get(['pkce_verifier', 'android_redirect_uri']);
  const pkce_verifier = stored.pkce_verifier;

  // Android flow stores redirect URI; desktop uses identity.getRedirectURL()
  let redirectUri;
  if (stored.android_redirect_uri) {
    redirectUri = stored.android_redirect_uri;
  } else if (api.identity && api.identity.getRedirectURL) {
    redirectUri = api.identity.getRedirectURL();
  } else {
    throw new Error('Redirect URI not available — please sign in again');
  }

  if (!pkce_verifier) {
    throw new Error('PKCE verifier missing from storage — please sign in again');
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
    throw new Error(`Token exchange failed: ${res.status} — ${text}`);
  }

  const data = await res.json();
  await saveToken(data);
  await api.storage.local.remove(['pkce_verifier', 'android_redirect_uri']);
}

// ─── Token management ─────────────────────────────────────────────────────────

async function refreshAccessToken() {
  const clientId      = await getClientId();
  const { mal_token } = await syncGet('mal_token');
  if (!mal_token?.refresh_token) throw new Error('No refresh token available');

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

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

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
  if (!mal_token) throw new Error('Not signed in');

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
    throw new Error('Not signed in');
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
  if (!res.ok) throw new Error(`MAL search failed: ${res.status}`);
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

  if (!res.ok) throw new Error(`MAL search failed: ${res.status}`);

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
    throw new Error(`MAL update failed: ${res.status} — ${text}`);
  }

  return res.json();
}

async function getMALUsername() {
  const res = await malRequest('GET', '/users/@me?fields=name');
  if (!res.ok) return null;
  const data = await res.json();
  return data.name ?? null;
}

// ─── MAL list status ──────────────────────────────────────────────────────────

async function getMalListStatus(malId) {
  const token = await getValidToken();
  const res   = await fetch(
    `${MAL_API_BASE}/manga/${malId}?fields=my_list_status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`MAL status query failed: ${res.status}`);
  const data = await res.json();
  return data.my_list_status?.num_chapters_read ?? 0;
}

// ─── Slug mapping ─────────────────────────────────────────────────────────────

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

// ─── Notification settings ────────────────────────────────────────────────────

async function getNotificationSettings() {
  const { notification_settings } = await syncGet('notification_settings');
  return {
    browserNotifications: notification_settings?.browserNotifications ?? true,
    inPageToast:          notification_settings?.inPageToast          ?? true,
    errorsOnly:           notification_settings?.errorsOnly           ?? false,
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function showNotification(type, message, tabId = null) {
  const settings = await getNotificationSettings();

  // If errorsOnly is on, suppress success notifications
  if (settings.errorsOnly && type === 'success') return;

  // Browser notification (not available on Android)
  if (settings.browserNotifications) {
    try {
      api.notifications.create({
        type:    'basic',
        iconUrl: 'icons/icon48.png',
        title:   type === 'success' ? '✅ RoliaSync' : '⚠️ RoliaSync',
        message,
      });
    } catch { /* browser.notifications not available on this platform */ }
  }

  // In-page toast via content script (useful on Android)
  if (settings.inPageToast && tabId != null) {
    api.tabs.sendMessage(tabId, {
      action:  'SHOW_TOAST',
      message,
      type:    type === 'success' ? 'success' : 'error',
    }).catch(() => { /* content script may not be ready */ });
  }
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

// ─── Sync logic ───────────────────────────────────────────────────────────────

async function syncChapter(slug, chapter, tabId = null) {
  const chapterNum = Number(chapter);

  // Duplicate guard: same chapter as last sync → skip silently
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
    historyEntry.errorMsg = 'Not found on MAL — assign manually';
    await api.storage.local.set({ pending_sync: { slug, chapter } });
    try {
      api.notifications.create(`not_found_${slug}`, {
        type:     'basic',
        iconUrl:  'icons/icon48.png',
        title:    '⚠️ RoliaSync',
        message:  `${slug} not found on MAL — assign manually?`,
        priority: 1,
      });
    } catch { /* browser.notifications not available */ }
  };

  const doSync = async () => {
    const { malId, malTitle } = await getMalId(slug);
    historyEntry.malTitle = malTitle;

    // Fetch current MAL progress
    const currentChapter = await getMalListStatus(malId);

    if (chapterNum === currentChapter) {
      return 'skip';
    }

    if (chapterNum < currentChapter) {
      // Backward — skip and inform user
      try {
        api.notifications.create(`skipped_${slug}`, {
          type:    'basic',
          iconUrl: 'icons/icon48.png',
          title:   '⏭️ Sync skipped',
          message: `Ch.${chapter} already on MAL (Ch.${currentChapter}). You can force sync from the history page.`,
        });
      } catch { /* browser.notifications not available */ }
      historyEntry.status   = 'skipped';
      historyEntry.malId    = malId;
      historyEntry.errorMsg = `MAL progress: Ch.${currentChapter}`;
      return 'skipped';
    }

    // Normal forward sync
    await updateMangaProgress(malId, chapterNum);
    historyEntry.status = 'success';
    await api.storage.local.set({ last_sync: { slug, chapter: String(chapter) } });
    await showNotification('success', `${malTitle} — Chapter ${chapter} saved to MAL`, tabId);
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

    console.warn(`[MAL Sync] Error, retrying in ${RETRY_DELAY_MS}ms:`, err.message);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

    try {
      result = await doSync();
    } catch (retryErr) {
      if (retryErr.code === 'NOT_FOUND') {
        await handleNotFound();
      } else {
        historyEntry.status   = 'error';
        historyEntry.errorMsg = retryErr.message;
        await showNotification('error', `Sync failed: ${retryErr.message}`, tabId);
      }
    }
  }

  // 'skip' → no history entry
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

// ─── Message handlers ─────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const action = msg.type ?? msg.action;

  switch (action) {

    case 'SYNC_CHAPTER':
      syncChapter(msg.slug, msg.chapter, _sender.tab?.id ?? null)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'FORCE_SYNC':
      // Syncs without MAL progress check (triggered from history page)
      (async () => {
        try {
          const { manga, chapter, malId, malTitle } = msg;
          await updateMangaProgress(malId, Number(chapter));
          await api.storage.local.set({ last_sync: { slug: manga, chapter: String(chapter) } });
          await showNotification('success', `${malTitle} — Chapter ${chapter} saved to MAL`);
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

    // Fallback: authorization code from options.html ?code= parameter
    case 'OAUTH_CODE':
      exchangeCodeForToken(msg.code)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'LOGOUT':
      (async () => {
        try {
          await syncRemove('mal_token');
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
          try { username = await getMALUsername(); } catch { /* ignore */ }
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
        // identity.getRedirectURL() not available on Android → try/catch
        let firefoxRedirect = null;
        try {
          if (api.identity && api.identity.getRedirectURL) {
            firefoxRedirect = api.identity.getRedirectURL();
          }
        } catch { /* not available */ }
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
          if (!id) throw new Error('Client ID must not be empty');
          await syncSet({ mal_client_id: id });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'GET_NOTIFICATION_SETTINGS':
      (async () => {
        try {
          const settings = await getNotificationSettings();
          sendResponse({ ok: true, settings });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'SAVE_NOTIFICATION_SETTINGS':
      (async () => {
        try {
          const settings = {
            browserNotifications: msg.settings?.browserNotifications ?? true,
            inPageToast:          msg.settings?.inPageToast          ?? true,
            errorsOnly:           msg.settings?.errorsOnly           ?? false,
          };
          await syncSet({ notification_settings: settings });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
  }
});

// ─── First install: open settings page if Client ID is missing ────────────────

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const { mal_client_id } = await syncGet('mal_client_id');
    if (!mal_client_id) {
      api.tabs.create({ url: api.runtime.getURL('options.html') });
    }
  }
});
