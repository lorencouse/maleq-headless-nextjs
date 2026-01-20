import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Maleq/);
  });

  test('should have main navigation', async ({ page }) => {
    await page.goto('/');

    // Check for main navigation links
    await expect(page.getByRole('link', { name: /shop/i })).toBeVisible();
  });

  test('should have skip link for accessibility', async ({ page }) => {
    await page.goto('/');

    // Focus on body first
    await page.keyboard.press('Tab');

    // Skip link should be visible when focused
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toHaveCSS('top', '0px');
  });
});

test.describe('Navigation', () => {
  test('should navigate to shop page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Shop');
    await expect(page).toHaveURL(/\/shop/);
  });

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=About');
    await expect(page).toHaveURL(/\/about/);
  });

  test('should navigate to contact page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Contact');
    await expect(page).toHaveURL(/\/contact/);
  });
});
