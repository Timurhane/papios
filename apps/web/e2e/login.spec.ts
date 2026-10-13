import { expect, test } from '@playwright/test';

test('unauthenticated visitor only sees the login screen', async ({ page }) => {
  await page.goto('/crm');
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
  await expect(page.getByLabel('E-posta')).toBeVisible();
  await expect(page.getByLabel('Şifre')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page).toHaveTitle(/Papi/);
});

test('page is not indexable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
