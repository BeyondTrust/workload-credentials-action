import { setOutput, setSecret, exportVariable } from '@actions/core';

export function setSecretOutput(name: string, value: string, envName?: string): void {
  setSecret(value);
  setOutput(name, value);
  if (envName) {
    exportVariable(envName, value);
  }
}
