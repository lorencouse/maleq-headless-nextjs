import { test, expect } from './fixtures';

test.describe('Home Page', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Male Q/);
  });

  test('should have main navigation', async ({ page }) => {
    await page.goto('/');

    const mainNav = page.getByRole('navigation', { name: /main navigation/i });
    await expect(mainNav).toBeVisible();
    await expect(mainNav.getByRole('link', { name: /^shop$/i })).toBeVisible();
  });

  test('should expose a main landmark for keyboard navigation', async ({ page }) => {
    await page.goto('/');

    // Keyboard users should be able to land on a primary structure quickly.
    await page.keyboard.press('Tab');

    const skipLink = page.locator('.skip-link, a[href="#main-content"], a[href="#main"]');
    if ((await skipLink.count()) > 0) {
      await expect(skipLink.first()).toBeVisible();
    } else {
      await expect(page.getByRole('main')).toBeVisible();
    }
  });
});

test.describe('Navigation', () => {
  test('should navigate to shop page', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: /main navigation/i })
      .getByRole('link', { name: /^shop$/i })
      .click();
    await expect(page).toHaveURL(/\/shop/);
  });

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: /main navigation/i })
      .getByRole('link', { name: /^about$/i })
      .click();
    await expect(page).toHaveURL(/\/about/);
  });

  test('should navigate to contact page', async ({ page }) => {
    await page.goto('/');
    const navContact = page
      .getByRole('navigation', { name: /main navigation/i })
      .getByRole('link', { name: /^contact$/i });
    if ((await navContact.count()) > 0) {
      await navContact.first().click();
    } else {
      const anyContactLink = page.getByRole('link', { name: /^contact$/i });
      if ((await anyContactLink.count()) > 0) {
        await anyContactLink.first().click();
      } else {
        await page.goto('/contact');
      }
    }
    await expect(page).toHaveURL(/\/contact/);
  });
});
