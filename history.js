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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildStatusCell(entry) {
  if (entry.status === 'success') {
    return '<span class="status-badge status-success">✅ Erfolgreich</span>';
  }
  if (entry.status === 'error') {
    const tooltip = escapeHtml(entry.errorMsg ?? 'Unbekannter Fehler');
    return `<span class="status-badge status-error" data-tooltip="${tooltip}" title="${tooltip}">⚠️ Fehler</span>`;
  }
  if (entry.status === 'not_found') {
    const tooltip = escapeHtml(entry.errorMsg ?? 'Nicht auf MAL gefunden');
    return `<span class="status-badge status-not-found" data-tooltip="${tooltip}" title="${tooltip}">🔍 Nicht gefunden</span>`;
  }
  if (entry.status === 'skipped') {
    const tooltip = escapeHtml(entry.errorMsg ?? '');
    const malId   = entry.malId   ? escapeHtml(String(entry.malId))   : '';
    const title   = entry.malTitle ? escapeHtml(entry.malTitle) : escapeHtml(entry.manga ?? '');
    const manga   = escapeHtml(entry.manga ?? '');
    const chapter = escapeHtml(String(entry.chapter ?? ''));
    return `
      <span class="status-badge status-skipped" title="${tooltip}">⏭️ Übersprungen</span>
      <button class="btn-force-sync"
        data-manga="${manga}"
        data-chapter="${chapter}"
        data-malid="${malId}"
        data-maltitle="${title}">🔄 Trotzdem syncen</button>
    `;
  }
  return '<span class="status-badge status-pending">⏳ Ausstehend</span>';
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

  const rows = history.map(entry => {
    const title    = escapeHtml(entry.malTitle ?? entry.manga ?? '–');
    const slug     = escapeHtml(entry.manga ?? '');
    const chapter  = escapeHtml(entry.chapter ?? '–');
    const timeRel  = escapeHtml(relativeTime(entry.timestamp));
    const timeAbs  = escapeHtml(absoluteTime(entry.timestamp));
    const statusCell = buildStatusCell(entry);

    return `
      <tr>
        <td class="td-title">
          ${title}
          ${title !== slug ? `<div class="slug">${slug}</div>` : ''}
        </td>
        <td class="td-chapter">Ch. ${chapter}</td>
        <td class="td-time" title="${timeAbs}">${timeRel}</td>
        <td>${statusCell}</td>
      </tr>
    `;
  });

  historyBody.innerHTML = rows.join('');
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
