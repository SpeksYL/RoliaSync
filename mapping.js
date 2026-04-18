/**
 * mapping.js — Manual slug assignment
 * Allows manually linking a roliascan slug to a MAL manga.
 */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── URL params ───────────────────────────────────────────────────────────────
const params      = new URLSearchParams(window.location.search);
const currentSlug = params.get('slug') ?? '';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const displaySlugEl  = document.getElementById('display-slug');
const searchInput    = document.getElementById('search-input');
const btnSearch      = document.getElementById('btn-search');
const resultsSection = document.getElementById('results-section');
const resultsList    = document.getElementById('results-list');
const emptyResults   = document.getElementById('empty-results');
const actionSection  = document.getElementById('action-section');
const previewTitle   = document.getElementById('preview-title');
const previewId      = document.getElementById('preview-id');
const btnAssign      = document.getElementById('btn-assign');
const statusMsg      = document.getElementById('status-msg');

// ─── State ────────────────────────────────────────────────────────────────────
let selectedMalId    = null;
let selectedMalTitle = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

if (currentSlug) {
  displaySlugEl.textContent = currentSlug;
  // Pre-fill search with slug converted to readable title
  searchInput.value = currentSlug.replace(/-/g, ' ');
} else {
  displaySlugEl.textContent = '(no slug provided)';
  showStatus('error', 'No manga slug found in URL. Please open this page via a notification.');
  btnSearch.disabled = true;
}

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

function showStatus(type, text) {
  statusMsg.className     = `msg msg-${type}`;
  statusMsg.textContent   = text;
  statusMsg.style.display = 'block';
}

function hideStatus() {
  statusMsg.style.display = 'none';
}

function setSearchLoading(loading) {
  btnSearch.textContent = '';
  if (loading) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner-inline';
    btnSearch.appendChild(spinner);
    btnSearch.appendChild(document.createTextNode('Searching…'));
    btnSearch.disabled   = true;
    searchInput.disabled = true;
  } else {
    btnSearch.textContent = 'Search';
    btnSearch.disabled    = false;
    searchInput.disabled  = false;
  }
}

function selectResult(id, title) {
  selectedMalId    = id;
  selectedMalTitle = title;

  document.querySelectorAll('#results-list li').forEach(li => {
    li.classList.toggle('selected', li.dataset.malId === String(id));
  });

  previewTitle.textContent    = title;
  previewId.textContent       = `MAL ID: ${id}`;
  actionSection.style.display = 'block';
  hideStatus();
}

// ─── Render results ───────────────────────────────────────────────────────────

function renderResults(results) {
  resultsList.textContent    = '';
  emptyResults.style.display = 'none';
  resultsSection.style.display = 'block';

  if (results.length === 0) {
    emptyResults.style.display = 'block';
    return;
  }

  results.forEach(({ id, title }) => {
    const li = document.createElement('li');
    li.dataset.malId = id;

    const spanTitle = document.createElement('span');
    spanTitle.className   = 'title';
    spanTitle.textContent = title;
    const spanId = document.createElement('span');
    spanId.className   = 'mal-id';
    spanId.textContent = `ID: ${id}`;
    li.appendChild(spanTitle);
    li.appendChild(spanId);

    li.addEventListener('click', () => selectResult(id, title));
    resultsList.appendChild(li);
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  hideStatus();
  actionSection.style.display = 'none';
  selectedMalId    = null;
  selectedMalTitle = null;

  setSearchLoading(true);

  try {
    const res = await sendMsg('SEARCH_MAL', { query });
    if (!res.ok) throw new Error(res.error ?? 'Search failed');
    renderResults(res.results);
  } catch (err) {
    showStatus('error', `Search error: ${err.message}`);
    resultsSection.style.display = 'none';
  } finally {
    setSearchLoading(false);
  }
}

// ─── Assign ───────────────────────────────────────────────────────────────────

async function doAssign() {
  if (!selectedMalId || !selectedMalTitle || !currentSlug) return;

  btnAssign.textContent = '';
  const spinner = document.createElement('span');
  spinner.className = 'spinner-inline';
  btnAssign.appendChild(spinner);
  btnAssign.appendChild(document.createTextNode('Saving…'));
  btnAssign.disabled = true;

  try {
    const res = await sendMsg('SAVE_MAPPING', {
      slug:     currentSlug,
      malId:    selectedMalId,
      malTitle: selectedMalTitle,
    });

    if (!res.ok) throw new Error(res.error ?? 'Save failed');

    showStatus('success',
      `✅ Assigned: "${selectedMalTitle}" (ID ${selectedMalId}) → ${currentSlug}\n` +
      `The pending sync will now be retried automatically.`
    );

    btnAssign.textContent = '✅ Saved';
    setTimeout(() => window.close(), 2500);

  } catch (err) {
    showStatus('error', `Error saving: ${err.message}`);
    btnAssign.textContent = 'Assign & Save';
    btnAssign.disabled    = false;
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

btnSearch.addEventListener('click', doSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

btnAssign.addEventListener('click', doAssign);
