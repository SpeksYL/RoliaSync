/**
 * redirect.js — OAuth2 Redirect Handler (Firefox)
 * Diese Seite wird von MAL nach der Authentifizierung aufgerufen.
 * Sie extrahiert den authorization_code aus der URL und
 * sendet ihn per Message an background.js.
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const spinnerEl = document.getElementById('spinner');
const titleEl   = document.getElementById('title');
const detailEl  = document.getElementById('detail');

function showSuccess(msg) {
  spinnerEl.style.display = 'none';
  titleEl.textContent     = '✅ Anmeldung erfolgreich';
  titleEl.className       = 'msg-success';
  detailEl.textContent    = msg;
  // Tab nach 2 Sekunden schließen
  setTimeout(() => window.close(), 2000);
}

function showError(msg) {
  spinnerEl.style.display = 'none';
  titleEl.textContent     = '⚠️ Anmeldung fehlgeschlagen';
  titleEl.className       = 'msg-error';
  detailEl.textContent    = msg;
}

(async function init() {
  // Rohe URL per Regex auslesen – kein URL-Objekt (würde percent-encoding auflösen)
  const raw   = window.location.href;
  const match = raw.match(/[?&]code=([^&]+)/);
  const code  = match ? match[1] : null;

  console.log('[MAL Redirect] URL:', raw);
  console.log('[MAL Redirect] Code erhalten, Länge:', code?.length);

  if (!code) {
    // MAL könnte einen Fehler zurückgeben
    const errMatch = raw.match(/[?&]error=([^&]+)/);
    const errDesc  = raw.match(/[?&]error_description=([^&]+)/);
    const errMsg   = errMatch
      ? decodeURIComponent((errDesc?.[1] ?? errMatch[1]).replace(/\+/g, ' '))
      : 'Kein Authorization Code in der URL gefunden';
    showError(errMsg);
    return;
  }

  try {
    const response = await api.runtime.sendMessage({ type: 'OAUTH_CODE', code });

    if (!response?.ok) {
      throw new Error(response?.error ?? 'Unbekannter Fehler im Background Script');
    }

    showSuccess('Du kannst diesen Tab schließen und zur Extension zurückkehren.');

  } catch (err) {
    console.error('[MAL Redirect] Fehler:', err);
    showError(`Fehler beim Token-Austausch: ${err.message}`);
  }
})();
