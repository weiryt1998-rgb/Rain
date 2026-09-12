'use strict';

/*
 * Renders favicon.svg into the PNG app icons with the browser Playwright uses.
 *   node scripts/make-icons.cjs            (Playwright's Chromium)
 *   PW_CHANNEL=msedge node scripts/make-icons.cjs
 * icon-192/512 keep transparent rounded corners; the maskable and Apple icons
 * are full-bleed because those platforms clip the shape themselves.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
// Full-bleed variant: square background, artwork scaled into the 80% safe zone.
const fullBleed = svg
  .replace(/rx="14"/g, 'rx="0"')
  .replace(/<rect x="\.75"[^>]*\/>/, '')
  .replace(/(<path d="M24 8S12)/, '<g transform="translate(24 24) scale(.8) translate(-24 -24)">$1')
  .replace(/<\/svg>\s*$/, '</g></svg>');

const ICONS = [
  { file: 'icons/icon-192.png', size: 192, source: svg, transparent: true },
  { file: 'icons/icon-512.png', size: 512, source: svg, transparent: true },
  { file: 'icons/maskable-512.png', size: 512, source: fullBleed, transparent: false },
  { file: 'icons/apple-touch-icon.png', size: 180, source: fullBleed, transparent: false }
];

(async () => {
  const channel = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};
  const browser = await chromium.launch(channel);
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${icon.size}px;height:${icon.size}px}</style>${icon.source}`);
    await page.screenshot({ path: path.join(ROOT, icon.file), omitBackground: icon.transparent, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    console.log(`wrote ${icon.file} (${icon.size}px${icon.transparent ? ', transparent' : ''})`);
  }
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
