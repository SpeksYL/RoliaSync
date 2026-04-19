const api = typeof browser !== 'undefined' ? browser : chrome;
const slug = new URLSearchParams(window.location.search).get('slug') ?? '';
const base = api.runtime.getURL('options.html');
window.location.replace(base + (slug ? '?slug=' + encodeURIComponent(slug) : '') + '#mappings');
