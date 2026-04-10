import { HttpClient } from '@actions/http-client';

const API_PATH = '/secrets';
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
    folder: normalized.substring(0, lastSlash).replace(/^\//, ''),
    name: normalized.substring(lastSlash + 1),
  };
}

export function createClient(oidcToken: string, apiVersion: string): HttpClient {
  return new HttpClient('beyondtrust-workload-credentials', [], {
    headers: {
      Authorization: `Bearer ${oidcToken}`,
      Accept: 'application/json',
      'bt-secrets-api-version': apiVersion,
    },
    socketTimeout: REQUEST_TIMEOUT_MS,
  });
}

export async function fetchSecret(
  client: HttpClient,
  apiBaseUrl: string,
  siteId: string,
  secretPath: string,
): Promise<Record<string, unknown>> {
  const { folder, name } = parsePath(secretPath);
  const url = buildUrl(apiBaseUrl, siteId, name, folder);

  const response = await client.get(url);

  const statusCode = response.message.statusCode ?? 0;
  const body = await response.readBody();

  if (statusCode !== 200) {
    throw new Error(`BeyondTrust API returned HTTP ${statusCode}`);
  }

  let result: SecretsResponse;
  try {
    result = JSON.parse(body) as SecretsResponse;
  } catch {
    throw new Error('BeyondTrust API returned an invalid JSON response');
  }

  if (!result.secret || typeof result.secret !== 'object' || Array.isArray(result.secret)) {
    throw new Error('BeyondTrust API response did not contain a secret value');
  }

  return result.secret;
}

function buildUrl(apiBaseUrl: string, siteId: string, name: string, folder: string): string {
  const encodedName = encodeURIComponent(name);
  const base = `${apiBaseUrl}/site/${encodeURIComponent(siteId)}${API_PATH}`;

  const path = `${base}/static/${encodedName}`;

  const params = new URLSearchParams();
  if (folder) {
    params.set('folder', folder);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
