import { Page, expect } from '@playwright/test';

export async function loginToKeycloak(page: Page, username: string, password: string) {
  // Wait for Keycloak login page to load
  await page.waitForURL(/idp\.keycloak\.net/, { timeout: 15000 });
  await expect(page.locator('#username')).toBeVisible({ timeout: 10000 });

  // Fill credentials
  await page.fill('#username', username);
  await page.fill('#password', password);

  // Submit
  await page.click('#kc-login');

  // Wait for redirect back to app
  await page.waitForURL(/myecom\.net/, { timeout: 15000 });
  // Wait for Angular to fully bootstrap and process auth
  await page.waitForTimeout(1000);
}

export async function logout(page: Page) {
  const logoutButton = page.locator('button.btn-logout');
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
    await page.waitForTimeout(3000);
  }
}
