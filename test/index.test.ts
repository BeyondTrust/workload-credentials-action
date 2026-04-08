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
      'site-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'secret-type': 'static',
      'secret-path': 'path/to/secret',
    });
    mockedCore.getIDToken.mockResolvedValue('oidc-token');
    mockedClient.fetchSecret.mockResolvedValue('the-secret');

    await run();

    expect(mockedCore.getIDToken).toHaveBeenCalled();
    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      'oidc-token',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'static',
      'path/to/secret'
    );
    expect(mockedSecret.setSecretOutput).toHaveBeenCalledWith(
      'secret',
      'the-secret'
    );
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('rejects invalid site-id', async () => {
    setupInputs({
      'site-id': 'not-a-uuid',
      'secret-type': 'static',
      'secret-path': 'path',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid site-id: "not-a-uuid"')
    );
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('rejects invalid secret-type', async () => {
    setupInputs({
      'site-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'secret-type': 'invalid',
      'secret-path': 'path',
    });

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid secret-type: "invalid"')
    );
    expect(mockedCore.getIDToken).not.toHaveBeenCalled();
  });

  test('accepts dynamic secret-type', async () => {
    setupInputs({
      'site-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'secret-type': 'dynamic',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockResolvedValue('value');

    await run();

    expect(mockedClient.fetchSecret).toHaveBeenCalledWith(
      'token',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'dynamic',
      'path'
    );
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  test('calls setFailed when the API client throws', async () => {
    setupInputs({
      'site-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'secret-type': 'static',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockResolvedValue('token');
    mockedClient.fetchSecret.mockRejectedValue(
      new Error('BeyondTrust API returned HTTP 500')
    );

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'BeyondTrust API returned HTTP 500'
    );
  });

  test('calls setFailed when OIDC token request fails', async () => {
    setupInputs({
      'site-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'secret-type': 'static',
      'secret-path': 'path',
    });
    mockedCore.getIDToken.mockRejectedValue(
      new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL')
    );

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'Unable to get ACTIONS_ID_TOKEN_REQUEST_URL'
    );
    expect(mockedClient.fetchSecret).not.toHaveBeenCalled();
  });
});
