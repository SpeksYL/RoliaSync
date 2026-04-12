/**
 * options.js — Einstellungsseite
 * Konfiguriert MAL Client-ID und zeigt Redirect URIs an.
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── OAuth Redirect Empfang ───────────────────────────────────────────────────
// options.html dient als Redirect URI für den Firefox OAuth Flow.
// MAL leitet nach dem Login auf options.html?code=... weiter.
// Der Code wird sofort ans Background Script weitergeleitet.
(function handleOAuthRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (!code) return;

  console.log('[MAL Auth] OAuth-Code in options.html empfangen, Länge:', code.length);
  api.runtime.sendMessage({ type: 'OAUTH_CODE', code }, (response) => {
    if (api.runtime.lastError) {
      console.error('[MAL Auth] Fehler beim Senden des Codes:', api.runtime.lastError.message);
      return;
    }
    if (response?.ok) {
      console.log('[MAL Auth] Code erfolgreich verarbeitet.');
      // URL bereinigen – verhindert erneuten Send beim Neuladen der Seite
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      console.error('[MAL Auth] Token-Fehler:', response?.error);
    }
  });
})();

// ─── DOM-Referenzen ───────────────────────────────────────────────────────────
const clientIdInput   = document.getElementById('client-id-input');
const btnSave         = document.getElementById('btn-save');
const saveMsg         = document.getElementById('save-msg');
const uriFfEl         = document.getElementById('uri-firefox');
const statusUsername  = document.getElementById('status-username');
const statusClientId  = document.getElementById('status-clientid');

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

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

function showSaveMsg(type, text) {
  saveMsg.className   = `msg msg-${type}`;
  saveMsg.textContent = text;
  saveMsg.style.display = 'block';
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    // Konfiguration aus background laden
    const cfg = await sendMsg('GET_CONFIG');
    if (cfg.ok) {
      clientIdInput.value  = cfg.clientId;
      uriFfEl.textContent  = cfg.firefoxRedirect || '–';
    }

    // Login-Status
    const status = await sendMsg('GET_STATUS');
    if (status.ok) {
      statusUsername.textContent  = status.loggedIn ? (status.username ?? 'eingeloggt') : 'Nicht angemeldet';
      statusUsername.className    = `status-val ${status.loggedIn ? 'status-ok' : 'status-err'}`;
      statusClientId.textContent  = cfg.clientId ? '✅ Vorhanden' : '⚠️ Fehlt';
      statusClientId.className    = `status-val ${cfg.clientId ? 'status-ok' : 'status-err'}`;
    }
  } catch (err) {
    showSaveMsg('err', `Fehler beim Laden: ${err.message}`);
  }
}

// ─── Speichern ────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    showSaveMsg('err', 'Bitte eine gültige Client-ID eingeben.');
    return;
  }

  btnSave.disabled    = true;
  btnSave.textContent = 'Speichern …';

  try {
    const res = await sendMsg('SAVE_CONFIG', { clientId });
    if (!res.ok) throw new Error(res.error ?? 'Speichern fehlgeschlagen');
    showSaveMsg('ok', '✅ Client-ID gespeichert. Du kannst dich jetzt im Popup anmelden.');
    await init();   // Status aktualisieren
  } catch (err) {
    showSaveMsg('err', `Fehler: ${err.message}`);
  } finally {
    btnSave.disabled    = false;
    btnSave.textContent = 'Speichern';
  }
});

// ─── Kopieren-Buttons ─────────────────────────────────────────────────────────

document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const targetId = btn.dataset.target;
    const text     = document.getElementById(targetId)?.textContent ?? '';
    if (!text || text === '–') return;

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓ Kopiert';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Kopieren';
        btn.classList.remove('copied');
      }, 2000);
    } catch {
      // Fallback: Text selektieren
      const el = document.getElementById(targetId);
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
});

// Starten
init();
