import { test, expect } from '@playwright/test';

const BASE = 'https://myecom.net:5500';
const KC = 'https://idp.keycloak.net:8443';

async function getToken(request: any, username: string, password: string): Promise<string> {
  const resp = await request.post(
    `${KC}/realms/myecom/protocol/openid-connect/token`,
    {
      form: {
        grant_type: 'password',
        client_id: 'myecom-spa',
        username,
        password,
      },
    }
  );
  const data = await resp.json();
  return data.access_token;
}

test.describe('API Endpoints', () => {
  test('health endpoint is public', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/health`);
    expect(resp.status()).toBe(200);
    expect(await resp.json()).toEqual({ status: 'ok' });
  });

  test('user endpoints return 401 without token', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/user/profile`);
    expect(resp.status()).toBe(401);
  });

  test('admin endpoints return 401 without token', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/admin/users`);
    expect(resp.status()).toBe(401);
  });

  test('user1 can access user endpoints', async ({ request }) => {
    const token = await getToken(request, 'user1', 'user1');

    const profile = await request.get(`${BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(profile.status()).toBe(200);
    const data = await profile.json();
    expect(data.username).toBe('user1');

    const products = await request.get(`${BASE}/api/user/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(products.status()).toBe(200);

    const orders = await request.get(`${BASE}/api/user/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(orders.status()).toBe(200);
  });

  test('user1 gets 403 on admin endpoints', async ({ request }) => {
    const token = await getToken(request, 'user1', 'user1');

    const users = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(users.status()).toBe(403);

    const stats = await request.get(`${BASE}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stats.status()).toBe(403);

    const settings = await request.get(`${BASE}/api/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(settings.status()).toBe(403);
  });

  test('admin1 can access all endpoints', async ({ request }) => {
    const token = await getToken(request, 'admin1', 'admin1');

    const profile = await request.get(`${BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(profile.status()).toBe(200);

    const users = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(users.status()).toBe(200);

    const stats = await request.get(`${BASE}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stats.status()).toBe(200);
    const statsData = await stats.json();
    expect(statsData).toHaveProperty('total_users');
    expect(statsData).toHaveProperty('revenue');

    const settings = await request.get(`${BASE}/api/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(settings.status()).toBe(200);
  });
});
