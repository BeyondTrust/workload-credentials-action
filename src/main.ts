import { getInput, setFailed, getIDToken, info } from '@actions/core';
import { load, JSON_SCHEMA } from 'js-yaml';
import { createClient, fetchSecret } from './client';
import { setSecretOutput } from './secret';
import { LIB_VERSION } from './version';

// TODO: Update to production URL before release
const API_BASE_URL = 'https://api.smop.bt-platform.net';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_PATH_REGEX = /^\/?[a-zA-Z0-9\-_@~*^%]+(\/[a-zA-Z0-9\-_@~*^%]+)*$/;

export interface SecretRequest {
  path: string;
  key: string;
  outputName: string;
  prefix: string;
  exportToEnv: boolean;
}

export function parseSecretInput(input: string): SecretRequest[] {
  const parsed = load(input, { schema: JSON_SCHEMA });

  if (!Array.isArray(parsed)) {
    throw new Error('secrets must be a YAML list.');
  }

  return parsed.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Secret entry ${index + 1}: must be an object.`);
    }

    const item = entry as Record<string, unknown>;

    if (!item.path || typeof item.path !== 'string') {
      throw new Error(`Secret entry ${index + 1}: "path" is required.`);
    }

    if (!item.key || typeof item.key !== 'string') {
      throw new Error(`Secret entry ${index + 1}: "key" is required.`);
    }

    if (item['output-name'] !== undefined && typeof item['output-name'] !== 'string') {
      throw new Error(`Secret entry ${index + 1}: "output-name" must be a string.`);
    }

    if (item['export-to-env'] !== undefined && typeof item['export-to-env'] !== 'boolean') {
      throw new Error(`Secret entry ${index + 1}: "export-to-env" must be true or false.`);
    }

    const path = item.path;
    const key = item.key;
    const outputName = (item['output-name'] as string) || key;
    const exportToEnv = (item['export-to-env'] as boolean) ?? false;

    if (!SECRET_PATH_REGEX.test(path) || path === '*') {
      throw new Error(`Secret entry ${index + 1}: invalid path "${path}".`);
    }

    let prefix = '';
    if (key === '*' && item['output-name']) {
      if (outputName.endsWith('*')) {
        prefix = outputName.slice(0, -1);
      } else {
        throw new Error(`Secret entry ${index + 1}: "output-name" must end with "*" when used with wildcard key.`);
      }
    }

    return { path, key, outputName, prefix, exportToEnv };
  });
}

const VALID_ENV_NAME_REGEX = /^[A-Z_][A-Z0-9_]*$/;

export function toEnvName(name: string): string {
  const envName = name.replace(/-/g, '_').toUpperCase();
  if (!VALID_ENV_NAME_REGEX.test(envName)) {
    throw new Error(`Cannot convert "${name}" to a valid environment variable name. Only alphanumeric characters, hyphens, and underscores are allowed.`);
  }
  return envName;
}

function toStringValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export async function run(): Promise<void> {
  try {
    info(`workload-credentials v${LIB_VERSION}`);

    const apiVersion = getInput('api-version');
    const siteId = getInput('site-id', { required: true });
    const secretsInput = getInput('static-secrets', { required: true });

    if (!UUID_REGEX.test(siteId)) {
      throw new Error('Invalid site-id. Must be a valid UUID.');
    }

    const requests = parseSecretInput(secretsInput);

    if (requests.length === 0) {
      throw new Error('At least one secret must be specified.');
    }

    info('Requesting OIDC token from GitHub...');
    const oidcToken = await getIDToken(siteId);

    if (!oidcToken) {
      throw new Error('Failed to retrieve OIDC token. Ensure the workflow has "id-token: write" permission.');
    }

    const client = createClient(oidcToken, apiVersion);
    const cache = new Map<string, Record<string, unknown>>();

    try {
      // Phase 1: Fetch all secrets and validate keys
      for (const req of requests) {
        if (!cache.has(req.path)) {
          info(`Fetching secret: ${req.path}`);
          cache.set(req.path, await fetchSecret(client, API_BASE_URL, siteId, req.path));
        }

        const parsed = cache.get(req.path)!;
        if (req.key !== '*' && !(req.key in parsed)) {
          throw new Error(`Key "${req.key}" not found in secret at "${req.path}".`);
        }
      }

      // Check for duplicate output names (including wildcard expansions)
      const outputNames = new Set<string>();
      for (const req of requests) {
        const names =
          req.key === '*'
            ? Object.keys(cache.get(req.path)!).map((k) => `${req.prefix}${k}`)
            : [req.outputName];

        for (const name of names) {
          if (outputNames.has(name)) {
            throw new Error(`Duplicate output name "${name}". Each output must be unique.`);
          }
          outputNames.add(name);
        }
      }

      // Phase 2: Export all outputs (only reached if all fetches and validations succeed)
      for (const req of requests) {
        const parsed = cache.get(req.path)!;

        if (req.key === '*') {
          const keys = Object.keys(parsed);
          info(`Wildcard export from "${req.path}": ${keys.length} keys`);
          for (const [key, val] of Object.entries(parsed)) {
            const name = `${req.prefix}${key}`;
            const envName = req.exportToEnv ? toEnvName(name) : undefined;
            setSecretOutput(name, toStringValue(val), envName);
          }
        } else {
          const value = toStringValue(parsed[req.key]);
          const envName = req.exportToEnv ? toEnvName(req.outputName) : undefined;
          setSecretOutput(req.outputName, value, envName);
        }
      }

      info('All secrets retrieved successfully.');
    } finally {
      cache.clear();
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
