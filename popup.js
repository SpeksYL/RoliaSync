/**
 * popup.js — Popup UI
 * Shows login button (logged out) or status + history button (logged in).
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
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

// Hide logo if it fails to load (CSP-safe, no onerror attribute)
if (headerLogo) {
  headerLogo.addEventListener('error', () => { headerLogo.style.display = 'none'; });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showError(msg) {
  errorMsgEl.textContent   = msg;
  errorMsgEl.style.display = 'block';
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

  if (min <  1)  return 'just now';
  if (min <  60) return `${min}m ago`;
  if (h   <  24) return `${h}h ago`;
  if (d   === 1) return 'yesterday';
  if (d   <  30) return `${d}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US');
}

function setStatusBadge(el, status) {
  el.textContent = '';
  const span = document.createElement('span');
  span.className = 'status-badge ';
  if (status === 'success') {
    span.className  += 'status-success';
    span.textContent = '✅ Success';
  } else if (status === 'error') {
    span.className  += 'status-error';
    span.textContent = '⚠️ Error';
  } else if (status === 'not_found') {
    span.className  += 'status-none';
    span.textContent = '🔍 Not found';
  } else if (status === 'skipped') {
    span.className  += 'status-none';
    span.textContent = '⏭️ Skipped';
  } else {
    span.className  += 'status-none';
    span.textContent = 'Pending';
  }
  el.appendChild(span);
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

// ─── UI state ─────────────────────────────────────────────────────────────────

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
    setStatusBadge(lastStatusEl, lastEntry.status);
    lastTimeEl.textContent    = relativeTime(lastEntry.timestamp);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  clearError();
  try {
    const res = await sendMsg('GET_STATUS');
    if (!res.ok) throw new Error(res.error ?? 'Status check failed');

    if (res.loggedIn) {
      showLoggedin(res.username, res.lastEntry);
    } else {
      showLoggedout();
    }
  } catch (err) {
    loading.style.display = 'none';
    showError(`Error: ${err.message}`);
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

btnLogin.addEventListener('click', async () => {
  clearError();
  btnLogin.disabled    = true;
  btnLogin.textContent = 'Signing in…';

  try {
    const res = await sendMsg('START_LOGIN');
    if (!res.ok) throw new Error(res.error ?? 'Login failed');
    await init();
  } catch (err) {
    showError(`Sign in failed: ${err.message}`);
    btnLogin.disabled    = false;
    btnLogin.textContent = '🔑 Sign in with MAL';
  }
});

btnLogout.addEventListener('click', async () => {
  clearError();
  try {
    await sendMsg('LOGOUT');
    showLoggedout();
  } catch (err) {
    showError(`Sign out failed: ${err.message}`);
  }
});

btnHistory.addEventListener('click', () => {
  api.tabs.create({ url: api.runtime.getURL('history.html') });
  window.close();
});

// Start
init();
