import { expect, test } from '@playwright/test';
test('pad ADSR produces finite sound and releases even during attack', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html'); await page.waitForFunction('typeof window.renderPad === "function"');
  for (const early of [false, true]) {
    const result = await page.evaluate('window.renderPad(' + early + ')') as { energy: number; finite: boolean; tail: number; peak: number };
    expect(result.energy).toBeGreaterThan(0); expect(result.finite).toBe(true); expect(result.tail).toBe(0); expect(result.peak).toBeLessThan(1);
  }
});
test('failed piano preparation keeps the current pad sounding', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html'); await page.waitForFunction('typeof window.preparePad === "function"');
  await page.evaluate('window.preparePad()'); await page.evaluate('window.note(true)');
  await page.route('**/manifest.json', route => route.fulfill({ status: 503, body: '' }));
  expect(await page.evaluate('window.preparePiano().then(() => false, () => true)')).toBe(true);
  expect(await page.evaluate('window.engine.diagnostics().voices')).toBe(1);
  await page.evaluate('window.note(false)'); await expect.poll(() => page.evaluate('window.engine.diagnostics().voices')).toBe(0);
});
test('real piano sample: finite signal, velocity dynamics, release and gain ramp', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderPiano === "function"');
  const loud = await page.evaluate('window.renderPiano(127, true)') as { energy: number; peak: number; tail: number; finite: boolean; maxStep: number };
  const soft = await page.evaluate('window.renderPiano(40, true)') as typeof loud;
  const held = await page.evaluate('window.renderPiano(127, false)') as typeof loud;
  expect(loud.energy).toBeGreaterThan(0.001); expect(loud.finite).toBe(true);
  expect(loud.peak).toBeLessThan(1); expect(loud.maxStep).toBeLessThan(0.1);
  expect(loud.tail).toBe(0); expect(held.tail).toBeGreaterThan(0);
  expect(soft.energy).toBeLessThan(loud.energy * 0.1);
});
test('bounded 64/32 voices, Panic silence and immediate replay', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.prepare === "function"'); await page.evaluate('window.prepare()');
  const state = await page.evaluate('window.flood()') as { voices: number; nodes: number; pcmBytes: number };
  console.log('Browser audio diagnostics:', JSON.stringify(state));
  expect(state.voices).toBe(64); expect(state.nodes).toBeLessThanOrEqual(384);
  expect(state.pcmBytes).toBeLessThan(256 * 1048576);
  await page.evaluate('window.engine.updateParameters({ voiceLimit: 32 })');
  expect(await page.evaluate('window.engine.diagnostics().voices')).toBe(32);
  await page.evaluate('window.router.panic(window.engine.now())');
  await expect.poll(() => page.evaluate('window.engine.diagnostics().nodes')).toBe(0);
  await expect.poll(() => page.evaluate('window.engine.diagnostics().peakAfter')).toBe(0);
  await page.evaluate('window.flood()'); expect(await page.evaluate('window.engine.diagnostics().voices')).toBe(32);
  await page.evaluate('window.engine.dispose()');
});
