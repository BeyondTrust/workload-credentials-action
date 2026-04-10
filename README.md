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

This action supports two types of secrets:

- **Static secrets** are stored values such as passwords, API keys, and connection strings.
- **Dynamic secrets** are generated on demand with a limited lifetime, such as temporary cloud credentials.

Each entry follows the format: `<path> <key> [| <alias>]`

- `path` — the secret path in BeyondTrust (e.g. `prod/db/creds`).
- `key` — the field to extract from the secret object (e.g. `password`). Use `*` to export all fields.
- `alias` — (optional) custom name for the step output and environment variable. If omitted, the key name is used. Not supported with `*`.

Using step outputs:

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static: |
        prod/app connectionString
        prod/app apiKey

  - name: Deploy
    env:
      DATABASE_URL: ${{ steps.secrets.outputs.connectionString }}
      API_KEY: ${{ steps.secrets.outputs.apiKey }}
    run: npm run deploy
```

Using environment variables (automatically available in subsequent steps):

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static: |
        prod/app connectionString
        prod/app apiKey

  - name: Deploy
    env:
      DATABASE_URL: ${{ env.CONNECTIONSTRING }}
      API_KEY: ${{ env.APIKEY }}
    run: npm run deploy
```


Use `| <alias>` to set a custom name for the step output and environment variable:

```yaml
steps:
  - name: Generate temporary AWS credentials
    uses: BeyondTrust/workload-credentials@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      dynamic: |
        prod/aws-creds accessKeyId | AWS_ACCESS_KEY_ID
        prod/aws-creds secretAccessKey | AWS_SECRET_ACCESS_KEY

  - name: Use the credentials
    run: aws s3 ls
```


Use `*` to export all fields from a secret as outputs and environment variables:

```yaml
steps:
  - name: Retrieve all app secrets
    uses: BeyondTrust/workload-credentials@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static: 'prod/app *'

  - name: Deploy
    run: npm run deploy
```

If the secret at `prod/app` contains `{ "connectionString": "postgres://...", "apiKey": "sk-123..." }`, this sets outputs `connectionString` and `apiKey`, and environment variables `$CONNECTIONSTRING` and `$APIKEY`.

Retrieve multiple secrets in a single step using multi-line inputs:

```yaml
steps:
  - name: Retrieve secrets
    uses: BeyondTrust/workload-credentials@v1
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      static: |
        prod/app connectionString | DATABASE_URL
        prod/app apiKey | API_KEY
      dynamic: |
        prod/aws-creds accessKeyId | AWS_ACCESS_KEY_ID
        prod/aws-creds secretAccessKey | AWS_SECRET_ACCESS_KEY

  - name: Use the credentials
    run: aws s3 ls

  - name: Deploy
    run: npm run deploy  
```

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `site-id` | Yes | The BeyondTrust site ID (UUID). |
| `static` | No | Static secrets to retrieve. Each line: `<path> <key> [| <alias>]`. |
| `dynamic` | No | Dynamic secrets to retrieve. Each line: `<path> <key> [| <alias>]`. |
| `api-base-url` | No | The BeyondTrust API base URL. Defaults to `https://api.beyondtrust.io`. |
| `api-version` | No | The BeyondTrust Workload Credentials API version. Defaults to `2026-02-16`. |

At least one `static` or `dynamic` entry must be specified.

## Outputs

Each secret is available as both a **step output** and an **environment variable**:

- **Step output**: named by the alias (or key if no alias). Access via `steps.<id>.outputs.<name>`.
- **Environment variable**: always uppercased. Automatically available in subsequent steps as `$NAME`.

| Entry | Step output | Env var |
|-------|------------|---------|
| `prod/app apiKey` | `steps.<id>.outputs.apiKey` | `$APIKEY` |
| `prod/app apiKey \| API_KEY` | `steps.<id>.outputs.API_KEY` | `$API_KEY` |

All values are masked in workflow logs.

## License

See [LICENSE](LICENSE) for details.
