'use strict';

/*
 * Deterministic Open-Meteo style payload for browser tests.
 * The browser clock is pinned to NOW (a Saturday afternoon in Bangkok) so
 * "today", "now" and sun position are stable regardless of when tests run.
 */
const NOW = Date.parse('2026-09-12T14:30:00+07:00');
const TODAY = '2026-09-12';
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

function bangkokLocal(timestamp, withTime = true) {
  const iso = new Date(timestamp + 7 * HOUR_MS).toISOString();
  return withTime ? iso.slice(0, 16) : iso.slice(0, 10);
}

/**
 * @param {object} [options]
 * @param {number} [options.tempOffset]  Shifts every temperature (used to tell districts apart).
 * @param {number|null} [options.stormAt] Hour of day (0-23) that gets a thunderstorm code, null for none.
 * @param {number} [options.rainPeakChance] Peak rain probability at 17:00 each day.
 */
function forecastFixture({ tempOffset = 0, stormAt = null, rainPeakChance = 70 } = {}) {
  const dayStart = Date.parse(`${TODAY}T00:00:00+07:00`);
  const hourlyTimes = Array.from({ length: 192 }, (_, index) => bangkokLocal(dayStart + index * HOUR_MS));
  const dates = Array.from({ length: 8 }, (_, index) => bangkokLocal(dayStart + index * DAY_MS, false));
  const hourOf = index => index % 24;
  const tempAt = index => Number((24 + tempOffset + 9 * Math.sin(((hourOf(index) - 8) / 24) * Math.PI * 2 + Math.PI / 2) * -1).toFixed(1));
  const rainAt = index => (hourOf(index) >= 15 && hourOf(index) <= 19 ? rainPeakChance : 15);
  const codeAt = index => (stormAt !== null && hourOf(index) === stormAt ? 95 : hourOf(index) >= 15 && hourOf(index) <= 19 && rainPeakChance >= 50 ? 61 : hourOf(index) >= 6 && hourOf(index) < 18 ? 1 : 0);
  return {
    timezone: 'Asia/Bangkok',
    current: {
      time: '2026-09-12T14:15', temperature_2m: Number((29.5 + tempOffset).toFixed(1)), relative_humidity_2m: 75,
      apparent_temperature: Number((34.6 + tempOffset).toFixed(1)), weather_code: 2, is_day: 1, wind_speed_10m: 8.2,
      wind_direction_10m: 225, wind_gusts_10m: 15.7, pressure_msl: 1009.4, precipitation: 0
    },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTimes.map((_, index) => tempAt(index)),
      apparent_temperature: hourlyTimes.map((_, index) => tempAt(index) + 3),
      weather_code: hourlyTimes.map((_, index) => codeAt(index)),
      is_day: hourlyTimes.map((_, index) => (hourOf(index) >= 6 && hourOf(index) < 18 ? 1 : 0)),
      precipitation_probability: hourlyTimes.map((_, index) => rainAt(index)),
      precipitation: hourlyTimes.map((_, index) => (rainAt(index) >= 50 ? 1.2 : 0)),
      relative_humidity_2m: hourlyTimes.map(() => 78),
      wind_speed_10m: hourlyTimes.map((_, index) => 4 + (hourOf(index) % 6)),
      uv_index: hourlyTimes.map((_, index) => (hourOf(index) >= 10 && hourOf(index) <= 15 ? 7.5 : hourOf(index) >= 7 && hourOf(index) < 18 ? 2.5 : 0)),
      visibility: hourlyTimes.map(() => 18000)
    },
    daily: {
      time: dates,
      temperature_2m_min: dates.map((_, index) => Number((24.2 + tempOffset - index * 0.3).toFixed(1))),
      temperature_2m_max: dates.map((_, index) => Number((33.4 + tempOffset - index * 0.5).toFixed(1))),
      weather_code: dates.map((_, index) => (stormAt !== null && index === 0 ? 95 : rainPeakChance >= 50 ? 61 : 2)),
      precipitation_probability_max: dates.map(() => rainPeakChance),
      precipitation_sum: dates.map(() => (rainPeakChance >= 50 ? 6.1 : 0.2)),
      sunrise: dates.map(date => `${date}T06:08`),
      sunset: dates.map(date => `${date}T18:25`),
      uv_index_max: dates.map(() => 8.8),
      wind_speed_10m_max: dates.map(() => 18.6)
    }
  };
}

/** Fulfils Open-Meteo requests with a fixture that varies slightly per district latitude. */
function fulfilForecast(options = {}) {
  return route => {
    const url = new URL(route.request().url());
    const latitude = Number(url.searchParams.get('latitude')) || 17;
    const tempOffset = Number(((latitude - 17) * 4).toFixed(1));
    return route.fulfill({ json: forecastFixture({ ...options, tempOffset: (options.tempOffset || 0) + tempOffset }) });
  };
}

module.exports = { NOW, TODAY, forecastFixture, fulfilForecast };
