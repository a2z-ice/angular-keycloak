import { test, expect } from '@playwright/test';
import { loginToKeycloak } from '../helpers/login';

test.describe('User Role Authorization', () => {
  test('user1 can access user pages via navigation', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'user1', 'user1');

    // Navigate to dashboard
    await page.click('a[href="/dashboard"]');
    await expect(page.locator('h1')).toContainText('Dashboard');

    // Navigate to profile
    await page.click('a[href="/profile"]');
    await expect(page.locator('h1')).toContainText('Profile');

    // Navigate to products
    await page.click('a[href="/products"]');
    await expect(page.locator('h1')).toContainText('Products');
  });

  test('user1 sees Access Denied on admin pages', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'user1', 'user1');

    await page.goto('/admin-panel');
    await expect(page.locator('h1')).toContainText('Access Denied', { timeout: 10000 });

    await page.goto('/user-management');
    await expect(page.locator('h1')).toContainText('Access Denied', { timeout: 10000 });

    await page.goto('/settings');
    await expect(page.locator('h1')).toContainText('Access Denied', { timeout: 10000 });
  });

  test('user1 nav does not show admin links', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'user1', 'user1');

    await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
    await expect(page.locator('a[href="/profile"]')).toBeVisible();
    await expect(page.locator('a[href="/products"]')).toBeVisible();
    await expect(page.locator('a[href="/admin-panel"]')).not.toBeVisible();
    await expect(page.locator('a[href="/user-management"]')).not.toBeVisible();
    await expect(page.locator('a[href="/settings"]')).not.toBeVisible();
  });
});
