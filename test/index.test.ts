import * as core from '@actions/core';
import * as client from '../src/client';
import * as secret from '../src/secret';
import { run, parseSecretInput } from '../src/main';

jest.mock('@actions/core');
jest.mock('../src/client');
jest.mock('../src/secret');

const mockedCore = core as jest.Mocked<typeof core>;
const mockedClient = client as jest.Mocked<typeof client>;
const mockedSecret = secret as jest.Mocked<typeof secret>;

const API_BASE_URL = 'https://api.beyondtrust.io';
const SITE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('parseSecretInput', () => {
  test('parses a single entry with key as output name', () => {
    expect(parseSecretInput('prod/db/password userName', 'static')).toEqual([
      { secretType: 'static', path: 'prod/db/password', key: 'userName', outputName: 'userName' },
    ]);
  });

  test('parses entry with alias', () => {
    expect(parseSecretInput('prod/db/password userName | DB_USERNAME', 'static')).toEqual([
      { secretType: 'static', path: 'prod/db/password', key: 'userName', outputName: 'DB_USERNAME' },
    ]);
  });

  test('parses multiple lines with and without aliases', () => {
    const input = `prod/db/password userName | DB_USERNAME
prod/db/connection host`;
    expect(parseSecretInput(input, 'static')).toEqual([
      { secretType: 'static', path: 'prod/db/password', key: 'userName', outputName: 'DB_USERNAME' },
      { secretType: 'static', path: 'prod/db/connection', key: 'host', outputName: 'host' },
    ]);
  });

  test('ignores empty lines', () => {
    const input = `
prod/db/password userName

prod/db/connection host
`;
    expect(parseSecretInput(input, 'dynamic')).toEqual([
      { secretType: 'dynamic', path: 'prod/db/password', key: 'userName', outputName: 'userName' },
      { secretType: 'dynamic', path: 'prod/db/connection', key: 'host', outputName: 'host' },
    ]);
  });

  test('throws on entry with only a path', () => {
    expect(() => parseSecretInput('prod/db/password', 'static')).toThrow('Invalid static secret entry');
  });

  test('throws on entry with too many parts', () => {
    expect(() => parseSecretInput('prod/db/password key extra', 'static')).toThrow('Invalid static secret entry');
  });

  test('throws on invalid path', () => {
    expect(() => parseSecretInput('invalid!path key', 'static')).toThrow('Invalid secret path');
  });

  test('throws when path is a wildcard', () => {
    expect(() => parseSecretInput('* key', 'static')).toThrow('Invalid secret path');
  });

  test('parses wildcard entry', () => {
    expect(parseSecretInput('prod/app *', 'static')).toEqual([
      { secretType: 'static', path: 'prod/app', key: '*', outputName: '*' },
    ]);
  });

  test('throws when alias is used with wildcard', () => {
    expect(() => parseSecretInput('prod/app * | ALIAS', 'static')).toThrow('Alias is not supported with wildcard (*)');
  });
});

describe('run', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCore.info.mockImplementation();
    mockedCore.setFailed.mockImplementation();
    mockedSecret.setSecretOutput.mockImplementation();
    mockedClient.createClient.mockReturnValue({ dispose: jest.fn() } as never);
  });

  function setupInputs(inputs: Record<string, string>) {
    mockedCore.getInput.mockImplementation((name: string) => {
      return inputs[name] ?? '';
    });
  }

  test('fetches a static secret and sets output by key', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'prod/db/creds userName',
    });
    mockedCore.getIDToken.mockResolvedValue('oidc-token');
    mockedClient.fetchSecret.mockResolvedValue({ userName: 'admin', password: 'secret' });

    await run();

    expect(mockedCore.getIDToken).toHaveBeenCalledWith(SITE_ID);
    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      expect.anything(),
      API_BASE_URL,
      SITE_ID,
      'static',
      'prod/db/creds',
    );
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('userName', 'USERNAME', 'admin');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('fetches a dynamic secret and sets output by key', async () => {
    setupInputs({
      'site-id': SITE_ID,
      dynamic: 'prod/aws-creds accessKeyId',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ accessKeyId: 'AKIA****' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      expect.anything(),
      API_BASE_URL,
      SITE_ID,
      'dynamic',
      'prod/aws-creds',
    );
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('accessKeyId', 'ACCESSKEYID', 'AKIA****');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('fetches multiple secrets from both static and dynamic', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'prod/db/creds password',
      dynamic: 'prod/aws-creds accessKeyId',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret
      .mockResolvedValueOnce({ password: 'db-pass' })
      .mockResolvedValueOnce({ accessKeyId: 'AKIA****' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledTimes(2);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('password', 'PASSWORD', 'db-pass');
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('accessKeyId', 'ACCESSKEYID', 'AKIA****');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('fetches same path only once when extracting multiple keys', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: `prod/db/creds userName
prod/db/creds password`,
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ userName: 'admin', password: 'secret' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledTimes(1);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('userName', 'USERNAME', 'admin');
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('password', 'PASSWORD', 'secret');
  });

  test('uses alias as output name when provided', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'prod/db/creds userName | DB_USERNAME',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ userName: 'admin' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('DB_USERNAME', 'DB_USERNAME', 'admin');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('wildcard exports all keys from secret', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'prod/app *',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ connectionString: 'postgres://...', apiKey: 'sk-123' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledTimes(1);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('connectionString', 'CONNECTIONSTRING', 'postgres://...');
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('apiKey', 'APIKEY', 'sk-123');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('rejects non-HTTPS api-base-url', async () => {
    setupInputs({
      'api-base-url': 'http://insecure.example.com',
      'site-id': SITE_ID,
      static: 'path key',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('api-base-url must use HTTPS.');
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects invalid site-id', async () => {
    setupInputs({
      'site-id': 'not-a-uuid',
      static: 'path key',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Invalid site-id. Must be a valid UUID.');
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects when no secrets are specified', async () => {
    setupInputs({
      'site-id': SITE_ID,
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('At least one static or dynamic secret must be specified.');
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects when key is not found in secret object', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'prod/db/creds missing',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ password: 'secret' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Key "missing" not found in secret at "prod/db/creds".');
  });

  test('rejects empty OIDC token', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'path key',
    });
    mockedCore.getIDToken.mockResolvedValue('');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to retrieve OIDC token'));
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });

  test('calls setFailed when OIDC token request fails', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'path key',
    });
    mockedCore.getIDToken.mockRejectedValue(new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL');
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });

  test('calls setFailed when the API client throws', async () => {
    setupInputs({
      'site-id': SITE_ID,
      static: 'path key',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockRejectedValue(new Error('BeyondTrust API returned HTTP 500'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('BeyondTrust API returned HTTP 500');
  });
});
