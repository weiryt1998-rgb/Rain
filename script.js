/*
 * UI layer for Sukhothai Weather.
 *
 * Data access, validation, formatting and the forecast cache live in
 * weather-core.js. This file owns view state, rendering and browser events.
 * It never mutates data returned by the core and sets styles only through the
 * CSSOM, so the page can run under a strict Content Security Policy.
 */
(function () {
  'use strict';

  const core = window.WeatherCore;
  if (!core) return;

  const STORE = Object.freeze({
    district: 'sukhothai-weather:district',
    unit: 'sukhothai-weather:unit',
    theme: 'sukhothai-weather:theme',
    favorites: 'sukhothai-weather:favorites',
    chart: 'sukhothai-weather:chart'
  });
  const TIMEZONE = 'Asia/Bangkok';
  const REFRESH_MS = 15 * 60 * 1000;
  const STALE_MS = 60 * 60 * 1000;
  const HOUR_MS = 3600000;
  const HOUR_COLUMN = 76;
  const CHART_HEIGHT = 132;
  const DISTRICT_FETCH_CONCURRENCY = 2;
  const CHARTS = ['temp', 'rain', 'wind'];

  const $ = id => document.getElementById(id);
  const el = {
    savedCount: $('saved-count'), searchForm: $('search-form'), searchInput: $('search-input'), suggestions: $('suggestions'),
    geoBtn: $('geo-btn'), themeBtn: $('theme-btn'), todayDate: $('today-date'), liveStatus: $('live-status'),
    refreshBtn: $('refresh-btn'), statusBanner: $('status-banner'), statusText: $('status-text'), retryBtn: $('retry-btn'),
    bannerClose: $('banner-close'), content: $('weather-content'), currentCard: $('current-card'), placeName: $('place-name'),
    placeMeta: $('place-meta'), breadcrumbDistrict: $('breadcrumb-district'), sidebarClock: $('sidebar-clock'), saveBtn: $('save-btn'),
    temp: $('current-temp'), unit: $('current-unit'), icon: $('current-icon'), condition: $('current-condition'),
    feels: $('current-feels'), max: $('current-max'), min: $('current-min'), rain: $('current-rain'), wind: $('current-wind'),
    rainMm: $('current-rain-mm'), update: $('current-update'), dailyList: $('daily-list'), hourlySubtitle: $('hourly-subtitle'),
    hourPrev: $('hour-prev'), hourNext: $('hour-next'), resetDay: $('reset-day'), chartUnit: $('chart-unit'),
    hourlyScroll: $('hourly-scroll'), hourlyInner: $('hourly-inner'), hourlyList: $('hourly-list'), hourlyChart: $('hourly-chart'),
    hourlySummary: $('hourly-summary'), humidity: $('d-humidity'), humidityMeter: $('humidity-meter'), humidityBar: $('humidity-bar'),
    humidityNote: $('humidity-note'), windValue: $('d-wind'), windArrow: $('wind-arrow'), windDirection: $('wind-direction'),
    windNote: $('wind-note'), uvBadge: $('uv-badge'), uv: $('d-uv'), uvMarker: $('uv-marker'), uvNote: $('uv-note'),
    sunrise: $('sunrise'), sunset: $('sunset'), sunPosition: $('sun-position'), sunNote: $('sun-note'),
    pressure: $('d-pressure'), pressureNote: $('pressure-note'), visibility: $('d-visibility'), visibilityNote: $('visibility-note'),
    insight: $('weather-insight'), insightIcon: $('insight-icon'), insightTitle: $('insight-title'), insightText: $('insight-text'),
    districtList: $('district-list'), districtsBadge: $('districts-badge'), savedList: $('saved-list'),
    shareBtn: $('share-btn'), installBtn: $('install-btn'), toast: $('toast')
  };
  const unitButtons = Array.from(document.querySelectorAll('.unit-toggle [data-unit]'));
  const chartButtons = Array.from(document.querySelectorAll('.chart-tabs [data-chart]'));
  const navItems = Array.from(document.querySelectorAll('.nav-item[data-nav]'));
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollBehavior = reducedMotion ? 'auto' : 'smooth';

  const state = {
    district: null,
    weather: null,
    stale: false,
    loading: false,
    unit: 'c',
    theme: 'light',
    themeExplicit: false,
    favorites: [],
    chart: 'temp',
    selectedDay: null,
    controller: null,
    summaries: new Map(),
    summaryQueue: null,
    lastFetchAt: 0,
    suggestionIndex: -1,
    toastTimer: 0,
    installPrompt: null
  };

  /* ---------- Small helpers ---------- */

  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const iconMarkup = kind => `<svg class="weather-icon weather-icon-${escapeHtml(kind)}" aria-hidden="true" focusable="false"><use href="#w-${escapeHtml(kind)}"/></svg>`;
  const temp = value => core.formatTemp(value, state.unit);
  const degree = value => Number.isFinite(value) ? `${temp(value)}°` : '—';
  const unitLabel = () => state.unit === 'f' ? '°F' : '°C';
  const percent = value => Number.isFinite(value) ? `${core.formatNumber(value)}%` : '—';
  const kph = value => Number.isFinite(value) ? `${core.formatNumber(value)} กม./ชม.` : '—';
  const floorHour = time => Math.floor(time / HOUR_MS) * HOUR_MS;
  const thaiDate = (time, options) => new Intl.DateTimeFormat('th-TH', { timeZone: TIMEZONE, ...options }).format(time);
  const shortDate = date => Number.isFinite(core.parseTime(date)) ? thaiDate(core.parseTime(date), { day: 'numeric', month: 'short' }) : '';

  function relativeTime(timestamp) {
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'เมื่อสักครู่';
    if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
    return `${Math.floor(hours / 24)} วันที่แล้ว`;
  }

  function durationText(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours && minutes) return `${hours} ชม. ${minutes} นาที`;
    if (hours) return `${hours} ชม.`;
    return `${minutes} นาที`;
  }

  function todayEntry() {
    const today = core.bangkokDate();
    return state.weather.daily.find(day => day.date === today) || state.weather.daily[0];
  }

  function currentHourEntry(weather = state.weather) {
    const now = Date.now();
    let entry = null;
    for (const hour of weather.hourly) {
      if (core.parseTime(hour.time) <= now) entry = hour;
      else break;
    }
    return entry || weather.hourly[0];
  }

  function upcomingHours(hoursAhead) {
    const start = floorHour(Date.now());
    return state.weather.hourly.filter(hour => {
      const time = core.parseTime(hour.time);
      return time >= start && time < start + hoursAhead * HOUR_MS;
    });
  }

  /* ---------- Preferences ---------- */

  function loadPreferences() {
    state.unit = core.safeStorage.get(STORE.unit, 'c') === 'f' ? 'f' : 'c';
    const storedTheme = core.safeStorage.get(STORE.theme, null);
    state.themeExplicit = storedTheme === 'dark' || storedTheme === 'light';
    state.theme = state.themeExplicit ? storedTheme : systemTheme();
    const favorites = core.safeStorage.get(STORE.favorites, []);
    state.favorites = Array.isArray(favorites) ? [...new Set(favorites.filter(id => core.districtById(id)))] : [];
    const chart = core.safeStorage.get(STORE.chart, 'temp');
    state.chart = CHARTS.includes(chart) ? chart : 'temp';
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function initialDistrict() {
    const requested = new URLSearchParams(window.location.search).get('district');
    const fromUrl = core.districtById(requested);
    if (requested && !fromUrl) showToast('ไม่พบอำเภอในลิงก์ แสดงอำเภอที่ดูล่าสุดแทน');
    return fromUrl || core.districtById(core.safeStorage.get(STORE.district, null)) || core.DISTRICTS[0];
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const dark = state.theme === 'dark';
    const label = dark ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด';
    el.themeBtn.setAttribute('aria-label', label);
    el.themeBtn.title = `${label} (T)`;
    el.themeBtn.innerHTML = `<svg class="icon"><use href="#${dark ? 'i-sun' : 'i-moon'}"/></svg>`;
    // Keep the browser chrome colour in step with an explicit theme choice.
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = dark ? '#0b1633' : '#1b2a5c'; });
  }

  function applyUnit() {
    for (const button of unitButtons) {
      const active = button.dataset.unit === state.unit;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    el.unit.textContent = unitLabel();
  }

  /* ---------- Status, banner, toast ---------- */

  function setLiveStatus(kind, text) {
    el.liveStatus.dataset.state = kind;
    el.liveStatus.querySelector('em').textContent = text;
  }

  function showBanner(message, { retry = true, kind = 'warning' } = {}) {
    el.statusText.textContent = message;
    el.retryBtn.hidden = !retry;
    el.statusBanner.dataset.kind = kind;
    el.statusBanner.querySelector('use').setAttribute('href', kind === 'offline' ? '#i-wifi-off' : kind === 'error' ? '#i-alert' : '#i-info');
    el.statusBanner.hidden = false;
  }

  function hideBanner() {
    el.statusBanner.hidden = true;
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  function updateFreshness() {
    if (!state.weather) return;
    const fetchedAt = state.weather.fetchedAt;
    const age = Date.now() - fetchedAt;
    if (state.loading) setLiveStatus('loading', 'กำลังอัปเดต');
    else if (!navigator.onLine) setLiveStatus('offline', `ออฟไลน์ · ข้อมูลเมื่อ ${core.formatTime(fetchedAt)}`);
    else if (state.stale || age > STALE_MS) setLiveStatus('stale', `ข้อมูลเก่า · ${relativeTime(fetchedAt)}`);
    else setLiveStatus('live', `อัปเดตล่าสุด ${core.formatTime(fetchedAt)}`);
    el.update.textContent = `${state.stale ? 'ข้อมูลที่บันทึกไว้' : 'อัปเดต'} ${core.formatTime(fetchedAt)} น. · ${relativeTime(fetchedAt)}`;
    el.update.classList.toggle('is-stale', state.stale || age > STALE_MS);
  }

  function updateClock() {
    el.sidebarClock.textContent = core.formatTime(Date.now());
    el.sidebarClock.setAttribute('datetime', new Date().toISOString());
  }

  /* ---------- Loading ---------- */

  function syncUrl() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('district') === state.district.id) return;
    url.searchParams.set('district', state.district.id);
    window.history.replaceState(null, '', url);
  }

  async function loadWeather({ silent = false } = {}) {
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    const district = state.district;
    state.loading = true;
    el.refreshBtn.classList.add('is-spinning');
    el.refreshBtn.disabled = true;
    el.content.setAttribute('aria-busy', 'true');
    setLiveStatus('loading', state.weather ? 'กำลังอัปเดต' : 'กำลังโหลดพยากรณ์');
    try {
      const weather = await core.fetchWeather(district, { signal: controller.signal });
      if (controller.signal.aborted || state.district.id !== district.id) return;
      state.weather = weather;
      state.stale = false;
      state.lastFetchAt = Date.now();
      state.summaries.set(district.id, weather);
      core.writeCache(district.id, weather);
      hideBanner();
      render();
      if (!silent) showToast(`อัปเดตข้อมูล${district.name}แล้ว`);
    } catch (error) {
      if (error && error.code === 'ABORTED') return;
      if (state.district.id !== district.id) return;
      const offline = !navigator.onLine || error.code === 'NETWORK_ERROR';
      state.stale = Boolean(state.weather);
      if (state.weather) {
        render();
        showBanner(`${error.message} กำลังแสดงข้อมูลที่บันทึกไว้เมื่อ ${core.formatTime(state.weather.fetchedAt)} น.`, { kind: offline ? 'offline' : 'warning' });
      } else {
        setLiveStatus('error', 'โหลดข้อมูลไม่ได้');
        showBanner(error.message, { kind: offline ? 'offline' : 'error' });
        renderEmpty('ไม่สามารถโหลดข้อมูลได้');
      }
    } finally {
      if (state.controller === controller) {
        state.controller = null;
        state.loading = false;
        el.refreshBtn.classList.remove('is-spinning');
        el.refreshBtn.disabled = false;
        el.content.setAttribute('aria-busy', 'false');
        updateFreshness();
      }
    }
  }

  function selectDistrict(district, { scroll = false } = {}) {
    if (!district) return;
    const changed = !state.district || state.district.id !== district.id;
    state.district = district;
    core.safeStorage.set(STORE.district, district.id);
    syncUrl();
    if (changed) {
      state.selectedDay = null;
      const cached = core.readCache(district.id);
      state.weather = cached;
      state.stale = Boolean(cached);
      hideBanner();
      if (cached) {
        state.summaries.set(district.id, cached);
        render();
      } else {
        renderEmpty();
      }
    }
    renderPlace();
    renderSaveButton();
    renderDistricts();
    renderSaved();
    loadWeather({ silent: true });
    if (scroll) $('overview').scrollIntoView({ behavior: scrollBehavior, block: 'start' });
  }

  function refresh() {
    if (!navigator.onLine) {
      showBanner('ไม่มีการเชื่อมต่ออินเทอร์เน็ต กำลังแสดงข้อมูลที่บันทึกไว้', { kind: 'offline' });
      updateFreshness();
      return;
    }
    loadWeather();
    queueDistrictSummaries(true);
  }

  /* ---------- District summaries (district grid and saved list) ---------- */

  function queueDistrictSummaries(force = false) {
    if (state.summaryQueue) return;
    const pending = core.DISTRICTS.filter(district => {
      if (district.id === state.district.id) return false;
      const cached = state.summaries.get(district.id) || core.readCache(district.id);
      if (cached && !state.summaries.has(district.id)) state.summaries.set(district.id, cached);
      return force || !cached || Date.now() - cached.fetchedAt > REFRESH_MS;
    });
    renderDistricts();
    renderSaved();
    if (!pending.length || !navigator.onLine) return;
    state.summaryQueue = (async () => {
      const queue = pending.slice();
      const worker = async () => {
        while (queue.length) {
          const district = queue.shift();
          try {
            const weather = await core.fetchWeather(district);
            state.summaries.set(district.id, weather);
            core.writeCache(district.id, weather);
            renderDistricts();
            renderSaved();
          } catch (_) {
            // The tile keeps its cached or empty state; the main card reports errors.
          }
        }
      };
      await Promise.all(Array.from({ length: DISTRICT_FETCH_CONCURRENCY }, worker));
    })().finally(() => { state.summaryQueue = null; });
  }

  /* ---------- Rendering ---------- */

  function render() {
    renderPlace();
    renderCurrent();
    renderDaily();
    renderHourly();
    renderDetails();
    renderInsight();
    renderDistricts();
    renderSaved();
    updateFreshness();
  }

  function renderPlace() {
    el.placeName.textContent = `อำเภอ${state.district.name}`;
    el.placeMeta.textContent = `${state.district.english} · จังหวัดสุโขทัย`;
    el.breadcrumbDistrict.textContent = state.district.name;
  }

  function renderEmpty(message = 'กำลังโหลดสภาพอากาศ') {
    renderPlace();
    window.WeatherBackdrop?.reset();
    el.currentCard.dataset.condition = 'loading';
    el.temp.textContent = '—';
    el.icon.innerHTML = '';
    el.condition.textContent = message;
    for (const node of [el.feels, el.max, el.min, el.rain, el.wind, el.rainMm]) node.textContent = '—';
    el.update.textContent = 'รอข้อมูลพยากรณ์';
    el.dailyList.innerHTML = Array.from({ length: 7 }, () => '<div class="daily-row skeleton-row" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>').join('');
    el.hourlyInner.style.width = '';
    el.hourlyList.innerHTML = Array.from({ length: 12 }, () => '<div class="hour-item skeleton-hour" aria-hidden="true"><span class="skeleton"></span><span class="skeleton skeleton-circle"></span><span class="skeleton"></span></div>').join('');
    el.hourlyChart.innerHTML = '';
    el.hourlySummary.textContent = '';
    el.insight.dataset.tone = 'neutral';
    el.insightTitle.textContent = 'เตรียมวันของคุณให้พร้อม';
    el.insightText.textContent = 'กำลังตรวจสอบแนวโน้มฝนและอุณหภูมิจากพยากรณ์ล่าสุด';
    document.title = `${state.district.name} — Rain สภาพอากาศสุโขทัย`;
    renderDistricts();
    renderSaved();
  }

  function heroCondition(kind, isDay) {
    if (kind === 'storm') return 'storm';
    if (kind === 'rain' || kind === 'snow') return 'rain';
    if (kind === 'fog') return 'fog';
    if (kind === 'moon' || isDay === false) return 'night';
    if (kind === 'cloud') return 'cloud';
    return 'clear';
  }

  function renderCurrent() {
    const { current } = state.weather;
    const today = todayEntry();
    const hour = currentHourEntry();
    const info = core.codeInfo(current.code, current.isDay);
    el.currentCard.dataset.condition = heroCondition(info.kind, current.isDay);
    window.WeatherBackdrop?.update(current);
    el.temp.textContent = temp(current.temp);
    el.unit.textContent = unitLabel();
    el.icon.innerHTML = iconMarkup(info.kind);
    el.condition.textContent = info.text;
    el.feels.textContent = degree(current.feelsLike);
    el.max.textContent = degree(today.max);
    el.min.textContent = degree(today.min);
    el.rain.textContent = percent(hour.rainChance !== null ? hour.rainChance : today.rainChance);
    el.wind.textContent = kph(current.windKph);
    el.rainMm.textContent = Number.isFinite(today.rainMm) ? `${core.formatNumber(today.rainMm, 1)} มม.` : '—';
    document.title = `${temp(current.temp)}${unitLabel()} ${info.text} · ${state.district.name} — Rain สภาพอากาศสุโขทัย`;
  }

  function renderDaily() {
    const today = core.bangkokDate();
    const days = state.weather.daily.filter(day => day.date >= today).slice(0, 7);
    if (!days.length) {
      el.dailyList.innerHTML = '<p class="empty-inline">ไม่มีพยากรณ์รายวัน</p>';
      return;
    }
    const mins = days.map(day => day.min).filter(Number.isFinite);
    const maxes = days.map(day => day.max).filter(Number.isFinite);
    const allMin = Math.min(...mins);
    const allMax = Math.max(...maxes);
    const span = Math.max(1, allMax - allMin);
    el.dailyList.innerHTML = days.map(day => {
      const info = core.codeInfo(day.code, true);
      const selected = state.selectedDay === day.date;
      const label = core.dayLabel(day.date);
      return `<button type="button" class="daily-row${selected ? ' is-selected' : ''}" data-date="${escapeHtml(day.date)}" aria-pressed="${selected}" aria-label="${escapeHtml(`${label} ${shortDate(day.date)} ${info.text} โอกาสฝน ${percent(day.rainChance)} ต่ำสุด ${degree(day.min)} สูงสุด ${degree(day.max)}`)}">
        <span class="daily-day"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(shortDate(day.date))}</small></span>
        <span class="daily-condition">${iconMarkup(info.kind)}<span>${escapeHtml(info.text)}</span></span>
        <span class="daily-rain"><svg class="icon"><use href="#i-drop"/></svg>${escapeHtml(percent(day.rainChance))}</span>
        <span class="daily-range"><span class="daily-min">${escapeHtml(degree(day.min))}</span><span class="daily-bar"><span></span></span><span class="daily-max">${escapeHtml(degree(day.max))}</span></span>
      </button>`;
    }).join('');
    // Position the range bars through the CSSOM so no inline style attributes are needed under CSP.
    el.dailyList.querySelectorAll('.daily-row').forEach((row, index) => {
      const day = days[index];
      const bar = row.querySelector('.daily-bar span');
      const left = Number.isFinite(day.min) ? ((day.min - allMin) / span) * 100 : 0;
      const right = Number.isFinite(day.max) ? ((allMax - day.max) / span) * 100 : 0;
      bar.style.left = `${left.toFixed(1)}%`;
      bar.style.right = `${right.toFixed(1)}%`;
    });
  }

  function hourlyWindow() {
    const hourly = state.weather.hourly;
    if (state.selectedDay) {
      const hours = hourly.filter(hour => core.bangkokDate(hour.time) === state.selectedDay);
      if (hours.length) return hours;
    }
    const start = Math.max(0, hourly.findIndex(hour => core.parseTime(hour.time) >= floorHour(Date.now())));
    return hourly.slice(start, start + 24);
  }

  function chartValue(hour) {
    if (state.chart === 'rain') return hour.rainChance;
    if (state.chart === 'wind') return hour.windKph;
    return Number.isFinite(hour.temp) ? Number(core.formatTemp(hour.temp, state.unit, 1).replace(/,/g, '')) : null;
  }

  function chartLabel(value) {
    if (!Number.isFinite(value)) return '—';
    if (state.chart === 'rain') return `${core.formatNumber(value)}%`;
    if (state.chart === 'wind') return core.formatNumber(value);
    return `${core.formatNumber(value)}°`;
  }

  function renderHourly() {
    const hours = hourlyWindow();
    const nowHour = floorHour(Date.now());
    el.resetDay.hidden = !state.selectedDay;
    el.hourlySubtitle.textContent = state.selectedDay
      ? `${core.dayLabel(state.selectedDay)} ${shortDate(state.selectedDay)} · เวลาประเทศไทย`
      : '24 ชั่วโมงข้างหน้า · เวลาประเทศไทย';
    el.chartUnit.textContent = state.chart === 'rain' ? '% โอกาสฝน' : state.chart === 'wind' ? 'กม./ชม.' : unitLabel();
    for (const button of chartButtons) {
      const active = button.dataset.chart === state.chart;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (!hours.length) {
      el.hourlyList.innerHTML = '<p class="empty-inline">ไม่มีพยากรณ์รายชั่วโมง</p>';
      el.hourlyChart.innerHTML = '';
      el.hourlySummary.textContent = '';
      return;
    }
    const width = hours.length * HOUR_COLUMN;
    el.hourlyInner.style.width = `${width}px`;
    el.hourlyList.innerHTML = hours.map(hour => {
      const time = core.parseTime(hour.time);
      const isNow = time === nowHour;
      const isPast = time < nowHour;
      const info = core.codeInfo(hour.code, hour.isDay);
      const label = isNow ? 'ตอนนี้' : core.formatTime(hour.time);
      return `<div class="hour-item${isNow ? ' is-now' : ''}${isPast ? ' is-past' : ''}" role="listitem" aria-label="${escapeHtml(`${label} ${info.text} ${chartLabel(chartValue(hour))} โอกาสฝน ${percent(hour.rainChance)}`)}">
        <span class="hour-time">${escapeHtml(label)}</span>
        ${iconMarkup(info.kind)}
        <span class="hour-value">${escapeHtml(chartLabel(chartValue(hour)))}</span>
        <span class="hour-meta"><svg class="icon"><use href="#i-drop"/></svg>${escapeHtml(percent(hour.rainChance))}</span>
      </div>`;
    }).join('');
    el.hourlyChart.innerHTML = buildChart(hours, width, nowHour);
    renderHourlySummary(hours);
    const nowIndex = hours.findIndex(hour => core.parseTime(hour.time) === nowHour);
    el.hourlyScroll.scrollLeft = !state.selectedDay && nowIndex > 0 ? Math.max(0, nowIndex * HOUR_COLUMN - 8) : 0;
  }

  function renderHourlySummary(hours) {
    const withTemp = hours.filter(hour => Number.isFinite(hour.temp));
    const withRain = hours.filter(hour => Number.isFinite(hour.rainChance));
    const parts = [];
    if (withTemp.length) {
      const hottest = withTemp.reduce((best, hour) => hour.temp > best.temp ? hour : best);
      const coolest = withTemp.reduce((best, hour) => hour.temp < best.temp ? hour : best);
      parts.push(`ร้อนสุด ${degree(hottest.temp)} ช่วง ${core.formatTime(hottest.time)} น. · เย็นสุด ${degree(coolest.temp)} ช่วง ${core.formatTime(coolest.time)} น.`);
    }
    if (withRain.length) {
      const wettest = withRain.reduce((best, hour) => hour.rainChance > best.rainChance ? hour : best);
      parts.push(wettest.rainChance >= 30 ? `โอกาสฝนสูงสุด ${percent(wettest.rainChance)} ช่วง ${core.formatTime(wettest.time)} น.` : 'โอกาสฝนต่ำตลอดช่วงนี้');
    }
    el.hourlySummary.textContent = parts.join(' · ');
  }

  function buildChart(hours, width, nowHour) {
    const values = hours.map(chartValue);
    const known = values.filter(Number.isFinite);
    if (!known.length) return '';
    const padTop = 22;
    const padBottom = 18;
    const plotHeight = CHART_HEIGHT - padTop - padBottom;
    let min = state.chart === 'temp' ? Math.min(...known) : 0;
    let max = state.chart === 'rain' ? 100 : Math.max(...known);
    if (max - min < 4) { max += 2; if (state.chart === 'temp') min -= 2; }
    const span = max - min || 1;
    const y = value => padTop + (1 - (value - min) / span) * plotHeight;
    const x = index => index * HOUR_COLUMN + HOUR_COLUMN / 2;
    const nowIndex = hours.findIndex(hour => core.parseTime(hour.time) === nowHour);
    const nowLine = nowIndex >= 0 ? `<line class="chart-now" x1="${x(nowIndex)}" x2="${x(nowIndex)}" y1="${padTop - 10}" y2="${CHART_HEIGHT - padBottom}"/>` : '';
    const grid = [0, 0.5, 1].map(fraction => {
      const gy = padTop + fraction * plotHeight;
      const label = chartLabel(max - fraction * span);
      return `<line class="chart-grid" x1="0" x2="${width}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}"/><text class="chart-axis" x="6" y="${(gy - 4).toFixed(1)}">${escapeHtml(label)}</text>`;
    }).join('');
    if (state.chart === 'rain') {
      const bars = values.map((value, index) => {
        if (!Number.isFinite(value)) return '';
        const height = Math.max(2, (value / 100) * plotHeight);
        return `<rect class="chart-bar" x="${x(index) - 14}" y="${(CHART_HEIGHT - padBottom - height).toFixed(1)}" width="28" height="${height.toFixed(1)}" rx="5"/>`;
      }).join('');
      return `<svg viewBox="0 0 ${width} ${CHART_HEIGHT}" width="${width}" height="${CHART_HEIGHT}" aria-hidden="true" focusable="false" class="chart chart-rain">${grid}${bars}${nowLine}</svg>`;
    }
    const points = [];
    values.forEach((value, index) => { if (Number.isFinite(value)) points.push([x(index), y(value)]); });
    const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
    const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${CHART_HEIGHT - padBottom} L${points[0][0].toFixed(1)} ${CHART_HEIGHT - padBottom} Z`;
    const dots = points.map(([px, py]) => `<circle class="chart-dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5"/>`).join('');
    return `<svg viewBox="0 0 ${width} ${CHART_HEIGHT}" width="${width}" height="${CHART_HEIGHT}" aria-hidden="true" focusable="false" class="chart chart-${escapeHtml(state.chart)}">
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="chart-fill-top"/><stop offset="1" class="chart-fill-bottom"/></linearGradient></defs>
      ${grid}<path class="chart-area" d="${area}" fill="url(#chart-fill)"/><path class="chart-line" d="${line}"/>${dots}${nowLine}
    </svg>`;
  }

  function renderDetails() {
    const { current } = state.weather;
    const hour = currentHourEntry();
    const today = todayEntry();

    const humidity = current.humidity !== null ? current.humidity : hour.humidity;
    el.humidity.innerHTML = `${escapeHtml(core.formatNumber(humidity))}<small>%</small>`;
    el.humidityBar.style.width = `${Number.isFinite(humidity) ? humidity : 0}%`;
    el.humidityMeter.setAttribute('aria-valuenow', String(Number.isFinite(humidity) ? humidity : 0));
    el.humidityNote.textContent = !Number.isFinite(humidity) ? 'ไม่มีข้อมูลความชื้น'
      : humidity >= 80 ? 'อากาศชื้นมาก รู้สึกอบอ้าว' : humidity >= 60 ? 'ความชื้นค่อนข้างสูง' : humidity >= 40 ? 'ความชื้นกำลังสบาย' : 'อากาศแห้ง ดื่มน้ำให้เพียงพอ';

    el.windValue.innerHTML = `${escapeHtml(core.formatNumber(current.windKph))}<small>กม./ชม.</small>`;
    el.windArrow.style.transform = current.windDirection !== null ? `rotate(${(current.windDirection + 180) % 360}deg)` : '';
    el.windDirection.textContent = current.windDirection !== null ? `พัดจากทิศ${core.windDirection(current.windDirection)}` : '—';
    el.windNote.textContent = current.gustKph !== null
      ? `ลมกระโชกสูงสุด ${core.formatNumber(current.gustKph)} กม./ชม.${current.gustKph >= 40 ? ' ระวังสิ่งของปลิว' : ''}`
      : 'ไม่มีข้อมูลลมกระโชก';

    const uvValue = hour.uv !== null ? hour.uv : today.uv;
    const uv = core.uvInfo(uvValue);
    el.uv.innerHTML = `${escapeHtml(core.formatNumber(uvValue, 1))}<small>/ 11+</small>`;
    el.uvBadge.textContent = uv.label;
    el.uvBadge.dataset.level = uv.level;
    el.uvMarker.style.left = `${Number.isFinite(uvValue) ? Math.min(100, (uvValue / 11) * 100) : 0}%`;
    el.uvMarker.hidden = !Number.isFinite(uvValue);
    const uvAdvice = { low: 'ออกแดดได้สบาย', moderate: 'ควรทาครีมกันแดด', high: 'สวมหมวกและทาครีมกันแดด', 'very-high': 'หลีกเลี่ยงแดดจัดช่วงกลางวัน', extreme: 'อยู่ในร่มช่วง 10:00–16:00' };
    el.uvNote.textContent = !Number.isFinite(uvValue) ? 'ไม่มีข้อมูลดัชนี UV'
      : `${Number.isFinite(today.uv) ? `สูงสุดวันนี้ ${core.formatNumber(today.uv, 1)} · ` : ''}${uvAdvice[core.uvInfo(Number.isFinite(today.uv) ? today.uv : uvValue).level] || 'ค่าพยากรณ์ในชั่วโมงนี้'}`;

    el.sunrise.textContent = core.formatTime(today.sunrise);
    el.sunset.textContent = core.formatTime(today.sunset);
    renderSunPosition(today);

    el.pressure.innerHTML = `${escapeHtml(core.formatNumber(current.pressure))}<small>hPa</small>`;
    el.pressureNote.textContent = !Number.isFinite(current.pressure) ? 'ไม่มีข้อมูลความกดอากาศ'
      : current.pressure < 1005 ? 'ความกดต่ำ มักสัมพันธ์กับฝนหรือพายุ' : current.pressure > 1018 ? 'ความกดสูง อากาศมักแจ่มใส' : 'ความกดอากาศปกติ ปรับเทียบที่ระดับน้ำทะเล';

    const visibility = hour.visibilityKm;
    el.visibility.innerHTML = `${escapeHtml(core.formatNumber(visibility, Number.isFinite(visibility) && visibility < 10 ? 1 : 0))}<small>กม.</small>`;
    el.visibilityNote.textContent = !Number.isFinite(visibility) ? 'ไม่มีข้อมูลทัศนวิสัย'
      : visibility >= 10 ? 'มองเห็นได้ชัดเจน' : visibility >= 4 ? 'ทัศนวิสัยปานกลาง' : 'ทัศนวิสัยต่ำ ขับขี่ด้วยความระมัดระวัง';
  }

  function renderSunPosition(today) {
    const rise = core.parseTime(today.sunrise);
    const set = core.parseTime(today.sunset);
    const now = Date.now();
    if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise) {
      el.sunPosition.setAttribute('cx', '50');
      el.sunPosition.setAttribute('cy', '2');
      el.sunNote.textContent = 'เวลาพระอาทิตย์ขึ้นและตกวันนี้';
      return;
    }
    const fraction = Math.min(1, Math.max(0, (now - rise) / (set - rise)));
    el.sunPosition.setAttribute('cx', (50 - 45 * Math.cos(Math.PI * fraction)).toFixed(1));
    el.sunPosition.setAttribute('cy', (40 - 38 * Math.sin(Math.PI * fraction)).toFixed(1));
    el.sunPosition.classList.toggle('is-night', now < rise || now > set);
    const daylight = durationText(set - rise);
    if (now < rise) el.sunNote.textContent = `อีก ${durationText(rise - now)} พระอาทิตย์จะขึ้น · กลางวัน ${daylight}`;
    else if (now > set) el.sunNote.textContent = `พระอาทิตย์ตกแล้ว · กลางวันวันนี้ ${daylight}`;
    else el.sunNote.textContent = `เหลือแสงอีก ${durationText(set - now)} · กลางวัน ${daylight}`;
  }

  function renderInsight() {
    const { current } = state.weather;
    const hour = currentHourEntry();
    const today = todayEntry();
    const upcoming = upcomingHours(12);
    const rainHours = upcoming.filter(item => Number.isFinite(item.rainChance) && item.rainChance >= 50);
    const peakRain = upcoming.reduce((best, item) => (Number.isFinite(item.rainChance) && (!best || item.rainChance > best.rainChance) ? item : best), null);
    const stormy = upcoming.some(item => core.codeInfo(item.code).kind === 'storm');
    const feels = current.feelsLike !== null ? current.feelsLike : current.temp;
    const peakText = peakRain && peakRain.rainChance >= 30 ? ` โอกาสฝนสูงสุด ${percent(peakRain.rainChance)} ช่วง ${core.formatTime(peakRain.time)} น.` : '';
    let tone = 'good';
    let icon = 'i-sun';
    let title;
    let text;
    if (stormy) {
      tone = 'alert';
      icon = 'i-alert';
      title = 'ระวังฝนฟ้าคะนอง';
      text = `มีโอกาสเกิดฝนฟ้าคะนองใน 12 ชั่วโมงข้างหน้า${peakText} หลีกเลี่ยงที่โล่งแจ้งและต้นไม้ใหญ่ขณะฝนตก`;
    } else if (rainHours.length) {
      tone = 'rain';
      icon = 'i-umbrella';
      title = 'อย่าลืมพกร่ม';
      text = `มีโอกาสฝนตกประมาณ ${rainHours.length} ชั่วโมงใน 12 ชั่วโมงข้างหน้า${peakText}${Number.isFinite(today.rainMm) ? ` ปริมาณฝนรวมวันนี้ประมาณ ${core.formatNumber(today.rainMm, 1)} มม.` : ''}`;
    } else if (Number.isFinite(feels) && feels >= 38) {
      tone = 'heat';
      icon = 'i-thermo';
      title = 'อากาศร้อนจัด';
      text = `อุณหภูมิที่รู้สึกได้ ${temp(feels)}${unitLabel()} ควรดื่มน้ำบ่อย ๆ และเลี่ยงกิจกรรมกลางแจ้งช่วงบ่าย${Number.isFinite(hour.uv) && hour.uv >= 8 ? ' ดัชนี UV สูงมาก ทาครีมกันแดดก่อนออกจากบ้าน' : ''}`;
    } else if (Number.isFinite(feels) && feels <= 20) {
      tone = 'cool';
      icon = 'i-thermo';
      title = 'อากาศเย็นสบาย';
      text = `อุณหภูมิที่รู้สึกได้ ${temp(feels)}${unitLabel()} อาจต้องมีเสื้อคลุมบาง ๆ โดยเฉพาะช่วงเช้าและค่ำ`;
    } else {
      title = 'วันนี้อากาศดี';
      text = `โอกาสฝนวันนี้ ${percent(today.rainChance)} อุณหภูมิ ${temp(today.min)}–${temp(today.max)}${unitLabel()} เหมาะกับการออกไปทำกิจกรรมนอกบ้าน${peakText}`;
    }
    el.insight.dataset.tone = tone;
    el.insightIcon.querySelector('use').setAttribute('href', `#${icon}`);
    el.insightTitle.textContent = title;
    el.insightText.textContent = text;
  }

  function renderSaveButton() {
    const saved = state.favorites.includes(state.district.id);
    el.saveBtn.classList.toggle('is-saved', saved);
    el.saveBtn.setAttribute('aria-pressed', String(saved));
    const label = saved ? 'นำออกจากรายการที่บันทึก' : 'บันทึกอำเภอนี้';
    el.saveBtn.setAttribute('aria-label', label);
    el.saveBtn.title = label;
    el.savedCount.textContent = String(state.favorites.length);
    el.savedCount.setAttribute('aria-label', `บันทึกแล้ว ${state.favorites.length} อำเภอ`);
  }

  function summaryMarkup(district) {
    const weather = state.summaries.get(district.id);
    if (!weather) return '<span class="district-temp skeleton-text">—</span><span class="district-condition">รอข้อมูล</span>';
    const info = core.codeInfo(weather.current.code, weather.current.isDay);
    const hour = currentHourEntry(weather);
    const stale = Date.now() - weather.fetchedAt > STALE_MS;
    return `<span class="district-temp">${escapeHtml(degree(weather.current.temp))}</span>
      <span class="district-condition">${iconMarkup(info.kind)}${escapeHtml(info.text)}</span>
      <span class="district-rain"><svg class="icon"><use href="#i-drop"/></svg>${escapeHtml(percent(hour.rainChance))}${stale ? ' <em class="district-stale">ข้อมูลเก่า</em>' : ''}</span>`;
  }

  function renderDistricts() {
    el.districtList.innerHTML = core.DISTRICTS.map(district => {
      const active = district.id === state.district.id;
      const saved = state.favorites.includes(district.id);
      return `<button type="button" class="district-card${active ? ' is-active' : ''}" data-district="${escapeHtml(district.id)}" aria-pressed="${active}">
        <span class="district-name"><strong>${escapeHtml(district.name)}</strong><small>${escapeHtml(district.english)}</small></span>
        ${summaryMarkup(district)}
        ${saved ? '<svg class="icon district-saved" aria-hidden="true"><use href="#i-bookmark"/></svg>' : ''}
        ${active ? '<span class="district-badge">กำลังดู</span>' : ''}
      </button>`;
    }).join('');
    const loaded = core.DISTRICTS.filter(district => state.summaries.has(district.id)).length;
    el.districtsBadge.textContent = loaded < core.DISTRICTS.length ? `โหลดแล้ว ${loaded}/${core.DISTRICTS.length}` : '9 อำเภอ';
  }

  function renderSaved() {
    if (!state.favorites.length) {
      el.savedList.innerHTML = '<p class="empty-state"><svg class="icon"><use href="#i-bookmark"/></svg><span>ยังไม่มีอำเภอที่บันทึก กดไอคอนบุ๊กมาร์กบนการ์ดสภาพอากาศเพื่อติดตามอำเภอที่คุณสนใจ</span></p>';
      return;
    }
    el.savedList.innerHTML = state.favorites.map(id => {
      const district = core.districtById(id);
      const active = id === state.district.id;
      return `<div class="saved-card${active ? ' is-active' : ''}">
        <button type="button" class="saved-open" data-district="${escapeHtml(id)}">
          <span class="district-name"><strong>${escapeHtml(district.name)}</strong><small>${escapeHtml(district.english)}</small></span>
          ${summaryMarkup(district)}
        </button>
        <button type="button" class="icon-button saved-remove" data-remove="${escapeHtml(id)}" aria-label="${escapeHtml(`นำ${district.name}ออกจากรายการ`)}" title="นำออกจากรายการ"><svg class="icon"><use href="#i-close"/></svg></button>
      </div>`;
    }).join('');
  }

  function renderTodayDate() {
    el.todayDate.textContent = `${thaiDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · สภาพอากาศใกล้ตัว ให้คุณพร้อมสำหรับทุกวัน`;
  }

  /* ---------- Favorites ---------- */

  function toggleFavorite(id) {
    const district = core.districtById(id);
    if (!district) return;
    const index = state.favorites.indexOf(id);
    if (index >= 0) state.favorites.splice(index, 1);
    else state.favorites.push(id);
    const persisted = core.safeStorage.set(STORE.favorites, state.favorites);
    renderSaveButton();
    renderDistricts();
    renderSaved();
    showToast(index >= 0 ? `นำ${district.name}ออกจากรายการแล้ว` : persisted ? `บันทึก${district.name}แล้ว` : `บันทึก${district.name}เฉพาะครั้งนี้ เบราว์เซอร์ไม่อนุญาตให้จดจำ`);
  }

  /* ---------- Search ---------- */

  function closeSuggestions() {
    el.suggestions.hidden = true;
    el.suggestions.innerHTML = '';
    el.searchInput.setAttribute('aria-expanded', 'false');
    el.searchInput.removeAttribute('aria-activedescendant');
    state.suggestionIndex = -1;
  }

  function openSuggestions() {
    const results = core.searchDistricts(el.searchInput.value);
    if (!results.length) {
      el.suggestions.innerHTML = '<li class="suggestion-empty" role="option" aria-disabled="true" aria-selected="false">ไม่พบอำเภอนี้ในสุโขทัย ลองพิมพ์ชื่อไทยหรืออังกฤษ</li>';
    } else {
      el.suggestions.innerHTML = results.map((district, index) => {
        const highlighted = index === state.suggestionIndex;
        const saved = state.favorites.includes(district.id);
        return `<li id="suggestion-${escapeHtml(district.id)}" role="option" data-district="${escapeHtml(district.id)}" aria-selected="${highlighted}"${highlighted ? ' class="is-highlighted"' : ''}><svg class="icon"><use href="#${saved ? 'i-bookmark' : 'i-pin'}"/></svg><span>${escapeHtml(district.name)}</span><small>${escapeHtml(district.english)}</small></li>`;
      }).join('');
    }
    el.suggestions.hidden = false;
    el.searchInput.setAttribute('aria-expanded', 'true');
    const highlighted = results[state.suggestionIndex];
    if (highlighted) el.searchInput.setAttribute('aria-activedescendant', `suggestion-${highlighted.id}`);
    else el.searchInput.removeAttribute('aria-activedescendant');
  }

  function chooseSuggestion(id) {
    const district = core.districtById(id);
    if (!district) return;
    el.searchInput.value = '';
    closeSuggestions();
    el.searchInput.blur();
    selectDistrict(district, { scroll: true });
  }

  /* ---------- Geolocation ---------- */

  function locate() {
    if (!navigator.geolocation) {
      showToast('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง');
      return;
    }
    if (!window.isSecureContext) {
      showToast('การใช้ตำแหน่งต้องเปิดผ่าน HTTPS หรือ localhost');
      return;
    }
    el.geoBtn.disabled = true;
    el.geoBtn.classList.add('is-busy');
    const done = () => {
      el.geoBtn.disabled = false;
      el.geoBtn.classList.remove('is-busy');
    };
    navigator.geolocation.getCurrentPosition(position => {
      done();
      const nearest = core.nearestDistrict(position.coords.latitude, position.coords.longitude);
      if (!nearest) {
        showToast('อ่านตำแหน่งไม่ได้ กรุณาเลือกอำเภอเอง');
        return;
      }
      selectDistrict(nearest.district, { scroll: true });
      showToast(nearest.distanceKm > 60
        ? `คุณอยู่ห่างจากสุโขทัย แสดงอำเภอที่ใกล้ที่สุด: ${nearest.district.name}`
        : `อำเภอที่ใกล้คุณที่สุดคือ ${nearest.district.name} (ห่างจุดอ้างอิง ${core.formatNumber(nearest.distanceKm, 1)} กม.)`);
    }, error => {
      done();
      showToast(error.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาค้นหาอำเภอเอง' : 'หาตำแหน่งไม่ได้ในขณะนี้ ลองใหม่อีกครั้ง');
    }, { timeout: 12000, maximumAge: 5 * 60 * 1000 });
  }

  /* ---------- Share & install ---------- */

  async function share() {
    const url = window.location.href;
    const title = `สภาพอากาศ${state.district.name} — Rain สุโขทัย`;
    const text = state.weather
      ? `${state.district.name}ตอนนี้ ${temp(state.weather.current.temp)}${unitLabel()} ${core.codeInfo(state.weather.current.code, state.weather.current.isDay).text}`
      : 'ดูสภาพอากาศสุโขทัยทั้ง 9 อำเภอ';
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('คัดลอกลิงก์แล้ว');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      showToast('แชร์ไม่สำเร็จ คัดลอกลิงก์จากแถบที่อยู่ได้เลย');
    }
  }

  function setupInstall() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.installPrompt = event;
      el.installBtn.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
      state.installPrompt = null;
      el.installBtn.hidden = true;
      showToast('ติดตั้ง Rain แล้ว เปิดได้จากหน้าจอหลัก');
    });
    el.installBtn.addEventListener('click', async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice.catch(() => null);
      state.installPrompt = null;
      el.installBtn.hidden = true;
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // Offline shell is a progressive enhancement; the page works without it.
      });
    });
  }

  /* ---------- Navigation highlight ---------- */

  function watchSections() {
    const sections = navItems.map(item => $(item.dataset.nav)).filter(Boolean);
    if (!('IntersectionObserver' in window) || !sections.length) return;
    const visible = new Map();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      let best = null;
      for (const section of sections) {
        const ratio = visible.get(section.id) || 0;
        if (ratio > 0 && (!best || ratio > best.ratio)) best = { id: section.id, ratio };
      }
      if (!best) return;
      for (const item of navItems) {
        const active = item.dataset.nav === best.id;
        item.classList.toggle('is-active', active);
        if (active) item.setAttribute('aria-current', 'location');
        else item.removeAttribute('aria-current');
      }
    }, { rootMargin: '-30% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] });
    for (const section of sections) observer.observe(section);
  }

  /* ---------- Events ---------- */

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    state.themeExplicit = true;
    core.safeStorage.set(STORE.theme, state.theme);
    applyTheme();
  }

  function bindEvents() {
    el.themeBtn.addEventListener('click', toggleTheme);
    if (window.matchMedia) {
      // Follow the system theme until the user picks one explicitly.
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', () => {
        if (state.themeExplicit) return;
        state.theme = media.matches ? 'dark' : 'light';
        applyTheme();
      });
    }

    for (const button of unitButtons) button.addEventListener('click', () => {
      if (state.unit === button.dataset.unit) return;
      state.unit = button.dataset.unit === 'f' ? 'f' : 'c';
      core.safeStorage.set(STORE.unit, state.unit);
      applyUnit();
      if (state.weather) render();
      else { renderDistricts(); renderSaved(); }
    });

    for (const button of chartButtons) button.addEventListener('click', () => {
      if (!CHARTS.includes(button.dataset.chart)) return;
      state.chart = button.dataset.chart;
      core.safeStorage.set(STORE.chart, state.chart);
      if (state.weather) renderHourly();
    });

    el.refreshBtn.addEventListener('click', refresh);
    el.retryBtn.addEventListener('click', refresh);
    el.bannerClose.addEventListener('click', hideBanner);
    el.saveBtn.addEventListener('click', () => toggleFavorite(state.district.id));
    el.geoBtn.addEventListener('click', locate);
    el.shareBtn.addEventListener('click', share);
    el.resetDay.addEventListener('click', () => {
      state.selectedDay = null;
      renderDaily();
      renderHourly();
    });

    el.dailyList.addEventListener('click', event => {
      const row = event.target.closest('[data-date]');
      if (!row) return;
      state.selectedDay = state.selectedDay === row.dataset.date ? null : row.dataset.date;
      renderDaily();
      renderHourly();
      if (state.selectedDay) $('forecast').scrollIntoView({ behavior: scrollBehavior, block: 'nearest' });
    });

    const scrollHours = direction => el.hourlyScroll.scrollBy({ left: direction * HOUR_COLUMN * 6, behavior: scrollBehavior });
    el.hourPrev.addEventListener('click', () => scrollHours(-1));
    el.hourNext.addEventListener('click', () => scrollHours(1));
    el.hourlyScroll.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); scrollHours(-0.5); }
      if (event.key === 'ArrowRight') { event.preventDefault(); scrollHours(0.5); }
      if (event.key === 'Home') { event.preventDefault(); el.hourlyScroll.scrollTo({ left: 0, behavior: scrollBehavior }); }
      if (event.key === 'End') { event.preventDefault(); el.hourlyScroll.scrollTo({ left: el.hourlyScroll.scrollWidth, behavior: scrollBehavior }); }
    });

    for (const list of [el.districtList, el.savedList]) list.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove]');
      if (remove) { toggleFavorite(remove.dataset.remove); return; }
      const card = event.target.closest('[data-district]');
      if (card) selectDistrict(core.districtById(card.dataset.district), { scroll: true });
    });

    el.searchInput.addEventListener('input', () => { state.suggestionIndex = -1; openSuggestions(); });
    el.searchInput.addEventListener('focus', openSuggestions);
    el.searchInput.addEventListener('keydown', event => {
      const options = Array.from(el.suggestions.querySelectorAll('[data-district]'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!options.length) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        state.suggestionIndex = (state.suggestionIndex + step + options.length) % options.length;
        openSuggestions();
      } else if (event.key === 'Escape') {
        closeSuggestions();
        el.searchInput.blur();
      }
    });
    el.searchForm.addEventListener('submit', event => {
      event.preventDefault();
      const options = Array.from(el.suggestions.querySelectorAll('[data-district]'));
      const pick = options[state.suggestionIndex] || options[0];
      if (pick) chooseSuggestion(pick.dataset.district);
      else showToast('ไม่พบอำเภอนี้ในสุโขทัย');
    });
    el.suggestions.addEventListener('mousedown', event => {
      const option = event.target.closest('[data-district]');
      if (!option) return;
      event.preventDefault();
      chooseSuggestion(option.dataset.district);
    });
    document.addEventListener('click', event => {
      if (!el.searchForm.contains(event.target)) closeSuggestions();
    });
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === '/') { event.preventDefault(); el.searchInput.focus(); }
      else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); refresh(); }
      else if (event.key === 't' || event.key === 'T') { event.preventDefault(); toggleTheme(); }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      updateClock();
      updateFreshness();
      if (Date.now() - state.lastFetchAt > REFRESH_MS) loadWeather({ silent: true });
    });
    window.addEventListener('online', () => {
      hideBanner();
      showToast('กลับมาออนไลน์แล้ว กำลังอัปเดตข้อมูล');
      loadWeather({ silent: true });
      queueDistrictSummaries();
    });
    window.addEventListener('offline', () => {
      updateFreshness();
      if (state.weather) showBanner('ไม่มีการเชื่อมต่ออินเทอร์เน็ต กำลังแสดงข้อมูลที่บันทึกไว้', { kind: 'offline' });
    });
    window.addEventListener('popstate', () => {
      const district = core.districtById(new URLSearchParams(window.location.search).get('district'));
      if (district && district.id !== state.district.id) selectDistrict(district);
    });

    setInterval(() => {
      if (document.visibilityState === 'visible' && !state.loading) {
        loadWeather({ silent: true });
        queueDistrictSummaries();
      } else {
        updateFreshness();
      }
    }, REFRESH_MS);
    setInterval(() => {
      updateClock();
      if (state.weather && document.visibilityState === 'visible') {
        updateFreshness();
        renderSunPosition(todayEntry());
      }
    }, 60000);
  }

  /* ---------- Start ---------- */

  function start() {
    loadPreferences();
    applyTheme();
    applyUnit();
    renderTodayDate();
    updateClock();
    bindEvents();
    setupInstall();
    registerServiceWorker();
    watchSections();
    state.district = initialDistrict();
    core.safeStorage.set(STORE.district, state.district.id);
    renderPlace();
    renderSaveButton();
    const cached = core.readCache(state.district.id);
    if (cached) {
      state.weather = cached;
      state.stale = true;
      state.summaries.set(state.district.id, cached);
      render();
    } else {
      renderEmpty();
    }
    syncUrl();
    loadWeather({ silent: true }).then(() => queueDistrictSummaries());
  }

  start();
})();
