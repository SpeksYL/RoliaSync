/**
 * content.js — Content Script
 * Wird auf roliascan.com/read/* injiziert.
 * Erkennt Manga-Slug und Chapter-Nummer aus der URL und
 * schickt eine SYNC_CHAPTER-Message an background.js –
 * aber erst wenn die Seite vollständig geladen ist.
 */

'use strict';

// ─── Browser-API Polyfill ─────────────────────────────────────────────────────
const api = typeof browser !== 'undefined' ? browser : chrome;

// Regex laut CLAUDE.md:
// /roliascan\.com\/read\/([\w-]+)\/ch([\d.]+)-\d+/
const CHAPTER_REGEX = /roliascan\.com\/read\/([\w-]+)\/ch([\d.]+)-\d+/;

function parseCurrentUrl() {
  const match = CHAPTER_REGEX.exec(window.location.href);
  if (!match) return null;
  return {
    slug:    match[1],   // z.B. "spy-x-family"
    chapter: match[2],   // z.B. "1" oder "1.5"
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
        console.warn('[MAL Sync] Konnte keine Verbindung zum Service Worker herstellen:',
          api.runtime.lastError.message);
        return;
      }
      if (response?.ok) {
        console.log(`[MAL Sync] Sync gestartet: ${parsed.slug} Ch.${parsed.chapter}`);
      } else {
        console.warn('[MAL Sync] Sync fehlgeschlagen:', response?.error);
      }
    }
  );
}

// ─── Initialer Check beim Laden der Seite ─────────────────────────────────────
// Sync erst auslösen wenn die Seite vollständig geladen ist (nicht sofort).

function tryInitialSync() {
  const parsed = parseCurrentUrl();
  if (parsed) {
    console.log(`[MAL Sync] Seite geladen – starte Sync: ${parsed.slug} Ch.${parsed.chapter}`);
    sendSync(parsed);
  }
}

if (document.readyState === 'complete') {
  // Seite bereits fertig (z.B. bei Reload nach Caching)
  tryInitialSync();
} else {
  // Auf vollständiges Laden warten
  window.addEventListener('load', tryInitialSync, { once: true });
}

// ─── SPA-Navigation beobachten (falls Roliascan clientseitiges Routing nutzt) ──
// Bei einem URL-Wechsel ohne Seitenreload prüfen ob die neue URL ein Chapter ist.

let lastUrl = window.location.href;

const observer = new MutationObserver(() => {
  if (window.location.href === lastUrl) return;
  lastUrl = window.location.href;

  const parsed = parseCurrentUrl();
  if (!parsed) return;

  console.log(`[MAL Sync] URL-Wechsel erkannt – warte auf Seiteninhalt: ${parsed.slug} Ch.${parsed.chapter}`);

  if (document.readyState === 'complete') {
    // SPA-Navigation: readyState bleibt 'complete', daher kleiner Puffer
    // damit der neue Seiteninhalt gerendert ist bevor wir syncen.
    setTimeout(() => sendSync(parsed), 500);
  } else {
    window.addEventListener('load', () => sendSync(parsed), { once: true });
  }
});

observer.observe(document.body, { childList: true, subtree: true });
