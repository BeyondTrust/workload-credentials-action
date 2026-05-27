# BeyondTrust Workload Credentials Action

Retrieve secrets from BeyondTrust Workload Credentials within your GitHub Actions workflows.

## Quick start

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: BeyondTrust/workload-credentials-action@v1
        with:
          site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
          service-name: 'ci-workflow'
          static-secrets: |
            - path: "prod/app"
              key: "connectionString"
              output-name: "DATABASE_URL"
              export-to-env: true

      - name: Deploy
        run: npm run deploy
        # $DATABASE_URL is available here
```

Replace `site-id` with your BeyondTrust site ID. The `id-token: write` permission is required so the action can request an OIDC token from GitHub.

## Inputs

| Name | Required | Description |
| ------ | ---------- | ------------- |
| `site-id` | Yes | The BeyondTrust site ID (UUID). Available on the confirmation page after successfully creating an OIDC issuer registration in [BeyondTrust Pathfinder Platform](https://app.beyondtrust.io). |
| `service-name` | Yes | The service name specified when creating an OIDC issuer registration in [BeyondTrust Pathfinder Platform](https://app.beyondtrust.io). |
| `static-secrets` | Yes | YAML list of secrets to retrieve. |
| `api-version` | No | The BeyondTrust Workload Credentials API version. Defaults to `2026-04-28`. |

The `static-secrets` input accepts a YAML list. Each entry supports:

| Field | Required | Description |
| ------- | ---------- | ------------- |
| `path` | Yes | The secret path in BeyondTrust (e.g. `prod/app`). |
| `key` | No | A specific field to extract. Omit to export all fields. |
| `output-name` | No | Alias for the output name, or a prefix if ending with `*`. See [Naming rules](#naming-rules). |
| `export-to-env` | No | Export as an uppercased environment variable. Defaults to `false`. |

## Outputs

Each secret is available as a **step output**. The name is determined by:
- `output-name` (alias) if provided
- `output-name` ending with `*` (prefix) + the field key
- The original field key if no `output-name` is set

When `export-to-env: true`, the value is also exported as an **uppercased environment variable** available in all subsequent steps.

All values are masked in workflow logs.

## Naming rules

Output names must match:

```text
^[a-zA-Z_][a-zA-Z0-9_]*$
```

Letters, digits, and underscores only; must start with a letter or underscore. A trailing `*` is allowed on `output-name` to indicate prefix mode.

This applies to `output-name` itself, and to JSON field keys whenever they become part of the output name — that is, when `output-name` is omitted, or when `output-name` ends with `*` (prefix mode, where the resolved name is `prefix + fieldKey`).

If a secret contains a field with an unsupported name (e.g. `api-key`, `api.v2`), use alias mode — `output-name` without a trailing `*` — to rename it:

```yaml
static-secrets: |
  - path: "prod/app"
    key: "api-key"
    output-name: "API_KEY"
```

Prefix mode does not rename the field key, so it cannot rescue an unsupported key. For example, `key: "api-key"` with `output-name: "my_app_*"` would resolve to `my_app_api-key`, which is rejected because of the `-`.

## Secret masking

All retrieved secret values are registered with GitHub's secret masking, preventing them from appearing in workflow logs.

## Usage

### Export all fields

The simplest form — exports every field from the secret as a step output:

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials-action@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      service-name: 'ci-workflow'
      static-secrets: |
        - path: "prod/app"

  - name: Deploy
    env:
      DATABASE_URL: ${{ steps.secrets.outputs.connectionString }}
      API_KEY: ${{ steps.secrets.outputs.apiKey }}
    run: npm run deploy
```

### Export a single field

Use `key` to extract a specific field:

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials-action@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      service-name: 'ci-workflow'
      static-secrets: |
        - path: "prod/app"
          key: "connectionString"
          output-name: "DATABASE_URL"

  - name: Deploy
    env:
      DATABASE_URL: ${{ steps.secrets.outputs.DATABASE_URL }}
    run: npm run deploy
```

### Export to environment variables

Use `export-to-env: true` to automatically export secrets as uppercased environment variables for all subsequent steps:

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials-action@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      service-name: 'ci-workflow'
      static-secrets: |
        - path: "prod/app"
          key: "connectionString"
          output-name: "DATABASE_URL"
          export-to-env: true

  - name: Deploy
    run: npm run deploy
```

### Prefix

Use `output-name` ending with `*` to prefix output names. Works with or without `key`:

```yaml
steps:
  - name: Retrieve all fields with prefix
    uses: BeyondTrust/workload-credentials-action@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      service-name: 'ci-workflow'
      static-secrets: |
        - path: "prod/app"
          output-name: "my_app_*"
          export-to-env: true

  - name: Deploy
    run: npm run deploy
```

If the secret contains `{ "apiKey": "sk-123", "dbHost": "localhost" }`, this sets:
- Step outputs: `my_app_apiKey`, `my_app_dbHost`
- Env vars: `MY_APP_APIKEY`, `MY_APP_DBHOST`

Prefix also works with a single key:

```yaml
static-secrets: |
  - path: "prod/app"
    key: "field1"
    output-name: "my_app_*"
```

This produces the output `my_app_field1`.

### Multiple secrets

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials-action@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      service-name: 'ci-workflow'
      static-secrets: |
        - path: "prod/app"
          output-name: "APP_*"
          export-to-env: true
        - path: "prod/db"
          key: "connectionString"
          output-name: "DATABASE_URL"
          export-to-env: true

  - name: Deploy
    run: npm run deploy
```

## Contributing

This project is open source but does not accept external contributions. If you have a bug report or feature request, please reach out to us through [BeyondTrust Support](https://www.beyondtrust.com/support).

## License

See [LICENSE](LICENSE) for details.
