import { expect, test } from '@playwright/test';
import { factoryPresets } from '../../src/domain/factory';

test('v3 upgrade replaces Bell Keys in user presets and drafts without deleting them', async ({ page }) => {
  await page.route('**/seed-storage', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/seed-storage');
  const preset = structuredClone(factoryPresets.find(p => p.id === 'worship-shimmer')!);
  preset.id = 'user-bells'; preset.name = 'My keys'; preset.layers[0]!.instrument.id = 'bell-keys';
  await page.evaluate(preset => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('live-keys', 3);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('presets', { keyPath: 'id' }).put(preset);
      request.result.createObjectStore('meta').put({ preset, dirty: true }, 'draft');
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), preset);
  await page.goto('/');
  await expect(page.getByLabel('Відкрити пресет', { exact: true })).toHaveValue('user-bells');
  await expect(page.locator('app-layer-editor').first().getByLabel('Тембр', { exact: true })).toHaveValue('rhodes');
  await expect(page.getByLabel('Відкрити пресет', { exact: true }).locator('option')).toHaveCount(11);
  await page.reload();
  await expect(page.locator('app-layer-editor').first().getByLabel('Тембр', { exact: true })).toHaveValue('rhodes');
});

for (const previousVersion of [1, 2]) test(`library reset from v${previousVersion} preserves settings and future saves`, async ({ page }) => {
  await page.route('**/seed-storage', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/seed-storage');
  await page.evaluate(async version => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('live-keys', version);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('presets', { keyPath: 'id' }).put({ id: 'old-custom', brokenOldSound: true });
        const meta = db.createObjectStore('meta');
        meta.put({ preset: { oldSound: true }, dirty: true }, 'draft');
        meta.put({ schemaVersion: 1, masterDb: -19, selectedInputs: ['keyboard'], voiceLimit: 32, globalTranspose: 2, outputMono: false }, 'settings');
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  }, previousVersion);
  await page.goto('/');
  const presets = page.getByLabel('Відкрити пресет', { exact: true });
  await expect(presets.locator('option')).toHaveCount(10);
  await expect(presets).toHaveValue('worship-piano');
  await expect(page.locator('#master')).toHaveValue('-19');
  await expect(page.getByLabel('Загальна транспозиція', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Зберегти як', exact: true }).click();
  await page.getByRole('button', { name: 'Створити', exact: true }).click();
  await expect(presets.locator('option')).toHaveCount(11);
  const savedId = await presets.inputValue();
  await page.reload();
  await expect(presets.locator('option')).toHaveCount(11);
  await expect(presets).toHaveValue(savedId);
  expect(await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('live-keys');
    request.onsuccess = () => { const db = request.result; resolve(db.version); db.close(); };
  }))).toBe(4);
});
