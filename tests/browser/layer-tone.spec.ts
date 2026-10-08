import { expect, test } from '@playwright/test';
test('layer EQ and Drive process audio and bypass restores a clean signal', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/tests/browser/audio.html');
  await page.waitForFunction('typeof window.renderTone === "function"');
  type Result = { energy: number; harmonic: number; finite: boolean };
  const dry = await page.evaluate('window.renderTone("eq", false)') as Result;
  const eq = await page.evaluate('window.renderTone("eq", true)') as Result;
  const drive = await page.evaluate('window.renderTone("drive", true)') as Result;
  const bypass = await page.evaluate('window.renderTone("drive", false)') as Result;
  expect(eq.energy / dry.energy).toBeCloseTo(4, 0);
  expect(drive.harmonic).toBeGreaterThan(dry.harmonic + 10);
  expect(bypass.energy).toBeCloseTo(dry.energy, 3);
  expect(eq.finite && drive.finite).toBe(true);
});
test('compact controls expose per-layer EQ/Drive, exclusive mute/solo and settings protection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Спільні ефекти', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Panic', exact: true })).toBeVisible();
  const layer = page.locator('app-layer-editor').first();
  await layer.getByRole('button', { name: 'Solo', exact: true }).click();
  await layer.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(layer.getByRole('button', { name: 'Solo', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await layer.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(layer.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await layer.getByRole('button', { name: 'Прибрати Filter', exact: true }).click();
  await layer.getByRole('button', { name: 'Прибрати Reverb', exact: true }).click();
  for (const name of ['EQ', 'Drive']) {
    await layer.getByRole('button', { name: 'Додати ефект', exact: true }).click();
    await expect(layer.getByRole('button', { name: 'Скасувати', exact: true }).locator('svg')).toHaveCount(1);
    await layer.getByRole('button', { name, exact: true }).click();
  }
  await expect(layer.getByRole('button', { name: 'Додати ефект', exact: true })).toBeDisabled();
  await layer.getByLabel('EQ · середина', { exact: true }).fill('5');
  await expect(layer.getByLabel('EQ · середина', { exact: true })).toHaveAttribute('aria-valuetext', '5 dB');
  await layer.getByLabel('Насичення', { exact: true }).fill('0.6');
  await expect(layer.getByLabel('Насичення', { exact: true })).toHaveAttribute('aria-valuetext', '60%');
  await page.getByRole('button', { name: 'Зберегти як', exact: true }).click();
  await page.getByRole('button', { name: 'Створити', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('Пресет збережено');
  await page.reload();
  await expect(layer.getByLabel('EQ · середина', { exact: true })).toHaveValue('5');
  await expect(layer.getByLabel('Насичення', { exact: true })).toHaveValue('0.6');
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await expect(page.getByLabel('Ліміт піків (dBFS)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Reverb decay (s)', { exact: true })).toHaveCount(0);
  await expect(page.locator('.master-level')).toHaveCSS('pointer-events', 'none');
});
