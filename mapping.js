/**
 * mapping.js — Manuelle Slug-Zuweisung
 * Ermöglicht die manuelle Verknüpfung eines Roliascan-Slugs mit einem MAL-Manga.
 */

'use strict';

// ─── Browser-API Polyfill ─────────────────────────────────────────────────────
const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── URL-Parameter ────────────────────────────────────────────────────────────
const params      = new URLSearchParams(window.location.search);
const currentSlug = params.get('slug') ?? '';

// ─── DOM-Referenzen ───────────────────────────────────────────────────────────
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

// ─── Zustand ──────────────────────────────────────────────────────────────────
let selectedMalId    = null;
let selectedMalTitle = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

if (currentSlug) {
  displaySlugEl.textContent = currentSlug;
  // Suchfeld vorausfüllen (Slug → lesbarer Titel)
  searchInput.value = currentSlug.replace(/-/g, ' ');
} else {
  displaySlugEl.textContent = '(kein Slug angegeben)';
  showStatus('error', 'Kein Manga-Slug in der URL gefunden. Bitte diese Seite über eine Notification öffnen.');
  btnSearch.disabled = true;
}

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

function showStatus(type, text) {
  statusMsg.className     = `msg msg-${type}`;
  statusMsg.textContent   = text;
  statusMsg.style.display = 'block';
}

function hideStatus() {
  statusMsg.style.display = 'none';
}

function setSearchLoading(loading) {
  if (loading) {
    btnSearch.innerHTML  = '<span class="spinner-inline"></span>Suche …';
    btnSearch.disabled   = true;
    searchInput.disabled = true;
  } else {
    btnSearch.innerHTML  = 'Suchen';
    btnSearch.disabled   = false;
    searchInput.disabled = false;
  }
}

function selectResult(id, title) {
  selectedMalId    = id;
  selectedMalTitle = title;

  // Markierung in Liste aktualisieren
  document.querySelectorAll('#results-list li').forEach(li => {
    li.classList.toggle('selected', li.dataset.malId === String(id));
  });

  // Vorschau anzeigen
  previewTitle.textContent    = title;
  previewId.textContent       = `MAL-ID: ${id}`;
  actionSection.style.display = 'block';
  hideStatus();
}

// ─── Suchergebnisse rendern ───────────────────────────────────────────────────

function renderResults(results) {
  resultsList.innerHTML = '';
  emptyResults.style.display = 'none';
  resultsSection.style.display = 'block';

  if (results.length === 0) {
    emptyResults.style.display = 'block';
    return;
  }

  results.forEach(({ id, title }) => {
    const li = document.createElement('li');
    li.dataset.malId = id;

    li.innerHTML = `
      <span class="title">${escapeHtml(title)}</span>
      <span class="mal-id">ID: ${id}</span>
    `;

    li.addEventListener('click', () => selectResult(id, title));
    resultsList.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Suche ausführen ──────────────────────────────────────────────────────────

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
    if (!res.ok) throw new Error(res.error ?? 'Suche fehlgeschlagen');
    renderResults(res.results);
  } catch (err) {
    showStatus('error', `Fehler bei der Suche: ${err.message}`);
    resultsSection.style.display = 'none';
  } finally {
    setSearchLoading(false);
  }
}

// ─── Zuweisung speichern ──────────────────────────────────────────────────────

async function doAssign() {
  if (!selectedMalId || !selectedMalTitle || !currentSlug) return;

  btnAssign.innerHTML  = '<span class="spinner-inline"></span>Speichern …';
  btnAssign.disabled   = true;

  try {
    const res = await sendMsg('SAVE_MAPPING', {
      slug:     currentSlug,
      malId:    selectedMalId,
      malTitle: selectedMalTitle,
    });

    if (!res.ok) throw new Error(res.error ?? 'Speichern fehlgeschlagen');

    showStatus('success',
      `✅ Zugewiesen: „${selectedMalTitle}" (ID ${selectedMalId}) → ${currentSlug}\n` +
      `Der ausstehende Sync wird jetzt automatisch wiederholt.`
    );

    btnAssign.innerHTML = '✅ Gespeichert';
    // Seite nach kurzer Verzögerung schließen
    setTimeout(() => window.close(), 2500);

  } catch (err) {
    showStatus('error', `Fehler beim Speichern: ${err.message}`);
    btnAssign.innerHTML = 'Zuweisen & Speichern';
    btnAssign.disabled  = false;
  }
}

// ─── Event-Handler ────────────────────────────────────────────────────────────

btnSearch.addEventListener('click', doSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

btnAssign.addEventListener('click', doAssign);
