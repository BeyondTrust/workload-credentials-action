import { build } from 'esbuild';

build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: ['node24'],
  outdir: 'dist',
  minify: true,
  sourcemap: 'external',
});
