/**
 * options.js — Settings page (tabbed)
 * Tabs: General · Notifications · Auto Status · Import · Mappings
 * Also handles Android OAuth callback (?code= in URL).
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── DOM refs — General ───────────────────────────────────────────────────────
const clientIdInput      = document.getElementById('client-id-input');
const btnSave            = document.getElementById('btn-save');
const saveMsg            = document.getElementById('save-msg');
const uriFfEl            = document.getElementById('uri-firefox');
const uriAndroidEl       = document.getElementById('uri-android');
const uriFfRowEl         = document.getElementById('uri-firefox-row');
const statusUsername     = document.getElementById('status-username');
const statusClientId     = document.getElementById('status-clientid');
const showImportButtonEl = document.getElementById('show-import-button');
const btnSaveGeneral     = document.getElementById('btn-save-general');
const generalMsg         = document.getElementById('general-msg');

// ─── DOM refs — Notifications ─────────────────────────────────────────────────
const notifBrowser     = document.getElementById('notif-browser');
const notifToast       = document.getElementById('notif-toast');
const notifErrorsOnly  = document.getElementById('notif-errors-only');
const btnSaveNotif     = document.getElementById('btn-save-notif');
const notifMsg         = document.getElementById('notif-msg');

// ─── DOM refs — Auto Status ───────────────────────────────────────────────────
const syncStatusEl        = document.getElementById('sync-status');
const autoSetReading      = document.getElementById('auto-set-reading');
const autoSetCompleted    = document.getElementById('auto-set-completed');
const autoSetOnHold       = document.getElementById('auto-set-on-hold');
const autoNeverChange     = document.getElementById('auto-never-change');
const autoStatusReadingEl = document.getElementById('auto-status-reading');
const autoStatusOnHoldEl  = document.getElementById('auto-status-on-hold');
const autoStatusCompleteEl= document.getElementById('auto-status-complete');
const syncStatusToRoliaEl = document.getElementById('sync-status-to-rolia');
const btnSaveAuto         = document.getElementById('btn-save-auto');
const autoStatusMsg       = document.getElementById('auto-status-msg');

// ─── DOM refs — Import ────────────────────────────────────────────────────────
const importEmpty       = document.getElementById('import-empty');
const importUi          = document.getElementById('import-ui');
const importBody        = document.getElementById('import-body');
const btnSelectAll      = document.getElementById('btn-select-all');
const btnDeselectAll    = document.getElementById('btn-deselect-all');
const btnImportRun      = document.getElementById('btn-import-run');
const btnImportClear    = document.getElementById('btn-import-clear');
const importProgressWrap = document.getElementById('import-progress-wrap');
const importProgressLabel = document.getElementById('import-progress-label');
const importProgressFill  = document.getElementById('import-progress-fill');
const importResultSummary = document.getElementById('import-result-summary');

// ─── DOM refs — Mappings ──────────────────────────────────────────────────────
const mappingsPendingNotice = document.getElementById('mappings-pending-notice');
const pendingSlugDisplay    = document.getElementById('pending-slug-display');
const pendingSlugEdit       = document.getElementById('pending-slug-edit');
const mappingsLoading       = document.getElementById('mappings-loading');
const mappingsEmpty         = document.getElementById('mappings-empty');
const mappingsTableWrap     = document.getElementById('mappings-table-wrap');
const mappingsBody          = document.getElementById('mappings-body');

// ─── State ────────────────────────────────────────────────────────────────────
let importManga     = [];      // manga array for current import session
const tabsInit      = new Set(); // which tabs have been initialized

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

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showMsg(el, type, text) {
  if (!el) return;
  el.className     = `msg msg-${type}`;
  el.textContent   = text;
  el.style.display = 'block';
}

// ─── Tab switching ────────────────────────────────────────────────────────────

async function activateTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === tabName);
  });

  // Update URL hash without triggering a navigation
  history.replaceState(null, '', '#' + tabName);

  // Lazy-init tabs that load data
  if (!tabsInit.has(tabName)) {
    tabsInit.add(tabName);
    if (tabName === 'import')   await initImportTab();
    if (tabName === 'mappings') await initMappingsTab();
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ─── Android OAuth callback ───────────────────────────────────────────────────

(function handleAndroidOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (!code) return;

  window.history.replaceState({}, '', window.location.pathname + window.location.hash);

  api.runtime.sendMessage({ type: 'OAUTH_CODE', code }, (response) => {
    if (api.runtime.lastError) {
      showMsg(saveMsg, 'err', `Login error: ${api.runtime.lastError.message}`);
      return;
    }
    if (response?.ok) {
      showMsg(saveMsg, 'ok', '✅ Successfully connected to MAL!');
    } else {
      showMsg(saveMsg, 'err', `Login failed: ${response?.error ?? 'Unknown error'}`);
    }
  });
})();

// ─── General tab init ─────────────────────────────────────────────────────────

async function initGeneralTab() {
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

    const notifRes = await sendMsg('GET_NOTIFICATION_SETTINGS');
    if (notifRes.ok && notifRes.settings) {
      if (notifBrowser)    notifBrowser.checked    = notifRes.settings.browserNotifications ?? true;
      if (notifToast)      notifToast.checked      = notifRes.settings.inPageToast          ?? true;
      if (notifErrorsOnly) notifErrorsOnly.checked = notifRes.settings.errorsOnly           ?? false;
    }

    const autoRes = await sendMsg('GET_AUTO_STATUS_SETTINGS');
    if (autoRes.ok && autoRes.settings) {
      if (syncStatusEl)          syncStatusEl.checked          = autoRes.settings.syncStatus         ?? true;
      if (autoSetReading)        autoSetReading.checked        = autoRes.settings.setReading         ?? true;
      if (autoSetCompleted)      autoSetCompleted.checked      = autoRes.settings.setCompleted       ?? true;
      if (autoSetOnHold)         autoSetOnHold.checked         = autoRes.settings.setOnHold          ?? true;
      if (autoNeverChange)       autoNeverChange.checked       = autoRes.settings.neverChange        ?? false;
      if (autoStatusReadingEl)   autoStatusReadingEl.checked   = autoRes.settings.autoStatusReading  ?? true;
      if (autoStatusOnHoldEl)    autoStatusOnHoldEl.checked    = autoRes.settings.autoStatusOnHold   ?? true;
      if (autoStatusCompleteEl)  autoStatusCompleteEl.checked  = autoRes.settings.autoStatusComplete ?? true;
      if (syncStatusToRoliaEl)   syncStatusToRoliaEl.checked   = autoRes.settings.syncStatusToRolia  ?? true;
    }

    const genRes = await sendMsg('GET_GENERAL_SETTINGS');
    if (genRes.ok && genRes.settings) {
      if (showImportButtonEl) showImportButtonEl.checked = genRes.settings.showImportButton ?? true;
    }
  } catch (err) {
    showMsg(saveMsg, 'err', `Failed to load settings: ${err.message}`);
  }
}

// ─── Save Client ID ───────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    showMsg(saveMsg, 'err', 'Please enter a valid Client ID.');
    return;
  }

  btnSave.disabled    = true;
  btnSave.textContent = 'Saving…';

  try {
    const res = await sendMsg('SAVE_CONFIG', { clientId });
    if (!res.ok) throw new Error(res.error ?? 'Save failed');
    showMsg(saveMsg, 'ok', '✅ Client ID saved. You can now sign in from the popup.');
    await initGeneralTab();
  } catch (err) {
    showMsg(saveMsg, 'err', `Error: ${err.message}`);
  } finally {
    btnSave.disabled    = false;
    btnSave.textContent = 'Save';
  }
});

// ─── Save General Settings (import button toggle) ─────────────────────────────

if (btnSaveGeneral) {
  btnSaveGeneral.addEventListener('click', async () => {
    const settings = {
      showImportButton: showImportButtonEl?.checked ?? true,
    };

    btnSaveGeneral.disabled    = true;
    btnSaveGeneral.textContent = 'Saving…';

    try {
      const res = await sendMsg('SAVE_GENERAL_SETTINGS', { settings });
      if (!res.ok) throw new Error(res.error ?? 'Save failed');
      showMsg(generalMsg, 'ok', '✅ Settings saved.');
    } catch (err) {
      showMsg(generalMsg, 'err', `Error: ${err.message}`);
    } finally {
      btnSaveGeneral.disabled    = false;
      btnSaveGeneral.textContent = 'Save';
    }
  });
}

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
      showMsg(notifMsg, 'ok', '✅ Notification settings saved.');
    } catch (err) {
      showMsg(notifMsg, 'err', `Error: ${err.message}`);
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
      syncStatus:         syncStatusEl?.checked         ?? true,
      setReading:         autoSetReading?.checked       ?? true,
      setCompleted:       autoSetCompleted?.checked     ?? true,
      setOnHold:          autoSetOnHold?.checked        ?? true,
      neverChange:        autoNeverChange?.checked      ?? false,
      autoStatusReading:  autoStatusReadingEl?.checked  ?? true,
      autoStatusOnHold:   autoStatusOnHoldEl?.checked   ?? true,
      autoStatusComplete: autoStatusCompleteEl?.checked ?? true,
      syncStatusToRolia:  syncStatusToRoliaEl?.checked  ?? true,
    };

    btnSaveAuto.disabled    = true;
    btnSaveAuto.textContent = 'Saving…';

    try {
      const res = await sendMsg('SAVE_AUTO_STATUS_SETTINGS', { settings });
      if (!res.ok) throw new Error(res.error ?? 'Save failed');
      showMsg(autoStatusMsg, 'ok', '✅ Auto status settings saved.');
    } catch (err) {
      showMsg(autoStatusMsg, 'err', `Error: ${err.message}`);
    } finally {
      btnSaveAuto.disabled    = false;
      btnSaveAuto.textContent = 'Save';
    }
  });
}

// ─── Copy buttons ─────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.target)?.textContent ?? '';
    if (!text || text === '–') return;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓ Copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    } catch {
      const el = document.getElementById(btn.dataset.target);
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── INLINE EDIT COMPONENT ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Replace `container` contents with a search input + live results.
 * onSave(malId, malTitle) is called when user selects a result.
 * onCancel() restores the original content.
 */
