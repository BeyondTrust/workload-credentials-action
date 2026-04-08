# BeyondTrust Workload Credentials

Retrieve secrets from [BeyondTrust Secrets Safe](https://www.beyondtrust.com) directly in your GitHub Actions workflows — no stored credentials required.

## Usage

```yaml
permissions:
  id-token: write   # Required for OIDC token request
  contents: read

steps:
  - name: Retrieve database password
    uses: BeyondTrust/workload-credentials@v1
    id: secrets
    with:
      site-id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      secret-type: 'static'
      secret-path: '/prod/db/password'

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
      secret-path: '/prod/aws-creds'

  - name: Use the credentials
    run: echo "Temporary credentials generated"
    env:
      CLOUD_CREDS: ${{ steps.cloud-creds.outputs.secret }}
```

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `site-id` | Yes | The BeyondTrust site ID (UUID). |
| `secret-type` | Yes | The type of secret to retrieve. Must be `static` or `dynamic`. |
| `secret-path` | Yes | The path to the secret in BeyondTrust Secrets Safe (e.g. `/prod/db/password`). |

## Outputs

| Name | Description |
|------|-------------|
| `secret` | The retrieved secret value as a JSON string. The value is masked in workflow logs. |


## Prerequisites

- A BeyondTrust Workload Credentials instance with OIDC trust configured for your GitHub organization/repository/branch.
- The `id-token: write` permission must be set in your workflow or job.

## License

See [LICENSE](LICENSE) for details.
