import { expect, test } from '@playwright/test';
test('start, sampled sound, master, Panic and new note', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Увімкнути звук', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Звук готовий', exact: true })).toBeVisible();
  const key = page.getByRole('button', { name: 'C4', exact: true });
  await key.dispatchEvent('keydown', { code: 'Enter' });
  await expect(page.getByTestId('voices')).toHaveText('1');
  await page.locator('#master').fill('-18'); await expect(page.locator('.master')).toContainText('-18 dB');
  await page.getByRole('button', { name: 'Panic', exact: true }).click();
  await expect(page.getByTestId('voices')).toHaveText('0');
  await key.dispatchEvent('keydown', { code: 'Enter' }); await expect(page.getByTestId('voices')).toHaveText('1');
  await key.dispatchEvent('keyup', { code: 'Enter' }); await expect(page.getByTestId('voices')).toHaveText('0');
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await page.screenshot({ path: 'test-results/live-keys.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('loading failure is recoverable', async ({ page }) => {
  await page.route('**/A0v4.mp3', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); await page.getByRole('button', { name: 'Увімкнути звук', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не вдалося підготувати звук');
  await page.unroute('**/A0v4.mp3'); await page.getByRole('button', { name: 'Увімкнути звук', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Звук готовий' })).toBeVisible();
});
test('MIDI denied/unsupported remain playable through screen keys', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true,
    value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) }));
  await page.goto('/'); await page.getByRole('button', { name: 'MIDI', exact: true }).click(); await page.getByRole('button', { name: 'Дозволити MIDI' }).click();
  await expect(page.getByRole('alert')).toContainText('Доступ до MIDI не надано');
  await page.evaluate(() => Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined }));
  await page.getByRole('button', { name: 'Дозволити MIDI' }).click();
  await expect(page.getByRole('alert')).toContainText('Web MIDI недоступний');
  await page.getByRole('button', { name: 'Закрити MIDI' }).click();
  await page.getByRole('button', { name: 'Увімкнути звук', exact: true }).click();
  await expect(page.getByRole('button', { name: 'C4', exact: true })).toBeEnabled();
});
