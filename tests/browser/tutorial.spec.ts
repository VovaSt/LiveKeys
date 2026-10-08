import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('first visit tutorial completes once and can be reopened from settings', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: '1. Увімкни звук' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Далі', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2. Обери свій звук' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Далі', exact: true }).click();
  await page.getByRole('button', { name: 'Далі', exact: true }).click();
  await page.getByRole('button', { name: 'Почати грати', exact: true }).click();
  await expect(page.locator('app-tutorial dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Зберегти як', exact: true })).toBeEnabled();
  await expect(page.locator('app-tutorial dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await page.getByRole('button', { name: 'Короткий туторіал', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('skip dismisses future automatic tutorials', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Пропустити', exact: true }).click();
  await expect(page.locator('app-tutorial dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Зберегти як', exact: true })).toBeEnabled();
  await expect(page.locator('app-tutorial dialog')).not.toBeVisible();
});
