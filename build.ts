import { build } from 'esbuild';

build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: ['node24'],
  outdir: 'dist',
  minify: true,
  // No sourcemap: the external .map is ~2MB base64, over the GraphQL
  // createCommitOnBranch request limit the Dependabot dist workflow relies on
  // to push a GitHub-signed commit. Keeping dist/ to index.js alone lets that
  // commit go through the signing API. See .github/workflows/dependabot-dist.yaml.
  sourcemap: false,
});
