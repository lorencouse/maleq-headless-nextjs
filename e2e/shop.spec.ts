import { test, expect } from '@playwright/test';

test.describe('Shop Page', () => {
  test('should load shop page', async ({ page }) => {
    await page.goto('/shop');
    await expect(page).toHaveTitle(/Shop/);
  });

  test('should display products', async ({ page }) => {
    await page.goto('/shop');

    // Wait for products to load
    await page.waitForSelector('[data-testid="product-card"], .product-card, a[href*="/shop/product/"]', {
      timeout: 10000,
    });

    // Check that at least one product is visible
    const products = await page.locator('a[href*="/shop/product/"]').count();
    expect(products).toBeGreaterThan(0);
  });

  test('should have filter options', async ({ page }) => {
    await page.goto('/shop');

    // Check for filter panel elements
    const filterPanel = page.locator('[data-testid="filter-panel"], .filter-panel, aside');
    await expect(filterPanel).toBeVisible();
  });

  test('should have sort dropdown', async ({ page }) => {
    await page.goto('/shop');

    // Look for sort dropdown
    const sortDropdown = page.locator('select, [data-testid="sort-dropdown"]');
    await expect(sortDropdown.first()).toBeVisible();
  });
});

test.describe('Product Page', () => {
  test('should navigate to product from shop', async ({ page }) => {
    await page.goto('/shop');

    // Wait for products to load and click first product
    const productLink = page.locator('a[href*="/shop/product/"]').first();
    await productLink.waitFor({ timeout: 10000 });
    await productLink.click();

    // Should be on product page
    await expect(page).toHaveURL(/\/shop\/product\//);
  });

  test('should display product information', async ({ page }) => {
    await page.goto('/shop');

    // Get first product link
    const productLink = page.locator('a[href*="/shop/product/"]').first();
    await productLink.waitFor({ timeout: 10000 });
    await productLink.click();

    // Check for product name (h1)
    const productName = page.locator('h1');
    await expect(productName).toBeVisible();

    // Check for add to cart button
    const addToCartButton = page.locator('button:has-text("Add to Cart"), button:has-text("View Options")');
    await expect(addToCartButton).toBeVisible();
  });
});
