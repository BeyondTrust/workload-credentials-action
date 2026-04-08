import { HttpClient } from '@actions/http-client';

// TODO: Replace with the actual BeyondTrust Secrets Safe API base URL.
const API_BASE_URL = 'https://beyondtrust.example.com';

const API_PATH = '/secrets/api';
const API_VERSION = '2026-02-16';
const REQUEST_TIMEOUT_MS = 30_000;

interface SecretsResponse {
  secret: Record<string, unknown>;
}

export function parsePath(secretPath: string): { folder: string; name: string } {
  const normalized = secretPath.replace(/\/+$/, '');
  const lastSlash = normalized.lastIndexOf('/');

  if (lastSlash === -1) {
    return { folder: '', name: normalized };
  }

  return {
    folder: normalized.substring(0, lastSlash),
    name: normalized.substring(lastSlash + 1),
  };
}

export async function fetchSecret(
  oidcToken: string,
  siteId: string,
  secretType: 'static' | 'dynamic',
  secretPath: string
): Promise<string> {
  const client = new HttpClient('beyondtrust-workload-credentials', [], {
    headers: {
      Authorization: `Bearer ${oidcToken}`,
      Accept: 'application/json',
      'bt-secrets-api-version': API_VERSION,
    },
    socketTimeout: REQUEST_TIMEOUT_MS,
  });

  try {
    const { folder, name } = parsePath(secretPath);
    const url = buildUrl(siteId, secretType, name, folder);

    const response =
      secretType === 'static'
        ? await client.get(url)
        : await client.post(url, '');

    const statusCode = response.message.statusCode ?? 0;
    const body = await response.readBody();

    if (statusCode !== 200 && statusCode !== 201) {
      throw new Error(`BeyondTrust API returned HTTP ${statusCode}`);
    }

    let result: SecretsResponse;
    try {
      result = JSON.parse(body) as SecretsResponse;
    } catch {
      throw new Error('BeyondTrust API returned an invalid JSON response');
    }

    if (!result.secret || typeof result.secret !== 'object') {
      throw new Error(
        'BeyondTrust API response did not contain a secret value'
      );
    }

    return JSON.stringify(result.secret);
  } finally {
    client.dispose();
  }
}

function buildUrl(
  siteId: string,
  secretType: 'static' | 'dynamic',
  name: string,
  folder: string
): string {
  const encodedName = encodeURIComponent(name);
  const base = `${API_BASE_URL}/${encodeURIComponent(siteId)}${API_PATH}`;

  const path =
    secretType === 'static'
      ? `${base}/static/${encodedName}`
      : `${base}/dynamic/${encodedName}/generate`;

  const params = new URLSearchParams();
  if (folder) {
    params.set('folder', folder);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
