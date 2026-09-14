'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { getEventListeners } = require('node:events');

const corePath = path.resolve(__dirname, '../weather-core.js');
const coreSource = fs.readFileSync(corePath, 'utf8');
const NOW = Date.parse('2026-09-12T12:30:00Z');
const DAY_MS = 86400000;
const copy = value => JSON.parse(JSON.stringify(value));

// Synthetic API fixtures are test input only. The application has no mock fallback.
function forecastFixture() {
  const start = Date.UTC(2026, 8, 12);
  const hourlyTimes = Array.from({ length: 192 }, (_, index) => new Date(start + index * 3600000).toISOString().slice(0, 16));
  const dates = Array.from({ length: 8 }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
  return {
    timezone: 'Asia/Bangkok',
    current: {
      time: '2026-09-12T19:15', temperature_2m: 29.5, relative_humidity_2m: 75,
      apparent_temperature: 34.6, weather_code: 63, is_day: 0, wind_speed_10m: 8.2,
      wind_direction_10m: 225, wind_gusts_10m: 15.7, pressure_msl: 1009.4, precipitation: 0.8
    },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTimes.map((_, index) => 25 + (index % 24) / 2),
      apparent_temperature: hourlyTimes.map(() => 32.1),
      weather_code: hourlyTimes.map(() => 61),
      is_day: hourlyTimes.map((_, index) => index % 24 >= 6 && index % 24 < 18 ? 1 : 0),
      precipitation_probability: hourlyTimes.map(() => 60),
      precipitation: hourlyTimes.map(() => 1.5),
      relative_humidity_2m: hourlyTimes.map(() => 82),
      wind_speed_10m: hourlyTimes.map(() => 5.4),
      uv_index: hourlyTimes.map(() => 4.5),
      visibility: hourlyTimes.map(() => 12400)
    },
    daily: {
      time: dates,
      temperature_2m_min: dates.map(() => 24.5),
      temperature_2m_max: dates.map(() => 35.2),
      weather_code: dates.map(() => 95),
      precipitation_probability_max: dates.map(() => 80),
      precipitation_sum: dates.map(() => 7.4),
      sunrise: dates.map(date => `${date}T06:08`),
      sunset: dates.map(date => `${date}T18:25`),
      uv_index_max: dates.map(() => 9.2),
      wind_speed_10m_max: dates.map(() => 18.6)
    }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(String(key), String(value))
  };
}

// Each test gets its own global objects, storage, clock, timers and fetch.
// No network request or real timeout can escape from this harness.
function harness(payload = forecastFixture()) {
  const calls = [];
  const storage = memoryStorage();
  const clock = { now: NOW };
  const timers = new Map();
  let timerId = 0;
  const sandbox = {
    module: { exports: {} }, URLSearchParams, AbortController, SyntaxError,
    localStorage: storage, __clock: clock,
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, due: clock.now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  };
  let fetchHandler = async () => ({ ok: true, status: 200, json: async () => copy(payload) });
  sandbox.fetch = (...args) => { calls.push(args); return fetchHandler(...args); };
  const context = vm.createContext(sandbox);
  vm.runInContext('Date.now = () => __clock.now;', context);
  vm.runInContext(coreSource, context, { filename: corePath });
  return {
    core: sandbox.module.exports, calls, storage, clock, timers, sandbox,
    setFetch(handler) { fetchHandler = handler; },
    advance(milliseconds) {
      clock.now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.due <= clock.now) { timers.delete(id); timer.callback(); }
      }
    }
  };
}

