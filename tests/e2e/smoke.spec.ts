import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { parseStl, writeStl } from '../../src/core/io/stl';
import { parse3mf } from '../../src/core/io/threemf';
import { analyzeTopology } from '../../src/core/mesh/topology';
import { weldVertices } from '../../src/core/mesh/weld';
import { makePauldron } from '../../src/core/testmeshes/pieces';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.status-badge')).toHaveCount(0, { timeout: 60_000 });
  return errors;
}

async function download(page: Page, button: string): Promise<Uint8Array> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button, exact: true }).click(),
  ]);
  return new Uint8Array(readFileSync((await file.path())!));
}

const arrayBuffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;

test('fits the demo armor and exports printable files', async ({ page }) => {
  const errors = await open(page);

  await page.getByRole('tab', { name: 'Armor' }).click();
  await page.getByRole('button', { name: 'Load demo armor' }).click();
  const cards = page.locator('.piece-card');
  await expect(cards.locator('img')).toHaveCount(4, { timeout: 60_000 });
  for (let i = 0; i < 4; i++) {
    await cards.nth(i).locator('.piece-head').click();
    await cards.nth(i).getByRole('button', { name: 'Put on body' }).click();
    await expect(cards.nth(i)).toContainText('on body');
  }

  await page.getByRole('tab', { name: 'Fit' }).click();
  await page.getByRole('button', { name: 'Demo bracer L', exact: true }).click();
  await expect(page.locator('.tally')).toContainText('Forearm (L)');
  await expect(page.locator('.verdict')).toHaveText(/Intersects|tight/);
  await page.getByRole('button', { name: 'Auto-size', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Scaled to');
  await expect(page.locator('.verdict')).not.toHaveText(/Intersects/);

  await page.getByRole('tab', { name: 'Print' }).click();
  const rows = page.locator('.print-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('.fit-ok, .fit-warn, .fit-bad')).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Demo bracer L' })).not.toContainText('scale 100.0%');

  const zip = unzipSync(await download(page, 'All as STL (zip)'));
  expect(Object.keys(zip).sort()).toEqual([
    'Demo_bracer_L.stl',
    'Demo_chest_plate.stl',
    'Demo_helmet.stl',
    'Demo_pauldron_L.stl',
  ]);
  for (const [name, bytes] of Object.entries(zip)) {
    const mesh = parseStl(arrayBuffer(bytes)).parts[0].mesh;
    expect(analyzeTopology(weldVertices(mesh).mesh).watertight, name).toBe(true);
    let minZ = Infinity;
    for (let i = 2; i < mesh.positions.length; i += 3) minZ = Math.min(minZ, mesh.positions[i]);
    expect(minZ, `${name} rests on the bed`).toBeCloseTo(0, 3);
  }

  const threeMf = parse3mf(arrayBuffer(await download(page, 'All as 3MF')));
  expect(threeMf.parts.map((p) => p.name)).toEqual([
    'Demo helmet',
    'Demo chest plate',
    'Demo pauldron L',
    'Demo bracer L',
  ]);
  for (const part of threeMf.parts) expect(analyzeTopology(part.mesh).watertight, part.name).toBe(true);

  const report = new TextDecoder().decode(await download(page, 'Sizing report'));
  expect(report).toContain('# ArmorFit sizing report');
  expect(report).toContain('Demo bracer L');

  const project = JSON.parse(new TextDecoder().decode(await download(page, 'Save project')));
  expect(project.kind).toBe('armorfit-project');
  expect(project.pieces).toHaveLength(4);

  expect(errors).toEqual([]);
});

test('imports an STL and recognises the piece from its file name', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('tab', { name: 'Armor' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.dropzone').click()]);
  await chooser.setFiles({
    name: 'Pauldron_R.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(writeStl(makePauldron())),
  });
  const card = page.locator('.piece-card');
  await expect(card.locator('img')).toHaveCount(1, { timeout: 60_000 });
  await expect(card).toContainText('Pauldron');
  await expect(card).toContainText('right');
  await expect(card).not.toContainText('not watertight');
  expect(errors).toEqual([]);
});

test('re-fits the mannequin and remembers measurements', async ({ page }) => {
  const errors = await open(page);
  const height = page.locator('input#m-height');
  await height.fill('190');
  await height.press('Enter');
  await expect(page.locator('.status-badge')).toHaveCount(0, { timeout: 60_000 });
  await page.reload();
  await expect(page.locator('.status-badge')).toHaveCount(0, { timeout: 60_000 });
  expect(Number(await page.locator('input#m-height').inputValue())).toBeCloseTo(190, 1);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('shows every tab without sideways scrolling', async ({ page }) => {
    const errors = await open(page);
    for (const name of ['Body', 'Armor', 'Fit', 'Print']) {
      await expect(page.getByRole('tab', { name })).toBeInViewport();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
