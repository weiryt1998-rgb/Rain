'use strict';

const { test, expect } = require('@playwright/test');
const { NOW, TODAY, fulfilForecast } = require('./fixture.cjs');

const API = 'https://api.open-meteo.com/**';

test.beforeEach(async ({ page }) => {
  // Pin Date.now() so "today", "now" and freshness labels are deterministic.
  await page.clock.setFixedTime(NOW);
  await page.route(API, fulfilForecast());
  // Tests never depend on web fonts; keep them offline-friendly and fast.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

async function openApp(page, query = '') {
  await page.goto(`/${query}`);
  await expect(page.locator('#current-temp')).not.toHaveText('—');
}

test('renders the dashboard from the forecast response', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().startsWith('https://api.open-meteo.com')) requests.push(new URL(request.url())); });
  await openApp(page);

  await expect(page).toHaveTitle(/เมืองสุโขทัย — Rain/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.locator('#place-name')).toHaveText('อำเภอเมืองสุโขทัย');
  await expect(page.locator('#current-temp')).toHaveText('30');
  await expect(page.locator('#current-condition')).toHaveText('มีเมฆบางส่วน');
  await expect(page.locator('#current-feels')).toHaveText('35°');
  await expect(page.locator('#current-max')).toHaveText('33°');
  await expect(page.locator('#current-min')).toHaveText('24°');
  await expect(page.locator('#current-rain-mm')).toHaveText('6.1 มม.');
  await expect(page.locator('#live-status')).toContainText('อัปเดตล่าสุด 14:30');
  await expect(page.locator('#weather-content')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#status-banner')).toBeHidden();

  await expect(page.locator('.daily-row')).toHaveCount(7);
  await expect(page.locator('.daily-row').first()).toContainText('วันนี้');
  await expect(page.locator('.daily-row').nth(1)).toContainText('พรุ่งนี้');
  await expect(page.locator('.hour-item')).toHaveCount(24);
  await expect(page.locator('.hour-item.is-now .hour-time')).toHaveText('ตอนนี้');
  await expect(page.locator('#hourly-chart svg')).toBeVisible();
  await expect(page.locator('#hourly-summary')).toContainText('โอกาสฝนสูงสุด 70%');

  await expect(page.locator('#d-humidity')).toContainText('75');
  await expect(page.locator('#humidity-meter')).toHaveAttribute('aria-valuenow', '75');
  await expect(page.locator('#wind-direction')).toHaveText('พัดจากทิศตะวันตกเฉียงใต้');
  await expect(page.locator('#uv-badge')).toHaveText('สูง');
  await expect(page.locator('#sunrise')).toHaveText('06:08');
  await expect(page.locator('#sunset')).toHaveText('18:25');
  await expect(page.locator('#sun-note')).toContainText('เหลือแสงอีก 3 ชม. 55 นาที');
  await expect(page.locator('#d-pressure')).toContainText('1,009');
  await expect(page.locator('#d-visibility')).toContainText('18');
  await expect(page.locator('#insight-title')).toHaveText('อย่าลืมพกร่ม');
  await expect(page.locator('#weather-insight')).toHaveAttribute('data-tone', 'rain');

  await expect(page.locator('.district-card')).toHaveCount(9);
  await expect(page.locator('.district-card.is-active')).toContainText('เมืองสุโขทัย');
  await expect(page.locator('.district-card .district-temp').filter({ hasNotText: '—' })).toHaveCount(9);

  const first = requests[0];
  expect(first.searchParams.get('latitude')).toBe('17.0077');
  expect(first.searchParams.get('timezone')).toBe('Asia/Bangkok');
  expect(first.searchParams.get('forecast_days')).toBe('8');
  expect(requests).toHaveLength(9);
  expect(new Set(requests.map(url => url.searchParams.get('latitude'))).size).toBe(9);
});