function openInlineEdit(container, slug, onSave, onCancel) {
  // Save original children to restore on cancel
  const savedNodes = Array.from(container.childNodes).map(n => n.cloneNode(true));

  function restoreContainer() {
    container.textContent = '';
    savedNodes.forEach(n => container.appendChild(n.cloneNode(true)));
  }

  container.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'inline-edit-wrap';

  // Input row (search + cancel)
  const row = document.createElement('div');
  row.className = 'inline-edit-row';

  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'inline-edit-input';
  input.placeholder = 'Search MAL…';
  input.value       = slug.replace(/-/g, ' ');

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'btn-inline-cancel';
  cancelBtn.textContent = '✕';
  cancelBtn.title       = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    restoreContainer();
    if (onCancel) onCancel();
  });

  row.appendChild(input);
  row.appendChild(cancelBtn);

  // Results area
  const results = document.createElement('div');
  results.className = 'inline-results';

  wrap.appendChild(row);
  wrap.appendChild(results);
  container.appendChild(wrap);

  input.focus();
  input.select();

  // Search on input (debounced)
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runInlineSearch(input.value, results, slug, onSave, container), 380);
  });

  // Initial search
  runInlineSearch(input.value, results, slug, onSave, container);

  // Enter key triggers search immediately
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounce);
      runInlineSearch(input.value, results, slug, onSave, container);
    }
    if (e.key === 'Escape') {
      restoreContainer();
      if (onCancel) onCancel();
    }
  });
}

