import { expect, test } from '@playwright/test';

test('sound selector groups all instruments and applies simple pad brightness', async ({ page }) => {
  await page.goto('/');
  const layer = page.locator('app-layer-editor').first(), select = layer.locator('.sound-select select');
  await expect(select.locator('optgroup')).toHaveCount(7);
  await expect(select.locator('option')).toHaveCount(29);
  expect(await select.locator('optgroup').evaluateAll(groups => groups.map(g => g.getAttribute('label'))))
    .toEqual(['Фортепіано', 'Електро-піано', 'Орган', 'Оркестр', 'Прості педи', 'Динамічні педи', 'Ліди']);
  await select.selectOption('warm-pad');
  await expect(layer.getByRole('slider', { name: 'Яскравість', exact: true })).toHaveAttribute('aria-valuetext', '400 Hz');
  await select.selectOption('glass-pad');
  await expect(layer.getByRole('slider', { name: 'Яскравість', exact: true })).toHaveAttribute('aria-valuetext', '4200 Hz');
  await select.selectOption('choir');
  await expect(select).toHaveValue('choir');
});

test('sampled pads and ensembles sustain, release, and use only three voice nodes', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderSampled === "function"');
  type Result = { energy: number; heldEnergy: number; finite: boolean; maxStep: number; side: number; windows: number[]; ended: number; nodes: number; tail: boolean };
  const ids = ['warm-pad', 'soft-air', 'strings-pad', 'glass-pad', 'ambient-pad', 'violin-orchestra', 'wind-orchestra', 'symphonic-orchestra', 'choir', 'aurora-motion', 'ocean-bloom', 'shimmer-pad', 'choir-bloom'];
  for (const id of ids) {
    const result = await page.evaluate('window.renderSampled(' + JSON.stringify(id) + ')') as Result;
    expect(result.energy, id).toBeGreaterThan(0.01);
    expect(result.heldEnergy, id).toBeGreaterThan(0.001);
    expect(result.finite && result.tail, id).toBe(true);
    expect(result.ended, id).toBe(1); expect(result.nodes, id).toBe(3);
    expect(result.maxStep, id).toBeLessThan(0.3);
    if (['aurora-motion', 'ocean-bloom', 'shimmer-pad', 'choir-bloom'].includes(id)) {
      expect(result.side / result.energy, id).toBeGreaterThan(0.05);
      const held = result.windows.slice(8, 24);
      expect(Math.max(...held) / Math.min(...held), id).toBeGreaterThan(1.05);
    }
  }
});
test('sampled pad is fully preloaded, uses bounded resources and responds to sustain and Panic', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.prepareSampled === "function"');
  await page.evaluate('window.prepareSampled("aurora-motion")');
  await page.route('**/samples/**', route => route.abort());
  const state = await page.evaluate('window.flood()') as { voices: number; nodes: number };
  expect(state.voices).toBe(10); expect(state.nodes).toBeLessThanOrEqual(512);
  await page.evaluate('window.router.handle({ type: "cc", input: "test", channel: 1, controller: 64, value: 0, time: window.engine.now() })');
  await expect.poll(() => page.evaluate('window.engine.diagnostics().voices')).toBe(0);
  await page.evaluate('window.note(true); window.router.panic(window.engine.now())');
  await expect.poll(() => page.evaluate('window.engine.diagnostics().nodes')).toBe(0);
  await page.evaluate('window.note(true)');
  expect(await page.evaluate('window.engine.diagnostics().voices')).toBe(1);
  await page.evaluate('window.engine.dispose()');
});
