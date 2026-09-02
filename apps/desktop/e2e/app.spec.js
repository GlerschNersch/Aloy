import { test, expect } from '@playwright/test';

test.describe('Aloy Web Application E2E Tests', () => {
  test('should load the main dashboard with title and sidebar', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/Aloy/i);

    // Check that sidebar brand header is visible. Scoped to the sidebar's
    // <h2> specifically — a bare text locator is ambiguous now that the
    // chat welcome message ("How can Aloy assist you?") also contains
    // "Aloy" and is visible on the same initial load.
    const brand = page.locator('h2').getByText('Aloy', { exact: true });
    await expect(brand).toBeVisible();
  });

  test('should allow typing in the chat input area', async ({ page }) => {
    await page.goto('/');

    const chatInput = page.locator('textarea, input[type="text"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.fill('Hello AI assistant!');
    await expect(chatInput).toHaveValue('Hello AI assistant!');
  });
});
