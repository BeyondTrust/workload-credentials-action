import { getInput, setFailed, getIDToken, info } from '@actions/core';
import { createClient, fetchSecret } from './client';
import { setSecretOutput } from './secret';
import { LIB_VERSION } from './version';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_PATH_REGEX = /^\/?[a-zA-Z0-9\-_@~*^%]+(\/[a-zA-Z0-9\-_@~*^%]+)*$/;

interface SecretRequest {
  secretType: 'static' | 'dynamic';
  path: string;
  key: string;
  outputName: string;
}

export function parseSecretInput(input: string, secretType: 'static' | 'dynamic'): SecretRequest[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [left, alias] = line.split('|').map((s) => s.trim());
      const parts = left.split(/\s+/);
      if (parts.length !== 2) {
        throw new Error(`Invalid ${secretType} secret entry: "${line}". Expected format: <path> <key> [| <alias>]`);
      }
      const [path, key] = parts;
      if (!SECRET_PATH_REGEX.test(path) || path === '*') {
        throw new Error(`Invalid secret path: "${path}". Must match pattern: ${SECRET_PATH_REGEX.source}`);
      }
      if (key === '*' && alias) {
        throw new Error(`Alias is not supported with wildcard (*) in "${line}".`);
      }
      return { secretType, path, key, outputName: alias || key };
    });
}

export async function run(): Promise<void> {
  try {
    info(`workload-credentials v${LIB_VERSION}`);

    const apiBaseUrl = getInput('api-base-url') || 'https://api.beyondtrust.io';
    const apiVersion = getInput('api-version') || '2026-02-16';
    const siteId = getInput('site-id', { required: true });
    const staticInput = getInput('static');
    const dynamicInput = getInput('dynamic');

    if (!apiBaseUrl.startsWith('https://')) {
      throw new Error('api-base-url must use HTTPS.');
    }

    if (!UUID_REGEX.test(siteId)) {
      throw new Error('Invalid site-id. Must be a valid UUID.');
    }

    const requests: SecretRequest[] = [];
    if (staticInput) {
      requests.push(...parseSecretInput(staticInput, 'static'));
    }
    if (dynamicInput) {
      requests.push(...parseSecretInput(dynamicInput, 'dynamic'));
    }

    if (requests.length === 0) {
      throw new Error('At least one static or dynamic secret must be specified.');
    }

    info('Requesting OIDC token from GitHub...');
    const oidcToken = await getIDToken(siteId);

    if (!oidcToken) {
      throw new Error('Failed to retrieve OIDC token. Ensure the workflow has "id-token: write" permission.');
    }

    const client = createClient(oidcToken, apiVersion);
    const cache = new Map<string, Record<string, unknown>>();

    try {
      for (const req of requests) {
        const cacheKey = `${req.secretType}:${req.path}`;
        let parsed = cache.get(cacheKey);

        if (!parsed) {
          info(`Fetching ${req.secretType} secret: ${req.path}`);
          parsed = await fetchSecret(client, apiBaseUrl, siteId, req.secretType, req.path);
          cache.set(cacheKey, parsed);
        }

        if (req.key === '*') {
          for (const [key, val] of Object.entries(parsed)) {
            const value = String(val);
            const envName = key.toUpperCase();
            setSecretOutput(key, envName, value);
          }
        } else {
          if (!(req.key in parsed)) {
            throw new Error(`Key "${req.key}" not found in secret at "${req.path}".`);
          }

          const value = String(parsed[req.key]);
          const envName = req.outputName.toUpperCase();
          setSecretOutput(req.outputName, envName, value);
        }
      }

      info('All secrets retrieved successfully.');
    } finally {
      client.dispose();
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed('An unexpected error occurred');
    }
  }
}
