import { setOutput, setSecret, exportVariable } from '@actions/core';

export function setSecretOutput(outputName: string, envName: string, value: string): void {
  setSecret(value);
  setOutput(outputName, value);
  exportVariable(envName, value);
}