test('search selects a district, updates the URL and is remembered on reload', async ({ page }) => {
  await openApp(page);
  await page.locator('#search-input').fill('si nak');
  await expect(page.locator('#suggestions [role="option"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#place-name')).toHaveText('อำเภอศรีนคร');
  await expect(page).toHaveURL(/district=si-nakhon/);
  await expect(page).toHaveTitle(/ศรีนคร/);
  await expect(page.locator('#breadcrumb-district')).toHaveText('ศรีนคร');
  await expect(page.locator('.district-card.is-active')).toContainText('ศรีนคร');

  await page.goto('/');
  await expect(page.locator('#place-name')).toHaveText('อำเภอศรีนคร');
  await expect(page).toHaveURL(/district=si-nakhon/);
});

test('a district in the URL wins over the remembered one, unknown ids fall back', async ({ page }) => {
  await openApp(page, '?district=thung-saliam');
  await expect(page.locator('#place-name')).toHaveText('อำเภอทุ่งเสลี่ยม');
  await page.goto('/?district=bangkok');
  await expect(page.locator('#place-name')).toHaveText('อำเภอทุ่งเสลี่ยม');
  await expect(page.locator('#toast')).toContainText('ไม่พบอำเภอในลิงก์');
});

test('temperature unit, theme and chart preferences persist across reloads', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-unit="f"]').click();
  await expect(page.locator('#current-temp')).toHaveText('85');
  await expect(page.locator('#current-unit')).toHaveText('°F');
  await expect(page.locator('.daily-row').first()).toContainText('92°');
  await page.locator('#theme-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-chart="rain"]').click();
  await expect(page.locator('#chart-unit')).toHaveText('% โอกาสฝน');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#current-unit')).toHaveText('°F');
  await expect(page.locator('#current-temp')).toHaveText('85');
  await expect(page.locator('[data-chart="rain"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#hourly-chart .chart-bar').first()).toBeAttached();
});

test('saving a district updates the count, saved list and can be undone', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#saved-count')).toHaveText('0');
  await page.locator('#save-btn').click();
  await expect(page.locator('#save-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#saved-count')).toHaveText('1');
  await expect(page.locator('.saved-card')).toHaveCount(1);
  await expect(page.locator('.saved-card')).toContainText('เมืองสุโขทัย');
  await expect(page.locator('.district-card.is-active .district-saved')).toBeAttached();

  await page.reload();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.locator('.saved-remove').click();
  await expect(page.locator('#saved-count')).toHaveText('0');
  await expect(page.locator('.saved-list .empty-state')).toBeVisible();
  await expect(page.locator('#save-btn')).toHaveAttribute('aria-pressed', 'false');
});

test('selecting a day filters the hourly forecast and can be reset', async ({ page }) => {
  await openApp(page);
  await page.locator('.daily-row').nth(2).click();
  await expect(page.locator('.daily-row').nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#hourly-subtitle')).toContainText('วันจันทร์');
  await expect(page.locator('.hour-item')).toHaveCount(24);
  await expect(page.locator('.hour-item .hour-time').first()).toHaveText('00:00');
  await expect(page.locator('.hour-item.is-now')).toHaveCount(0);
  await expect(page.locator('#reset-day')).toBeVisible();
  await page.locator('#reset-day').click();
  await expect(page.locator('#hourly-subtitle')).toContainText('24 ชั่วโมงข้างหน้า');
  await expect(page.locator('.hour-item.is-now')).toHaveCount(1);
  await expect(page.locator('#reset-day')).toBeHidden();
});

test('keeps showing the cached forecast with a stale banner when the API fails', async ({ page }) => {
  await openApp(page);
  await page.unroute(API);
  await page.route(API, route => route.fulfill({ status: 503, body: 'down' }));
  await page.locator('#refresh-btn').click();
  await expect(page.locator('#status-banner')).toBeVisible();
  await expect(page.locator('#status-banner')).toContainText('กำลังแสดงข้อมูลที่บันทึกไว้');
  await expect(page.locator('#live-status')).toHaveAttribute('data-state', 'stale');
  await expect(page.locator('#current-temp')).toHaveText('30');
  await expect(page.locator('#current-update')).toHaveClass(/is-stale/);

  await page.unroute(API);
  await page.route(API, fulfilForecast());
  await page.locator('#retry-btn').click();
  await expect(page.locator('#status-banner')).toBeHidden();
  await expect(page.locator('#live-status')).toHaveAttribute('data-state', 'live');
});

test('shows an error state without cache and recovers on retry', async ({ page }) => {
  await page.unroute(API);
  await page.route(API, route => route.fulfill({ status: 429, body: 'slow down' }));
  await page.goto('/');
  await expect(page.locator('#status-banner')).toBeVisible();
  await expect(page.locator('#status-banner')).toHaveAttribute('data-kind', 'error');
  await expect(page.locator('#status-banner')).toContainText('มีการเรียกข้อมูลจำนวนมาก');
  await expect(page.locator('#current-condition')).toHaveText('ไม่สามารถโหลดข้อมูลได้');
  await expect(page.locator('#live-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('.daily-row.skeleton-row')).toHaveCount(7);

  await page.unroute(API);
  await page.route(API, fulfilForecast());
  await page.locator('#retry-btn').click();
  await expect(page.locator('#current-temp')).toHaveText('30');
  await expect(page.locator('#status-banner')).toBeHidden();
  await expect(page.locator('.daily-row.skeleton-row')).toHaveCount(0);
});

test('rejects a malformed forecast instead of rendering it', async ({ page }) => {
  await page.unroute(API);
  await page.route(API, route => route.fulfill({ json: { timezone: 'Asia/Bangkok', current: {}, hourly: {}, daily: {} } }));
  await page.goto('/');
  await expect(page.locator('#status-banner')).toContainText('ข้อมูลอากาศที่ได้รับไม่ครบถ้วน');
  await expect(page.locator('#current-temp')).toHaveText('—');
});

test('geolocation picks the nearest district reference point', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 17.3171, longitude: 99.8311 });
  await openApp(page);
  await page.locator('#geo-btn').click();
  await expect(page.locator('#place-name')).toHaveText('อำเภอสวรรคโลก');
  await expect(page.locator('#toast')).toContainText('สวรรคโลก');
  await expect(page).toHaveURL(/district=sawankhalok/);
});

