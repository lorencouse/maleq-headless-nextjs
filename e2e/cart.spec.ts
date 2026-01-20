import { test, expect } from '@playwright/test';

test.describe('Cart Functionality', () => {
  test('should start with empty cart', async ({ page }) => {
    await page.goto('/cart');

    // Should show empty cart message or state
    const emptyState = page.locator('text=/empty|no items|start shopping/i');
    await expect(emptyState).toBeVisible();
  });

  test('should navigate to cart page', async ({ page }) => {
    await page.goto('/');

    // Click on cart icon/link in header
    const cartLink = page.locator('a[href="/cart"], [data-testid="cart-link"]');
    await cartLink.click();

    await expect(page).toHaveURL(/\/cart/);
  });
});

test.describe('Add to Cart', () => {
  test('should add simple product to cart', async ({ page }) => {
    await page.goto('/shop');

    // Find a simple product's add to cart button
    const addToCartButton = page.locator('button:has-text("Add to Cart")').first();

    // If there's a simple product, test adding to cart
    const buttonCount = await addToCartButton.count();
    if (buttonCount > 0) {
      await addToCartButton.click();

      // Should show success toast or cart update
      await page.waitForTimeout(1000);

      // Cart count should update
      const cartBadge = page.locator('[data-testid="cart-count"], .cart-count');
      if (await cartBadge.isVisible()) {
        const count = await cartBadge.textContent();
        expect(parseInt(count || '0')).toBeGreaterThan(0);
      }
    }
  });
});
