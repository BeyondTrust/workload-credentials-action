import * as core from '@actions/core';
import * as client from '../src/client';
import * as secret from '../src/secret';
import { run, parseSecretInput, toEnvName } from '../src/main';

jest.mock('@actions/core');
jest.mock('../src/client');
jest.mock('../src/secret');

const mockedCore = core as jest.Mocked<typeof core>;
const mockedClient = client as jest.Mocked<typeof client>;
const mockedSecret = secret as jest.Mocked<typeof secret>;

const SITE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('parseSecretInput', () => {
  test('parses a single entry', () => {
    const input = '- path: "prod/app"\n  key: "password"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'password', outputName: 'password', exportToEnv: false, prefix: '' },
    ]);
  });

  test('parses entry with output-name and export-to-env', () => {
    const input = '- path: "prod/app"\n  key: "password"\n  output-name: "DB_PASSWORD"\n  export-to-env: true';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'password', outputName: 'DB_PASSWORD', exportToEnv: true, prefix: '' },
    ]);
  });

  test('parses multiple entries', () => {
    const input = `- path: "prod/app"
  key: "connectionString"
  output-name: "DATABASE_URL"
- path: "prod/app"
  key: "apiKey"`;
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'connectionString', outputName: 'DATABASE_URL', exportToEnv: false, prefix: '' },
      { path: 'prod/app', key: 'apiKey', outputName: 'apiKey', exportToEnv: false, prefix: '' },
    ]);
  });

  test('parses wildcard entry', () => {
    const input = '- path: "prod/app"\n  key: "*"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: '*', outputName: '*', exportToEnv: false, prefix: '' },
    ]);
  });

  test('throws when input is not a YAML list', () => {
    expect(() => parseSecretInput('not a list')).toThrow('secrets must be a YAML list.');
  });

  test('throws when path is missing', () => {
    expect(() => parseSecretInput('- key: "password"')).toThrow('Secret entry 1: "path" is required.');
  });

  test('throws when key is missing', () => {
    expect(() => parseSecretInput('- path: "prod/app"')).toThrow('Secret entry 1: "key" is required.');
  });

  test('throws on invalid path', () => {
    expect(() => parseSecretInput('- path: "invalid!path"\n  key: "k"')).toThrow('Secret entry 1: invalid path');
  });

  test('throws when path is a wildcard', () => {
    expect(() => parseSecretInput('- path: "*"\n  key: "k"')).toThrow('Secret entry 1: invalid path');
  });

  test('throws when entry is not an object', () => {
    expect(() => parseSecretInput('- "just a string"')).toThrow('Secret entry 1: must be an object.');
  });

  test('throws when output-name is not a string', () => {
    expect(() => parseSecretInput('- path: "prod/app"\n  key: "k"\n  output-name: 123')).toThrow(
      'Secret entry 1: "output-name" must be a string.',
    );
  });

  test('throws when export-to-env is not a boolean', () => {
    expect(() => parseSecretInput('- path: "prod/app"\n  key: "k"\n  export-to-env: "yes"')).toThrow(
      'Secret entry 1: "export-to-env" must be true or false.',
    );
  });

  test('returns empty array for empty YAML list', () => {
    expect(parseSecretInput('[]')).toEqual([]);
  });

  test('throws when output-name without trailing * is used with wildcard key', () => {
    expect(() => parseSecretInput('- path: "prod/app"\n  key: "*"\n  output-name: "ALIAS"')).toThrow(
      'Secret entry 1: "output-name" must end with "*" when used with wildcard key.',
    );
  });

  test('parses wildcard with prefix', () => {
    const input = '- path: "prod/app"\n  key: "*"\n  output-name: "my_app_*"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: '*', outputName: 'my_app_*', prefix: 'my_app_', exportToEnv: false },
    ]);
  });
});

