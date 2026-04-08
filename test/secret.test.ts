import * as core from '@actions/core';
import { setSecretOutput } from '../src/secret';

describe('setSecretOutput', () => {
  test('it should set a secret output', () => {
    jest.spyOn(core, 'setSecret');
    jest.spyOn(core, 'setOutput');

    setSecretOutput('foo', 'bar');

    expect(core.setSecret).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalled();
  });
});
