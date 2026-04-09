# BeyondTrust Workload Credentials

Retrieve secrets from BeyondTrust Workload Credentials in your GitHub Actions workflows.

## Prerequisites

- GitHub OIDC provider is registered for your site.
- The `id-token: write` permission must be set in your workflow or job.

## Usage

```yaml
steps:
  - name: Retrieve database password
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      secret-type: 'static'
      secret-path: 'prod/db/password'

  - name: Use the secret
    run: echo "Secret retrieved successfully"
    env:
      DB_PASSWORD: ${{ steps.secrets.outputs.secret }}
```

### Dynamic Secrets

```yaml
steps:
  - name: Generate temporary cloud credentials
    uses: BeyondTrust/workload-credentials@v1
    id: cloud-creds
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      secret-type: 'dynamic'
      secret-path: 'prod/aws-creds'

  - name: Use the credentials
    run: echo "Temporary credentials generated"
    env:
      CLOUD_CREDS: ${{ steps.cloud-creds.outputs.secret }}
```

### Extract a Single Value

Use `secret-key` to extract a specific field from the secret JSON instead of getting the full object:

```yaml
steps:
  - name: Retrieve database password
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      secret-type: 'static'
      secret-path: 'prod/db/password'
      secret-key: 'password'

  - name: Use the secret
    run: echo "Secret retrieved successfully"
    env:
      DB_PASSWORD: ${{ steps.secrets.outputs.secret }}
```

### Custom API Base URL

```yaml
steps:
  - name: Retrieve secret from custom endpoint
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      api-base-url: 'https://custom.beyondtrust.example.com'
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      secret-type: 'static'
      secret-path: 'prod/db/password'
```

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `site-id` | Yes | The BeyondTrust site ID (UUID). |
| `secret-type` | Yes | The type of secret to retrieve. Must be `static` or `dynamic`. |
| `secret-path` | Yes | The path to the secret (e.g. `prod/db/password`). |
| `secret-key` | No | Extract a single value from the secret JSON by key. If omitted, the full JSON object is returned. |
| `api-base-url` | No | The BeyondTrust API base URL. Defaults to `https://api.beyondtrust.io`. |
| `api-version` | No | The BeyondTrust Workload Credentials API version. Defaults to `2026-02-16`. |

## Outputs

| Name | Description |
|------|-------------|
| `secret` | The retrieved secret value. Returns a JSON string by default, or a single value if `secret-key` is specified. The value is masked in workflow logs. |


## License

See [LICENSE](LICENSE) for details.
