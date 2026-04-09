import * as core from '@actions/core';
import * as client from '../src/client';
import * as secret from '../src/secret';
import { run } from '../src/main';

jest.mock('@actions/core');
jest.mock('../src/client');
jest.mock('../src/secret');

const mockedCore = core as jest.Mocked<typeof core>;
const mockedClient = client as jest.Mocked<typeof client>;
const mockedSecret = secret as jest.Mocked<typeof secret>;

const API_BASE_URL = 'https://api.beyondtrust.io';
const API_VERSION = '2026-02-16';
const SITE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('run', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCore.info.mockImplementation();
    mockedCore.setFailed.mockImplementation();
    mockedSecret.setSecretOutput.mockImplementation();
  });

  function setupInputs(inputs: Record<string, string>) {
    mockedCore.getInput.mockImplementation((name: string) => {
      return inputs[name] ?? '';
    });
  }

  test('fetches a secret and sets it as output', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path/to/secret',
    });
    mockedCore.getIDToken.mockResolvedValue('oidc-token');
    mockedClient.fetchSecret.mockResolvedValue('the-secret');

    await run();

    expect(mockedCore.getIDToken).toHaveBeenCalledWith(SITE_ID);
    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      'oidc-token',
      API_BASE_URL,
      API_VERSION,
      SITE_ID,
      'static',
      'path/to/secret',
    );
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('secret', 'the-secret');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('rejects non-HTTPS api-base-url', async () => {
    setupInputs({
      'api-base-url': 'http://insecure.example.com',
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('api-base-url must use HTTPS.');
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects invalid site-id', async () => {
    setupInputs({
      'site-id': 'not-a-uuid',
      'secret-type': 'static',
      'secret-path': 'path',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid site-id: "not-a-uuid"'));
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects invalid secret-type', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'invalid',
      'secret-path': 'path',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid secret-type: "invalid"'));
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test.each(['', '   ', 'trailing/', 'has spaces', 'special!char'])(
    'rejects invalid secret-path: "%s"',
    async (invalidPath) => {
      setupInputs({
        'site-id': SITE_ID,
        'secret-type': 'static',
        'secret-path': invalidPath,
      });

      await run();

      expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid secret-path'));
      expect(mockedCore.getIDToken).not.toHaveBeenCalled();
    },
  );

  test('accepts dynamic secret-type', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'dynamic',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue('value');

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      'token',
      API_BASE_URL,
      API_VERSION,
      SITE_ID,
      'dynamic',
      'path',
    );
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('extracts a single value when secret-key is provided', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path',
      'secret-key': 'password',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue(JSON.stringify({ password: 'my-secret', username: 'admin' }));

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('secret', 'my-secret');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('rejects when secret-key is not found in secret object', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path',
      'secret-key': 'missing',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue(JSON.stringify({ password: 'my-secret' }));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('secret-key "missing" not found in the secret object.');
  });

  test('calls setFailed when the API client throws', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockRejectedValue(new Error('BeyondTrust API returned HTTP 500'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('BeyondTrust API returned HTTP 500');
  });

  test('rejects empty OIDC token', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockResolvedValue('');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to retrieve OIDC token'));
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });

  test('calls setFailed when OIDC token request fails', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'secret-type': 'static',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockRejectedValue(new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL');
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });
});
