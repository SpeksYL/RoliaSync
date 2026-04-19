const api = typeof browser !== 'undefined' ? browser : chrome;
window.location.replace(api.runtime.getURL('options.html') + '#import');
