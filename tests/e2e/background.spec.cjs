'use strict';

const { test, expect } = require('@playwright/test');
const { NOW, forecastFixture } = require('./fixture.cjs');

const API = 'https://api.open-meteo.com/**';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

async function routeCurrent(page, current) {
  await page.route(API, route => {
    const forecast = forecastFixture();
    Object.assign(forecast.current, current);
    return route.fulfill({ json: forecast });
  });
}

async function expectScene(page, condition, time, photoStem) {
  await expect(page.locator('body')).toHaveAttribute('data-weather', condition);
  await expect(page.locator('body')).toHaveAttribute('data-weather-time', time);
  const photo = page.locator('#weather-backdrop .weather-photo.is-visible');
  await expect(photo).toHaveCount(1);
  if (photoStem) await expect(photo).toHaveAttribute('src', new RegExp(`${photoStem}-4k\\.(?:jpe?g|webp|png)$`));
  const dimensions = await photo.evaluate(image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }));
  expect(dimensions.complete).toBe(true);
  expect(dimensions.width).toBeGreaterThanOrEqual(3840);
  expect(dimensions.height).toBeGreaterThanOrEqual(2160);
  return photo.getAttribute('src');
}

async function refresh(page) {
  await expect(page.locator('#refresh-btn')).toBeEnabled();
  await page.locator('#refresh-btn').click();
  await expect(page.locator('#weather-content')).toHaveAttribute('aria-busy', 'false');
}

async function backgroundAnimations(page) {
  return page.evaluate(() => {
    const photo = document.querySelector('.weather-photo.is-visible');
    const atmosphere = document.querySelector('.weather-atmosphere');
    return [
      getComputedStyle(photo).animationName,
      getComputedStyle(atmosphere, '::before').animationName,
      getComputedStyle(atmosphere, '::after').animationName,
      getComputedStyle(document.body, '::after').animationName
    ];
  });
}

test('uses decoded 4K photos for the current weather, including rain at night', async ({ page }) => {
  const current = { weather_code: 0, is_day: 1 };
  await routeCurrent(page, current);
  await page.goto('/');
  await expect(page.locator('#weather-backdrop')).toHaveAttribute('aria-hidden', 'true');
  const sunny = await expectScene(page, 'clear', 'day', 'sunny');
  const cases = [
    { code: 61, day: 1, condition: 'rain', photo: 'rainy' },
    { code: 61, day: 0, condition: 'rain', photo: 'rainy' },
    { code: 95, day: 0, condition: 'storm', photo: 'storm' },
    { code: 0, day: 0, condition: 'night', photo: 'night' },
    { code: 3, day: 1, condition: 'cloud', photo: 'cloudy' },
    { code: 2, day: 1, condition: 'partly', photo: 'sunny' },
    { code: 45, day: 1, condition: 'fog', photo: 'cloudy', effect: 'weather-mist' },
    { code: 71, day: 1, condition: 'snow', photo: 'cloudy', effect: 'weather-snow' }
  ];
  const photos = new Map([['clear', sunny]]);
  for (const sample of cases) {
    Object.assign(current, { weather_code: sample.code, is_day: sample.day });
    await refresh(page);
    const source = await expectScene(page, sample.condition, sample.day ? 'day' : 'night', sample.photo);
    photos.set(sample.condition, source);
    const lightning = await page.evaluate(() => getComputedStyle(document.body, '::after').display);
    expect(lightning).toBe(sample.condition === 'storm' ? 'block' : 'none');
    if (sample.effect) {
      const effect = await page.locator('.weather-atmosphere').evaluate(node => getComputedStyle(node, '::after').animationName);
      expect(effect).toBe(sample.effect);
    }
  }
  // Cloudy photography supports fog and snow overlays; partly cloudy shares sun.
  expect(new Set(photos.values()).size).toBe(5);
});

test('keeps the current sunny background when viewing rainy forecast days or changing theme', async ({ page }) => {
  await routeCurrent(page, { weather_code: 0, is_day: 1 });
  await page.goto('/');
  const source = await expectScene(page, 'clear', 'day', 'sunny');
  await expect(page.locator('.daily-row').nth(2)).toContainText('ฝนเล็กน้อย');
  await page.locator('.daily-row').nth(2).click();
  await page.locator('#theme-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-unit="f"]').click();
  expect(await expectScene(page, 'clear', 'day', 'sunny')).toBe(source);
});

