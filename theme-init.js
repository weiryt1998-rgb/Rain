/*
 * Runs synchronously in <head> so the saved theme is applied before the first
 * paint. Kept as a separate file so the page can use a strict Content Security
 * Policy without inline scripts.
 */
(function () {
  'use strict';
  var theme = null;
  try {
    theme = JSON.parse(window.localStorage.getItem('sukhothai-weather:theme'));
  } catch (_) { /* Storage may be blocked; fall back to the system preference. */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
