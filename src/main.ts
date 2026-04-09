import { getInput, setFailed, getIDToken, info } from '@actions/core';
import { fetchSecret } from './client';
import { setSecretOutput } from './secret';
import { LIB_VERSION } from './version';

const VALID_SECRET_TYPES = ['static', 'dynamic'] as const;
type SecretType = (typeof VALID_SECRET_TYPES)[number];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_PATH_REGEX = /^\/?[a-zA-Z0-9\-_@~*^%]+(\/[a-zA-Z0-9\-_@~*^%]+)*$/;

function isValidSecretType(value: string): value is SecretType {
  return VALID_SECRET_TYPES.includes(value as SecretType);
}

export async function run(): Promise<void> {
  try {
    info(`workload-credentials v${LIB_VERSION}`);

    const apiBaseUrl = getInput('api-base-url') || 'https://api.beyondtrust.io';
    const apiVersion = getInput('api-version') || '2026-02-16';
    const siteId = getInput('site-id', { required: true });
    const secretType = getInput('secret-type', { required: true });
    const secretPath = getInput('secret-path', { required: true });
    const secretKey = getInput('secret-key');

    if (!apiBaseUrl.startsWith('https://')) {
      throw new Error('api-base-url must use HTTPS.');
    }

    if (!UUID_REGEX.test(siteId)) {
      throw new Error(`Invalid site-id: "${siteId}". Must be a valid UUID.`);
    }

    if (!isValidSecretType(secretType)) {
      throw new Error(`Invalid secret-type: "${secretType}". Must be one of: ${VALID_SECRET_TYPES.join(', ')}`);
    }

    if (!SECRET_PATH_REGEX.test(secretPath)) {
      throw new Error(`Invalid secret-path: "${secretPath}". Must match pattern: ${SECRET_PATH_REGEX.source}`);
    }

    info('Requesting OIDC token from GitHub...');
    const oidcToken = await getIDToken(siteId);

    if (!oidcToken) {
      throw new Error('Failed to retrieve OIDC token. Ensure the workflow has "id-token: write" permission.');
    }

    info('Fetching secret from BeyondTrust...');
    const secret = await fetchSecret(oidcToken, apiBaseUrl, apiVersion, siteId, secretType, secretPath);

    if (secretKey) {
      const parsed = JSON.parse(secret) as Record<string, unknown>;
      if (!(secretKey in parsed)) {
        throw new Error(`secret-key "${secretKey}" not found in the secret object.`);
      }
      setSecretOutput('secret', String(parsed[secretKey]));
    } else {
      setSecretOutput('secret', secret);
    }
    info('Secret retrieved successfully.');
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed('An unexpected error occurred');
    }
  }
}
