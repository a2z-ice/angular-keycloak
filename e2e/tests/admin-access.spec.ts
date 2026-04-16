import { test, expect } from '@playwright/test';
import { loginToKeycloak } from '../helpers/login';

test.describe('Admin Role Authorization', () => {
  test('admin1 can access all user pages', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'admin1', 'admin1');

    await page.click('a[href="/dashboard"]');
    await expect(page.locator('h1')).toContainText('Dashboard');

    await page.click('a[href="/profile"]');
    await expect(page.locator('h1')).toContainText('Profile');

    await page.click('a[href="/products"]');
    await expect(page.locator('h1')).toContainText('Products');
  });

  test('admin1 can access all admin pages', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'admin1', 'admin1');

    await page.click('a[href="/admin-panel"]');
    await expect(page.locator('h1')).toContainText('Admin Panel');

    await page.click('a[href="/user-management"]');
    await expect(page.locator('h1')).toContainText('User Management');

    await page.click('a[href="/settings"]');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('admin1 sees all menu items in nav', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'admin1', 'admin1');

    await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
    await expect(page.locator('a[href="/profile"]')).toBeVisible();
    await expect(page.locator('a[href="/products"]')).toBeVisible();
    await expect(page.locator('a[href="/admin-panel"]')).toBeVisible();
    await expect(page.locator('a[href="/user-management"]')).toBeVisible();
    await expect(page.locator('a[href="/settings"]')).toBeVisible();
  });
});
