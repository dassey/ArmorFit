// Calibrates the photo measurements: renders mannequins, runs them through the photo pipeline in Chromium and
// prints, per measurement, the raw truth/measured ratio (the CALIBRATION constant in
// src/core/photo/silhouette.ts) and the error with the current constants.
//
//   node scripts/calibrate-photo.mjs                          calibration set, default camera
//   node scripts/calibrate-photo.mjs '{"distance":2.7,"cameraHeight":1.3}'
//   node scripts/calibrate-photo.mjs '{"holdout":true}'       bodies not used for calibration
//   node scripts/calibrate-photo.mjs '{"holdout":true,"photos":true,"distance":2.4,"cameraHeight":1}' tests/e2e/fixtures
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const options = JSON.parse(process.argv[2] ?? '{}');
const out = process.argv[3];
const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  await page.addInitScript((o) => (window.CALIBRATE = o), options);
  await page.goto('http://127.0.0.1:5199/scripts/photo-calibration/index.html');
  await page.waitForFunction(() => window.RESULT, null, { timeout: 600_000 });
  const result = await page.evaluate(() => window.RESULT);
  if (result.front && out) {
    const jpeg = (url) => Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(`${out}/front.jpg`, jpeg(result.front));
    writeFileSync(`${out}/side.jpg`, jpeg(result.side));
    const truth = Object.fromEntries(
      Object.entries(result.truth).map(([k, v]) => [k, Math.round(v * 10) / 10]),
    );
    writeFileSync(`${out}/truth.json`, JSON.stringify(truth, null, 2) + '\n');
    console.log(`Wrote ${out}/front.jpg, side.jpg and truth.json`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await browser.close();
  await server.close();
}