test('district lookup and search cover all nine districts and Thai/English input', () => {
  const { core } = harness();
  assert.equal(core.DISTRICTS.length, 9);
  assert.equal(new Set(core.DISTRICTS.map(district => district.id)).size, 9);
  assert.equal(core.searchDistricts('  อำเภอ ศรีนคร  ')[0].id, 'si-nakhon');
  assert.equal(core.searchDistricts('อ. คีรีมาศ')[0].id, 'khiri-mat');
  assert.equal(core.searchDistricts('  Si SATCHANALAI ')[0].id, 'si-satchanalai');
  assert.equal(core.searchDistricts('ban-dan-lan-hoi')[0].name, 'บ้านด่านลานหอย');
  assert.equal(core.searchDistricts('ไม่พบอำเภอนี้').length, 0);
  assert.equal(core.searchDistricts(' ').length, 9);
  assert.equal(core.districtById('unknown'), null);
  const district = core.districtById('si-nakhon');
  const nearest = core.nearestDistrict(district.lat, district.lon);
  assert.equal(nearest.district.id, district.id);
  assert.equal(nearest.distanceKm, 0);
  assert(core.nearestDistrict(district.lat + 0.01, district.lon).distanceKm > 1);
  assert.equal(core.nearestDistrict(null, 99), null);
  assert.equal(core.nearestDistrict(91, 99), null);
  assert.equal(core.nearestDistrict(17, Infinity), null);
});

test('temperature and number formatting preserve zero and never turn missing values into readings', () => {
  const { core } = harness();
  assert.equal(core.formatTemp(0, 'f'), '32');
  assert.equal(core.formatTemp(100, 'fahrenheit'), '212');
  assert.equal(core.formatTemp(-40, 'f'), '-40');
  assert.equal(core.formatTemp(29.25, 'c', 1), '29.3');
  assert.equal(core.formatNumber(1009.4, 1), '1,009.4');
  assert.equal(core.formatNumber(-0.01), '0');
  for (const value of [null, undefined, NaN, Infinity, '', '29', false]) {
    assert.equal(core.formatTemp(value, 'f'), '—');
    assert.equal(core.formatNumber(value), '—');
  }
});

test('Bangkok timestamps, date rollover and Thai labels are independent of device timezone', () => {
  const { core } = harness();
  assert.equal(core.parseTime('2026-09-12T09:30'), Date.parse('2026-09-12T02:30:00Z'));
  assert.equal(core.parseTime('2026-09-12'), Date.parse('2026-09-11T17:00:00Z'));
  assert.equal(core.formatTime('2026-09-12T17:00:00Z'), '00:00');
  assert.equal(core.bangkokDate('2026-12-31T18:00:00Z'), '2027-01-01');
  assert.equal(core.bangkokDate(), '2026-09-12');
  assert.equal(core.dayLabel('2026-09-12', '2026-09-12'), 'วันนี้');
  assert.equal(core.dayLabel('2027-01-01', '2026-12-31'), 'พรุ่งนี้');
  assert.equal(core.dayLabel('2026-09-14', '2026-09-12'), 'วันจันทร์');
  for (const value of ['2026-02-29T06:00', '2026-02-31', '2026-09-12T24:00', '2026-13-01', 'nonsense', null]) {
    assert(Number.isNaN(core.parseTime(value)));
    assert.equal(core.formatTime(value), '—');
  }
  assert(Number.isFinite(core.parseTime('2024-02-29T06:00')));

  const script = `const w=require(${JSON.stringify(corePath)}); console.log(JSON.stringify([w.parseTime('2026-09-12T09:30'),w.formatTime('2026-09-12T09:30'),w.bangkokDate('2026-09-12T18:00:00Z')]));`;
  const outputs = ['America/Los_Angeles', 'Asia/Tokyo'].map(TZ => {
    const child = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], [Date.parse('2026-09-12T02:30:00Z'), '09:30', '2026-09-13']);
});

