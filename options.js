/**
 * options.js — Settings page
 * Configures MAL Client ID, redirect URIs, notification settings,
 * and auto-status behavior.
 * Also handles Android OAuth callback (?code= in URL).
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const clientIdInput    = document.getElementById('client-id-input');
const btnSave          = document.getElementById('btn-save');
const saveMsg          = document.getElementById('save-msg');
const uriFfEl          = document.getElementById('uri-firefox');
const uriAndroidEl     = document.getElementById('uri-android');
const uriFfRowEl       = document.getElementById('uri-firefox-row');
const statusUsername   = document.getElementById('status-username');
const statusClientId   = document.getElementById('status-clientid');
const notifBrowser     = document.getElementById('notif-browser');
const notifToast       = document.getElementById('notif-toast');
const notifErrorsOnly  = document.getElementById('notif-errors-only');
const btnSaveNotif     = document.getElementById('btn-save-notif');
const notifMsg         = document.getElementById('notif-msg');
const autoSetReading   = document.getElementById('auto-set-reading');
const autoSetCompleted = document.getElementById('auto-set-completed');
const autoSetOnHold    = document.getElementById('auto-set-on-hold');
const autoNeverChange  = document.getElementById('auto-never-change');
const btnSaveAuto      = document.getElementById('btn-save-auto');
const autoStatusMsg    = document.getElementById('auto-status-msg');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  saveMsg.className     = `msg msg-${type}`;
  saveMsg.textContent   = text;
  saveMsg.style.display = 'block';
}

function showNotifMsg(type, text) {
  if (!notifMsg) return;
  notifMsg.className     = `msg msg-${type}`;
  notifMsg.textContent   = text;
  notifMsg.style.display = 'block';
}

function showAutoMsg(type, text) {
  if (!autoStatusMsg) return;
  autoStatusMsg.className     = `msg msg-${type}`;
  autoStatusMsg.textContent   = text;
  autoStatusMsg.style.display = 'block';
}

// ─── Android OAuth callback ───────────────────────────────────────────────────
// When MAL redirects to options.html?code=... on Android, handle the code here.

(function handleAndroidOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (!code) return;

  window.history.replaceState({}, '', window.location.pathname);

  api.runtime.sendMessage({ type: 'OAUTH_CODE', code }, (response) => {
    if (api.runtime.lastError) {
      showSaveMsg('err', `Login error: ${api.runtime.lastError.message}`);
      return;
    }
    if (response?.ok) {
      showSaveMsg('ok', '✅ Successfully connected to MAL!');
    } else {
      showSaveMsg('err', `Login failed: ${response?.error ?? 'Unknown error'}`);
    }
  });
})();

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const cfg = await sendMsg('GET_CONFIG');
    if (cfg.ok) {
      clientIdInput.value = cfg.clientId;

      if (cfg.firefoxRedirect) {
        uriFfEl.textContent = cfg.firefoxRedirect;
        if (uriFfRowEl) uriFfRowEl.style.display = '';
      } else {
        uriFfEl.textContent = '–';
        if (uriFfRowEl) uriFfRowEl.style.display = 'none';
      }

      if (uriAndroidEl) {
        uriAndroidEl.textContent = cfg.androidRedirect || '–';
      }
    }

    const status = await sendMsg('GET_STATUS');
    if (status.ok) {
      statusUsername.textContent = status.loggedIn
        ? (status.username ?? 'signed in') : 'Not signed in';
      statusUsername.className   = `status-val ${status.loggedIn ? 'status-ok' : 'status-err'}`;
      statusClientId.textContent = cfg.clientId ? '✅ Set' : '⚠️ Missing';
      statusClientId.className   = `status-val ${cfg.clientId ? 'status-ok' : 'status-err'}`;
    }

    // Load notification settings
    const notifRes = await sendMsg('GET_NOTIFICATION_SETTINGS');
    if (notifRes.ok && notifRes.settings) {
      if (notifBrowser)    notifBrowser.checked    = notifRes.settings.browserNotifications ?? true;
      if (notifToast)      notifToast.checked      = notifRes.settings.inPageToast          ?? true;
      if (notifErrorsOnly) notifErrorsOnly.checked = notifRes.settings.errorsOnly           ?? false;
    }

    // Load auto status settings
    const autoRes = await sendMsg('GET_AUTO_STATUS_SETTINGS');
    if (autoRes.ok && autoRes.settings) {
      if (autoSetReading)   autoSetReading.checked   = autoRes.settings.setReading   ?? true;
      if (autoSetCompleted) autoSetCompleted.checked = autoRes.settings.setCompleted ?? true;
      if (autoSetOnHold)    autoSetOnHold.checked    = autoRes.settings.setOnHold    ?? true;
      if (autoNeverChange)  autoNeverChange.checked  = autoRes.settings.neverChange  ?? false;
    }
  } catch (err) {
    showSaveMsg('err', `Failed to load: ${err.message}`);
  }
}

// ─── Save Client ID ───────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    showSaveMsg('err', 'Please enter a valid Client ID.');
    return;
  }

  btnSave.disabled    = true;
  btnSave.textContent = 'Saving…';

  try {
    const res = await sendMsg('SAVE_CONFIG', { clientId });
    if (!res.ok) throw new Error(res.error ?? 'Save failed');
    showSaveMsg('ok', '✅ Client ID saved. You can now sign in from the popup.');
    await init();
  } catch (err) {
    showSaveMsg('err', `Error: ${err.message}`);
  } finally {
    btnSave.disabled    = false;
    btnSave.textContent = 'Save';
  }
});

// ─── Save Notification Settings ───────────────────────────────────────────────

if (btnSaveNotif) {
  btnSaveNotif.addEventListener('click', async () => {
    const settings = {
      browserNotifications: notifBrowser?.checked   ?? true,
      inPageToast:          notifToast?.checked      ?? true,
      errorsOnly:           notifErrorsOnly?.checked ?? false,
    };

    btnSaveNotif.disabled    = true;
    btnSaveNotif.textContent = 'Saving…';

    try {
      const res = await sendMsg('SAVE_NOTIFICATION_SETTINGS', { settings });
      if (!res.ok) throw new Error(res.error ?? 'Save failed');
      showNotifMsg('ok', '✅ Notification settings saved.');
    } catch (err) {
      showNotifMsg('err', `Error: ${err.message}`);
    } finally {
      btnSaveNotif.disabled    = false;
      btnSaveNotif.textContent = 'Save';
    }
  });
}

// ─── Save Auto Status Settings ────────────────────────────────────────────────

if (btnSaveAuto) {
  btnSaveAuto.addEventListener('click', async () => {
    const settings = {
      setReading:   autoSetReading?.checked   ?? true,
      setCompleted: autoSetCompleted?.checked ?? true,
      setOnHold:    autoSetOnHold?.checked    ?? true,
      neverChange:  autoNeverChange?.checked  ?? false,
    };

    btnSaveAuto.disabled    = true;
    btnSaveAuto.textContent = 'Saving…';

    try {
      const res = await sendMsg('SAVE_AUTO_STATUS_SETTINGS', { settings });
      if (!res.ok) throw new Error(res.error ?? 'Save failed');
      showAutoMsg('ok', '✅ Auto status settings saved.');
    } catch (err) {
      showAutoMsg('err', `Error: ${err.message}`);
    } finally {
      btnSaveAuto.disabled    = false;
      btnSaveAuto.textContent = 'Save';
    }
  });
}

// ─── Copy buttons ─────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const targetId = btn.dataset.target;
    const text     = document.getElementById(targetId)?.textContent ?? '';
    if (!text || text === '–') return;

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓ Copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    } catch {
      const el = document.getElementById(targetId);
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
});

// Start
init();