test('keyboard: slash focuses search, arrows choose a suggestion, escape closes it', async ({ page }) => {
  await openApp(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('#suggestions')).toBeVisible();
  await expect(page.locator('#suggestions [role="option"]')).toHaveCount(9);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#search-input')).toHaveAttribute('aria-activedescendant', 'suggestion-ban-dan-lan-hoi');
  await page.keyboard.press('Enter');
  await expect(page.locator('#place-name')).toHaveText('อำเภอบ้านด่านลานหอย');
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  await expect(page.locator('#suggestions')).toBeHidden();
  await expect(page.locator('#search-input')).toHaveAttribute('aria-expanded', 'false');
});

test('layout never scrolls horizontally and key controls stay visible', async ({ page }) => {
  await openApp(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.locator('.nav-item[data-nav="districts"]')).toBeVisible();
  await page.locator('#hourly-scroll').focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => document.getElementById('hourly-scroll').scrollLeft)).toBeGreaterThan(0);
});

test('accessibility basics: unique ids, named controls, no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openApp(page);
  const report = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    const unnamed = [...document.querySelectorAll('button, a')].filter(node => {
      const name = node.getAttribute('aria-label') || node.textContent.trim() || node.getAttribute('title');
      return !name;
    }).map(node => node.outerHTML.slice(0, 80));
    const headings = [...document.querySelectorAll('h1, h2, h3')].map(node => node.tagName);
    return { duplicates, unnamed, h1Count: headings.filter(tag => tag === 'H1').length, hasMain: Boolean(document.querySelector('main#main')) };
  });
  expect(report.duplicates).toEqual([]);
  expect(report.unnamed).toEqual([]);
  expect(report.h1Count).toBe(1);
  expect(report.hasMain).toBe(true);
  expect(errors).toEqual([]);
});

test('thunderstorm forecast switches the insight to an alert', async ({ page }) => {
  await page.unroute(API);
  await page.route(API, fulfilForecast({ stormAt: 17 }));
  await openApp(page);
  await expect(page.locator('#insight-title')).toHaveText('ระวังฝนฟ้าคะนอง');
  await expect(page.locator('#weather-insight')).toHaveAttribute('data-tone', 'alert');
  await expect(page.locator('.daily-row').first()).toContainText('ฝนฟ้าคะนอง');
  expect(TODAY).toBe('2026-09-12');
});
