import { test, expect, type Page } from '@playwright/test';

async function openFirstProduct(page: Page) {
  await page.goto('/shop');
  const productLink = page.locator('a[href*="/product/"]').first();
  await productLink.waitFor({ timeout: 10000 });
  const href = await productLink.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href as string);
  await expect(page).toHaveURL(/\/product\//);
}

test.describe('Shop Page', () => {
  test('should load shop page', async ({ page }) => {
    await page.goto('/shop');
    await expect(page).toHaveTitle(/Shop/);
  });

  test('should display products', async ({ page }) => {
    await page.goto('/shop');

    // Wait for products to load
    await page.waitForSelector('[data-testid="product-card"], .product-card, a[href*="/product/"]', {
      timeout: 10000,
    });

    // Check that at least one product is visible
    const products = await page.locator('a[href*="/product/"]').count();
    expect(products).toBeGreaterThan(0);
  });

  test('should have filter options', async ({ page }) => {
    await page.goto('/shop');

    // Check for filter panel elements (desktop aside or mobile trigger).
    const filterUI = page.locator(
      '[data-testid="filter-panel"], .filter-panel, aside, button:has-text("Filters")'
    );
    await expect(filterUI.first()).toBeVisible();
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
    await openFirstProduct(page);
  });

  test('should display product information', async ({ page }) => {
    await openFirstProduct(page);

    // Product page should render a primary heading and purchase CTA.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // Accept any purchase-related CTA (in-stock: "Add to Cart", out-of-stock: "Notify Me When Available")
    const ctaButton = page.getByRole('button', {
      name: /add to cart|select options|notify me when available/i,
    }).first();
    await expect(ctaButton).toBeVisible({ timeout: 10000 });
  });
});
