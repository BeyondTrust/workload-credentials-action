import { HttpClient } from '@actions/http-client';
import { createClient, fetchSecret, parsePath } from '../src/client';

jest.mock('@actions/http-client');

const MockedHttpClient = HttpClient as jest.MockedClass<typeof HttpClient>;

function mockHttpResponse(statusCode: number, body: string) {
  const dispose = jest.fn();
  const response = {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(body),
  };

  MockedHttpClient.prototype.get.mockResolvedValue(response as unknown as Awaited<ReturnType<HttpClient['get']>>);
  MockedHttpClient.prototype.dispose = dispose;
  return { response, dispose };
}

describe('parsePath', () => {
  test('returns name only when no slashes', () => {
    expect(parsePath('password')).toEqual({ folder: '', name: 'password' });
  });

  test('splits folder and name on last slash', () => {
    expect(parsePath('/prod/db/password')).toEqual({
      folder: 'prod/db',
      name: 'password',
    });
  });

  test('handles single level path', () => {
    expect(parsePath('/password')).toEqual({ folder: '', name: 'password' });
  });

  test('splits folder and name without leading slash', () => {
    expect(parsePath('prod/db/password')).toEqual({
      folder: 'prod/db',
      name: 'password',
    });
  });

  test('strips trailing slashes', () => {
    expect(parsePath('/prod/db/password/')).toEqual({
      folder: 'prod/db',
      name: 'password',
    });
  });
});

const API_BASE_URL = 'https://api.beyondtrust.io';
const API_VERSION = '2026-02-16';
const SITE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('fetchSecret', () => {
  let client: HttpClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = createClient('oidc-token', API_VERSION);
  });

  test('returns secret object', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { password: 'my-secret' }, metadata: {} }));

    const result = await fetchSecret(client, API_BASE_URL, SITE_ID, 'db-password');

    expect(result).toEqual({ password: 'my-secret' });
    expect(MockedHttpClient.prototype.get).toHaveBeenCalled();
  });

  test('creates client with bearer token and api version header', () => {
    expect(MockedHttpClient).toHaveBeenCalledWith(
      'beyondtrust-workload-credentials',
      [],
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oidc-token',
          'bt-secrets-api-version': API_VERSION,
        }),
      }),
    );
  });

  test('includes folder query parameter when path has folder', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret(client, API_BASE_URL, SITE_ID, '/prod/db/password');

    const url = MockedHttpClient.prototype.get.mock.calls[0][0];
    expect(url).toContain('/static/password');
    expect(url).toContain('folder=prod%2Fdb');
  });

  test('omits folder query parameter when path has no folder', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret(client, API_BASE_URL, SITE_ID, 'password');

    const url = MockedHttpClient.prototype.get.mock.calls[0][0];
    expect(url).toContain('/static/password');
    expect(url).not.toContain('folder');
  });

  test('includes site-id in URL', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: { k: 'v' } }));

    await fetchSecret(client, API_BASE_URL, SITE_ID, 'secret');

    const url = MockedHttpClient.prototype.get.mock.calls[0][0];
    expect(url).toContain(`/site/${SITE_ID}/`);
  });

  test('throws on non-success status code', async () => {
    mockHttpResponse(401, 'Unauthorized');

    await expect(fetchSecret(client, API_BASE_URL, SITE_ID, 'path')).rejects.toThrow(
      'BeyondTrust API returned HTTP 401',
    );
  });

  test('throws on invalid JSON response', async () => {
    mockHttpResponse(200, 'not json');

    await expect(fetchSecret(client, API_BASE_URL, SITE_ID, 'path')).rejects.toThrow(
      'BeyondTrust API returned an invalid JSON response',
    );
  });

  test('throws when response is missing secret field', async () => {
    mockHttpResponse(200, JSON.stringify({ other: 'data' }));

    await expect(fetchSecret(client, API_BASE_URL, SITE_ID, 'path')).rejects.toThrow(
      'BeyondTrust API response did not contain a secret value',
    );
  });

  test('throws when secret field is an array', async () => {
    mockHttpResponse(200, JSON.stringify({ secret: [1, 2, 3] }));

    await expect(fetchSecret(client, API_BASE_URL, SITE_ID, 'path')).rejects.toThrow(
      'BeyondTrust API response did not contain a secret value',
    );
  });
});
