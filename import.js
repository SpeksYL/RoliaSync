/**
 * import.js — Bulk import page
 * Reads bookmarks from storage, resolves MAL IDs, and imports selected manga.
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const loadingState   = document.getElementById('loading-state');
const emptyState     = document.getElementById('empty-state');
const importUi       = document.getElementById('import-ui');
const importBody     = document.getElementById('import-body');
const summaryCount   = document.getElementById('summary-count');
const btnSelectAll   = document.getElementById('btn-select-all');
const btnDeselectAll = document.getElementById('btn-deselect-all');
const btnImport      = document.getElementById('btn-import');
const progressWrap   = document.getElementById('progress-wrap');
const progressLabel  = document.getElementById('progress-label');
const progressBar    = document.getElementById('progress-bar');
const resultSummary  = document.getElementById('result-summary');

// ─── State ────────────────────────────────────────────────────────────────────
let manga = []; // enriched with malId / malTitle / confidence after resolution

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

function roliaStatusLabel(status) {
  const map = {
    reading:       'Reading',
    completed:     'Completed',
    on_hold:       'On Hold',
    dropped:       'Dropped',
    plan_to_read:  'Plan to Read',
  };
  return map[status] ?? status;
}

function countSelected() {
  return document.querySelectorAll('#import-body input[type="checkbox"]:checked:not(:disabled)').length;
}

function updateImportButton() {
  const n = countSelected();
  btnImport.textContent = `Import selected (${n})`;
  btnImport.disabled    = n === 0;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderRow(item, index) {
  const tr = document.createElement('tr');
  tr.dataset.index = index;

  // Checkbox
  const tdCheck = document.createElement('td');
  tdCheck.className = 'td-check';
  const cb = document.createElement('input');
  cb.type    = 'checkbox';
  cb.dataset.index = index;
  cb.disabled = true; // enabled after MAL match is resolved
  cb.addEventListener('change', updateImportButton);
  tdCheck.appendChild(cb);

  // Cover
  const tdCover = document.createElement('td');
  tdCover.className = 'td-cover';
  if (item.cover) {
    const img = document.createElement('img');
    img.src = item.cover;
    img.alt = '';
    img.onerror = () => {
      img.replaceWith(makePlaceholder());
    };
    tdCover.appendChild(img);
  } else {
    tdCover.appendChild(makePlaceholder());
  }

  // Title
  const tdTitle = document.createElement('td');
  tdTitle.className = 'td-title';
  tdTitle.textContent = item.title;
  if (item.title !== item.slug) {
    const slugDiv = document.createElement('div');
    slugDiv.className   = 'slug';
    slugDiv.textContent = item.slug;
    tdTitle.appendChild(slugDiv);
  }

  // Rolia Status
  const tdStatus = document.createElement('td');
  tdStatus.className = 'td-status';
  const badge = document.createElement('span');
  badge.className   = `rolia-badge rolia-${item.status}`;
  badge.textContent = roliaStatusLabel(item.status);
  tdStatus.appendChild(badge);

  // Chapter
  const tdChapter = document.createElement('td');
  tdChapter.className   = 'td-chapter';
  tdChapter.textContent = item.chapter > 0 ? `Ch. ${item.chapter}` : '–';

  // MAL match (loading spinner initially)
  const tdMal = document.createElement('td');
  tdMal.className = 'td-mal';
  tdMal.id = `mal-cell-${index}`;
  const spinner = document.createElement('span');
  spinner.className = 'spinner-inline';
  tdMal.appendChild(spinner);

  // Row status icon (success / error after import)
  const tdRowStatus = document.createElement('td');
  tdRowStatus.className = 'td-row-status';
  tdRowStatus.id = `row-status-${index}`;

  tr.appendChild(tdCheck);
  tr.appendChild(tdCover);
  tr.appendChild(tdTitle);
  tr.appendChild(tdStatus);
  tr.appendChild(tdChapter);
  tr.appendChild(tdMal);
  tr.appendChild(tdRowStatus);
  importBody.appendChild(tr);
}

function makePlaceholder() {
  const div = document.createElement('div');
  div.className   = 'no-cover';
  div.textContent = '📚';
  return div;
}

function updateMalCell(index, item) {
  const cell = document.getElementById(`mal-cell-${index}`);
  if (!cell) return;

  cell.textContent = '';

  if (!item.malId) {
    const span = document.createElement('span');
    span.className   = 'mal-none';
    span.textContent = '❌ Not found';
    cell.appendChild(span);
    return;
  }

  const wrap  = document.createElement('div');
  wrap.className = 'mal-match';

  const icon = document.createElement('span');
  icon.className   = 'mal-icon';
  icon.textContent = item.confidence === 'high' ? '✅' : '⚠️';

  const info = document.createElement('div');
  const titleEl = document.createElement('div');
  titleEl.className   = 'mal-title';
  titleEl.textContent = item.malTitle;
  const idEl = document.createElement('div');
  idEl.className   = 'mal-id';
  idEl.textContent = `ID ${item.malId}`;
  info.appendChild(titleEl);
  info.appendChild(idEl);

  wrap.appendChild(icon);
  wrap.appendChild(info);
  cell.appendChild(wrap);

  // Enable checkbox
  const cb = document.querySelector(`input[type="checkbox"][data-index="${index}"]`);
  if (cb) {
    cb.disabled = false;
    cb.checked  = true; // default: selected
    updateImportButton();
  }
}

function setRowDone(index, ok, message) {
  const tr = document.querySelector(`tr[data-index="${index}"]`);
  const statusCell = document.getElementById(`row-status-${index}`);
  if (tr) tr.classList.add(ok ? 'row-done' : 'row-error');
  if (statusCell) statusCell.textContent = ok ? '✅' : '❌';
  if (!ok && message) {
    const td = document.querySelector(`#mal-cell-${index}`);
    if (td) {
      const err = document.createElement('div');
      err.style.cssText = 'font-size:11px;color:#ffab91;margin-top:2px;';
      err.textContent   = message;
      td.appendChild(err);
    }
  }
  // Uncheck and disable after import attempt
  const cb = document.querySelector(`input[type="checkbox"][data-index="${index}"]`);
  if (cb) { cb.checked = false; cb.disabled = true; }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const { pending_import } = await api.storage.local.get('pending_import');
  manga = pending_import ?? [];

  loadingState.style.display = 'none';

  if (manga.length === 0) {
    emptyState.style.display = 'block';
    summaryCount.textContent = '0 manga';
    return;
  }

  summaryCount.textContent = `${manga.length} manga`;
  importUi.style.display   = 'block';

  // Render all rows first (with loading state)
  manga.forEach((item, i) => renderRow(item, i));

  // Resolve MAL IDs sequentially (small delay to avoid hammering MAL search)
  for (let i = 0; i < manga.length; i++) {
    try {
      const res = await sendMsg('GET_MAL_ID', { slug: manga[i].slug });
      if (res.ok) {
        manga[i].malId      = res.malId;
        manga[i].malTitle   = res.malTitle;
        manga[i].confidence = res.confidence;
      } else {
        manga[i].malId = null;
        manga[i].confidence = 'none';
      }
    } catch {
      manga[i].malId = null;
      manga[i].confidence = 'error';
    }
    updateMalCell(i, manga[i]);

    // Small delay between MAL search requests to avoid rate limiting
    if (i < manga.length - 1) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  updateImportButton();
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function runImport() {
  const selected = [...document.querySelectorAll(
    '#import-body input[type="checkbox"]:checked:not(:disabled)'
  )].map(cb => Number(cb.dataset.index));

  if (selected.length === 0) return;

  // Lock UI
  btnImport.disabled    = true;
  btnSelectAll.disabled = true;
  btnDeselectAll.disabled = true;
  progressWrap.style.display = 'block';
  resultSummary.style.display = 'none';

  let done = 0, succeeded = 0, failed = 0;

  for (const index of selected) {
    const item = manga[index];

    progressLabel.textContent =
      `Importing ${done + 1} / ${selected.length}: ${item.malTitle ?? item.title}…`;
    progressBar.style.width =
      `${Math.round((done / selected.length) * 100)}%`;

    try {
      const res = await sendMsg('IMPORT_SINGLE', {
        malId:    item.malId,
        malTitle: item.malTitle,
        slug:     item.slug,
        chapter:  item.chapter,
        status:   item.status,
      });

      if (res.ok) {
        succeeded++;
        setRowDone(index, true);
      } else {
        failed++;
        setRowDone(index, false, res.error);
      }
    } catch (err) {
      failed++;
      setRowDone(index, false, err.message);
    }

    done++;
    // Rate limit: 500ms between requests
    if (done < selected.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  progressBar.style.width    = '100%';
  progressLabel.textContent  = 'Done!';

  // Show result
  const ok = failed === 0;
  resultSummary.className     = `${ok ? 'ok' : 'err'}`;
  resultSummary.style.display = 'block';
  resultSummary.textContent   =
    `✅ ${succeeded} imported successfully` +
    (failed > 0 ? ` · ❌ ${failed} failed` : '');

  updateImportButton();
  btnSelectAll.disabled   = false;
  btnDeselectAll.disabled = false;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

btnSelectAll.addEventListener('click', () => {
  document.querySelectorAll('#import-body input[type="checkbox"]:not(:disabled)')
    .forEach(cb => { cb.checked = true; });
  updateImportButton();
});

btnDeselectAll.addEventListener('click', () => {
  document.querySelectorAll('#import-body input[type="checkbox"]:not(:disabled)')
    .forEach(cb => { cb.checked = false; });
  updateImportButton();
});

btnImport.addEventListener('click', runImport);

// ─── Start ────────────────────────────────────────────────────────────────────
init().catch(err => {
  loadingState.style.display = 'none';
  emptyState.style.display   = 'block';
  emptyState.querySelector('p').textContent = `Error: ${err.message}`;
});
