import { getInput, setFailed, getIDToken, info } from '@actions/core';
import { load, JSON_SCHEMA } from 'js-yaml';
import { createClient, fetchSecret } from './client';
import { setSecretOutput } from './secret';
import { LIB_VERSION } from './version';

// TODO: Update to production URL before release
const API_BASE_URL = 'https://api.beyondtrust.io';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_PATH_REGEX = /^\/?[a-zA-Z0-9\-_@~*^%]+(\/[a-zA-Z0-9\-_@~*^%]+)*$/;
const OUTPUT_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*\*?$/;
const FIELD_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SERVICE_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

export interface SecretRequest {
  path: string;
  key?: string;
  prefix: string;
  alias: string;
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

    if (item.key !== undefined && typeof item.key !== 'string') {
      throw new Error(`Secret entry ${index + 1}: "key" must be a string.`);
    }

    if (item['output-name'] !== undefined && typeof item['output-name'] !== 'string') {
      throw new Error(`Secret entry ${index + 1}: "output-name" must be a string.`);
    }

    if (item['export-to-env'] !== undefined && typeof item['export-to-env'] !== 'boolean') {
      throw new Error(`Secret entry ${index + 1}: "export-to-env" must be true or false.`);
    }

    const path = item.path;
    const key = item.key as string | undefined;
    const outputName = (item['output-name'] as string) || '';
    const exportToEnv = (item['export-to-env'] as boolean) ?? false;

    if (!SECRET_PATH_REGEX.test(path)) {
      throw new Error(`Secret entry ${index + 1}: invalid path "${path}".`);
    }

    // output-name ending with * = prefix mode, otherwise = alias mode
    const isPrefix = outputName.endsWith('*');
    const prefix = isPrefix ? outputName.slice(0, -1) : '';
    const alias = isPrefix ? '' : outputName;

    // Alias without key: can't alias all fields to one name
    if (!key && alias) {
      throw new Error(`Secret entry ${index + 1}: "output-name" must end with "*" when "key" is not specified.`);
    }

    const outputNameBody = isPrefix ? prefix : alias;
    if (outputNameBody.length > 0 && !OUTPUT_NAME_REGEX.test(outputNameBody)) {
      throw new Error(
        `Secret entry ${index + 1}: "output-name" "${outputName}" is invalid. Use letters, digits, and underscores only; must start with a letter or underscore. A trailing "*" is allowed for prefix mode.`,
      );
    }

    // When key is used as (or part of) the output name, it must be a valid identifier.
    if (key && !alias && !FIELD_KEY_REGEX.test(key)) {
      throw new Error(
        `Secret entry ${index + 1}: "key" "${key}" can't be used as an output name. Add "output-name" to alias it (e.g. output-name: "MY_NAME").`,
      );
    }

    return { path, key, prefix, alias, exportToEnv };
  });
}

function toStringValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function resolveOutputName(req: SecretRequest, fieldKey: string): string {
  if (req.alias) return req.alias;
  return `${req.prefix}${fieldKey}`;
}

export async function run(): Promise<void> {
  try {
    info(`workload-credentials v${LIB_VERSION}`);

    const apiVersion = getInput('api-version');
    const siteId = getInput('site-id', { required: true });
    const serviceName = getInput('service-name', { required: true });
    const secretsInput = getInput('static-secrets', { required: true });

    if (!UUID_REGEX.test(siteId)) {
      throw new Error('Invalid site-id. Must be a valid UUID.');
    }

    if (!SERVICE_NAME_REGEX.test(serviceName)) {
      throw new Error('Invalid service-name. Use letters, digits, hyphens, and underscores only.');
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

    const client = createClient(oidcToken, apiVersion, serviceName);
    const cache = new Map<string, Record<string, unknown>>();

    try {
      // Phase 1: Fetch all secrets and validate keys
      for (const req of requests) {
        if (!cache.has(req.path)) {
          info(`Fetching secret: ${req.path}`);
          cache.set(req.path, await fetchSecret(client, API_BASE_URL, siteId, req.path));
        }

        const parsed = cache.get(req.path)!;
        if (req.key && !(req.key in parsed)) {
          throw new Error(`Key "${req.key}" not found in secret at "${req.path}".`);
        }

        // Export-all mode: every JSON key becomes an output name, so each must be a valid identifier.
        if (!req.key) {
          for (const k of Object.keys(parsed)) {
            if (!FIELD_KEY_REGEX.test(k)) {
              throw new Error(
                `Secret at "${req.path}" contains field "${k}" which can't be used as an output name. ` +
                  `Alias it explicitly: { path: "${req.path}", key: "${k}", output-name: "YOUR_NAME" }.`,
              );
            }
          }
        }
      }

      // Check for duplicate output names (and env var names when exporting to env).
      const outputNames = new Set<string>();
      const envNames = new Set<string>();
      for (const req of requests) {
        const keys = req.key ? [req.key] : Object.keys(cache.get(req.path)!);

        for (const k of keys) {
          const name = resolveOutputName(req, k);
          if (!OUTPUT_NAME_REGEX.test(name)) {
            throw new Error(
              `Resolved output name ${JSON.stringify(name)} contains invalid characters. ` +
                `Only letters, digits, "_", "-", and "." are allowed.`,
            );
          }
          if (outputNames.has(name)) {
            throw new Error(`Duplicate output name "${name}". Each output must be unique.`);
          }
          outputNames.add(name);

          if (req.exportToEnv) {
            const envName = name.toUpperCase();
            if (envNames.has(envName)) {
              throw new Error(
                `Duplicate environment variable name "${envName}". Each env var must be unique when "export-to-env" is true.`,
              );
            }
            envNames.add(envName);
          }
        }
      }

      // Phase 2: Export all outputs (only reached if all fetches and validations succeed)
      for (const req of requests) {
        const parsed = cache.get(req.path)!;
        const keys = req.key ? [req.key] : Object.keys(parsed);

        if (!req.key) {
          info(`Exporting all fields from "${req.path}": ${keys.length} keys`);
        }

        for (const k of keys) {
          const name = resolveOutputName(req, k);
          const value = toStringValue(parsed[k]);
          const envName = req.exportToEnv ? name.toUpperCase() : undefined;
          setSecretOutput(name, value, envName);
        }
      }

      info('All secrets retrieved successfully.');
    } finally {
      cache.clear();
      client.client.dispose();
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed('An unexpected error occurred');
    }
  }
}
