/**
 * background.js — Background Script (Firefox MV2)
 * Manages OAuth2 PKCE flow, MAL API calls, storage, slug mappings,
 * bulk import, status sync, and auto-status on reading.
 */

'use strict';

const api = browser;

// ─── Configuration ────────────────────────────────────────────────────────────
const MAL_API_BASE           = 'https://api.myanimelist.net/v2';
const MAL_AUTH_URL           = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_TOKEN_URL          = 'https://myanimelist.net/v1/oauth2/token';
const ANDROID_REDIRECT_URI   = 'https://roliascan.com/mal-callback';
const MAX_HISTORY            = 50;
const RETRY_DELAY_MS         = 3000;

// ─── storage.sync helpers ─────────────────────────────────────────────────────

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
  await api.storage.sync.remove(keys).catch(() => {});
  await api.storage.local.remove(keys).catch(() => {});
}

// ─── Client ID ────────────────────────────────────────────────────────────────

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

// ─── OAuth2 ───────────────────────────────────────────────────────────────────

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

  const navListener = (details) => {
    if (details.url.includes('mal-callback') || details.url.includes('code=')) {
      extractAndHandle(details.url, details.tabId);
    }
  };

  api.webNavigation.onBeforeNavigate.addListener(navListener, {
    url: [{ urlContains: 'roliascan.com' }],
  });

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
  if (hasWebAuthFlow) return startOAuthFlowDesktop();
  return startOAuthFlowAndroid();
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const clientId      = await getClientId();
  const stored        = await api.storage.local.get(['pkce_verifier', 'android_redirect_uri']);
  const pkce_verifier = stored.pkce_verifier;

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

