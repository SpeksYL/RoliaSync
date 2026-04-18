/**
 * options.js — Einstellungsseite
 * Konfiguriert MAL Client-ID und zeigt Redirect URIs an.
 * Behandelt auch den Android OAuth Callback (?code= in URL).
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── DOM-Referenzen ───────────────────────────────────────────────────────────
const clientIdInput   = document.getElementById('client-id-input');
const btnSave         = document.getElementById('btn-save');
const saveMsg         = document.getElementById('save-msg');
const uriFfEl         = document.getElementById('uri-firefox');
const uriAndroidEl    = document.getElementById('uri-android');
const uriFfRowEl      = document.getElementById('uri-firefox-row');
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

// ─── Android OAuth Callback ───────────────────────────────────────────────────
// Wenn MAL auf Android zu options.html?code=... weiterleitet, Code abfangen
// und an background.js schicken.

(function handleAndroidOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (!code) return;

  // URL sofort bereinigen
  window.history.replaceState({}, '', window.location.pathname);

  api.runtime.sendMessage({ type: 'OAUTH_CODE', code }, (response) => {
    if (api.runtime.lastError) {
      showSaveMsg('err', `Login-Fehler: ${api.runtime.lastError.message}`);
      return;
    }
    if (response?.ok) {
      showSaveMsg('ok', '✅ Erfolgreich mit MAL verbunden!');
    } else {
      showSaveMsg('err', `Login fehlgeschlagen: ${response?.error ?? 'Unbekannter Fehler'}`);
    }
  });
})();

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    // Konfiguration aus background laden
    const cfg = await sendMsg('GET_CONFIG');
    if (cfg.ok) {
      clientIdInput.value = cfg.clientId;

      // Desktop Redirect URI (nur auf Desktop verfügbar)
      if (cfg.firefoxRedirect) {
        uriFfEl.textContent = cfg.firefoxRedirect;
        if (uriFfRowEl) uriFfRowEl.style.display = '';
      } else {
        uriFfEl.textContent = '–';
        // Desktop-Zeile ausblenden wenn nicht verfügbar (z.B. auf Android)
        if (uriFfRowEl) uriFfRowEl.style.display = 'none';
      }

      // Android Redirect URI
      if (uriAndroidEl) {
        uriAndroidEl.textContent = cfg.androidRedirect || '–';
      }
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
