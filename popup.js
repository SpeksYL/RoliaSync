/**
 * popup.js — Popup UI Logik
 * Zeigt Login-Button (ausgeloggt) oder Status + Verlauf-Button (eingeloggt).
 */

'use strict';

// ─── Browser-API Polyfill ─────────────────────────────────────────────────────
const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── DOM-Referenzen ───────────────────────────────────────────────────────────
const loading          = document.getElementById('loading');
const viewLoggedout    = document.getElementById('view-loggedout');
const viewLoggedin     = document.getElementById('view-loggedin');
const btnLogin         = document.getElementById('btn-login');
const btnLogout        = document.getElementById('btn-logout');
const btnHistory       = document.getElementById('btn-history');
const usernameEl       = document.getElementById('username');
const lastTitleEl      = document.getElementById('last-sync-title');
const lastChapterEl    = document.getElementById('last-sync-chapter');
const lastStatusEl     = document.getElementById('last-sync-status');
const lastTimeEl       = document.getElementById('last-sync-time');
const errorMsgEl       = document.getElementById('error-msg');
const headerLogo       = document.getElementById('header-logo');

// Logo ausblenden falls nicht ladbar (CSP-sicher, kein onerror-Attribut)
if (headerLogo) {
  headerLogo.addEventListener('error', () => { headerLogo.style.display = 'none'; });
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function showError(msg) {
  errorMsgEl.textContent    = msg;
  errorMsgEl.style.display  = 'block';
  errorMsgEl.style.background = '';  // Standard-Fehlerfarbe (aus CSS)
}

function showInfo(msg) {
  errorMsgEl.textContent    = msg;
  errorMsgEl.style.display  = 'block';
  errorMsgEl.style.background = '#1a237e';  // Blau für Info
  errorMsgEl.style.color      = '#90caf9';
}

function clearError() {
  errorMsgEl.style.display = 'none';
  errorMsgEl.textContent   = '';
}

function relativeTime(timestamp) {
  if (!timestamp) return '–';
  const diff = Date.now() - timestamp;
  const min  = Math.floor(diff / 60_000);
  const h    = Math.floor(diff / 3_600_000);
  const d    = Math.floor(diff / 86_400_000);

  if (min <  1)  return 'gerade eben';
  if (min <  60) return `vor ${min} Min`;
  if (h   <  24) return `vor ${h} Std`;
  if (d   === 1) return 'gestern';
  if (d   <  30) return `vor ${d} Tagen`;
  return new Date(timestamp).toLocaleDateString('de-DE');
}

function statusBadge(status) {
  if (status === 'success')   return '<span class="status-badge status-success">✅ Erfolgreich</span>';
  if (status === 'error')     return '<span class="status-badge status-error">⚠️ Fehler</span>';
  if (status === 'not_found') return '<span class="status-badge status-none">🔍 Nicht gefunden</span>';
  return '<span class="status-badge status-none">Ausstehend</span>';
}

function sendMsg(type, payload = {}) {
  return new Promise((resolve, reject) => {
    api.runtime.sendMessage({ type, ...payload }, (response) => {
      if (api.runtime.lastError) {
        reject(new Error(api.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── UI-Zustand setzen ────────────────────────────────────────────────────────

function showLoggedout() {
  loading.style.display       = 'none';
  viewLoggedout.style.display = 'block';
  viewLoggedin.style.display  = 'none';
}

function showLoggedin(username, lastEntry) {
  loading.style.display       = 'none';
  viewLoggedout.style.display = 'none';
  viewLoggedin.style.display  = 'block';

  usernameEl.textContent = username ?? '–';

  if (lastEntry) {
    lastTitleEl.textContent   = lastEntry.malTitle ?? lastEntry.manga ?? '–';
    lastChapterEl.textContent = lastEntry.chapter  ? `Ch. ${lastEntry.chapter}` : '–';
    lastStatusEl.innerHTML    = statusBadge(lastEntry.status);
    lastTimeEl.textContent    = relativeTime(lastEntry.timestamp);
  }
}

// ─── Firefox: auf Login-Abschluss warten (Polling) ───────────────────────────

async function pollForLogin() {
  // Bis zu 5 Minuten in 2-Sekunden-Intervallen auf Token warten
  showInfo('Browser-Tab geöffnet – bitte bei MAL anmelden …');
  loading.style.display       = 'none';
  viewLoggedout.style.display = 'block';
  btnLogin.disabled    = true;
  btnLogin.textContent = 'Warte auf Anmeldung …';

  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const status = await sendMsg('GET_STATUS');
      if (status.loggedIn) {
        clearError();
        showLoggedin(status.username, status.lastEntry);
        return;
      }
    } catch { /* ignorieren, weiter warten */ }
  }

  showError('Anmeldung abgelaufen – bitte erneut versuchen.');
  btnLogin.disabled    = false;
  btnLogin.textContent = '🔑 Mit MAL anmelden';
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  clearError();
  try {
    const res = await sendMsg('GET_STATUS');
    if (!res.ok) throw new Error(res.error ?? 'Statusabfrage fehlgeschlagen');

    if (res.loggedIn) {
      showLoggedin(res.username, res.lastEntry);
    } else {
      showLoggedout();
    }
  } catch (err) {
    loading.style.display = 'none';
    showError(`Fehler: ${err.message}`);
  }
}

// ─── Event-Handler ────────────────────────────────────────────────────────────

btnLogin.addEventListener('click', async () => {
  clearError();
  btnLogin.disabled    = true;
  btnLogin.textContent = 'Anmeldung läuft …';

  try {
    const res = await sendMsg('START_LOGIN');

    if (res.pending) {
      // Firefox: Tab wurde geöffnet, auf Abschluss per Polling warten
      await pollForLogin();
    } else if (!res.ok) {
      throw new Error(res.error ?? 'Login fehlgeschlagen');
    } else {
      // Chrome: OAuth direkt abgeschlossen
      await init();
    }
  } catch (err) {
    showError(`Anmeldung fehlgeschlagen: ${err.message}`);
    btnLogin.disabled    = false;
    btnLogin.textContent = '🔑 Mit MAL anmelden';
  }
});

btnLogout.addEventListener('click', async () => {
  clearError();
  try {
    await sendMsg('LOGOUT');
    showLoggedout();
  } catch (err) {
    showError(`Abmeldung fehlgeschlagen: ${err.message}`);
  }
});

btnHistory.addEventListener('click', () => {
  api.tabs.create({ url: api.runtime.getURL('history.html') });
  window.close();
});

// Starten
init();
