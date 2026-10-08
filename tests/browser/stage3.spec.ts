import { test, expect } from '@playwright/test';
test('all synthesized instruments sound, release, and electric velocity changes normalized spectrum', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderCatalogue === "function"');
  const results = await page.evaluate('window.renderCatalogue()') as { id: string; energy: number; peak: number; finite: boolean; tail: boolean }[];
  expect(results).toHaveLength(12);
  for (const r of results) { expect(r.energy, r.id).toBeGreaterThan(0.01); expect(r.peak, r.id).toBeLessThan(1); expect(r.finite && r.tail, r.id).toBe(true); }
  const spectra = [];
  for (const id of ['warm-tine', 'bright-tine', 'soft-reed']) {
    const soft = await page.evaluate('window.renderElectric(' + JSON.stringify(id) + ', 35)') as { energy: number; brightness: number };
    const loud = await page.evaluate('window.renderElectric(' + JSON.stringify(id) + ', 120)') as typeof soft;
    expect(loud.energy).toBeGreaterThan(soft.energy);
    expect(Math.abs(loud.brightness - soft.brightness)).toBeGreaterThan(0.001);
    spectra.push(loud.brightness.toFixed(4));
  }
  expect(new Set(spectra).size).toBe(3);
});
test('actual AudioWorklet caps peaks; shared reverb/delay tails are finite and Panic clears them', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderEffects === "function"');
  const normal = await page.evaluate('window.renderEffects(false)') as { energy: number; peak: number; finite: boolean; tail: number };
  const cleared = await page.evaluate('window.renderEffects(true)') as typeof normal;
  for (const r of [normal, cleared]) { expect(r.energy).toBeGreaterThan(0); expect(r.finite).toBe(true); expect(r.peak).toBeLessThanOrEqual(0.500001); }
  expect(normal.tail).toBeGreaterThan(0.01); expect(cleared.tail).toBeLessThan(1e-10);
});
test('factory recall, effects persistence, bank memory and load retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const selection = page.getByLabel('Відкрити пресет', { exact: true });
  await expect(selection.locator('option')).toHaveCount(10);
  await selection.selectOption('worship-gospel');
  const layers = page.locator('app-layer-editor');
  await expect(layers).toHaveCount(2);
  await expect(layers.nth(1).getByLabel('Тембр', { exact: true })).toHaveValue('gospel-organ');
  await page.getByRole('button', { name: 'Увімкнути звук', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Звук готовий' })).toBeVisible();
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await page.getByLabel('Ліміт піків (dBFS)', { exact: true }).fill('-2');
  await page.getByRole('button', { name: 'Закрити налаштування' }).click();
  await page.locator('#master').fill('-21');
  await page.getByRole('button', { name: 'Зберегти як', exact: true }).click();
  await page.getByRole('button', { name: 'Створити', exact: true }).click();
  await expect(page.locator('.statusbar').getByText('Пресет збережено', { exact: true })).toBeVisible();
  await page.reload(); await expect(layers).toHaveCount(2);
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await expect(page.getByLabel('Ліміт піків (dBFS)', { exact: true })).toHaveValue('-2');
  await expect(page.locator('#master')).toHaveValue('-21');
  await page.getByRole('button', { name: 'Закрити налаштування' }).click();
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await page.getByText('Банки звуків', { exact: true }).click();
  await page.route('**/salamander-3v/manifest.json', route => route.fulfill({ status: 503, body: '' }));
  const bank = page.locator('.bank-row').first();
  await bank.getByRole('button').click(); await expect(bank).toContainText('Помилка завантаження');
  await page.unroute('**/salamander-3v/manifest.json');
  await bank.getByRole('button').click(); await expect(bank).toContainText('Готовий у пам’яті');
  await page.getByRole('button', { name: 'Закрити налаштування' }).click();
  await selection.selectOption('worship-warm'); await expect(layers).toHaveCount(2);
  await expect(layers.first().getByLabel('Тембр', { exact: true })).toHaveValue('warm-tine');
  await expect(page.locator('#master')).toHaveValue('-21');
  await page.screenshot({ path: 'test-results/stage3-effects.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('all current banks fit the PCM budget and wet Panic allows immediate replay', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.prepareWet === "function"'); await page.evaluate('window.prepareWet()');
  await page.evaluate('window.engine.loadBank("fluid-ensemble")');
  await page.evaluate('window.engine.loadBank("felt-piano")');
  await page.evaluate('window.engine.loadBank("worship-textures")');
  const state = await page.evaluate('window.engine.diagnostics()') as { assets: number; pcmBytes: number };
  console.log('Stage 3 combined banks:', JSON.stringify(state));
  expect(state.assets).toBe(194); expect(state.pcmBytes).toBeLessThan(256 * 1048576);
  await page.evaluate('window.note(true)');
  await expect.poll(() => page.evaluate('window.engine.diagnostics().peakAfter')).toBeGreaterThan(0);
  await page.evaluate('window.router.panic(window.engine.now())');
  await expect.poll(() => page.evaluate('window.engine.diagnostics().peakAfter')).toBeLessThan(0.000001);
  await page.evaluate('window.note(true)');
  expect(await page.evaluate('window.engine.diagnostics().voices')).toBe(1);
  await page.evaluate('window.note(false); window.engine.dispose()');
});
test('mono output averages stereo without a level boost', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html'); await page.waitForFunction('typeof window.renderMono === "function"');
  const stereo = await page.evaluate('window.renderMono(false)') as number[];
  const mono = await page.evaluate('window.renderMono(true)') as number[];
  expect(stereo[0]).toBeCloseTo(0.6); expect(stereo[1]).toBeCloseTo(0.2);
  expect(mono[0]).toBeCloseTo(0.4); expect(mono[1]).toBeCloseTo(0.4);
});
