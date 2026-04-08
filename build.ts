import { build } from 'esbuild';

build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: ['node20'],
  outdir: 'dist',
  sourcemap: 'external',
});
