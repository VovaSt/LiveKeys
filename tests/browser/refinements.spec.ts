import { expect, test } from '@playwright/test';

test('organ and lead releases preserve the envelope during attack, decay and sustain', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderSynthRelease === "function"');
  const results = await page.evaluate('window.renderSynthRelease()') as { error: number; jump: number; tail: number }[];
  expect(results).toHaveLength(12);
  for (const result of results) {
    expect(result.error).toBeLessThan(0.0001); expect(result.jump).toBeLessThan(0.003); expect(result.tail).toBe(0);
  }
});

test('sound arrows follow dropdown order; Save overwrites and Save as creates numbered presets', async ({ page }) => {
  await page.goto('/');
  const layer = page.locator('app-layer-editor').first(), sound = layer.getByLabel('Тембр', { exact: true });
  await layer.getByRole('button', { name: 'Наступний звук', exact: true }).click();
  await expect(sound).toHaveValue('soft-grand');
  await layer.getByRole('button', { name: 'Попередній звук', exact: true }).click();
  await expect(sound).toHaveValue('natural-grand');
  await expect(page.getByRole('button', { name: 'Зберегти', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Зберегти як', exact: true }).click();
  await expect(page.getByLabel('Назва нового пресету')).toHaveValue('Natural Grand');
  await page.getByRole('button', { name: 'Створити', exact: true }).click();
  const selection = page.getByLabel('Відкрити пресет', { exact: true });
  await expect(selection.locator('option')).toHaveCount(11);
  await expect(selection.locator('option:checked')).toHaveText('11 · Natural Grand');
  const id = await selection.inputValue();
  await layer.getByRole('button', { name: 'Наступний звук', exact: true }).click();
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(selection).toHaveValue(id); await expect(selection.locator('option')).toHaveCount(11);
  await page.reload(); await expect(sound).toHaveValue('soft-grand');
  await page.getByRole('button', { name: 'Зберегти як', exact: true }).click();
  await expect(page.getByLabel('Назва нового пресету')).toHaveValue('Soft Grand');
  await page.getByRole('button', { name: 'Створити', exact: true }).click();
  await expect(selection.locator('option')).toHaveCount(12);
  await expect(selection.locator('option:checked')).toHaveText('12 · Soft Grand');
});
