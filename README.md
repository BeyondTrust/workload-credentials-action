# BeyondTrust Workload Credentials

Retrieve secrets from BeyondTrust Workload Credentials in your GitHub Actions workflows.

## Authentication

This action uses GitHub's OpenID Connect (OIDC) tokens to authenticate with BeyondTrust. No long-lived secrets need to be stored in your repository or GitHub Secrets.

Your workflow or job must grant the `id-token: write` permission:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      # ...
```

## Secret masking

All retrieved secret values are registered with GitHub's secret masking, preventing them from appearing in workflow logs.

## Usage

The `secrets` input accepts a YAML list. Each entry supports:

| Field | Required | Description |
|-------|----------|-------------|
| `path` | Yes | The secret path in BeyondTrust (e.g. `prod/app`). |
| `key` | Yes | The field to extract from the secret object. Use `*` to export all fields. |
| `output-name` | No | Custom name for the step output. Defaults to the key name. With `key: "*"`, use a prefix ending in `*` (e.g. `my_app_*`). |
| `export-to-env` | No | Export the value as an uppercased environment variable for subsequent steps. Defaults to `false`. |

### Basic usage

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static-secrets: |
        - path: "prod/app"
          key: "connectionString"
        - path: "prod/app"
          key: "apiKey"

  - name: Deploy
    env:
      DATABASE_URL: ${{ steps.secrets.outputs.connectionString }}
      API_KEY: ${{ steps.secrets.outputs.apiKey }}
    run: npm run deploy
```

### Custom output names

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static-secrets: |
        - path: "prod/app"
          key: "connectionString"
          output-name: "DATABASE_URL"
        - path: "prod/app"
          key: "apiKey"
          output-name: "API_KEY"

  - name: Deploy
    env:
      DATABASE_URL: ${{ steps.secrets.outputs.DATABASE_URL }}
      API_KEY: ${{ steps.secrets.outputs.API_KEY }}
    run: npm run deploy
```

### Export to environment variables

Use `export-to-env: true` to automatically export secrets as uppercased environment variables for all subsequent steps:

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static-secrets: |
        - path: "prod/app"
          key: "connectionString"
          output-name: "DATABASE_URL"
          export-to-env: true
        - path: "prod/app"
          key: "apiKey"
          output-name: "API_KEY"
          export-to-env: true

  - name: Deploy
    run: npm run deploy
```

### Wildcard

Use `key: "*"` to export all fields from a secret:

```yaml
steps:
  - name: Retrieve all app secrets
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static-secrets: |
        - path: "prod/app"
          key: "*"

  - name: Deploy
    env:
      DATABASE_URL: ${{ steps.secrets.outputs.connectionString }}
    run: npm run deploy
```

Combine `key: "*"` with `export-to-env: true` to export all fields as environment variables:

```yaml
steps:
  - name: Retrieve all app secrets
    uses: BeyondTrust/workload-credentials@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static-secrets: |
        - path: "prod/app"
          key: "*"
          export-to-env: true

  - name: Deploy
    run: npm run deploy
```

### Wildcard with prefix

Use `output-name` with a trailing `*` to prefix all wildcard-expanded output names:

```yaml
steps:
  - name: Retrieve all app secrets
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static-secrets: |
        - path: "prod/app"
          key: "*"
          output-name: "my_app_*"
          export-to-env: true

  - name: Deploy
    run: npm run deploy
```

If the secret contains `{ "apiKey": "sk-123", "dbHost": "localhost" }`, this sets:
- Step outputs: `my_app_apiKey`, `my_app_dbHost`
- Env vars: `MY_APP_APIKEY`, `MY_APP_DBHOST`

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `site-id` | Yes | The BeyondTrust site ID (UUID). |
| `static-secrets` | Yes | YAML list of secrets to retrieve. See [Usage](#usage) for format. |
| `api-version` | No | The BeyondTrust Workload Credentials API version. Defaults to `2026-02-16`. |

## Outputs

Each secret is available as a **step output**, named by `output-name` (or `key` if not specified). Access via `steps.<id>.outputs.<name>`.

When `export-to-env: true`, the value is also exported as an **uppercased environment variable** available in all subsequent steps.

All values are masked in workflow logs.

## License

See [LICENSE](LICENSE) for details.
