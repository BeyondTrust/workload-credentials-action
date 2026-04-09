import { HttpClient } from '@actions/http-client';
import { fetchSecret, parsePath } from '../src/client';

jest.mock('@actions/http-client');

const MockedHttpClient = HttpClient as jest.MockedClass<typeof HttpClient>;

function mockHttpResponse(statusCode: number, body: string) {
  const dispose = jest.fn();
  const response = {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(body),
  };

  MockedHttpClient.prototype.get.mockResolvedValue(response as unknown as Awaited<ReturnType<HttpClient['get']>>);
  MockedHttpClient.prototype.post.mockResolvedValue(response as unknown as Awaited<ReturnType<HttpClient['post']>>);
  MockedHttpClient.prototype.dispose = dispose;
  return { response, dispose };
}

describe('parsePath', () => {
  test('returns name only when no slashes', () => {
    expect(parsePath('password')).toEqual({ folder: '', name: 'password' });
  });

  test('splits folder and name on last slash', () => {
    expect(parsePath('/prod/db/password')).toEqual({
      folder: '/prod/db',
      name: 'password',
    });
  });

  test('handles single level path', () => {
    expect(parsePath('/password')).toEqual({ folder: '', name: 'password' });
  });

  test('strips trailing slashes', () => {
    expect(parsePath('/prod/db/password/')).toEqual({
      folder: '/prod/db',
      name: 'password',
    });
  });
});

const API_BASE_URL = 'https://api.beyondtrust.io';
const API_VERSION = '2026-02-16';
const SITE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('fetchSecret', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses GET for static secrets and returns JSON-stringified secret', async () => {
    const { dispose } = mockHttpResponse(200, JSON.stringify({ secret: { password: 'my-secret' }, metadata: {} }));

    const result = await fetchSecret('oidc-token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'db-password');

    expect(result).toBe(JSON.stringify({ password: 'my-secret' }));
    expect(MockedHttpClient.prototype.get).toHaveBeenCalled();
    expect(MockedHttpClient.prototype.post).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });

  test('uses POST for dynamic secrets', async () => {
    mockHttpResponse(201, JSON.stringify({ secret: { accessKeyId: 'AKIA****' } }));

    const result = await fetchSecret('oidc-token', API_BASE_URL, API_VERSION, SITE_ID, 'dynamic', 'aws-creds');

    expect(result).toBe(JSON.stringify({ accessKeyId: 'AKIA****' }));
    expect(MockedHttpClient.prototype.post).toHaveBeenCalled();
    expect(MockedHttpClient.prototype.get).not.toHaveBeenCalled();
  });

  test('sends bearer token and api version header', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret('my-oidc-token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'secret');

    expect(MockedHttpClient).toHaveBeenCalledWith(
      'beyondtrust-workload-credentials',
      [],
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-oidc-token',
          'bt-secrets-api-version': API_VERSION,
        }),
      }),
    );
  });

  test('includes folder query parameter when path has folder', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'static', '/prod/db/password');

    const url = MockedHttpClient.prototype.get.mock.calls[0][0];
    expect(url).toContain('/static/password');
    expect(url).toContain('folder=%2Fprod%2Fdb');
  });

  test('omits folder query parameter when path has no folder', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'password');

    const url = MockedHttpClient.prototype.get.mock.calls[0][0];
    expect(url).toContain('/static/password');
    expect(url).not.toContain('folder');
  });

  test('builds correct URL for dynamic generate endpoint', async () => {
    mockHttpResponse(201, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'dynamic', '/prod/aws-creds');

    const url = MockedHttpClient.prototype.post.mock.calls[0][0];
    expect(url).toContain('/dynamic/aws-creds/generate');
    expect(url).toContain('folder=%2Fprod');
  });

  test('includes site-id in URL', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'secret');

    const url = MockedHttpClient.prototype.get.mock.calls[0][0];
    expect(url).toContain(`/site/${SITE_ID}/`);
  });

  test('throws on non-success status code', async () => {
    mockHttpResponse(401, 'Unauthorized');

    await expect(fetchSecret('bad-token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'path')).rejects.toThrow(
      'BeyondTrust API returned HTTP 401',
    );
  });

  test('throws on invalid JSON response', async () => {
    mockHttpResponse(200, 'not json');

    await expect(fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'path')).rejects.toThrow(
      'BeyondTrust API returned an invalid JSON response',
    );
  });

  test('throws when response is missing secret field', async () => {
    mockHttpResponse(200, JSON.stringify({ other: 'data' }));

    await expect(fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'path')).rejects.toThrow(
      'BeyondTrust API response did not contain a secret value',
    );
  });

  test('disposes the HTTP client even on failure', async () => {
    const { dispose } = mockHttpResponse(500, 'Internal Server Error');

    await expect(fetchSecret('token', API_BASE_URL, API_VERSION, SITE_ID, 'static', 'path')).rejects.toThrow();
    expect(dispose).toHaveBeenCalled();
  });
});