// Update chapter progress, and optionally set reading status + date fields.
// status = null means don't change the status field (MAL keeps existing).
async function updateMangaProgress(malId, chapterNum, status = null, currentInfo = null) {
  const body = { num_chapters_read: chapterNum };
  if (status) {
    const statusBody = buildStatusPatchBody(status, currentInfo);
    Object.assign(body, statusBody);
  }

  const res = await malRequest('PATCH', `/manga/${malId}/my_list_status`, body);

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

// ─── MAL manga info (chapter progress + publication status) ───────────────────

async function getMalMangaInfo(malId) {
  const token = await getValidToken();
  const res   = await fetch(
    `${MAL_API_BASE}/manga/${malId}?fields=num_chapters,my_list_status{status,num_chapters_read,start_date,finish_date},status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`MAL info query failed: ${res.status}`);
  const data = await res.json();
  return {
    numChapters:  data.num_chapters ?? 0,
    malStatus:    data.status ?? '',
    listStatus:   data.my_list_status?.status         ?? null,
    chaptersRead: data.my_list_status?.num_chapters_read ?? 0,
    startDate:    data.my_list_status?.start_date      ?? null,
    finishDate:   data.my_list_status?.finish_date     ?? null,
  };
}

// Build PATCH body for a status change, adding start/finish date only when not yet set.
function buildStatusPatchBody(status, currentInfo = null) {
  const body = { status };
  const today = new Date().toISOString().split('T')[0];
  if (status === 'reading'   && !currentInfo?.startDate)  body.start_date  = today;
  if (status === 'completed' && !currentInfo?.finishDate) body.finish_date = today;
  return body;
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
  const { mangaMeta = {} }    = await api.storage.local.get('mangaMeta');
  const existing = slugMappings[slug] ?? {};
  const meta     = mangaMeta[slug]    ?? {};
  slugMappings[slug] = {
    ...existing,
    ...meta,
    id:    malId,
    title: malTitle,
  };
  await syncSet({ slugMappings });
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

async function getNotificationSettings() {
  const { notification_settings } = await syncGet('notification_settings');
  return {
    errorsOnly: notification_settings?.errorsOnly ?? false,
  };
}

async function getAutoStatusSettings() {
  const { auto_status_settings } = await syncGet('auto_status_settings');
  const s = auto_status_settings ?? {};
  return {
    syncStatus:         s.syncStatus         ?? true,
    neverChange:        s.neverChange        ?? false,
    // Migrate old keys → new keys so saved preferences are preserved
    autoStatusReading:  s.autoStatusReading  ?? s.setReading   ?? true,
    autoStatusOnHold:   s.autoStatusOnHold   ?? s.setOnHold    ?? true,
    autoStatusComplete: s.autoStatusComplete ?? s.setCompleted ?? true,
    syncStatusToRolia:  s.syncStatusToRolia  ?? true,
  };
}

// ─── tabs.sendMessage with timeout ───────────────────────────────────────────

async function sendMessageToTab(tabId, message, timeout = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    api.tabs.sendMessage(tabId, message)
      .then(response => { clearTimeout(timer); resolve(response); })
      .catch(err => {
        clearTimeout(timer);
        const msg = err?.message ?? '';
        if (!msg.includes('Could not establish connection') &&
            !msg.includes('Receiving end does not exist')) {
          console.error('[RoliaSync] sendMessageToTab error:', msg);
        }
        resolve(null);
      });
  });
}

// ─── Manga meta — live fetch + cache write ────────────────────────────────────

async function getMangaMetaLive(slug, tabId) {
  if (!tabId) return null;
  try {
    const res = await sendMessageToTab(tabId, { action: 'GET_MANGA_META', slug });
    if (!res) return null;
    return {
      roliaId:       res.roliaId ? Number(res.roliaId) : null,
      isOngoing:     res.isOngoing  ?? null,
      isFinished:    res.isFinished ?? null,
      totalChapters: res.totalChapters ?? null,
    };
  } catch {
    return null;
  }
}

async function saveMangaMetaToCache(slug, meta) {
  try {
    const { slugMappings = {} } = await syncGet('slugMappings');
    if (slugMappings[slug]) {
      if (meta.roliaId   != null) slugMappings[slug].roliaId   = meta.roliaId;
      if (meta.isOngoing != null) slugMappings[slug].isOngoing = meta.isOngoing;
      if (meta.isFinished!= null) slugMappings[slug].isFinished= meta.isFinished;
      await syncSet({ slugMappings });
    } else {
      const { mangaMeta = {} } = await api.storage.local.get('mangaMeta');
      mangaMeta[slug] = {
        roliaId:    meta.roliaId,
        isOngoing:  meta.isOngoing,
        isFinished: meta.isFinished,
      };
      await api.storage.local.set({ mangaMeta });
    }
  } catch { /* non-fatal */ }
}

// ─── Rolia status API (proxied via content.js — credentialed fetch) ───────────

async function getRoliaStatus(roliaId, tabId) {
  if (!tabId) return null;
  const res = await sendMessageToTab(tabId, {
    action: 'GET_ROLIA_STATUS',
    data:   { mangaId: roliaId },
  });
  return res?.status ?? null;
}

// Slugs with an in-flight auto-status POST — prevents ROLIA_STATUS_CHANGED
// from setting autoStatusLocks when background triggered the status change.
const _autoStatusInProgress = new Set();

async function setRoliaStatus(roliaId, status, tabId, slug = null) {
  if (!tabId) return;
  if (slug) {
    _autoStatusInProgress.add(slug);
    setTimeout(() => _autoStatusInProgress.delete(slug), 5000);
  }
  await sendMessageToTab(tabId, {
    action:       'SET_ROLIA_STATUS',
    isAutoStatus: true,
    data:         { mangaId: roliaId, status },
  });
}

async function getGeneralSettings() {
  const { general_settings } = await syncGet('general_settings');
  return {
    showImportButton: general_settings?.showImportButton ?? true,
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function showNotification(type, message, tabId = null) {
  if (tabId == null) return;
  const settings = await getNotificationSettings();
  if (settings.errorsOnly && type === 'success') return;
  sendMessageToTab(tabId, {
    action:  'SHOW_TOAST',
    message,
    type:    type === 'success' ? 'success' : 'error',
  });
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

async function syncChapter(slug, chapter, tabId = null, totalRoliaChapters = null, isEndChapter = false) {
  // Respect per-manga sync toggle
  const { slugMappings: _sm = {} } = await syncGet('slugMappings');
  if (_sm[slug]?.syncEnabled === false) return;
  const mapping = _sm[slug] ?? {};

  const chapterNum = Number(chapter);

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
    await showNotification('error', `${slug} not found on MAL — assign manually`, tabId);
  };

  const doSync = async () => {
    const { malId, malTitle } = await getMalId(slug);
    historyEntry.malTitle = malTitle;

    const info = await getMalMangaInfo(malId);
    const currentChapter = info.chaptersRead;

    if (chapterNum === currentChapter) {
      console.error('[RoliaSync] Skipped reason: already at this chapter', 'slug:', slug, 'chapter:', chapterNum);
      return 'skip';
    }

    if (chapterNum < currentChapter) {
      console.error('[RoliaSync] Skipped reason: chapter behind MAL progress', 'slug:', slug, 'chapter:', chapterNum, 'malProgress:', currentChapter);
      await showNotification('error', `Ch.${chapter} already on MAL (Ch.${currentChapter}). Force sync from history.`, tabId);
      historyEntry.status   = 'skipped';
      historyEntry.malId    = malId;
      historyEntry.errorMsg = `MAL progress: Ch.${currentChapter}`;
      return 'skipped';
    }

    // Determine auto status
    const autoSettings = await getAutoStatusSettings();
    let newStatus    = null;
    let autoTrigger  = null;

    const isFirstRead = currentChapter === 0;

    // Load manga meta — prefer cached mapping fields, otherwise fetch live (awaited)
    const hasCachedMeta = mapping.isFinished != null || mapping.isOngoing != null;
    let liveMeta = null;
    if (!hasCachedMeta) {
      liveMeta = await getMangaMetaLive(slug, tabId);
      if (liveMeta) await saveMangaMetaToCache(slug, liveMeta);
    }

    const effectiveMeta = liveMeta ?? mapping;
    const malFinished   = info.malStatus === 'finished';
    const mangaFinished = effectiveMeta.isFinished ?? malFinished;
    const mangaOngoing  = effectiveMeta.isOngoing  ?? !malFinished;
    const roliaId       = effectiveMeta.roliaId    ?? null;

    const malTotal   = info.numChapters > 0 ? info.numChapters : null;
    const roliaTotal = (liveMeta?.totalChapters > 0 ? liveMeta.totalChapters : null)
                    ?? (totalRoliaChapters > 0 ? totalRoliaChapters : null);

    // isEndChapter from DOM (no "Next Chapter" link) has highest priority.
    // Fallback: chapter number comparison against known totals.
    let isLastChapter;
    if (isEndChapter) {
      isLastChapter = true;
    } else if (effectiveMeta?.isFinished) {
      // Finished manga — Rolia is authoritative; trigger on either total
      isLastChapter = (roliaTotal > 0 && chapterNum >= roliaTotal) ||
                      (malTotal   > 0 && chapterNum >= malTotal);
    } else {
      // Ongoing — use minimum so MAL specials don't delay On Hold
      const minTotal = Math.min(roliaTotal || Infinity, malTotal || Infinity);
      isLastChapter  = minTotal > 0 && minTotal < Infinity && chapterNum >= minTotal;
    }

    console.error('[RoliaSync] doSync meta:', effectiveMeta,
      'isEndChapter:', isEndChapter,
      'isLastChapter:', isLastChapter,
      'chapterNum:', chapterNum,
      'malTotal:', malTotal,
      'roliaTotal:', roliaTotal,
      'isFirstRead:', isFirstRead,
      'mangaFinished:', mangaFinished,
      'mangaOngoing:', mangaOngoing);

    if (!autoSettings.neverChange) {
      const { autoStatusLocks = [] } = await api.storage.local.get('autoStatusLocks');
      const locked = autoStatusLocks.includes(slug);

      if (!locked) {
        // Last chapter takes priority over first-chapter reading
        if (isLastChapter) {
          if (mangaFinished && autoSettings.autoStatusComplete) {
            newStatus   = 'completed';
            autoTrigger = 'last-chapter';
          } else if (mangaOngoing && autoSettings.autoStatusOnHold) {
            newStatus   = 'on_hold';
            autoTrigger = 'last-chapter';
          }
        }

        if (!autoTrigger && isFirstRead && autoSettings.autoStatusReading) {
          const roliaStatus = roliaId ? await getRoliaStatus(roliaId, tabId) : null;
          if (info.listStatus === null && (roliaStatus === null || roliaStatus === 'plan_to_read')) {
            newStatus   = 'reading';
            autoTrigger = 'first-chapter';
          }
        }
      }
    }

    // Manga not yet in list — must provide a status to create the entry
    if (info.listStatus === null && newStatus === null) {
      newStatus = 'reading';
    }

    await updateMangaProgress(malId, chapterNum, newStatus, info);
    historyEntry.status = 'success';

    // Record which date was set so history.js can show it
    const today = new Date().toISOString().split('T')[0];
    if (newStatus === 'reading'   && !info.startDate)  historyEntry.dateSet = today;
    if (newStatus === 'completed' && !info.finishDate) historyEntry.dateSet = today;

    await api.storage.local.set({ last_sync: { slug, chapter: String(chapter) } });
    await showNotification('success', `${malTitle} — Chapter ${chapter} saved to MAL`, tabId);

    // Sync status back to Rolia + record auto-status history entry
    if (autoTrigger && newStatus) {
      if (roliaId && autoSettings.syncStatusToRolia) {
        await setRoliaStatus(roliaId, newStatus, tabId, slug);
      }
      await addHistoryEntry({
        type:      'auto-status',
        manga:     slug,
        malTitle,
        chapter:   null,
        status:    newStatus,
        trigger:   autoTrigger,
        timestamp: Date.now(),
      });
    }

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

    // Retry after delay
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
      syncChapter(msg.slug, msg.chapter, _sender.tab?.id ?? null, msg.totalRoliaChapters ?? null, msg.isEndChapter ?? false)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'FORCE_SYNC':
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
            errorsOnly: msg.settings?.errorsOnly ?? false,
          };
          await syncSet({ notification_settings: settings });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'GET_AUTO_STATUS_SETTINGS':
      (async () => {
        try {
          const settings = await getAutoStatusSettings();
          sendResponse({ ok: true, settings });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'SAVE_AUTO_STATUS_SETTINGS':
      (async () => {
        try {
          const settings = {
            syncStatus:         msg.settings?.syncStatus         ?? true,
            neverChange:        msg.settings?.neverChange        ?? false,
            autoStatusReading:  msg.settings?.autoStatusReading  ?? true,
            autoStatusOnHold:   msg.settings?.autoStatusOnHold   ?? true,
            autoStatusComplete: msg.settings?.autoStatusComplete ?? true,
            syncStatusToRolia:  msg.settings?.syncStatusToRolia  ?? true,
          };
          await syncSet({ auto_status_settings: settings });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'SAVE_MANGA_META':
      (async () => {
        try {
          const { slugMappings = {} } = await syncGet('slugMappings');
          if (slugMappings[msg.slug]) {
            // Mapping exists — enrich it directly
            if (msg.roliaId   != null) slugMappings[msg.slug].roliaId   = msg.roliaId;
            if (msg.isOngoing != null) slugMappings[msg.slug].isOngoing = msg.isOngoing;
            if (msg.isFinished!= null) slugMappings[msg.slug].isFinished= msg.isFinished;
            await syncSet({ slugMappings });
          } else {
            // No MAL mapping yet — cache for later merge in saveSlugMapping
            const { mangaMeta = {} } = await api.storage.local.get('mangaMeta');
            mangaMeta[msg.slug] = {
              roliaId:    msg.roliaId,
              isOngoing:  msg.isOngoing,
              isFinished: msg.isFinished,
            };
            await api.storage.local.set({ mangaMeta });
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'GET_GENERAL_SETTINGS':
      (async () => {
        try {
          const settings = await getGeneralSettings();
          sendResponse({ ok: true, settings });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    case 'SAVE_GENERAL_SETTINGS':
      (async () => {
        try {
          const settings = {
            showImportButton: msg.settings?.showImportButton ?? true,
          };
          await syncSet({ general_settings: settings });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    // ── Bulk import ────────────────────────────────────────────────────────────

    // Store manga list in local storage and open the import tab
    case 'OPEN_IMPORT':
      (async () => {
        try {
          await api.storage.local.set({ pending_import: msg.manga });
          await api.tabs.create({ url: api.runtime.getURL('options.html') + '#import' });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    // Resolve a roliascan slug to a MAL manga (for import.js)
    case 'GET_MAL_ID':
      (async () => {
        try {
          const { slugMappings = {} } = await syncGet('slugMappings');
          if (slugMappings[msg.slug]) {
            const m = slugMappings[msg.slug];
            sendResponse({ ok: true, malId: m.id, malTitle: m.title, confidence: 'high' });
            return;
          }
          const result = await searchMangaAuth(msg.slug);
          if (result) {
            sendResponse({ ok: true, malId: result.id, malTitle: result.title, confidence: 'medium' });
          } else {
            sendResponse({ ok: true, malId: null, malTitle: null, confidence: 'none' });
          }
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    // Import a single manga entry (chapter progress + reading status)
    case 'IMPORT_SINGLE':
      (async () => {
        try {
          const { malId, malTitle, slug, chapter, status } = msg;
          const body = {};
          if (Number(chapter) > 0) body.num_chapters_read = Number(chapter);
          if (status)              body.status            = status;

          const res = await malRequest('PATCH', `/manga/${malId}/my_list_status`, body);
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`MAL update failed: ${res.status} — ${text}`);
          }

          if (slug && malId && malTitle) {
            await saveSlugMapping(slug, malId, malTitle);
          }

          await addHistoryEntry({
            manga:     slug ?? malTitle,
            malTitle,
            chapter:   chapter > 0 ? String(chapter) : '–',
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

    case 'DELETE_MAPPING':
      (async () => {
        try {
          const { slugMappings = {} } = await syncGet('slugMappings');
          delete slugMappings[msg.slug];
          await syncSet({ slugMappings });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    // Sync a status change from the bookmarks page MutationObserver
    case 'SYNC_STATUS':
      (async () => {
        try {
          const { slugMappings: smSync = {} } = await syncGet('slugMappings');
          if (smSync[msg.slug]?.syncEnabled === false) {
            sendResponse({ ok: true, skipped: true });
            return;
          }

          let malId = msg.malId ?? null;
          let malTitle = null;

          if (!malId) {
            const found = await getMalId(msg.slug);
            malId    = found.malId;
            malTitle = found.malTitle;
          }

          // Only PATCH if status actually changed
          const info = await getMalMangaInfo(malId);
          if (info.listStatus === msg.status) {
            sendResponse({ ok: true, skipped: true, reason: 'status unchanged' });
            return;
          }
          const oldStatus = info.listStatus;

          const res = await malRequest(
            'PATCH',
            `/manga/${malId}/my_list_status`,
            buildStatusPatchBody(msg.status, info)
          );
          if (!res.ok) throw new Error(`Status sync failed: ${res.status}`);

          await addHistoryEntry({
            type:      'status',
            manga:     msg.slug,
            malTitle,
            oldStatus,
            newStatus: msg.status,
            timestamp: Date.now(),
          });

          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    // Status change intercepted from Rolia's own fetch call
    case 'ROLIA_STATUS_CHANGED':
      (async () => {
        try {
          // Respect global status sync toggle
          const autoSettings = await getAutoStatusSettings();
          if (!autoSettings.syncStatus) {
            sendResponse({ ok: true, skipped: true });
            return;
          }

          const { data } = msg;

          // Try multiple field names Rolia might use
          const slug       = data.slug ?? data.mangaSlug ?? data.manga_slug ?? null;
          const roliaStatus = data.status ?? data.manga_status ?? null;

          if (!slug || !roliaStatus) {
            sendResponse({ ok: false, error: 'Missing slug or status in body' });
            return;
          }

          // Respect per-manga sync toggle
          const { slugMappings: smRolia = {} } = await syncGet('slugMappings');
          if (smRolia[slug]?.syncEnabled === false) {
            sendResponse({ ok: true, skipped: true });
            return;
          }

          const statusMap = {
            reading:      'reading',
            completed:    'completed',
            on_hold:      'on_hold',
            dropped:      'dropped',
            plan_to_read: 'plan_to_read',
          };
          const mappedStatus = statusMap[roliaStatus];
          if (!mappedStatus) {
            sendResponse({ ok: false, error: `Unknown status: ${roliaStatus}` });
            return;
          }

          const { malId, malTitle } = await getMalId(slug);

          // Only PATCH if status actually changed
          const info = await getMalMangaInfo(malId);
          if (info.listStatus === mappedStatus) {
            sendResponse({ ok: true, skipped: true, reason: 'status unchanged' });
            return;
          }
          const oldStatus = info.listStatus;

          const res = await malRequest(
            'PATCH',
            `/manga/${malId}/my_list_status`,
            buildStatusPatchBody(mappedStatus, info)
          );
          if (!res.ok) throw new Error(`MAL status update failed: ${res.status}`);

          await addHistoryEntry({
            type:      'status',
            manga:     slug,
            malTitle,
            oldStatus,
            newStatus: mappedStatus,
            timestamp: Date.now(),
          });

          // Lock auto-status — but only for user-initiated status changes,
          // not when background.js itself triggered the Rolia POST.
          if (!_autoStatusInProgress.has(slug)) {
            const { autoStatusLocks = [] } = await api.storage.local.get('autoStatusLocks');
            if (!autoStatusLocks.includes(slug)) {
              autoStatusLocks.push(slug);
              await api.storage.local.set({ autoStatusLocks });
            }
          }

          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;

    // Toggle per-manga sync on/off
    case 'SET_SYNC_ENABLED':
      (async () => {
        try {
          const { slugMappings = {} } = await syncGet('slugMappings');
          if (slugMappings[msg.slug]) {
            slugMappings[msg.slug].syncEnabled = msg.enabled;
            await syncSet({ slugMappings });
          }
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

// ─── Browser action — open popup or tab depending on platform ─────────────────

api.browserAction.onClicked.addListener(async () => {
  const info = await api.runtime.getPlatformInfo();
  if (info.os === 'android') {
    api.tabs.create({ url: api.runtime.getURL('popup.html') });
  } else {
    api.browserAction.openPopup().catch(() => {
      // Fallback: open as tab if openPopup() is unavailable
      api.tabs.create({ url: api.runtime.getURL('popup.html') });
    });
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