test('weather, wind and UV presentation handles night, boundaries and unknown measurements', () => {
  const { core } = harness();
  assert.equal(core.codeInfo(0).kind, 'sun');
  assert.equal(core.codeInfo(0, false).kind, 'moon');
  assert.equal(core.codeInfo(1, 0).kind, 'moon');
  assert.equal(core.codeInfo(63).kind, 'rain');
  assert.equal(core.codeInfo(95).kind, 'storm');
  assert.equal(core.codeInfo(45).kind, 'fog');
  for (const code of [null, undefined, 1234, 'toString', '__proto__']) assert.equal(core.codeInfo(code).kind, 'cloud');
  assert.equal(core.windDirection(0), 'เหนือ');
  assert.equal(core.windDirection(360), 'เหนือ');
  assert.equal(core.windDirection(90), 'ตะวันออก');
  assert.equal(core.windDirection(-90), 'ตะวันตก');
  assert.equal(core.windDirection(null), '—');
  for (const [value, level] of [[0, 'low'], [3, 'moderate'], [6, 'high'], [8, 'very-high'], [11, 'extreme'], [null, 'unknown'], [-1, 'unknown']]) {
    assert.equal(core.uvInfo(value).level, level);
  }
  // WHO categories apply to the index rounded to a whole number, so 2.5 is already "moderate".
  for (const [value, level] of [[2.4, 'low'], [2.5, 'moderate'], [5.4, 'moderate'], [5.5, 'high'], [7.4, 'high'], [7.5, 'very-high'], [10.4, 'very-high'], [10.5, 'extreme']]) {
    assert.equal(core.uvInfo(value).level, level, `uv ${value}`);
  }
});

test('hourly rain, rain chance and weather code cover the hour starting at each timestamp', async () => {
  // Open-Meteo reports these three for the hour ending at the timestamp; instantaneous readings are not shifted.
  const source = forecastFixture();
  source.hourly.precipitation_probability = source.hourly.time.map((_, index) => index % 101);
  source.hourly.precipitation = source.hourly.time.map((_, index) => index / 10);
  source.hourly.weather_code = source.hourly.time.map((_, index) => (index % 2 ? 95 : 61));
  source.hourly.temperature_2m = source.hourly.time.map((_, index) => 20 + index / 100);
  source.hourly.uv_index = source.hourly.time.map((_, index) => index / 50);
  const h = harness(source);
  const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
  assert.equal(weather.hourly.length, 192);
  for (let index = 0; index < 191; index++) {
    const hour = weather.hourly[index];
    assert.equal(hour.time, source.hourly.time[index]);
    assert.equal(hour.rainChance, (index + 1) % 101, `rainChance at ${hour.time}`);
    assert.equal(hour.rainMm, (index + 1) / 10, `rainMm at ${hour.time}`);
    assert.equal(hour.code, (index + 1) % 2 ? 95 : 61, `code at ${hour.time}`);
    assert.equal(hour.temp, 20 + index / 100, `temp at ${hour.time}`);
    assert.equal(hour.uv, index / 50, `uv at ${hour.time}`);
  }
  const last = weather.hourly[191];
  assert.equal(last.rainChance, null);
  assert.equal(last.rainMm, null);
  assert.equal(last.code, null);
  assert.equal(last.temp, 20 + 191 / 100);
  // The shifted rows round-trip through the cache unchanged.
  assert.equal(h.core.writeCache('mueang', weather), true);
  assert.deepEqual(copy(h.core.readCache('mueang')), copy(weather));
});

