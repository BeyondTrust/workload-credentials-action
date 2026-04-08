import { getInput, setFailed, getIDToken, info } from '@actions/core';
import { fetchSecret } from './client';
import { setSecretOutput } from './secret';
import { LIB_VERSION } from './version';

const VALID_SECRET_TYPES = ['static', 'dynamic'] as const;
type SecretType = (typeof VALID_SECRET_TYPES)[number];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSecretType(value: string): value is SecretType {
  return VALID_SECRET_TYPES.includes(value as SecretType);
}

export async function run(): Promise<void> {
  try {
    info(`workload-credentials v${LIB_VERSION}`);

    const siteId = getInput('site-id', { required: true });
    const secretType = getInput('secret-type', { required: true });
    const secretPath = getInput('secret-path', { required: true });

    if (!UUID_REGEX.test(siteId)) {
      throw new Error(
        `Invalid site-id: "${siteId}". Must be a valid UUID.`
      );
    }

    if (!isValidSecretType(secretType)) {
      throw new Error(
        `Invalid secret-type: "${secretType}". Must be one of: ${VALID_SECRET_TYPES.join(', ')}`
      );
    }

    info('Requesting OIDC token from GitHub...');
    const oidcToken = await getIDToken();

    info('Fetching secret from BeyondTrust...');
    const secret = await fetchSecret(oidcToken, siteId, secretType, secretPath);

    setSecretOutput('secret', secret);
    info('Secret retrieved successfully.');
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed('An unexpected error occurred');
    }
  }
}
