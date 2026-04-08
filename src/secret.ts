import { setOutput, setSecret } from '@actions/core';

export function setSecretOutput(name: string, value: string): void {
  setSecret(value);
  setOutput(name, value);
}
