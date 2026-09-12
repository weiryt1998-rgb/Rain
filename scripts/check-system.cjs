'use strict';

/*
 * Checks that the live Open-Meteo service still returns data the app can use,
 * by running the exact fetch + validation path from weather-core.js.
 * Needs internet access; no credentials or local secrets are involved.
 */
const core = require('../weather-core.js');

const SAMPLE_IDS = ['mueang', 'thung-saliam'];

async function checkDistrict(id) {
  const district = core.districtById(id);
  const started = Date.now();
  try {
    const weather = await core.fetchWeather(district);
    const info = core.codeInfo(weather.current.code, weather.current.isDay);
    console.log(`PASS ${district.english.padEnd(16)} ${core.formatTemp(weather.current.temp)}°C ${info.text} · ${weather.hourly.length} hourly rows · ${weather.daily.length} daily rows · ${Date.now() - started} ms`);
    return true;
  } catch (error) {
    console.error(`FAIL ${district.english.padEnd(16)} ${error.code || 'ERROR'}: ${error.message}`);
    return false;
  }
}

(async () => {
  console.log(`Checking Open-Meteo for ${SAMPLE_IDS.length} of ${core.DISTRICTS.length} Sukhothai districts (${core.bangkokDate()} Asia/Bangkok)`);
  const results = await Promise.all(SAMPLE_IDS.map(checkDistrict));
  if (results.every(Boolean)) {
    console.log('All checks passed.');
  } else {
    console.error('Some checks failed. The app will fall back to cached forecasts where available.');
    process.exitCode = 1;
  }
})();
