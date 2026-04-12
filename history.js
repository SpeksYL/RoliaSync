/**
 * history.js — Verlaufsseite
 * Lädt alle Sync-Einträge aus chrome.storage und rendert sie als Tabelle.
 */

'use strict';

// ─── Browser-API Polyfill ─────────────────────────────────────────────────────
const api = typeof browser !== 'undefined' ? browser : chrome;

const loadingEl     = document.getElementById('loading');
const emptyStateEl  = document.getElementById('empty-state');
const tableWrapper  = document.getElementById('table-wrapper');
const historyBody   = document.getElementById('history-body');
const entryCountEl  = document.getElementById('entry-count');
const clearArea     = document.getElementById('clear-area');
const btnClear      = document.getElementById('btn-clear');

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

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
  return new Date(timestamp).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function absoluteTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildStatusCell(entry, td) {
  const badge = document.createElement('span');
  badge.className = 'status-badge';

  if (entry.status === 'success') {
    badge.classList.add('status-success');
    badge.textContent = '✅ Erfolgreich';
  } else if (entry.status === 'error') {
    badge.classList.add('status-error');
    badge.textContent = '⚠️ Fehler';
    const msg = entry.errorMsg ?? 'Unbekannter Fehler';
    badge.title = msg;
    badge.dataset.tooltip = msg;
  } else if (entry.status === 'not_found') {
    badge.classList.add('status-not-found');
    badge.textContent = '🔍 Nicht gefunden';
    const msg = entry.errorMsg ?? 'Nicht auf MAL gefunden';
    badge.title = msg;
    badge.dataset.tooltip = msg;
  } else if (entry.status === 'skipped') {
    badge.classList.add('status-skipped');
    badge.textContent = '⏭️ Übersprungen';
    if (entry.errorMsg) badge.title = entry.errorMsg;
    if (entry.malId) {
      const btn = document.createElement('button');
      btn.className        = 'btn-force-sync';
      btn.textContent      = '🔄 Trotzdem syncen';
      btn.dataset.manga    = entry.manga    ?? '';
      btn.dataset.chapter  = String(entry.chapter ?? '');
      btn.dataset.malid    = String(entry.malId);
      btn.dataset.maltitle = entry.malTitle ?? entry.manga ?? '';
      td.appendChild(badge);
      td.appendChild(btn);
      return;
    }
  } else {
    badge.classList.add('status-pending');
    badge.textContent = '⏳ Ausstehend';
  }

  td.appendChild(badge);
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

// ─── Tabelle rendern ──────────────────────────────────────────────────────────

function renderHistory(history) {
  loadingEl.style.display = 'none';

  if (!history || history.length === 0) {
    emptyStateEl.style.display = 'block';
    entryCountEl.textContent   = '0 Einträge';
    clearArea.style.display    = 'none';
    return;
  }

  entryCountEl.textContent  = `${history.length} Einträge`;
  tableWrapper.style.display = 'block';
  clearArea.style.display    = 'block';

  historyBody.textContent = '';
  history.forEach(entry => {
    const title   = entry.malTitle ?? entry.manga ?? '–';
    const slug    = entry.manga ?? '';

    const tr = document.createElement('tr');

    // Titel
    const tdTitle = document.createElement('td');
    tdTitle.className   = 'td-title';
    tdTitle.textContent = title;
    if (title !== slug && slug) {
      const slugDiv = document.createElement('div');
      slugDiv.className   = 'slug';
      slugDiv.textContent = slug;
      tdTitle.appendChild(slugDiv);
    }

    // Chapter
    const tdChapter = document.createElement('td');
    tdChapter.className   = 'td-chapter';
    tdChapter.textContent = `Ch. ${entry.chapter ?? '–'}`;

    // Zeit
    const tdTime = document.createElement('td');
    tdTime.className   = 'td-time';
    tdTime.title       = absoluteTime(entry.timestamp);
    tdTime.textContent = relativeTime(entry.timestamp);

    // Status
    const tdStatus = document.createElement('td');
    buildStatusCell(entry, tdStatus);

    tr.appendChild(tdTitle);
    tr.appendChild(tdChapter);
    tr.appendChild(tdTime);
    tr.appendChild(tdStatus);
    historyBody.appendChild(tr);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await sendMsg('GET_HISTORY');
    if (!res.ok) throw new Error(res.error ?? 'Verlauf konnte nicht geladen werden');
    renderHistory(res.history);
  } catch (err) {
    loadingEl.style.display = 'none';
    emptyStateEl.style.display = 'block';
    emptyStateEl.querySelector('p').textContent =
      `Fehler beim Laden: ${err.message}`;
  }
}

// ─── Verlauf löschen ──────────────────────────────────────────────────────────

btnClear.addEventListener('click', async () => {
  if (!confirm('Gesamten Sync-Verlauf löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
    return;
  }

  await api.storage.local.remove(['sync_history', 'last_sync']);

  // UI zurücksetzen
  historyBody.innerHTML      = '';
  tableWrapper.style.display = 'none';
  clearArea.style.display    = 'none';
  emptyStateEl.style.display = 'block';
  entryCountEl.textContent   = '0 Einträge';
});

// ─── Force-Sync ───────────────────────────────────────────────────────────────

historyBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-force-sync');
  if (!btn) return;

  btn.disabled    = true;
  btn.textContent = '⏳ …';

  const manga    = btn.dataset.manga;
  const chapter  = btn.dataset.chapter;
  const malId    = Number(btn.dataset.malid);
  const malTitle = btn.dataset.maltitle;

  try {
    const res = await sendMsg('FORCE_SYNC', { manga, chapter, malId, malTitle });
    if (!res.ok) throw new Error(res.error ?? 'Sync fehlgeschlagen');
    btn.textContent = '✅ Gesynct';
    // Zeile als gesynct markieren
    const badge = btn.previousElementSibling;
    if (badge) {
      badge.className   = 'status-badge status-success';
      badge.textContent = '✅ Erfolgreich';
    }
    btn.remove();
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '🔄 Trotzdem syncen';
    alert(`Fehler: ${err.message}`);
  }
});

// Starten
init();
