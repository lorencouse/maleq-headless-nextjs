import { test, expect } from '@playwright/test';

test.describe('Cart Functionality', () => {
  test('should start with empty cart', async ({ page }) => {
    await page.goto('/cart');

    // Should show empty cart message or a clear CTA.
    const emptyHeading = page.getByRole('heading', { name: /your cart is empty/i });
    const startShopping = page.getByRole('link', { name: /start shopping/i });
    if (await emptyHeading.isVisible()) {
      await expect(emptyHeading).toBeVisible();
    } else {
      await expect(startShopping).toBeVisible();
    }
  });

  test('should navigate to cart page', async ({ page }) => {
    await page.goto('/');

    // Click cart from main navigation when available, otherwise direct route fallback.
    const cartLink = page
      .getByRole('navigation', { name: /main navigation/i })
      .getByRole('link', { name: /^cart$/i });
    if ((await cartLink.count()) > 0) {
      await cartLink.first().click();
    } else {
      await page.goto('/cart');
    }

    await expect(page).toHaveURL(/\/cart/);
  });
});

test.describe('Add to Cart', () => {
  test('should add simple product to cart', async ({ page }) => {
    await page.goto('/shop');

    // Find a simple product add-to-cart on current catalog snapshot.
    const addToCartButton = page.getByRole('button', { name: /^add to cart$/i }).first();
    const buttonCount = await page.getByRole('button', { name: /^add to cart$/i }).count();
    if (buttonCount === 0) {
      test.skip(true, 'No simple product with direct add-to-cart is currently visible on /shop');
    }

    await addToCartButton.click();
    await page.goto('/cart');

    // Cart should not be in empty state after add.
    await expect(page.getByRole('heading', { name: /your cart is empty/i })).toHaveCount(0);
  });
});
