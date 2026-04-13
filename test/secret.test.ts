import * as core from '@actions/core';
import { setSecretOutput } from '../src/secret';

describe('setSecretOutput', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('masks the value and sets the output', () => {
    const setSecretSpy = jest.spyOn(core, 'setSecret').mockImplementation();
    const setOutputSpy = jest.spyOn(core, 'setOutput').mockImplementation();
    const exportVariableSpy = jest.spyOn(core, 'exportVariable').mockImplementation();

    setSecretOutput('connectionString', 'super-secret-value');

    expect(setSecretSpy).toHaveBeenCalledWith('super-secret-value');
    expect(setOutputSpy).toHaveBeenCalledWith('connectionString', 'super-secret-value');
    expect(exportVariableSpy).not.toHaveBeenCalled();
  });

  test('exports to env var when envName is provided', () => {
    const setSecretSpy = jest.spyOn(core, 'setSecret').mockImplementation();
    const setOutputSpy = jest.spyOn(core, 'setOutput').mockImplementation();
    const exportVariableSpy = jest.spyOn(core, 'exportVariable').mockImplementation();

    setSecretOutput('connectionString', 'super-secret-value', 'CONNECTION_STRING');

    expect(setSecretSpy).toHaveBeenCalledWith('super-secret-value');
    expect(setOutputSpy).toHaveBeenCalledWith('connectionString', 'super-secret-value');
    expect(exportVariableSpy).toHaveBeenCalledWith('CONNECTION_STRING', 'super-secret-value');
  });
});
