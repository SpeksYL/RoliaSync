/**
 * content.js — Content Script
 * Handles two pages:
 *   1. roliascan.com/read/* — detects chapter from URL and syncs to MAL
 *   2. roliascan.com/bookmarks — injects import button, observes status changes
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── In-page toast (shared) ───────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === 'success' ? '#2ecc71' : '#e74c3c'};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 999999;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    max-width: 280px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    line-height: 1.4;
    word-break: break-word;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

api.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SHOW_TOAST') {
    showToast(msg.message, msg.type ?? 'success');
  }
});

// ─── Chapter sync (roliascan.com/read/*) ─────────────────────────────────────

const CHAPTER_REGEX = /roliascan\.com\/read\/([\w-]+)\/ch([\d.]+)-\d+/;

function parseCurrentUrl() {
  const match = CHAPTER_REGEX.exec(window.location.href);
  if (!match) return null;
  return {
    slug:    match[1],   // e.g. "spy-x-family"
    chapter: match[2],   // e.g. "1" or "1.5"
    url:     window.location.href,
  };
}

function sendSync(parsed) {
  api.runtime.sendMessage(
    {
      type:    'SYNC_CHAPTER',
      slug:    parsed.slug,
      chapter: parsed.chapter,
      url:     parsed.url,
    },
    (response) => {
      if (api.runtime.lastError) {
        console.warn('[RoliaSync] Could not connect to background:', api.runtime.lastError.message);
        return;
      }
      if (!response?.ok) {
        console.warn('[RoliaSync] Sync failed:', response?.error);
      }
    }
  );
}

function tryInitialSync() {
  const parsed = parseCurrentUrl();
  if (parsed) sendSync(parsed);
}

// ─── Fetch interceptor (status changes via Rolia API) ────────────────────────

function setupFetchInterceptor() {
  // Inject into page world (content scripts cannot override window.fetch directly)
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const [url, options] = args;
        if (typeof url === 'string' &&
            url.includes('/auth/manga-status') &&
            options?.method === 'POST') {
          try {
            const bodyText = typeof options.body === 'string'
              ? options.body
              : await new Response(options.body).text();
            const bodyData = JSON.parse(bodyText);
            const slugMatch = window.location.pathname.match(
              /\\/manga\\/([\\w-]+)\\/?/
            );
            const slug = slugMatch ? slugMatch[1] : null;
            if (bodyData.status && slug) {
              window.dispatchEvent(new CustomEvent('roliaStatusChanged', {
                detail: {
                  slug:     slug,
                  manga_id: bodyData.manga_id,
                  status:   bodyData.status,
                }
              }));
            }
          } catch(_e) {}
        }
        return originalFetch.apply(this, args);
      };
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove();

  // Receive the CustomEvent from page world and forward to background
  window.addEventListener('roliaStatusChanged', (e) => {
    api.runtime.sendMessage({
      action: 'ROLIA_STATUS_CHANGED',
      data:   e.detail,
    });
  });
}

// ─── Bookmarks sync (roliascan.com/bookmarks) ─────────────────────────────────

function normalizeRoliaStatus(raw) {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'on hold')      return 'on_hold';
  if (s === 'plan to read') return 'plan_to_read';
  return s; // reading, completed, dropped
}

function readBookmarksManga() {
  // Try the primary selector, then broader fallbacks
  const groups = document.querySelectorAll(
    '#library-grid div.group, #library-grid .manga-item, .library-item, .manga-card'
  );

  const manga = [];
  groups.forEach(group => {
    const link      = group.querySelector('a.manga-link, a[href*="/manga/"]');
    const titleEl   = group.querySelector('a.manga-title, .manga-title, .title');
    const statusEl  = group.querySelector('span.status-badge, .status-badge');
    const chapterEl = group.querySelector('span.manga-chapter, .manga-chapter');
    const imgEl     = group.querySelector('img');

    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    const slug = href.split('/').filter(Boolean).pop() ?? '';
    if (!slug || slug === 'manga') return;

    const title   = titleEl?.textContent.trim() ?? slug;
    const status  = statusEl ? normalizeRoliaStatus(statusEl.textContent) : 'plan_to_read';
    const chText  = chapterEl?.textContent ?? '';
    const chMatch = chText.match(/([\d.]+)/);
    const chapter = chMatch ? Number(chMatch[1]) : 0;
    const mangaId = group.dataset.mangaId ?? group.dataset.id ?? null;
    const cover   = imgEl?.src ?? imgEl?.dataset.src ?? null;

    manga.push({ slug, title, status, chapter, mangaId, cover });
  });

  return manga;
}

function injectImportButton(manga) {
  const existing = document.getElementById('roliasync-import-btn');
  if (existing) {
    existing.textContent = `📥 Import to MAL (${manga.length} manga)`;
    return;
  }

  const btn = document.createElement('button');
  btn.id = 'roliasync-import-btn';
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #e74c3c;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 99999;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    border: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-weight: 600;
    line-height: 1;
  `;
  btn.textContent = `📥 Import to MAL (${manga.length} manga)`;

  btn.addEventListener('click', () => {
    // Re-read DOM in case it changed since initial load
    const current = readBookmarksManga();
    btn.textContent = '⏳ Opening…';
    btn.disabled    = true;

    api.runtime.sendMessage({ type: 'OPEN_IMPORT', manga: current }, (response) => {
      if (api.runtime.lastError || !response?.ok) {
        btn.textContent = '❌ Error — check settings';
        btn.disabled    = false;
        return;
      }
      // Tab opened — button stays disabled until user navigates away
    });
  });

  document.body.appendChild(btn);
}

function observeStatusChanges() {
  const grid = document.querySelector('#library-grid, .library-grid, main');
  if (!grid) return;

  // Debounce to avoid firing on intermediate DOM states
  const pending = new Map(); // slug → newStatus
  let flushTimer = null;

  function flush() {
    pending.forEach((status, slug) => {
      api.runtime.sendMessage({ type: 'SYNC_STATUS', slug, status }, (res) => {
        if (api.runtime.lastError) return;
        if (res?.ok) showToast(`${slug}: status → ${status}`, 'success');
      });
    });
    pending.clear();
  }

  function handleBadgeChange(badge) {
    const group = badge.closest(
      '[data-manga-id], .group, .manga-item, .manga-card, .library-item'
    );
    if (!group) return;

    const link = group.querySelector('a.manga-link, a[href*="/manga/"]');
    const href = link?.getAttribute('href') ?? '';
    const slug = href.split('/').filter(Boolean).pop();
    if (!slug || slug === 'manga') return;

    pending.set(slug, normalizeRoliaStatus(badge.textContent));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 800);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const el = mutation.target.parentElement;
        if (el?.classList.contains('status-badge')) handleBadgeChange(el);
      } else if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const badge = node.classList?.contains('status-badge')
            ? node
            : node.querySelector?.('span.status-badge');
          if (badge) handleBadgeChange(badge);
        }
      }
    }
  });

  observer.observe(grid, { subtree: true, characterData: true, childList: true });
}

function initBookmarksPage() {
  const manga = readBookmarksManga();
  if (manga.length > 0) injectImportButton(manga);
  observeStatusChanges();

  // Re-scan after lazy-loaded content appears
  let scanTimer = null;
  const scanObserver = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const updated = readBookmarksManga();
      if (updated.length > 0) injectImportButton(updated);
    }, 600);
  });

  const root = document.querySelector('#library-grid, .library-grid, main') ?? document.body;
  scanObserver.observe(root, { childList: true, subtree: true });
}

// ─── URL routing ──────────────────────────────────────────────────────────────

const _href = window.location.href;

const isMangaPage = /roliascan\.com\/manga\/[\w-]+\/?$/.test(_href);
if (isMangaPage) {
  setupFetchInterceptor();
}

if (/roliascan\.com\/read\//.test(_href)) {
  // Initial sync
  if (document.readyState === 'complete') {
    tryInitialSync();
  } else {
    window.addEventListener('load', tryInitialSync, { once: true });
  }

  // SPA navigation observer
  let lastUrl = _href;
  const chapterObserver = new MutationObserver(() => {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;

    const parsed = parseCurrentUrl();
    if (!parsed) return;

    if (document.readyState === 'complete') {
      setTimeout(() => sendSync(parsed), 500);
    } else {
      window.addEventListener('load', () => sendSync(parsed), { once: true });
    }
  });
  chapterObserver.observe(document.body, { childList: true, subtree: true });

} else if (/roliascan\.com\/bookmarks/.test(_href)) {
  if (document.readyState === 'complete') {
    initBookmarksPage();
  } else {
    window.addEventListener('load', initBookmarksPage, { once: true });
  }
}
