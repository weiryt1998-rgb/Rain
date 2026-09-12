/* Weather photographs are decoded before fading in; only the current scene is loaded. */
(function () {
  'use strict';

  const backdrop = document.getElementById('weather-backdrop');
  const motionButton = document.getElementById('weather-motion-btn');
  if (!backdrop || !window.WeatherCore) return;

  const photos = Array.from(backdrop.querySelectorAll('.weather-photo'));
  const PHOTO = Object.freeze({
    clear: 'images/weather/sunny-4k.jpg',
    partly: 'images/weather/sunny-4k.jpg',
    cloud: 'images/weather/cloudy-4k.jpg',
    rain: 'images/weather/rainy-4k.jpg',
    storm: 'images/storm-4k.jpg',
    fog: 'images/weather/cloudy-4k.jpg',
    snow: 'images/weather/cloudy-4k.jpg',
    night: 'images/weather/night-4k.jpg'
  });
  const MOTION_KEY = 'sukhothai-weather:motion';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = window.WeatherCore.safeStorage.get(MOTION_KEY, false) === true;
  let activePhoto = null;
  let requestedSource = '';
  let requestVersion = 0;

  function syncMotion() {
    const stopped = paused || reducedMotion.matches;
    document.body.dataset.motion = stopped ? 'paused' : 'running';
    document.body.dataset.pageHidden = String(document.hidden);
    if (!motionButton) return;
    const label = reducedMotion.matches ? 'ระบบตั้งค่าให้ลดการเคลื่อนไหว' : stopped ? 'เปิดภาพพื้นหลังเคลื่อนไหว' : 'หยุดภาพพื้นหลังเคลื่อนไหว';
    motionButton.setAttribute('aria-label', label);
    motionButton.setAttribute('aria-pressed', String(stopped));
    motionButton.title = label;
    motionButton.disabled = reducedMotion.matches;
    motionButton.querySelector('use').setAttribute('href', stopped ? '#i-play' : '#i-pause');
  }

  function clearPhotos() {
    photos.forEach(photo => {
      photo.classList.remove('is-visible');
      photo.removeAttribute('src');
    });
    activePhoto = null;
  }

  async function showPhoto(source) {
    if (source === requestedSource) return;
    requestedSource = source;
    const version = ++requestVersion;
    if (!source) {
      clearPhotos();
      return;
    }
    // Use a detached image while loading, so a stale request cannot paint over
    // a newer district or briefly show a broken-image indicator.
    const incoming = new Image();
    incoming.decoding = 'async';
    incoming.src = source;
    try {
      await incoming.decode();
      if (version !== requestVersion) return;
      const next = photos.find(photo => photo !== activePhoto);
      next.src = source;
      await next.decode();
      if (version !== requestVersion) return;
      photos.forEach(photo => photo.classList.toggle('is-visible', photo === next));
      activePhoto = next;
    } catch (_) {
      if (version !== requestVersion) return;
      // A missing image should leave a calm gradient, never an unrelated scene.
      clearPhotos();
      requestedSource = '';
    }
  }

  function update(current) {
    const info = current && window.WeatherCore.codeInfo(current.code, current.isDay);
    let scene = 'loading';
    if (info) {
      if (['rain', 'storm', 'fog', 'snow'].includes(info.kind)) scene = info.kind;
      else if (info.kind === 'cloud') scene = current.code === 3 ? 'cloud' : 'loading';
      else if (info.kind === 'moon' || current.isDay === false || current.isDay === 0) scene = 'night';
      else if (info.kind === 'partly') scene = 'partly';
      else if (info.kind === 'sun') scene = 'clear';
    }
    document.body.dataset.weather = scene;
    document.body.dataset.weatherTime = current?.isDay === true || current?.isDay === 1 ? 'day'
      : current?.isDay === false || current?.isDay === 0 ? 'night' : 'unknown';
    void showPhoto(PHOTO[scene] || '');
  }

  motionButton?.addEventListener('click', () => {
    paused = !paused;
    window.WeatherCore.safeStorage.set(MOTION_KEY, paused);
    syncMotion();
  });
  reducedMotion.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // On a first visit the photo can finish before the worker takes control.
      // Route it through the worker once so this first scene is available offline.
      if (requestedSource) fetch(requestedSource).catch(() => {});
    });
  }
  syncMotion();
  window.WeatherBackdrop = Object.freeze({ update, reset: () => update(null) });
})();
