import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { parseStl, writeStl } from '../../src/core/io/stl';
import { parse3mf } from '../../src/core/io/threemf';
import { analyzeTopology } from '../../src/core/mesh/topology';
import { weldVertices } from '../../src/core/mesh/weld';
import { Matrix4, Vector3 } from 'three';
import type { MeshData } from '../../src/core/mesh/types';
import { makeChestPlate, makeForearmTube, makeHelmet, makePauldron } from '../../src/core/testmeshes/pieces';

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

function placed(mesh: MeshData, m: Matrix4): MeshData {
  const toFile = new Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1).multiply(m);
  const positions = new Float32Array(mesh.positions.length);
  const v = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]).applyMatrix4(toFile);
    positions.set([v.x, v.y, v.z], i);
  }
  return { positions, indices: mesh.indices };
}

test('assembles a set of files that share one layout and sizes it', async ({ page }) => {
  const errors = await open(page);
  const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
  const tPose = new Matrix4().makeRotationZ(-Math.PI / 2);
  const mirror = new Matrix4().makeScale(-1, 1, 1);
  const thigh = new Matrix4().makeScale(1.7, 1.4, 1.7);
  const set: [string, MeshData][] = [
    ['Helmet.stl', placed(makeHelmet(), at(0, 1640, 0))],
    ['Chest Plate.stl', placed(makeChestPlate(), at(0, 1300, 40))],
    [
      'Back Plate.stl',
      placed(makeChestPlate(), at(0, 1300, -40).multiply(new Matrix4().makeRotationY(Math.PI))),
    ],
    ['Pauldron Left.stl', placed(makePauldron(), at(190, 1450, 0))],
    ['Pauldron Right.stl', placed(makePauldron(), at(-190, 1450, 0).multiply(mirror))],
    ['Forearm Left.stl', placed(makeForearmTube(), at(560, 1360, 0).multiply(tPose))],
    ['Forearm Right.stl', placed(makeForearmTube(), at(-560, 1360, 0).multiply(mirror).multiply(tPose))],
    ['Thigh Left.stl', placed(makeForearmTube(), at(100, 720, 0).multiply(thigh))],
    ['Thigh Right.stl', placed(makeForearmTube(), at(-100, 720, 0).multiply(thigh))],
  ];
  await page.getByRole('tab', { name: 'Armor' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.dropzone').click()]);
  await chooser.setFiles(
    set.map(([name, mesh]) => ({ name, mimeType: 'model/stl', buffer: Buffer.from(writeStl(mesh)) })),
  );
  const cards = page.locator('.piece-card');
  await expect(cards.locator('img')).toHaveCount(set.length, { timeout: 60_000 });
  await expect(page.locator('.toast', { hasText: 'Assembled set found' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'check units' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Put all on body' }).click();
  await expect(cards.filter({ hasText: 'on body' })).toHaveCount(set.length);
  await page.getByRole('button', { name: 'Auto-size all' }).click();
  await expect(page.locator('.toast', { hasText: 'Auto-sized' })).toContainText(`${set.length} pieces`, {
    timeout: 60_000,
  });
  expect(errors).toEqual([]);
});

test('exposes the app to AI agents through WebMCP', async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, { execute: (i: unknown) => Promise<unknown>; annotations?: object }>();
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: (
          tool: { name: string; execute: (i: unknown) => Promise<unknown> },
          opts?: { signal?: AbortSignal },
        ) => {
          tools.set(tool.name, tool);
          opts?.signal?.addEventListener('abort', () => tools.delete(tool.name));
          return Promise.resolve();
        },
      },
    });
    (window as unknown as { __tools: typeof tools }).__tools = tools;
  });
  const errors = await open(page);
  const call = (name: string, input: object = {}) =>
    page.evaluate(
      async ([n, i]) => {
        const t = (
          window as unknown as {
            __tools: Map<string, { execute: (x: unknown) => Promise<{ content: { text: string }[] }> }>;
          }
        ).__tools.get(n as string);
        if (!t) throw new Error(`missing tool ${n}`);
        const r = await t.execute(i);
        const txt = r.content[0].text;
        try {
          return JSON.parse(txt);
        } catch {
          return txt;
        }
      },
      [name, input] as const,
    );
  const names = await page.evaluate(() => [
    ...(window as unknown as { __tools: Map<string, unknown> }).__tools.keys(),
  ]);
  expect(names).toEqual(
    expect.arrayContaining([
      'armorfit_get_status',
      'armorfit_put_on_body',
      'armorfit_auto_size',
      'armorfit_sizing_report',
    ]),
  );
  const s0 = await call('armorfit_get_status');
  expect(s0.pieces).toEqual([]);
  const s1 = await call('armorfit_set_measurements', { values: { height: 182, chest: 104 }, unit: 'cm' });
  expect(s1.measurementsMm.height).toBeCloseTo(1820, 0);
  expect(s1.enteredByUser).toEqual(expect.arrayContaining(['height', 'chest']));
  await call('armorfit_load_demo_armor');
  const placed = await call('armorfit_put_on_body');
  expect(placed.pieces).toHaveLength(4);
  expect(placed.pieces.every((p: { onBody: boolean }) => p.onBody)).toBe(true);
  const bracer = placed.pieces.find((p: { name: string }) => p.name === 'Demo bracer L');
  const sized = await call('armorfit_auto_size', { ids: [bracer.id] });
  const after = sized.pieces.find((p: { id: string }) => p.id === bracer.id);
  expect(after.scalePercent[0]).not.toBe(100);
  const d = await call('armorfit_get_piece', { id: 'Demo bracer L' });
  expect(d.fit.covers[0].region).toContain('Forearm');
  const report = await call('armorfit_sizing_report');
  expect(report).toContain('# ArmorFit sizing report');
  await call('armorfit_show', { tab: 'armor', id: bracer.id });
  await expect(page.locator('.piece-card')).toHaveCount(4);
  await expect(page.locator('.piece-card.selected')).toContainText('Demo bracer L');
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
