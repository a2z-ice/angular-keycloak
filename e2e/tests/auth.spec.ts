import { test, expect } from '@playwright/test';
import { loginToKeycloak, logout } from '../helpers/login';

test.describe('Authentication Flow', () => {
  test('should show login button on home page when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button.btn-login')).toBeVisible();
    await expect(page.locator('button.btn-logout')).not.toBeVisible();
  });

  test('should redirect to Keycloak when clicking login', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await page.waitForURL(/idp\.keycloak\.net/, { timeout: 15000 });
    await expect(page.locator('#username')).toBeVisible();
  });

  test('should redirect to Keycloak when accessing protected route unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/idp\.keycloak\.net/, { timeout: 15000 });
    await expect(page.locator('#username')).toBeVisible();
  });

  test('user1 can login and is authenticated', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'user1', 'user1');
    // After login, user should be authenticated (logout visible)
    await expect(page.locator('button.btn-logout')).toBeVisible();
    // Navigate to dashboard
    await page.click('a[href="/dashboard"]');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('admin1 can login and is authenticated', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'admin1', 'admin1');
    await expect(page.locator('button.btn-logout')).toBeVisible();
    await page.click('a[href="/dashboard"]');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('logout clears session', async ({ page }) => {
    await page.goto('/');
    await page.click('button.btn-login');
    await loginToKeycloak(page, 'user1', 'user1');
    await expect(page.locator('button.btn-logout')).toBeVisible();
    await logout(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.locator('button.btn-login')).toBeVisible({ timeout: 15000 });
  });
});
