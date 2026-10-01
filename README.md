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
| `export-to-env` | No | Export as an uppercase environment variable. Defaults to `false`. Requires an `output-name` prefix when `key` is omitted — see [Environment variable naming](#environment-variable-naming). |

## Outputs

Each secret is available as a **step output**. The name is determined by:
- `output-name` (alias) if provided
- `output-name` ending with `*` (prefix) + the field key
- The original field key if no `output-name` is set

When `export-to-env: true`, the value is also exported as an **uppercase environment variable** available in all subsequent steps. Naming is constrained in that mode; see [Environment variable naming](#environment-variable-naming).

All values are masked in workflow logs.

## Naming rules

Output names must match:

```text
^[a-zA-Z_][a-zA-Z0-9_]*$
```

Letters, digits, and underscores only; must start with a letter or underscore. A trailing `*` is allowed on `output-name` to indicate prefix mode.

This applies to `output-name` itself, and to JSON field keys whenever they become part of the output name. That is, when `output-name` is omitted, or when `output-name` ends with `*` (prefix mode, where the resolved name is `prefix + fieldKey`).

If a secret contains a field with an unsupported name (e.g. `api-key`, `api.v2`), use alias mode, `output-name` without a trailing `*`,  to rename it:

```yaml
static-secrets: |
  - path: "prod/app"
    key: "api-key"
    output-name: "API_KEY"
```

Prefix mode does not rename the field key, so it cannot rescue an unsupported key. For example, `key: "api-key"` with `output-name: "my_app_*"` resolves to `my_app_api-key`, which is rejected because of the `-`.

## Environment variable naming

With `export-to-env: true`, the environment variable name has to come from your workflow, not from the secret. Otherwise whoever can name a field on the secret chooses a variable name on your runner — and names like `GIT_SSH_COMMAND`, `LD_PRELOAD`, or `NPM_CONFIG_REGISTRY` change how later steps execute code.

Two rules follow from that.

### A prefix is required when `key` is omitted

Without `key`, every field in the secret becomes an environment variable, so `output-name` must supply a namespace:

```yaml
static-secrets: |
  - path: "prod/app"
    output-name: "APP_*"     # required
    export-to-env: true
```

A field named `GIT_SSH_COMMAND` then resolves to `APP_GIT_SSH_COMMAND`, which no tool reads. To control exact names, request the fields explicitly instead:

```yaml
static-secrets: |
  - path: "prod/app"
    key: "accessKeyId"
    output-name: "AWS_ACCESS_KEY_ID"
    export-to-env: true
```

This applies only to `export-to-env`. Exporting every field as a **step output** needs no prefix, because a later step must reference an output by name for it to have any effect.

### Reserved names are rejected

As a backstop — a prefix like `git_*` doesn't namespace anything — resolved names are checked against a reserved list:

- Runner-controlled namespaces: `GITHUB_*`, `RUNNER_*`, `ACTIONS_*`, `INPUT_*`
- Loaders and lookup paths: `LD_*`, `DYLD_*`, `PATH`, `CLASSPATH`, `HOME`
- Command hooks: `GIT_*`, `SSH_*`, `BASH_ENV`, `ENV`, `SHELLOPTS`, `PS4`, `EDITOR`, `PAGER`
- Runtimes and package managers: `NODE_*`, `PYTHON*`, `PERL*`, `RUBY*`, `JAVA_*`, `NPM_CONFIG_*`, `PIP_*`, `YARN_*`, `GEM_*`, `BUNDLE_*`, `NUGET_*`, `DOTNET_*`
- Windows: `COMSPEC`, `PATHEXT`, `PSMODULEPATH`, `MSBUILD*`, `PROGRAMFILES`, `CHOCOLATEY*`, `__COMPAT_LAYER`
- Network and transport: `HTTP_PROXY`, `HTTPS_PROXY`, `SSL_CERT_FILE`, `NETRC`, `OPENSSL_*`
- Endpoint redirection: `DOCKER_HOST`, `DOCKER_CONFIG`, `KUBECONFIG`, `AWS_CONFIG_FILE`, `AWS_CONTAINER_*`, `GCE_METADATA*`

The full list is in [src/reserved-env.ts](src/reserved-env.ts). Hitting one fails the step before anything is exported, so a secret change can never partially apply.

Credential-shaped names are deliberately **not** reserved, including `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AZURE_CLIENT_SECRET`, `ARM_CLIENT_SECRET`, `TF_VAR_*`, `DOCKER_PASSWORD`, `CARGO_REGISTRY_TOKEN`, and `NPM_TOKEN`. Only the redirection members of those namespaces are refused.

If you deliberately want a reserved variable, name it yourself with `key` + `output-name`. The action sets it and logs a warning, because the name is then declared in your workflow rather than in the secret — the same authority you have writing an `env:` block by hand:

```yaml
static-secrets: |
  - path: "prod/app"
    key: "sshCommand"
    output-name: "GIT_SSH_COMMAND"
    export-to-env: true
```

## Secret masking

Retrieved secret values are automatically masked in workflow logs using GitHub's secret scanning.

## Usage

### Export all fields

The simplest form. Exports every field from the secret as a step output:

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

Use `export-to-env: true` to automatically export secrets as uppercase environment variables for all subsequent steps:

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
