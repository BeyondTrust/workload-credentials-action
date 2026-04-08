import { getInput } from '@actions/core';
import { setSecretOutput } from './secret';
import { LIB_VERSION } from './version';

function run(): void {
  const message = getInput('message');
  setSecretOutput('secretMessage', message);
  console.log(`VERSION: ${LIB_VERSION}`);
}

run();
