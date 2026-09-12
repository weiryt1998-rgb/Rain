/*
 * Data and presentation helpers for Sukhothai Weather. No API key is required.
 * Forecast fields: https://open-meteo.com/en/docs
 * District reference points: Department of Livestock Development, page 7:
 * https://dld.go.th/th/images/stories/about_us/gisdld/06.pdf
 * These are representative district office areas, not district boundaries.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeatherCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TIMEZONE = 'Asia/Bangkok';
  const DAY_MS = 86400000;
  const CACHE_VERSION = 1;
  const CACHE_PREFIX = 'sukhothai-weather:v1:';
  const DISTRICTS = Object.freeze([
    { id: 'mueang', name: 'เมืองสุโขทัย', english: 'Mueang Sukhothai', lat: 17.0077, lon: 99.8228 },
    { id: 'ban-dan-lan-hoi', name: 'บ้านด่านลานหอย', english: 'Ban Dan Lan Hoi', lat: 17.0054, lon: 99.5743 },
    { id: 'khiri-mat', name: 'คีรีมาศ', english: 'Khiri Mat', lat: 16.8338, lon: 99.8019 },
    { id: 'kong-krailat', name: 'กงไกรลาศ', english: 'Kong Krailat', lat: 16.9527, lon: 99.9759 },
    { id: 'si-satchanalai', name: 'ศรีสัชนาลัย', english: 'Si Satchanalai', lat: 17.5170, lon: 99.7605 },
    { id: 'si-samrong', name: 'ศรีสำโรง', english: 'Si Samrong', lat: 17.1544, lon: 99.8551 },
    { id: 'sawankhalok', name: 'สวรรคโลก', english: 'Sawankhalok', lat: 17.3171, lon: 99.8311 },
    { id: 'si-nakhon', name: 'ศรีนคร', english: 'Si Nakhon', lat: 17.3483, lon: 99.9908 },
    { id: 'thung-saliam', name: 'ทุ่งเสลี่ยม', english: 'Thung Saliam', lat: 17.3212, lon: 99.5608 }
  ].map(Object.freeze));

  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const numeric = value => isNumber(value) ? value : null;
  const inRange = (value, min, max) => isNumber(value) && value >= min && value <= max ? value : null;
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function districtById(id) {
    return DISTRICTS.find(district => district.id === id) || null;
  }

  function searchDistricts(query) {
    const needle = typeof query === 'string'
      ? query.trim().toLowerCase().normalize('NFC').replace(/^(?:อำเภอ|อําเภอ|อ\.|amphoe\s*)\s*/u, '').replace(/[\s-]+/g, '')
      : '';
    if (!needle) return DISTRICTS.slice();
    return DISTRICTS.filter(district => [district.name, district.english, district.id].some(value =>
      value.toLowerCase().normalize('NFC').replace(/[\s-]+/g, '').includes(needle)
    ));
  }

  function nearestDistrict(lat, lon) {
    if (inRange(lat, -90, 90) === null || inRange(lon, -180, 180) === null) return null;
    const radians = degrees => degrees * Math.PI / 180;
    let closest = null;
    for (const district of DISTRICTS) {
      const dLat = radians(district.lat - lat);
      const dLon = radians(district.lon - lon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat)) * Math.cos(radians(district.lat)) * Math.sin(dLon / 2) ** 2;
      const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
      if (!closest || distanceKm < closest.distanceKm) closest = { district, distanceKm };
    }
    return closest;
  }

  const WEATHER_CODES = {
    0: ['ท้องฟ้าแจ่มใส', 'sun'], 1: ['ท้องฟ้าโปร่งเป็นส่วนใหญ่', 'sun'],
    2: ['มีเมฆบางส่วน', 'partly'], 3: ['มีเมฆมาก', 'cloud'],
    45: ['มีหมอก', 'fog'], 48: ['หมอกเยือกแข็ง', 'fog'],
    51: ['ฝนละอองเบาบาง', 'rain'], 53: ['ฝนละอองปานกลาง', 'rain'], 55: ['ฝนละอองหนาแน่น', 'rain'],
    56: ['ฝนละอองเยือกแข็งเล็กน้อย', 'rain'], 57: ['ฝนละอองเยือกแข็งหนาแน่น', 'rain'],
    61: ['ฝนเล็กน้อย', 'rain'], 63: ['ฝนปานกลาง', 'rain'], 65: ['ฝนตกหนัก', 'rain'],
    66: ['ฝนเยือกแข็งเล็กน้อย', 'rain'], 67: ['ฝนเยือกแข็งหนัก', 'rain'],
    71: ['หิมะตกเล็กน้อย', 'snow'], 73: ['หิมะตกปานกลาง', 'snow'], 75: ['หิมะตกหนัก', 'snow'], 77: ['เกล็ดหิมะ', 'snow'],
    80: ['ฝนซู่เล็กน้อย', 'rain'], 81: ['ฝนซู่ปานกลาง', 'rain'], 82: ['ฝนซู่รุนแรง', 'rain'],
    85: ['หิมะซู่เล็กน้อย', 'snow'], 86: ['หิมะซู่หนัก', 'snow'],
    95: ['ฝนฟ้าคะนอง', 'storm'], 96: ['ฝนฟ้าคะนองและลูกเห็บ', 'storm'], 99: ['ฝนฟ้าคะนองและลูกเห็บหนัก', 'storm']
  };

  function codeInfo(code, isDay = true) {
    const info = isNumber(code) && Object.prototype.hasOwnProperty.call(WEATHER_CODES, code) ? WEATHER_CODES[code] : null;
    if (!info) return { text: 'ไม่มีข้อมูลสภาพท้องฟ้า', kind: 'cloud' };
    return { text: info[0], kind: info[1] === 'sun' && (isDay === false || isDay === 0) ? 'moon' : info[1] };
  }

  function formatNumber(value, digits = 0) {
    if (!isNumber(value)) return '—';
    const precision = Number.isInteger(digits) ? Math.max(0, Math.min(digits, 3)) : 0;
    // Avoid a misleading negative zero after rounding near 0 °C.
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })
      .format(Number(value.toFixed(precision)) || 0);
  }

  function formatTemp(celsius, unit = 'c', digits = 0) {
    if (!isNumber(celsius)) return '—';
    const fahrenheit = typeof unit === 'string' && /^(?:f|°f|fahrenheit)$/i.test(unit);
    return formatNumber(fahrenheit ? celsius * 9 / 5 + 32 : celsius, digits);
  }

  function parseTime(value) {
    if (value instanceof Date) return value.getTime();
    if (isNumber(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return NaN;
    let timestamp = value.trim();
    const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(timestamp);
    if (!calendar) return NaN;
    const year = Number(calendar[1]);
    const month = Number(calendar[2]);
    const day = Number(calendar[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
      || (calendar[4] !== undefined && (Number(calendar[4]) > 23 || Number(calendar[5]) > 59))) return NaN;
    // Open-Meteo timestamps are local wall-clock strings when timezone is set.
    // Add Bangkok's fixed UTC offset, so the user's device timezone is irrelevant.
    if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) timestamp += 'T00:00:00+07:00';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(timestamp)) timestamp += '+07:00';
    else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) return NaN;
    return Date.parse(timestamp);
  }

  function bangkokDate(date = Date.now()) {
    const time = parseTime(date);
    if (!Number.isFinite(time)) return '';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
    const part = name => parts.find(item => item.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function formatTime(timestamp) {
    const time = parseTime(timestamp);
    if (!Number.isFinite(time)) return '—';
    return new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time);
  }

  function dayLabel(date, today = bangkokDate()) {
    const day = bangkokDate(date);
    const reference = bangkokDate(today);
    if (!day || !reference) return '—';
    if (day === reference) return 'วันนี้';
    if (day === bangkokDate(parseTime(reference) + DAY_MS)) return 'พรุ่งนี้';
    return new Intl.DateTimeFormat('th-TH', { timeZone: TIMEZONE, weekday: 'long' }).format(parseTime(day));
  }

  function windDirection(degrees) {
    if (!isNumber(degrees)) return '—';
    const directions = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
    return directions[Math.round(((degrees % 360 + 360) % 360) / 45) % 8];
  }

  function uvInfo(value) {
    if (!isNumber(value) || value < 0) return { label: 'ไม่มีข้อมูล', level: 'unknown' };
    if (value < 3) return { label: 'ต่ำ', level: 'low' };
    if (value < 6) return { label: 'ปานกลาง', level: 'moderate' };
    if (value < 8) return { label: 'สูง', level: 'high' };
    if (value < 11) return { label: 'สูงมาก', level: 'very-high' };
    return { label: 'สูงจัด', level: 'extreme' };
  }

  const CURRENT_FIELDS = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'weather_code', 'is_day', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'precipitation'];
  const HOURLY_FIELDS = ['temperature_2m', 'apparent_temperature', 'weather_code', 'is_day', 'precipitation_probability', 'precipitation', 'relative_humidity_2m', 'wind_speed_10m', 'uv_index', 'visibility'];
  const DAILY_FIELDS = ['temperature_2m_min', 'temperature_2m_max', 'weather_code', 'precipitation_probability_max', 'precipitation_sum', 'sunrise', 'sunset', 'uv_index_max', 'wind_speed_10m_max'];

  function weatherError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(parseTime(value));
  }

  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && bangkokDate(value) === value;
  }

  function validateSeries(series, fields, isDaily) {
    if (!isRecord(series) || !Array.isArray(series.time) || !series.time.length || series.time.length > (isDaily ? 16 : 384)) return false;
    const timeValid = isDaily ? validDate : validTimestamp;
    if (!series.time.every((value, index) => timeValid(value) && (index === 0 || parseTime(value) > parseTime(series.time[index - 1])))) return false;
    return fields.every(field => Array.isArray(series[field]) && series[field].length === series.time.length && series[field].every(value => {
      if (value === null) return true;
      return field === 'sunrise' || field === 'sunset' ? validTimestamp(value) : isNumber(value);
    }));
  }

  function normalizeWeather(data) {
    if (!isRecord(data) || data.error || data.timezone !== TIMEZONE || !isRecord(data.current) || !validTimestamp(data.current.time)
      || !CURRENT_FIELDS.every(field => Object.prototype.hasOwnProperty.call(data.current, field) && (data.current[field] === null || isNumber(data.current[field])))
      || !validateSeries(data.hourly, HOURLY_FIELDS, false) || !validateSeries(data.daily, DAILY_FIELDS, true)) {
      throw weatherError('ข้อมูลอากาศที่ได้รับไม่ครบถ้วน กรุณาลองอัปเดตอีกครั้ง', 'INVALID_DATA');
    }
    const current = data.current;
    const at = (series, field, index) => numeric(series[field][index]);
    const dayFlag = value => value === 1 ? true : value === 0 ? false : null;
    const weather = {
      fetchedAt: Date.now(),
      current: {
        time: current.time, temp: numeric(current.temperature_2m), feelsLike: numeric(current.apparent_temperature),
        code: numeric(current.weather_code), isDay: dayFlag(current.is_day),
        humidity: inRange(current.relative_humidity_2m, 0, 100), windKph: inRange(current.wind_speed_10m, 0, Infinity),
        windDirection: inRange(current.wind_direction_10m, 0, 360), gustKph: inRange(current.wind_gusts_10m, 0, Infinity),
        pressure: inRange(current.pressure_msl, 0, Infinity), precipitation: inRange(current.precipitation, 0, Infinity)
      },
      hourly: data.hourly.time.map((time, index) => ({
        time, temp: at(data.hourly, 'temperature_2m', index), feelsLike: at(data.hourly, 'apparent_temperature', index),
        code: at(data.hourly, 'weather_code', index), isDay: dayFlag(data.hourly.is_day[index]),
        rainChance: inRange(at(data.hourly, 'precipitation_probability', index), 0, 100),
        rainMm: inRange(at(data.hourly, 'precipitation', index), 0, Infinity),
        humidity: inRange(at(data.hourly, 'relative_humidity_2m', index), 0, 100),
        windKph: inRange(at(data.hourly, 'wind_speed_10m', index), 0, Infinity),
        uv: inRange(at(data.hourly, 'uv_index', index), 0, Infinity),
        visibilityKm: isNumber(data.hourly.visibility[index]) && data.hourly.visibility[index] >= 0 ? data.hourly.visibility[index] / 1000 : null
      })),
      daily: data.daily.time.map((date, index) => ({
        date, min: at(data.daily, 'temperature_2m_min', index), max: at(data.daily, 'temperature_2m_max', index),
        code: at(data.daily, 'weather_code', index), rainChance: inRange(at(data.daily, 'precipitation_probability_max', index), 0, 100),
        rainMm: inRange(at(data.daily, 'precipitation_sum', index), 0, Infinity),
        sunrise: data.daily.sunrise[index], sunset: data.daily.sunset[index],
        uv: inRange(at(data.daily, 'uv_index_max', index), 0, Infinity),
        windKph: inRange(at(data.daily, 'wind_speed_10m_max', index), 0, Infinity)
      })),
      timezone: TIMEZONE
    };
    if (!isNumber(weather.current.temp) || !weather.hourly.some(hour => isNumber(hour.temp)) || !weather.daily.some(day => isNumber(day.min) && isNumber(day.max))) {
      throw weatherError('ยังไม่มีข้อมูลอุณหภูมิสำหรับพื้นที่นี้ กรุณาลองอีกครั้ง', 'INVALID_DATA');
    }
    return weather;
  }

  async function fetchWeather(district, { signal } = {}) {
    if (!district || !districtById(district.id)) throw weatherError('ไม่พบอำเภอที่เลือก', 'INVALID_DISTRICT');
    // Always use the canonical district coordinates, including when reading a URL.
    const location = districtById(district.id);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal && signal.aborted) {
      const error = weatherError('ยกเลิกการโหลดข้อมูลแล้ว', 'ABORTED');
      error.name = 'AbortError';
      throw error;
    }
    if (signal) signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 18000);
    const params = new URLSearchParams({
      latitude: String(location.lat), longitude: String(location.lon),
      current: CURRENT_FIELDS.join(','), hourly: HOURLY_FIELDS.join(','), daily: DAILY_FIELDS.join(','),
      timezone: TIMEZONE, forecast_days: '8', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm'
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        if (response.status === 429) throw weatherError('มีการเรียกข้อมูลจำนวนมาก กรุณารอสักครู่แล้วลองใหม่', 'RATE_LIMIT');
        throw weatherError('บริการข้อมูลอากาศไม่พร้อมใช้งานชั่วคราว กรุณาลองอีกครั้ง', 'SERVICE_ERROR');
      }
      const data = await response.json();
      // A request aborted between response headers and body parsing must not win a race.
      if (controller.signal.aborted) throw weatherError('ยกเลิกการโหลดข้อมูลแล้ว', 'ABORTED');
      return normalizeWeather(data);
    } catch (error) {
      if (timedOut) throw weatherError('การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองอีกครั้ง', 'TIMEOUT');
      if ((signal && signal.aborted) || controller.signal.aborted) {
        const cancelled = weatherError('ยกเลิกการโหลดข้อมูลแล้ว', 'ABORTED');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      if (error && ['INVALID_DATA', 'RATE_LIMIT', 'SERVICE_ERROR'].includes(error.code)) throw error;
      if (error instanceof SyntaxError) throw weatherError('รูปแบบข้อมูลอากาศไม่ถูกต้อง กรุณาลองอีกครั้ง', 'INVALID_DATA');
      throw weatherError('เชื่อมต่อข้อมูลอากาศไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  const safeStorage = Object.freeze({
    get(key, fallback = null) {
      try {
        const value = globalThis.localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) return false;
        globalThis.localStorage.setItem(key, serialized);
        return true;
      } catch (_) { return false; }
    }
  });

  function validNumericFields(record, fields) {
    return isRecord(record) && fields.every(field => Object.prototype.hasOwnProperty.call(record, field) && (record[field] === null || isNumber(record[field])));
  }

  function validDayFlag(value) { return value === true || value === false || value === null; }

  function validRanges(record, percentFields, nonnegativeFields) {
    return percentFields.every(field => record[field] === null || inRange(record[field], 0, 100) !== null)
      && nonnegativeFields.every(field => record[field] === null || inRange(record[field], 0, Infinity) !== null);
  }

  function validWeatherCache(weather) {
    if (!isRecord(weather) || weather.timezone !== TIMEZONE || !isNumber(weather.fetchedAt) || weather.fetchedAt <= 0
      || !validNumericFields(weather.current, ['temp', 'feelsLike', 'code', 'humidity', 'windKph', 'windDirection', 'gustKph', 'pressure', 'precipitation'])
      || !validTimestamp(weather.current.time) || !isNumber(weather.current.temp) || !validDayFlag(weather.current.isDay)
      || !validRanges(weather.current, ['humidity'], ['windKph', 'gustKph', 'pressure', 'precipitation'])
      || (weather.current.windDirection !== null && inRange(weather.current.windDirection, 0, 360) === null)
      || !Array.isArray(weather.hourly) || !weather.hourly.length || weather.hourly.length > 384
      || !Array.isArray(weather.daily) || !weather.daily.length || weather.daily.length > 16) return false;
    if (!weather.hourly.every((hour, index) => validNumericFields(hour, ['temp', 'feelsLike', 'code', 'rainChance', 'rainMm', 'humidity', 'windKph', 'uv', 'visibilityKm'])
      && validRanges(hour, ['rainChance', 'humidity'], ['rainMm', 'windKph', 'uv', 'visibilityKm'])
      && validTimestamp(hour.time) && validDayFlag(hour.isDay) && (index === 0 || parseTime(hour.time) > parseTime(weather.hourly[index - 1].time)))) return false;
    if (!weather.daily.every((day, index) => validNumericFields(day, ['min', 'max', 'code', 'rainChance', 'rainMm', 'uv', 'windKph'])
      && validRanges(day, ['rainChance'], ['rainMm', 'uv', 'windKph']) && (day.min === null || day.max === null || day.min <= day.max)
      && validDate(day.date) && (day.sunrise === null || validTimestamp(day.sunrise)) && (day.sunset === null || validTimestamp(day.sunset))
      && (index === 0 || day.date > weather.daily[index - 1].date))) return false;
    return weather.hourly.some(hour => isNumber(hour.temp)) && weather.daily.some(day => isNumber(day.min) && isNumber(day.max));
  }

  function readCache(id) {
    if (!districtById(id)) return null;
    const cached = safeStorage.get(CACHE_PREFIX + id);
    if (!isRecord(cached) || cached.version !== CACHE_VERSION || cached.districtId !== id || !validWeatherCache(cached.weather)) return null;
    const age = Date.now() - cached.weather.fetchedAt;
    if (age < -60000 || age > DAY_MS) return null;
    return cached.weather;
  }

  function writeCache(id, weather) {
    if (!districtById(id) || !validWeatherCache(weather)) return false;
    return safeStorage.set(CACHE_PREFIX + id, { version: CACHE_VERSION, districtId: id, weather });
  }

  return Object.freeze({
    DISTRICTS, districtById, searchDistricts, nearestDistrict, codeInfo, formatTemp, formatNumber,
    bangkokDate, formatTime, dayLabel, parseTime, windDirection, uvInfo, fetchWeather,
    readCache, writeCache, safeStorage
  });
});
