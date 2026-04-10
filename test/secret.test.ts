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

    setSecretOutput('userName', 'DB_USERNAME', 'super-secret-value');

    expect(setSecretSpy).toHaveBeenCalledWith('super-secret-value');
    expect(setOutputSpy).toHaveBeenCalledWith('userName', 'super-secret-value');
    expect(exportVariableSpy).toHaveBeenCalledWith('DB_USERNAME', 'super-secret-value');
  });
});
