import { expect, test } from '@playwright/test';

test('octave limits and independent key fades persist after saving', async ({ page }) => {
  await page.goto('/');
  const layer = page.locator('app-layer-editor').first();
  await layer.getByText('Ноти та динаміка', { exact: false }).click();
  const octave = layer.getByLabel('Октава', { exact: true });
  await expect(octave).toHaveAttribute('min', '-3'); await expect(octave).toHaveAttribute('max', '3');
  await octave.fill('-3'); await octave.fill('3');
  await layer.getByLabel('Нижній край', { exact: true }).fill('7');
  await layer.getByLabel('Верхній край', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Зберегти як', exact: true }).click();
  await page.getByRole('button', { name: 'Створити', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('Пресет збережено');
  await page.reload();
  await expect(octave).toHaveValue('3');
  await expect(layer.getByLabel('Нижній край', { exact: true })).toHaveValue('7');
  await expect(layer.getByLabel('Верхній край', { exact: true })).toHaveValue('12');
  const style = await page.locator('select').first().evaluate(node => {
    const css = getComputedStyle(node); return { padding: parseFloat(css.paddingRight), position: css.backgroundPosition };
  });
  expect(style.padding).toBeGreaterThanOrEqual(30); expect(style.position).toContain('12px');
});

test('Felt Piano uses distinct recorded velocity layers with a finite natural release', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderFelt === "function"');
  const results = [];
  for (const velocity of [35, 75, 115]) {
    const result = await page.evaluate('window.renderFelt(' + velocity + ')') as { zone: string; energy: number; tail: number; finite: boolean; ended: boolean };
    expect(result.energy).toBeGreaterThan(0.01); expect(result.tail).toBeGreaterThan(0);
    expect(result.finite && result.ended).toBe(true); results.push(result);
  }
  expect(new Set(results.map(r => r.zone)).size).toBe(3);
  expect(results[2]!.energy).toBeGreaterThan(results[0]!.energy);
});

test('ten worship presets can be prepared and played without missing assets', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
  await page.goto('/');
  const selection = page.getByLabel('Відкрити пресет', { exact: true });
  await expect(selection.locator('option')).toHaveCount(10);
  await page.getByRole('button', { name: 'Увімкнути звук', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Звук готовий', exact: true })).toBeVisible();
  const ids = await selection.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  for (const id of ids) {
    console.log('Preparing worship preset:', id);
    await selection.selectOption(id);
    const counts: Record<string, number> = { 'worship-piano': 1, 'worship-prayer': 2, 'worship-warm': 2, 'worship-verse': 2,
      'worship-chorus': 3, 'worship-shimmer': 3, 'worship-ocean': 3, 'worship-choir': 4, 'worship-gospel': 2, 'worship-strings': 4 };
    await expect(page.locator('app-layer-editor')).toHaveCount(counts[id]!);
    const key = page.getByRole('button', { name: 'E4', exact: true });
    await expect(key).toBeEnabled();
    await key.dispatchEvent('keydown', { code: 'Enter' });
    await expect(page.getByTestId('voices')).not.toHaveText('0');
    await key.dispatchEvent('keyup', { code: 'Enter' });
    await page.getByRole('button', { name: 'Panic', exact: true }).click();
    await expect(page.getByTestId('voices')).toHaveText('0');
  }
  expect(errors).toEqual([]);
});
