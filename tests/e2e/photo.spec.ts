import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { CALIBRATION } from '../../src/core/photo/silhouette';

// Front and side renders of a mannequin that is not in the calibration set, with its true measurements.
const FIXTURES = 'tests/e2e/fixtures';
const truth: Record<string, number> = JSON.parse(readFileSync(`${FIXTURES}/truth.json`, 'utf8'));

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.status-badge')).toHaveCount(0, { timeout: 60_000 });
  return errors;
}

test('measures the body from a front and a side photo', async ({ page }) => {
  const errors = await open(page);
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (['POST', 'PUT'].includes(r.method())) uploads.push(r.url());
  });

  await page.getByRole('button', { name: 'Size the mannequin to you' }).click();
  const dialog = page.getByRole('dialog', { name: 'Measure me with photos' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText(/ready/, { timeout: 90_000 });

  await dialog.getByLabel('Height (barefoot)').fill((truth.height / 10).toFixed(1));
  await dialog.getByLabel('Height (barefoot)').press('Enter');
  await dialog.locator('input[aria-label="Front photo"]').setInputFiles(`${FIXTURES}/front.jpg`);
  await dialog.locator('input[aria-label="Side photo"]').setInputFiles(`${FIXTURES}/side.jpg`);
  await expect(dialog.locator('.chip.ok')).toHaveCount(2, { timeout: 60_000 });

  const cells = dialog.locator('td[data-key]');
  await expect(cells).toHaveCount(Object.keys(CALIBRATION).length + 1);
  for (const key of Object.keys(CALIBRATION)) {
    const cm = parseFloat((await dialog.locator(`td[data-key="${key}"]`).textContent())!);
    expect(Math.abs(cm * 10 - truth[key]) / truth[key], `${key}: ${cm} cm vs ${truth[key]} mm`).toBeLessThan(
      0.06,
    );
  }

  await dialog.getByRole('checkbox', { name: 'Use calf circumference' }).uncheck();
  await dialog.getByRole('button', { name: /^Use \d+ measurements$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.toast')).toContainText('from your photos');
  await expect(page.locator('.ps-card.done')).toContainText('Sized from your photos');
  await expect(page.getByRole('button', { name: 'Size the mannequin to you' })).toHaveCount(0);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('armorfit:profile:v1')!));
  expect(saved.mode).toBe('detailed');
  expect(saved.userSet).toContain('chest');
  expect(saved.userSet).not.toContain('calfCirc');
  expect(Math.abs(saved.values.chest - truth.chest) / truth.chest).toBeLessThan(0.06);
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});

test('explains what is wrong when the side photo is another front photo', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Body' }).click();
  await page.getByRole('button', { name: 'Measure me with photos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Measure me with photos' });
  await dialog.getByLabel('Height (barefoot)').fill('170');
  await dialog.getByLabel('Height (barefoot)').press('Enter');
  await dialog.locator('input[aria-label="Front photo"]').setInputFiles(`${FIXTURES}/front.jpg`);
  await dialog.locator('input[aria-label="Side photo"]').setInputFiles(`${FIXTURES}/front.jpg`);
  await expect(dialog.locator('.ps-slot.error')).toContainText('does not look like a side view', {
    timeout: 90_000,
  });
  await expect(dialog.getByRole('button', { name: 'Add both photos' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