test('uses a neutral background while loading and clears a previous scene for unknown weather', async ({ page }) => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const current = { weather_code: 61, is_day: 1 };
  await page.route(API, async route => {
    await ready;
    const forecast = forecastFixture();
    Object.assign(forecast.current, current);
    await route.fulfill({ json: forecast });
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-weather', 'loading');
  await expect(page.locator('#weather-backdrop .weather-photo.is-visible')).toHaveCount(0);
  release();
  await expectScene(page, 'rain', 'day', 'rainy');
  current.weather_code = 999;
  await refresh(page);
  await expect(page.locator('#current-condition')).toHaveText('ไม่มีข้อมูลสภาพท้องฟ้า');
  await expect(page.locator('body')).toHaveAttribute('data-weather', 'loading');
  await expect(page.locator('#weather-backdrop .weather-photo.is-visible')).toHaveCount(0);
});

test('clears the previous district background while an uncached district loads', async ({ page }) => {
  const pending = [];
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  let released = false;
  await page.route(API, async route => {
    const url = new URL(route.request().url());
    const selected = url.searchParams.get('latitude') === '17.0077';
    if (!selected && !released) {
      pending.push(url.href);
      await ready;
    }
    const forecast = forecastFixture();
    Object.assign(forecast.current, { weather_code: selected ? 61 : 0, is_day: 1 });
    await route.fulfill({ json: forecast });
  });
  await page.goto('/');
  await expectScene(page, 'rain', 'day', 'rainy');
  await page.locator('#search-input').fill('si nak');
  await page.keyboard.press('Enter');
  await expect(page.locator('#place-name')).toHaveText('อำเภอศรีนคร');
  await expect(page.locator('body')).toHaveAttribute('data-weather', 'loading');
  await expect(page.locator('#weather-backdrop .weather-photo.is-visible')).toHaveCount(0);
  expect(pending.length).toBeGreaterThan(0);
  released = true;
  release();
  await expectScene(page, 'clear', 'day', 'sunny');
});

test('preserves the cached rainy scene when a refresh fails and while offline', async ({ page, context }) => {
  await routeCurrent(page, { weather_code: 61, is_day: 1 });
  await page.goto('/');
  const source = await expectScene(page, 'rain', 'day', 'rainy');
  await page.unroute(API);
  await page.route(API, route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.reload();
  await expect(page.locator('#status-banner')).toContainText('กำลังแสดงข้อมูลที่บันทึกไว้');
  expect(await expectScene(page, 'rain', 'day', 'rainy')).toBe(source);
  await context.setOffline(true);
  await refresh(page);
  await expect(page.locator('#live-status')).toHaveAttribute('data-state', 'offline');
  expect(await expectScene(page, 'rain', 'day', 'rainy')).toBe(source);
});

test('stops all background movement when reduced motion changes at runtime', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await routeCurrent(page, { weather_code: 95, is_day: 1 });
  await page.goto('/');
  await expectScene(page, 'storm', 'day', 'storm');
  expect((await backgroundAnimations(page)).some(name => name !== 'none')).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => backgroundAnimations(page)).toEqual(['none', 'none', 'none', 'none']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await backgroundAnimations(page)).some(name => name !== 'none')).toBe(true);
});

test('lets the user pause background motion and remembers it after reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await routeCurrent(page, { weather_code: 61, is_day: 1 });
  await page.goto('/');
  await expectScene(page, 'rain', 'day', 'rainy');
  await page.locator('#weather-motion-btn').click();
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'paused');
  await expect.poll(() => backgroundAnimations(page)).toEqual(['none', 'none', 'none', 'none']);
  await page.reload();
  await expectScene(page, 'rain', 'day', 'rainy');
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'paused');
  await expect.poll(() => backgroundAnimations(page)).toEqual(['none', 'none', 'none', 'none']);
  await page.locator('#weather-motion-btn').click();
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'running');
  await expect.poll(async () => (await backgroundAnimations(page)).some(name => name !== 'none')).toBe(true);
});

test('falls back to a neutral scene if the new weather image cannot load', async ({ page }) => {
  const current = { weather_code: 0, is_day: 1 };
  await routeCurrent(page, current);
  await page.goto('/');
  await expectScene(page, 'clear', 'day', 'sunny');
  await page.route('**/images/weather/rainy-4k.*', route => route.abort('failed'));
  current.weather_code = 61;
  await refresh(page);
  await expect(page.locator('body')).toHaveAttribute('data-weather', 'rain');
  await expect(page.locator('#weather-backdrop .weather-photo.is-visible')).toHaveCount(0);
  await expect(page.locator('#current-temp')).toHaveText('30');
});
