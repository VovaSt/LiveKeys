import { expect, test } from '@playwright/test';

test('pad controls default to ten and character is open after effects', async ({ page }) => {
  await page.goto('/');
  const layer = page.locator('app-layer-editor').first();
  await layer.locator('.sound-select select').selectOption('warm-pad');
  const character = layer.locator('details').filter({ has: page.locator('summary', { hasText: 'Характер звуку' }) });
  await expect(character).toHaveAttribute('open', '');
  expect(await character.evaluate(el => el.previousElementSibling?.tagName)).toBe('APP-EFFECTS-EDITOR');
  await layer.getByText('Ноти та динаміка', { exact: false }).click();
  const limit = layer.getByRole('slider', { name: 'Одночасні голоси' });
  await expect(limit).toHaveValue('10');
  await limit.fill('6'); await expect(limit).toHaveValue('6');
  await expect(page.locator('.audio-load')).toBeVisible();
});

test('oldest pad voice fades for half a second and remaining voices respect limit', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.prepareSampled === "function"');
  const envelope = await page.evaluate('window.renderVoiceFade()') as number[];
  expect(envelope[0]).toBeCloseTo(1, 3); expect(envelope[1]).toBeCloseTo(0.5, 3);
  expect(envelope[2]).toBeCloseTo(0, 3); expect(envelope[3]).toBe(0);
  await page.evaluate('window.prepareSampled("warm-pad")');
  const result = await page.evaluate(`(() => {
    const { engine, router } = window;
    for (let note = 60; note <= 70; note++) router.handle({ type: 'on', input: 'test', channel: 1, note, velocity: 100, time: engine.now() });
    return { state: engine.diagnostics(), active: [...engine.voices.values()].map(r => r.identity.pitch), retiring: [...engine.retiring.values()].map(r => ({ pitch: r.identity.pitch, duration: r.voice.releaseDuration })) };
  })()`) as { state: { voices: number }; active: number[]; retiring: { pitch: number; duration: number }[] };
  expect(result.state.voices).toBe(10); expect(result.active).not.toContain(60);
  expect(result.retiring).toEqual([{ pitch: 60, duration: 0.5 }]);
  await expect.poll(() => page.evaluate('window.engine.diagnostics().retiringVoices')).toBe(0);
  await page.evaluate('window.engine.panic(window.engine.now())');
  await expect.poll(() => page.evaluate('window.engine.diagnostics().voices')).toBe(0);
});
