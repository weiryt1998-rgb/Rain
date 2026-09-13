/*
 * Service worker: keeps the app shell available offline.
 * Forecast data is never cached here; weather-core.js keeps its own
 * validated 24-hour cache in localStorage and marks stale data in the UI.
 */
'use strict';

// Bump when a shell file changes in a way that must reach offline users immediately.
const VERSION = 'rain-shell-v4';
const SHELL = ['./', './index.html', './style.css', './script.js', './weather-core.js', './weather-backdrop.js', './theme-init.js', './favicon.svg', './manifest.webmanifest'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    // Cache only the 4K scenes actually viewed. Large photos must not delay
    // shell installation or prevent the app from installing if one is absent.
    if (url.pathname.includes('/images/')) {
      event.respondWith(cacheFirst(request, event));
      return;
    }
    event.respondWith(networkFirst(request));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Anything else (the Open-Meteo API included) goes straight to the network.
});

async function cacheFirst(request, event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || refresh;
}
