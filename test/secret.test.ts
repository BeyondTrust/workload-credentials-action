import * as core from '@actions/core';
import { setSecretOutput } from '../src/secret';

describe('setSecretOutput', () => {
  let setSecretSpy: jest.SpyInstance;
  let setOutputSpy: jest.SpyInstance;
  let exportVariableSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    setSecretSpy = jest.spyOn(core, 'setSecret').mockImplementation();
    setOutputSpy = jest.spyOn(core, 'setOutput').mockImplementation();
    exportVariableSpy = jest.spyOn(core, 'exportVariable').mockImplementation();
  });

  test('masks the value and sets the output', () => {
    setSecretOutput('connectionString', 'super-secret-value');

    expect(setSecretSpy).toHaveBeenCalledWith('super-secret-value');
    expect(setOutputSpy).toHaveBeenCalledWith('connectionString', 'super-secret-value');
    expect(exportVariableSpy).not.toHaveBeenCalled();
  });

  test('exports to env var when envName is provided', () => {
    setSecretOutput('connectionString', 'super-secret-value', 'CONNECTION_STRING');

    expect(setSecretSpy).toHaveBeenCalledWith('super-secret-value');
    expect(setOutputSpy).toHaveBeenCalledWith('connectionString', 'super-secret-value');
    expect(exportVariableSpy).toHaveBeenCalledWith('CONNECTION_STRING', 'super-secret-value');
  });
});