test('fetch converts a real-shaped eight-day API response and uses canonical district coordinates', async () => {
  const h = harness();
  const controller = new AbortController();
  const weather = await h.core.fetchWeather({ ...h.core.DISTRICTS[0], lat: 0, lon: 0 }, { signal: controller.signal });
  assert.equal(h.calls.length, 1);
  const [address, options] = h.calls[0];
  const url = new URL(address);
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '17.0077');
  assert.equal(url.searchParams.get('longitude'), '99.8228');
  assert.equal(url.searchParams.get('forecast_days'), '8');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Bangkok');
  assert.equal(url.searchParams.get('temperature_unit'), 'celsius');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(url.searchParams.get('precipitation_unit'), 'mm');
  assert(url.searchParams.get('hourly').split(',').includes('visibility'));
  assert(url.searchParams.get('current').split(',').includes('pressure_msl'));
  assert.equal(options.signal.aborted, false);
  assert.equal(weather.timezone, 'Asia/Bangkok');
  assert.equal(weather.fetchedAt, NOW);
  assert.equal(weather.hourly.length, 192);
  assert.equal(weather.daily.length, 8);
  assert.deepEqual(copy(weather.current), {
    time: '2026-09-12T19:15', temp: 29.5, feelsLike: 34.6, code: 63, isDay: false,
    humidity: 75, windKph: 8.2, windDirection: 225, gustKph: 15.7, pressure: 1009.4, precipitation: 0.8
  });
  assert.equal(weather.hourly[0].visibilityKm, 12.4);
  assert.equal(weather.hourly[0].rainChance, 60);
  assert.equal(weather.hourly[0].rainMm, 1.5);
  assert.equal(weather.hourly[8].isDay, true);
  assert.equal(weather.daily[0].min, 24.5);
  assert.equal(weather.daily[0].max, 35.2);
  assert.equal(weather.daily[0].uv, 9.2);
  assert.equal(weather.daily[0].sunrise, '2026-09-12T06:08');
  assert.equal(weather.daily[7].date, '2026-09-19');
  assert.equal(h.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('nullable API measurements stay null while genuine zero values stay zero', async () => {
  const source = forecastFixture();
  Object.assign(source.current, { relative_humidity_2m: null, wind_gusts_10m: null, weather_code: null, is_day: null, wind_speed_10m: 0, wind_direction_10m: 0, precipitation: 0 });
  for (const [field, values] of Object.entries(source.hourly)) if (field !== 'time') values[0] = null;
  // Rain figures and the weather code of hourly[0] are read from the next API row.
  for (const field of ['precipitation_probability', 'precipitation', 'weather_code']) source.hourly[field][1] = null;
  for (const [field, values] of Object.entries(source.daily)) if (field !== 'time') values[0] = null;
  source.hourly.precipitation_probability[2] = 0;
  source.hourly.precipitation[2] = 0;
  source.hourly.visibility[1] = 0;
  const h = harness(source);
  const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
  assert.equal(weather.current.humidity, null);
  assert.equal(weather.current.code, null);
  assert.equal(weather.current.isDay, null);
  assert.equal(weather.current.windKph, 0);
  assert.equal(weather.current.windDirection, 0);
  assert.equal(weather.current.precipitation, 0);
  for (const [field, value] of Object.entries(weather.hourly[0])) if (field !== 'time') assert.equal(value, null, field);
  for (const [field, value] of Object.entries(weather.daily[0])) if (field !== 'date') assert.equal(value, null, field);
  assert.equal(weather.hourly[1].rainChance, 0);
  assert.equal(weather.hourly[1].rainMm, 0);
  assert.equal(weather.hourly[1].visibilityKm, 0);
  assert.equal(h.core.writeCache('mueang', weather), true);
  assert.deepEqual(copy(h.core.readCache('mueang')), copy(weather));
});

test('out-of-range environmental readings are treated as missing', async () => {
  const source = forecastFixture();
  source.current.relative_humidity_2m = 101;
  source.current.wind_speed_10m = -1;
  source.hourly.precipitation_probability[1] = -1; // feeds hourly[0] (hour starting at row 0)
  source.hourly.visibility[0] = -100;
  source.daily.uv_index_max[0] = -1;
  const h = harness(source);
  const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
  assert.equal(weather.current.humidity, null);
  assert.equal(weather.current.windKph, null);
  assert.equal(weather.hourly[0].rainChance, null);
  assert.equal(weather.hourly[0].visibilityKm, null);
  assert.equal(weather.daily[0].uv, null);
});

test('malformed responses fail instead of becoming a plausible forecast', async t => {
  const cases = [
    ['empty response', () => ({})],
    ['API error envelope', source => { source.error = true; }],
    ['wrong timezone', source => { source.timezone = 'UTC'; }],
    ['missing current field', source => { delete source.current.weather_code; }],
    ['invalid current date', source => { source.current.time = '2026-02-31T10:00'; }],
    ['missing current temperature', source => { source.current.temperature_2m = null; }],
    ['numeric string', source => { source.current.temperature_2m = '29'; }],
    ['missing hourly field', source => { delete source.hourly.visibility; }],
    ['unequal hourly arrays', source => { source.hourly.temperature_2m.pop(); }],
    ['no hourly temperature', source => { source.hourly.temperature_2m.fill(null); }],
    ['duplicate hourly timestamp', source => { source.hourly.time[1] = source.hourly.time[0]; }],
    ['invalid daily date', source => { source.daily.time[0] = '2026-02-31'; }],
    ['no daily temperatures', source => { source.daily.temperature_2m_min.fill(null); }],
    ['empty daily times', source => { source.daily.time = []; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const source = forecastFixture();
    const h = harness(mutate(source) || source);
    await assert.rejects(h.core.fetchWeather(h.core.DISTRICTS[0]), error => error.code === 'INVALID_DATA' && /ข้อมูล/.test(error.message));
    assert.equal(h.timers.size, 0);
  });
});

test('HTTP, invalid JSON and network failures expose useful error types and clean up', async t => {
  for (const [status, code] of [[429, 'RATE_LIMIT'], [400, 'SERVICE_ERROR'], [503, 'SERVICE_ERROR']]) await t.test(`HTTP ${status}`, async () => {
    const h = harness();
    const controller = new AbortController();
    h.setFetch(async () => ({ ok: false, status, json: async () => { throw new Error('HTTP errors should not parse a success body'); } }));
    await assert.rejects(h.core.fetchWeather(h.core.DISTRICTS[0], { signal: controller.signal }), error => error.code === code && /[ก-๙]/u.test(error.message));
    assert.equal(h.timers.size, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
  const malformed = harness();
  malformed.setFetch(async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } }));
  await assert.rejects(malformed.core.fetchWeather(malformed.core.DISTRICTS[0]), error => error.code === 'INVALID_DATA');
  const offline = harness();
  offline.setFetch(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.core.fetchWeather(offline.core.DISTRICTS[0]), error => error.code === 'NETWORK_ERROR');
  const invalid = harness();
  await assert.rejects(invalid.core.fetchWeather({ id: 'bangkok' }), error => error.code === 'INVALID_DISTRICT');
  assert.equal(invalid.calls.length, 0);
});

test('pre-aborted requests never call fetch', async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.core.fetchWeather(h.core.DISTRICTS[0], { signal: controller.signal }), error => error.name === 'AbortError' && error.code === 'ABORTED');
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

test('cancelling a pending request aborts its fetch and removes the external listener', async () => {
  const h = harness();
  const controller = new AbortController();
  let requestSignal;
  h.setFetch((_, { signal }) => new Promise((resolve, reject) => {
    requestSignal = signal;
    signal.addEventListener('abort', () => reject(new Error('cancelled transport')), { once: true });
  }));
  const request = h.core.fetchWeather(h.core.DISTRICTS[0], { signal: controller.signal });
  const rejected = assert.rejects(request, error => error.name === 'AbortError' && error.code === 'ABORTED');
  controller.abort();
  await rejected;
  assert.equal(requestSignal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('an abort during response parsing prevents stale data from winning a request race', async () => {
  const h = harness();
  const controller = new AbortController();
  let finishBody;
  h.setFetch(async () => ({ ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) }));
  const request = h.core.fetchWeather(h.core.DISTRICTS[0], { signal: controller.signal });
  // Let fetchWeather get past `await fetch()` and call response.json().
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishBody, 'function');
  controller.abort();
  finishBody(forecastFixture());
  await assert.rejects(request, error => error.name === 'AbortError' && error.code === 'ABORTED');
  assert.equal(h.timers.size, 0);
});

test('connection timeout aborts transport and differs from a user cancellation', async () => {
  const h = harness();
  const controller = new AbortController();
  h.setFetch((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
  }));
  const request = h.core.fetchWeather(h.core.DISTRICTS[0], { signal: controller.signal });
  const rejected = assert.rejects(request, error => error.code === 'TIMEOUT' && error.name !== 'AbortError');
  h.advance(18000);
  await rejected;
  assert.equal(h.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('cache is isolated by district and expires after 24 hours', async () => {
  const h = harness();
  const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
  assert.equal(h.core.writeCache('mueang', weather), true);
  assert.deepEqual(copy(h.core.readCache('mueang')), copy(weather));
  assert.equal(h.core.readCache('si-nakhon'), null);
  assert.equal(h.core.writeCache('unknown', weather), false);
  h.clock.now = NOW + DAY_MS;
  assert(h.core.readCache('mueang'));
  h.clock.now += 1;
  assert.equal(h.core.readCache('mueang'), null);
  h.clock.now = NOW - 60001;
  assert.equal(h.core.readCache('mueang'), null);
});

test('malformed cached envelopes and weather rows are ignored safely', async t => {
  const cases = [
    ['old schema', cached => { cached.version = 0; }],
    ['previous cache version (rain figures for the preceding hour)', cached => { cached.version = 1; }],
    ['different district', cached => { cached.districtId = 'si-nakhon'; }],
    ['invalid timestamp', cached => { cached.weather.fetchedAt = 'today'; }],
    ['missing current object', cached => { cached.weather.current = null; }],
    ['non-boolean day flag', cached => { cached.weather.current.isDay = 'false'; }],
    ['wrong timezone', cached => { cached.weather.timezone = 'UTC'; }],
    ['null hourly row', cached => { cached.weather.hourly[0] = null; }],
    ['missing hourly metric', cached => { delete cached.weather.hourly[0].rainChance; }],
    ['impossible percentage', cached => { cached.weather.hourly[0].rainChance = 200; }],
    ['negative rainfall', cached => { cached.weather.hourly[0].rainMm = -1; }],
    ['duplicate hourly time', cached => { cached.weather.hourly[1].time = cached.weather.hourly[0].time; }],
    ['daily extrema reversed', cached => { cached.weather.daily[0].min = 50; }],
    ['invalid sunrise', cached => { cached.weather.daily[0].sunrise = 'broken'; }],
    ['empty daily array', cached => { cached.weather.daily = []; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const h = harness();
    const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
    h.core.writeCache('mueang', weather);
    const key = [...h.storage.values.keys()][0];
    const cached = JSON.parse(h.storage.values.get(key));
    mutate(cached);
    h.storage.values.set(key, JSON.stringify(cached));
    assert.equal(h.core.readCache('mueang'), null);
  });
  const h = harness();
  const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
  h.core.writeCache('mueang', weather);
  const key = [...h.storage.values.keys()][0];
  h.storage.values.set(key, '{bad json');
  assert.equal(h.core.readCache('mueang'), null);
  assert.equal(h.core.writeCache('mueang', {}), false);
});

test('storage denial, quota errors and invalid JSON never prevent normal API use', async () => {
  const h = harness();
  Object.defineProperty(h.sandbox, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: storage denied'); } });
  assert.equal(h.core.safeStorage.get('unit', 'c'), 'c');
  assert.equal(h.core.safeStorage.set('unit', 'f'), false);
  assert.equal(h.core.readCache('mueang'), null);
  const weather = await h.core.fetchWeather(h.core.DISTRICTS[0]);
  assert.equal(weather.current.temp, 29.5);
  assert.equal(h.core.writeCache('mueang', weather), false);
  Object.defineProperty(h.sandbox, 'localStorage', { configurable: true, value: { getItem: () => 'invalid json', setItem() { throw new Error('QuotaExceededError'); } } });
  assert.equal(h.core.safeStorage.get('theme', 'light'), 'light');
  assert.equal(h.core.safeStorage.set('theme', 'dark'), false);
  assert.equal(h.core.safeStorage.set('theme', undefined), false);
});