describe('toEnvName', () => {
  test('uppercases and returns valid name', () => {
    expect(toEnvName('apiKey')).toBe('APIKEY');
  });

  test('replaces hyphens with underscores', () => {
    expect(toEnvName('my-api-key')).toBe('MY_API_KEY');
  });

  test('handles prefix with hyphens', () => {
    expect(toEnvName('my_app_db-host')).toBe('MY_APP_DB_HOST');
  });

  test('throws on invalid characters', () => {
    expect(() => toEnvName('my.key')).toThrow('Cannot convert "my.key" to a valid environment variable name');
  });

  test('throws on name starting with a number', () => {
    expect(() => toEnvName('1key')).toThrow('Cannot convert "1key" to a valid environment variable name');
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

  const DEFAULT_INPUTS: Record<string, string> = {
    'api-version': '2026-02-16',
  };

  function setupInputs(inputs: Record<string, string>) {
    mockedCore.getInput.mockImplementation((name: string) => {
      return inputs[name] ?? DEFAULT_INPUTS[name] ?? '';
    });
  }

  function yamlSecrets(...entries: string[]): string {
    return entries.map((e) => `- ${e}`).join('\n');
  }

  test('fetches a secret and sets output by key', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/db/creds"\n  key: "userName"'),
    });
    mockedCore.getIDToken.mockResolvedValue('oidc-token');
    mockedClient.fetchSecret.mockResolvedValue({ userName: 'admin', password: 'secret' });

    await run();

    expect(mockedCore.getIDToken).toHaveBeenCalledWith(SITE_ID);
    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      SITE_ID,
      'prod/db/creds',
    );
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('userName', 'admin', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('uses output-name when provided', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/db/creds"\n  key: "userName"\n  output-name: "DB_USERNAME"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ userName: 'admin' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('DB_USERNAME', 'admin', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('exports to env when export-to-env is true', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/db/creds"\n  key: "password"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ password: 'secret' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('password', 'secret', 'PASSWORD');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('fetches same path only once when extracting multiple keys', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets(
        'path: "prod/db/creds"\n  key: "userName"',
        'path: "prod/db/creds"\n  key: "password"',
      ),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ userName: 'admin', password: 'secret' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledTimes(1);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('userName', 'admin', undefined);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('password', 'secret', undefined);
  });

  test('wildcard exports all keys from secret', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "*"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ connectionString: 'postgres://...', apiKey: 'sk-123' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledTimes(1);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('connectionString', 'postgres://...', undefined);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('apiKey', 'sk-123', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('wildcard with export-to-env exports all keys', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "*"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ connectionString: 'postgres://...', apiKey: 'sk-123' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('connectionString', 'postgres://...', 'CONNECTIONSTRING');
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('apiKey', 'sk-123', 'APIKEY');
  });

  test('wildcard with prefix adds prefix to output names', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "*"\n  output-name: "my_app_*"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ apiKey: 'sk-123', dbHost: 'localhost' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_apiKey', 'sk-123', undefined);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_dbHost', 'localhost', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('wildcard with prefix and export-to-env uppercases the prefixed name', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "*"\n  output-name: "my_app_*"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ apiKey: 'sk-123' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_apiKey', 'sk-123', 'MY_APP_APIKEY');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('serializes nested objects as JSON', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "config"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ config: { host: 'localhost', port: 5432 } });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith(
      'config',
      JSON.stringify({ host: 'localhost', port: 5432 }),
      undefined,
    );
  });

  test('serializes null value as empty string', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "token"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ token: null });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('token', '', undefined);
  });

  test('serializes array value as JSON', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "hosts"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ hosts: ['a', 'b'] });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('hosts', JSON.stringify(['a', 'b']), undefined);
  });

  test('converts hyphens to underscores in env var name', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "api-key"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ 'api-key': 'sk-123' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('api-key', 'sk-123', 'API_KEY');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('rejects invalid env var name when export-to-env is true', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "my.key"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ 'my.key': 'value' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Cannot convert "my.key"'));
    expect(mockedSecret.setSecretOutput).not.toHaveBeenCalled();
  });

  test('rejects invalid site-id', async () => {
    setupInputs({
      'site-id': 'not-a-uuid',
      'static-secrets': yamlSecrets('path: "path"\n  key: "key"'),
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Invalid site-id. Must be a valid UUID.');
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects duplicate output names', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets(
        'path: "prod/db"\n  key: "password"\n  output-name: "DB_PASS"',
        'path: "prod/redis"\n  key: "password"\n  output-name: "DB_PASS"',
      ),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ password: 'secret' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Duplicate output name "DB_PASS". Each output must be unique.');
    expect(mockedSecret.setSecretOutput).not.toHaveBeenCalled();
  });

  test('rejects wildcard collision with explicit entry', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "*"', 'path: "prod/other"\n  key: "password"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret
      .mockResolvedValueOnce({ password: 'from-app', apiKey: 'sk-123' })
      .mockResolvedValueOnce({ password: 'from-other' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Duplicate output name "password". Each output must be unique.');
    expect(mockedSecret.setSecretOutput).not.toHaveBeenCalled();
  });

  test('rejects when key is not found in secret object', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/db/creds"\n  key: "missing"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ password: 'secret' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Key "missing" not found in secret at "prod/db/creds".');
  });

  test('rejects empty OIDC token', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "path"\n  key: "key"'),
    });
    mockedCore.getIDToken.mockResolvedValue('');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to retrieve OIDC token'));
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });

  test('calls setFailed when OIDC token request fails', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "path"\n  key: "key"'),
    });
    mockedCore.getIDToken.mockRejectedValue(new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL');
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });

  test('calls setFailed when the API client throws', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "path"\n  key: "key"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockRejectedValue(new Error('BeyondTrust API returned HTTP 500'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('BeyondTrust API returned HTTP 500');
  });
});
