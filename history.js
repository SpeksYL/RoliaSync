/**
 * history.js — Sync history page
 * Loads sync entries from storage and renders them as a table.
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const loadingEl     = document.getElementById('loading');
const emptyStateEl  = document.getElementById('empty-state');
const tableWrapper  = document.getElementById('table-wrapper');
const historyBody   = document.getElementById('history-body');
const entryCountEl  = document.getElementById('entry-count');
const clearArea     = document.getElementById('clear-area');
const btnClear      = document.getElementById('btn-clear');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
  });
}

function absoluteTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildStatusCell(entry, td) {
  const badge = document.createElement('span');
  badge.className = 'status-badge';

  if (entry.status === 'success') {
    badge.classList.add('status-success');
    badge.textContent = '✅ Success';
  } else if (entry.status === 'error') {
    badge.classList.add('status-error');
    badge.textContent = '⚠️ Error';
    const msg = entry.errorMsg ?? 'Unknown error';
    badge.title = msg;
    badge.dataset.tooltip = msg;
  } else if (entry.status === 'not_found') {
    badge.classList.add('status-not-found');
    badge.textContent = '🔍 Not found';
    const msg = entry.errorMsg ?? 'Not found on MAL';
    badge.title = msg;
    badge.dataset.tooltip = msg;
  } else if (entry.status === 'skipped') {
    badge.classList.add('status-skipped');
    badge.textContent = '⏭️ Skipped';
    if (entry.errorMsg) badge.title = entry.errorMsg;
    if (entry.malId) {
      const btn = document.createElement('button');
      btn.className        = 'btn-force-sync';
      btn.textContent      = '🔄 Force sync';
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
    badge.textContent = '⏳ Pending';
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

// ─── Render table ─────────────────────────────────────────────────────────────

function renderHistory(history) {
  loadingEl.style.display = 'none';

  if (!history || history.length === 0) {
    emptyStateEl.style.display = 'block';
    entryCountEl.textContent   = '0 entries';
    clearArea.style.display    = 'none';
    return;
  }

  entryCountEl.textContent   = `${history.length} entries`;
  tableWrapper.style.display = 'block';
  clearArea.style.display    = 'block';

  historyBody.textContent = '';
  history.forEach(entry => {
    const title = entry.malTitle ?? entry.manga ?? '–';
    const slug  = entry.manga ?? '';

    const tr = document.createElement('tr');

    // Title
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

    // Time
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
    if (!res.ok) throw new Error(res.error ?? 'Failed to load history');
    renderHistory(res.history);
  } catch (err) {
    loadingEl.style.display = 'none';
    emptyStateEl.style.display = 'block';
    emptyStateEl.querySelector('p').textContent = `Failed to load: ${err.message}`;
  }
}

// ─── Clear history ────────────────────────────────────────────────────────────

btnClear.addEventListener('click', async () => {
  if (!confirm('Delete entire sync history? This cannot be undone.')) return;

  await api.storage.local.remove(['sync_history', 'last_sync']);

  historyBody.textContent    = '';
  tableWrapper.style.display = 'none';
  clearArea.style.display    = 'none';
  emptyStateEl.style.display = 'block';
  entryCountEl.textContent   = '0 entries';
});

// ─── Force sync ───────────────────────────────────────────────────────────────

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
    if (!res.ok) throw new Error(res.error ?? 'Sync failed');
    btn.textContent = '✅ Synced';
    const badge = btn.previousElementSibling;
    if (badge) {
      badge.className   = 'status-badge status-success';
      badge.textContent = '✅ Success';
    }
    btn.remove();
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '🔄 Force sync';
    alert(`Error: ${err.message}`);
  }
});

// Start
init();