async function runInlineSearch(query, resultsEl, slug, onSave, container) {
  if (!query.trim()) return;

  resultsEl.textContent = '';
  const msg = document.createElement('div');
  msg.className   = 'inline-msg';
  msg.textContent = 'Searching…';
  resultsEl.appendChild(msg);

  try {
    const res = await sendMsg('SEARCH_MAL', { query: query.trim() });
    if (!res.ok) throw new Error(res.error);

    resultsEl.textContent = '';

    if (res.results.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'inline-msg';
      empty.textContent = 'No results — try a different title';
      resultsEl.appendChild(empty);
      return;
    }

    res.results.forEach(({ id, title }) => {
      const item = document.createElement('div');
      item.className = 'inline-result';

      const titleEl = document.createElement('span');
      titleEl.className   = 'ir-title';
      titleEl.textContent = title;

      const idEl = document.createElement('span');
      idEl.className   = 'ir-id';
      idEl.textContent = `ID ${id}`;

      item.appendChild(titleEl);
      item.appendChild(idEl);

      item.addEventListener('click', async () => {
        try {
          const saveRes = await sendMsg('SAVE_MAPPING', { slug, malId: id, malTitle: title });
          if (!saveRes.ok) throw new Error(saveRes.error);
          onSave(id, title);
        } catch (err) {
          const errEl = document.createElement('div');
          errEl.className   = 'inline-msg';
          errEl.textContent = `Error: ${err.message}`;
          resultsEl.textContent = '';
          resultsEl.appendChild(errEl);
        }
      });

      resultsEl.appendChild(item);
    });
  } catch (err) {
    resultsEl.textContent = '';
    const errEl = document.createElement('div');
    errEl.className   = 'inline-msg';
    errEl.textContent = `Error: ${err.message}`;
    resultsEl.appendChild(errEl);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── IMPORT TAB ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function roliaStatusLabel(status) {
  return { reading: 'Reading', completed: 'Completed', on_hold: 'On Hold',
           dropped: 'Dropped', plan_to_read: 'Plan to Read' }[status] ?? status;
}

function countImportSelected() {
  return document.querySelectorAll(
    '#import-body input[type="checkbox"]:checked:not(:disabled)'
  ).length;
}

function updateImportBtn() {
  const n = countImportSelected();
  btnImportRun.textContent = `Import selected (${n})`;
  btnImportRun.disabled    = n === 0;
}

function renderImportRow(item, index) {
  const tr = document.createElement('tr');
  tr.dataset.index = index;

  // Checkbox
  const tdCheck = document.createElement('td');
  tdCheck.className = 'td-check';
  const cb = document.createElement('input');
  cb.type           = 'checkbox';
  cb.dataset.index  = index;
  cb.disabled       = true;
  cb.addEventListener('change', updateImportBtn);
  tdCheck.appendChild(cb);

  // Cover
  const tdCover = document.createElement('td');
  tdCover.className = 'td-cover';
  if (item.cover) {
    const img = document.createElement('img');
    img.src   = item.cover;
    img.alt   = '';
    img.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className   = 'no-cover';
      ph.textContent = '📚';
      img.replaceWith(ph);
    });
    tdCover.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className   = 'no-cover';
    ph.textContent = '📚';
    tdCover.appendChild(ph);
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
  const badge = document.createElement('span');
  badge.className   = `rolia-badge rolia-${item.status}`;
  badge.textContent = roliaStatusLabel(item.status);
  tdStatus.appendChild(badge);

  // Chapter
  const tdChapter = document.createElement('td');
  tdChapter.className   = 'td-chapter';
  tdChapter.textContent = item.chapter > 0 ? `Ch. ${item.chapter}` : '–';

  // MAL match cell (loading initially)
  const tdMal = document.createElement('td');
  tdMal.className = 'td-mal';
  tdMal.id        = `import-mal-${index}`;
  const spinner = document.createElement('span');
  spinner.className = 'spinner-inline';
  tdMal.appendChild(spinner);

  // Edit button cell
  const tdEditBtn = document.createElement('td');
  tdEditBtn.id = `import-edit-btn-${index}`;
  const editBtn = document.createElement('button');
  editBtn.className   = 'btn-edit';
  editBtn.textContent = '✏️';
  editBtn.title       = 'Edit MAL assignment';
  editBtn.style.display = 'none'; // shown after MAL cell loads
  editBtn.addEventListener('click', () => {
    openInlineEdit(
      tdMal,
      item.slug,
      (malId, malTitle) => {
        // Update state and re-render cell
        importManga[index].malId      = malId;
        importManga[index].malTitle   = malTitle;
        importManga[index].confidence = 'high';
        renderImportMalCell(index);
        editBtn.style.display = '';
      },
      () => {
        // Cancelled — restore cell
        renderImportMalCell(index);
      }
    );
    editBtn.style.display = 'none';
  });
  tdEditBtn.appendChild(editBtn);

  // Row status
  const tdRowStatus = document.createElement('td');
  tdRowStatus.className = 'td-row-status';
  tdRowStatus.id        = `import-row-status-${index}`;

  tr.appendChild(tdCheck);
  tr.appendChild(tdCover);
  tr.appendChild(tdTitle);
  tr.appendChild(tdStatus);
  tr.appendChild(tdChapter);
  tr.appendChild(tdMal);
  tr.appendChild(tdEditBtn);
  tr.appendChild(tdRowStatus);
  importBody.appendChild(tr);
}

function renderImportMalCell(index) {
  const item = importManga[index];
  const cell = document.getElementById(`import-mal-${index}`);
  const editBtnCell = document.getElementById(`import-edit-btn-${index}`);
  const cb = document.querySelector(`#import-body input[data-index="${index}"]`);
  if (!cell) return;

  cell.textContent = '';

  if (!item.malId) {
    const badge = document.createElement('span');
    badge.className        = 'mal-badge badge-notfound';
    badge.textContent      = '❌ Not found';
    badge.dataset.tooltip  = 'Click ✏️ to assign manually';
    cell.appendChild(badge);
    if (cb) { cb.disabled = true; cb.checked = false; }
  } else {
    const tooltip = item.confidence === 'high'
      ? 'Found via saved mapping'
      : 'Found via MAL search — verify title';
    const cls = item.confidence === 'high' ? 'badge-matched' : 'badge-uncertain';

    const badge = document.createElement('span');
    badge.className       = `mal-badge ${cls}`;
    badge.textContent     = item.confidence === 'high' ? '✅ Matched' : '⚠️ Approximate';
    badge.dataset.tooltip = tooltip;
    cell.appendChild(badge);

    const titleDiv = document.createElement('div');
    titleDiv.className   = 'mal-match-title';
    titleDiv.textContent = item.malTitle;
    titleDiv.title       = item.malTitle;
    cell.appendChild(titleDiv);

    if (cb) { cb.disabled = false; cb.checked = true; }
  }

  // Show edit button
  const editBtn = editBtnCell?.querySelector('.btn-edit');
  if (editBtn) editBtn.style.display = '';

  updateImportBtn();
}

function setImportRowDone(index, ok, errorMsg) {
  const tr = document.querySelector(`#import-body tr[data-index="${index}"]`);
  const statusCell = document.getElementById(`import-row-status-${index}`);
  const cb = document.querySelector(`#import-body input[data-index="${index}"]`);
  if (tr) tr.classList.add('row-done');
  if (statusCell) statusCell.textContent = ok ? '✅' : '❌';
  if (cb) { cb.checked = false; cb.disabled = true; }
  if (!ok && errorMsg) {
    const cell = document.getElementById(`import-mal-${index}`);
    if (cell) {
      const err = document.createElement('div');
      err.style.cssText = 'font-size:11px;color:#ffab91;margin-top:3px;';
      err.textContent   = errorMsg;
      cell.appendChild(err);
    }
  }
}

async function initImportTab() {
  const stored = await api.storage.local.get(['pending_import', 'pending_import_ts']);
  importManga = stored.pending_import ?? [];

  if (importManga.length === 0) {
    importEmpty.style.display = 'block';
    importUi.style.display    = 'none';
    return;
  }

  importEmpty.style.display = 'none';
  importUi.style.display    = 'block';
  importBody.textContent    = '';

  importManga.forEach((item, i) => renderImportRow(item, i));

  // Resolve MAL IDs sequentially
  for (let i = 0; i < importManga.length; i++) {
    try {
      const res = await sendMsg('GET_MAL_ID', { slug: importManga[i].slug });
      if (res.ok) {
        importManga[i].malId      = res.malId ?? null;
        importManga[i].malTitle   = res.malTitle ?? null;
        importManga[i].confidence = res.confidence ?? 'none';
      } else {
        importManga[i].malId = null;
        importManga[i].confidence = 'none';
      }
    } catch {
      importManga[i].malId = null;
      importManga[i].confidence = 'error';
    }
    renderImportMalCell(i);
    if (i < importManga.length - 1) await new Promise(r => setTimeout(r, 250));
  }
}

async function runImport() {
  const selected = [...document.querySelectorAll(
    '#import-body input[type="checkbox"]:checked:not(:disabled)'
  )].map(cb => Number(cb.dataset.index));

  if (selected.length === 0) return;

  btnImportRun.disabled    = true;
  btnSelectAll.disabled    = true;
  btnDeselectAll.disabled  = true;
  importProgressWrap.style.display = 'block';
  importResultSummary.style.display = 'none';

  let done = 0, succeeded = 0, failed = 0;

  for (const index of selected) {
    const item = importManga[index];

    importProgressLabel.textContent =
      `Importing ${done + 1} / ${selected.length}: ${item.malTitle ?? item.title}…`;
    importProgressFill.style.width =
      `${Math.round((done / selected.length) * 100)}%`;

    try {
      const res = await sendMsg('IMPORT_SINGLE', {
        malId:    item.malId,
        malTitle: item.malTitle,
        slug:     item.slug,
        chapter:  item.chapter,
        status:   item.status,
      });
      if (res.ok) { succeeded++; setImportRowDone(index, true); }
      else { failed++; setImportRowDone(index, false, res.error); }
    } catch (err) {
      failed++;
      setImportRowDone(index, false, err.message);
    }

    done++;
    if (done < selected.length) await new Promise(r => setTimeout(r, 500));
  }

  importProgressFill.style.width  = '100%';
  importProgressLabel.textContent = 'Done!';

  importResultSummary.className   = failed === 0 ? 'ok' : 'err';
  importResultSummary.style.display = 'block';
  importResultSummary.textContent =
    `✅ ${succeeded} imported` + (failed > 0 ? ` · ❌ ${failed} failed` : '');

  updateImportBtn();
  btnSelectAll.disabled   = false;
  btnDeselectAll.disabled = false;
}

btnSelectAll?.addEventListener('click', () => {
  document.querySelectorAll('#import-body input[type="checkbox"]:not(:disabled)')
    .forEach(cb => { cb.checked = true; });
  updateImportBtn();
});

btnDeselectAll?.addEventListener('click', () => {
  document.querySelectorAll('#import-body input[type="checkbox"]:not(:disabled)')
    .forEach(cb => { cb.checked = false; });
  updateImportBtn();
});

btnImportRun?.addEventListener('click', runImport);

btnImportClear?.addEventListener('click', async () => {
  await api.storage.local.remove(['pending_import', 'pending_import_ts']);
  importBody.textContent      = '';
  importUi.style.display      = 'none';
  importEmpty.style.display   = 'block';
  importProgressWrap.style.display  = 'none';
  importResultSummary.style.display = 'none';
  importManga = [];
  tabsInit.delete('import'); // allow re-init if user imports again
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── MAPPINGS TAB ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function loadMappings() {
  mappingsLoading.style.display    = 'block';
  mappingsEmpty.style.display      = 'none';
  mappingsTableWrap.style.display  = 'none';
  mappingsBody.textContent         = '';

  try {
    const res = await sendMsg('GET_MAPPINGS');
    if (!res.ok) throw new Error(res.error);

    const entries = Object.entries(res.mappings ?? {});
    mappingsLoading.style.display = 'none';

    if (entries.length === 0) {
      mappingsEmpty.style.display = 'block';
      return;
    }

    mappingsTableWrap.style.display = 'block';

    entries.sort(([a], [b]) => a.localeCompare(b));
    entries.forEach(([slug, m]) => renderMappingRow(slug, m.id, m.title, m.syncEnabled !== false));
  } catch (err) {
    mappingsLoading.textContent = `Failed to load: ${err.message}`;
  }
}

function renderMappingRow(slug, malId, malTitle, syncEnabled = true) {
  const tr = document.createElement('tr');
  tr.id = `mapping-row-${CSS.escape(slug)}`;

  const tdSlug = document.createElement('td');
  tdSlug.className   = 'td-slug';
  tdSlug.textContent = slug;

  const tdTitle = document.createElement('td');
  tdTitle.className   = 'td-mal-title';
  tdTitle.id          = `mapping-title-${CSS.escape(slug)}`;
  tdTitle.textContent = malTitle;

  const tdId = document.createElement('td');
  tdId.className   = 'td-mal-id';
  tdId.id          = `mapping-id-${CSS.escape(slug)}`;
  tdId.textContent = malId;

  // Sync toggle
  const tdSync = document.createElement('td');
  tdSync.className = 'td-sync';
  const syncToggle = document.createElement('input');
  syncToggle.type    = 'checkbox';
  syncToggle.checked = syncEnabled;
  syncToggle.title   = syncEnabled ? 'Sync enabled' : 'Sync disabled';
  syncToggle.addEventListener('change', async () => {
    syncToggle.title = syncToggle.checked ? 'Sync enabled' : 'Sync disabled';
    await sendMsg('SET_SYNC_ENABLED', { slug, enabled: syncToggle.checked });
  });
  tdSync.appendChild(syncToggle);

  const tdActions = document.createElement('td');
  tdActions.className = 'td-actions';

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className   = 'btn-edit';
  editBtn.textContent = '✏️ Edit';
  editBtn.addEventListener('click', () => {
    openInlineEdit(
      tdTitle,
      slug,
      (newMalId, newMalTitle) => {
        // Refresh title and id cells
        tdTitle.textContent = newMalTitle;
        document.getElementById(`mapping-id-${CSS.escape(slug)}`).textContent = newMalId;
      },
      () => {
        // Cancelled — restore title text
        tdTitle.textContent = malTitle;
      }
    );
  });

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className   = 'btn-delete';
  delBtn.textContent = '🗑️ Delete';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete mapping for "${slug}"?`)) return;
    try {
      const res = await sendMsg('DELETE_MAPPING', { slug });
      if (!res.ok) throw new Error(res.error);
      tr.remove();
      // Show empty state if no rows remain
      if (mappingsBody.children.length === 0) {
        mappingsTableWrap.style.display = 'none';
        mappingsEmpty.style.display     = 'block';
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  tdActions.appendChild(editBtn);
  tdActions.appendChild(delBtn);

  tr.appendChild(tdSlug);
  tr.appendChild(tdTitle);
  tr.appendChild(tdId);
  tr.appendChild(tdSync);
  tr.appendChild(tdActions);
  mappingsBody.appendChild(tr);
}

async function initMappingsTab() {
  const params     = new URLSearchParams(window.location.search);
  const pendingSlug = params.get('slug');

  if (pendingSlug) {
    pendingSlugDisplay.textContent          = pendingSlug;
    mappingsPendingNotice.style.display     = 'block';

    // Open inline edit immediately in the notice panel
    openInlineEdit(
      pendingSlugEdit,
      pendingSlug,
      async (malId, malTitle) => {
        // Hide notice and reload mappings list
        mappingsPendingNotice.style.display = 'none';
        await loadMappings();
      },
      () => {
        mappingsPendingNotice.style.display = 'none';
      }
    );
  }

  await loadMappings();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── INIT ──────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function init() {
  // Determine which tab to show from URL hash
  const hash    = window.location.hash.replace('#', '') || 'general';
  const validTabs = ['general', 'notifications', 'auto-status', 'import', 'mappings'];
  const startTab  = validTabs.includes(hash) ? hash : 'general';

  // Load settings-tab data (always needed, cheap)
  await initGeneralTab();

  // Activate starting tab (may trigger lazy import/mappings init)
  await activateTab(startTab);
}

init();
