/**
 * content.js — Content Script
 * Injected on roliascan.com/read/* pages.
 * Detects manga slug and chapter number from the URL and
 * sends a SYNC_CHAPTER message to background.js once the page is fully loaded.
 * Also handles SHOW_TOAST messages from background.js.
 */

'use strict';

// ─── Browser API ──────────────────────────────────────────────────────────────
const api = typeof browser !== 'undefined' ? browser : chrome;

// URL pattern: /read/{slug}/ch{number}-{id}/
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

// ─── In-page Toast ────────────────────────────────────────────────────────────
// Used on Android where browser.notifications is not available.

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

// ─── Message listener ─────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SHOW_TOAST') {
    showToast(msg.message, msg.type ?? 'success');
  }
});

// ─── Initial sync on page load ────────────────────────────────────────────────
// Wait for full page load before triggering sync.

function tryInitialSync() {
  const parsed = parseCurrentUrl();
  if (parsed) sendSync(parsed);
}

if (document.readyState === 'complete') {
  // Page already loaded (e.g. cached reload)
  tryInitialSync();
} else {
  window.addEventListener('load', tryInitialSync, { once: true });
}

// ─── SPA navigation observer ──────────────────────────────────────────────────
// Watch for URL changes without a full page reload (client-side routing).

let lastUrl = window.location.href;

const observer = new MutationObserver(() => {
  if (window.location.href === lastUrl) return;
  lastUrl = window.location.href;

  const parsed = parseCurrentUrl();
  if (!parsed) return;

  if (document.readyState === 'complete') {
    // SPA navigation: readyState stays 'complete', small delay so new content renders first
    setTimeout(() => sendSync(parsed), 500);
  } else {
    window.addEventListener('load', () => sendSync(parsed), { once: true });
  }
});

observer.observe(document.body, { childList: true, subtree: true });
