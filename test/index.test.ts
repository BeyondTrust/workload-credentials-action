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
  // Scenario 1: no key, no output-name
  test('parses entry without key or output-name', () => {
    const input = '- path: "prod/app"';
    expect(parseSecretInput(input)).toEqual([{ path: 'prod/app', prefix: '', alias: '', exportToEnv: false }]);
  });

  // Scenario 2: no key, output-name with prefix
  test('parses entry without key with prefix output-name', () => {
    const input = '- path: "prod/app"\n  output-name: "my_app_*"';
    expect(parseSecretInput(input)).toEqual([{ path: 'prod/app', prefix: 'my_app_', alias: '', exportToEnv: false }]);
  });

  // Scenario 3: no key, output-name without * (error)
  test('throws when output-name without * is used without key', () => {
    expect(() => parseSecretInput('- path: "prod/app"\n  output-name: "DB_PASSWORD"')).toThrow(
      'Secret entry 1: "output-name" must end with "*" when "key" is not specified.',
    );
  });

  // Scenario 4: key, no output-name
  test('parses entry with key only', () => {
    const input = '- path: "prod/app"\n  key: "field1"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'field1', prefix: '', alias: '', exportToEnv: false },
    ]);
  });

  // Scenario 5: key, output-name alias
  test('parses entry with key and alias output-name', () => {
    const input = '- path: "prod/app"\n  key: "field1"\n  output-name: "DB_PASSWORD"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'field1', prefix: '', alias: 'DB_PASSWORD', exportToEnv: false },
    ]);
  });

  // Scenario 6: key, output-name prefix
  test('parses entry with key and prefix output-name', () => {
    const input = '- path: "prod/app"\n  key: "field1"\n  output-name: "my_app_*"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'field1', prefix: 'my_app_', alias: '', exportToEnv: false },
    ]);
  });

  test('parses entry with export-to-env', () => {
    const input = '- path: "prod/app"\n  key: "password"\n  export-to-env: true';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'password', prefix: '', alias: '', exportToEnv: true },
    ]);
  });

  test('parses multiple entries', () => {
    const input = `- path: "prod/app"
  key: "connectionString"
  output-name: "DATABASE_URL"
- path: "prod/app"
  key: "apiKey"`;
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'connectionString', prefix: '', alias: 'DATABASE_URL', exportToEnv: false },
      { path: 'prod/app', key: 'apiKey', prefix: '', alias: '', exportToEnv: false },
    ]);
  });

  test('throws when input is not a YAML list', () => {
    expect(() => parseSecretInput('not a list')).toThrow('secrets must be a YAML list.');
  });

  test('throws when path is missing', () => {
    expect(() => parseSecretInput('- key: "password"')).toThrow('Secret entry 1: "path" is required.');
  });

  test('throws when key is not a string', () => {
    expect(() => parseSecretInput('- path: "prod/app"\n  key: 123')).toThrow('Secret entry 1: "key" must be a string.');
  });

  test('throws on invalid path', () => {
    expect(() => parseSecretInput('- path: "invalid!path"\n  key: "k"')).toThrow('Secret entry 1: invalid path');
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

  test('throws when output-name contains a newline (alias mode)', () => {
    const input = '- path: "prod/app"\n  key: "field"\n  output-name: "harmless\\nINJECTED<<EOF\\nattacker\\nEOF"';
    expect(() => parseSecretInput(input)).toThrow(/"output-name".*contains invalid characters/);
  });

  test('throws when output-name contains a newline (prefix mode)', () => {
    const input = '- path: "prod/app"\n  output-name: "pre\\nfix_*"';
    expect(() => parseSecretInput(input)).toThrow(/"output-name".*contains invalid characters/);
  });

  test('throws when output-name contains an equals sign', () => {
    const input = '- path: "prod/app"\n  key: "field"\n  output-name: "name=evil"';
    expect(() => parseSecretInput(input)).toThrow(/"output-name".*contains invalid characters/);
  });

  test('throws when key contains a newline', () => {
    const input = '- path: "prod/app"\n  key: "field\\nINJECTED"';
    expect(() => parseSecretInput(input)).toThrow(/"key".*contains invalid characters/);
  });

  test('accepts output-name with allowed punctuation', () => {
    const input = '- path: "prod/app"\n  key: "field"\n  output-name: "my.app-name_1"';
    expect(parseSecretInput(input)).toEqual([
      { path: 'prod/app', key: 'field', prefix: '', alias: 'my.app-name_1', exportToEnv: false },
    ]);
  });

  test('accepts bare "*" as prefix mode with empty prefix', () => {
    const input = '- path: "prod/app"\n  output-name: "*"';
    expect(parseSecretInput(input)).toEqual([{ path: 'prod/app', prefix: '', alias: '', exportToEnv: false }]);
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
    mockedClient.createClient.mockReturnValue({ client: { dispose: jest.fn() }, headers: {} } as never);
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

  // Scenario 1: no key, no output-name → export all fields
  test('exports all fields when key is omitted', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a', field2: 'b' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('field1', 'a', undefined);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('field2', 'b', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  // Scenario 2: no key, output-name prefix → export all fields prefixed
  test('exports all fields with prefix', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  output-name: "my_app_*"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a', field2: 'b' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_field1', 'a', undefined);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_field2', 'b', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  // Scenario 4: key, no output-name → single field
  test('exports single field by key', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "field1"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a', field2: 'b' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledTimes(1);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('field1', 'a', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  // Scenario 5: key, output-name alias → single field aliased
  test('exports single field with alias', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "field1"\n  output-name: "DB_PASSWORD"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('DB_PASSWORD', 'a', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  // Scenario 6: key, output-name prefix → single field prefixed
  test('exports single field with prefix', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "field1"\n  output-name: "my_app_*"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_field1', 'a', undefined);
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  // Scenario 7: key not found → error
  test('rejects when key is not found in secret object', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "missing"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a', field2: 'b' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Key "missing" not found in secret at "prod/app".');
  });

  // export-to-env tests
  test('exports to env when export-to-env is true', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "password"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ password: 'secret' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('password', 'secret', 'PASSWORD');
  });

  test('exports all fields to env with prefix', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  output-name: "my_app_*"\n  export-to-env: true'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ apiKey: 'sk-123' });

    await run();

    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('my_app_apiKey', 'sk-123', 'MY_APP_APIKEY');
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

  // Caching
  test('fetches same path only once', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"\n  key: "field1"', 'path: "prod/app"\n  key: "field2"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ field1: 'a', field2: 'b' });

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledTimes(1);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('field1', 'a', undefined);
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith('field2', 'b', undefined);
  });

  // Serialization
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

  // Duplicate detection
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

  test('rejects API-supplied field name with newline before any output is set', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue({ 'evil\nINJECTED': 'value' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringMatching(/contains invalid characters/));
    expect(mockedSecret.setSecretOutput).not.toHaveBeenCalled();
  });

  test('rejects all-fields collision with explicit entry', async () => {
    setupInputs({
      'site-id': SITE_ID,
      'static-secrets': yamlSecrets('path: "prod/app"', 'path: "prod/other"\n  key: "field1"'),
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret
      .mockResolvedValueOnce({ field1: 'from-app' })
      .mockResolvedValueOnce({ field1: 'from-other' });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Duplicate output name "field1". Each output must be unique.');
    expect(mockedSecret.setSecretOutput).not.toHaveBeenCalled();
  });

  // Validation
  test('rejects invalid site-id', async () => {
    setupInputs({
      'site-id': 'not-a-uuid',
      'static-secrets': yamlSecrets('path: "path"\n  key: "key"'),
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Invalid site-id. Must be a valid UUID.');
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
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
