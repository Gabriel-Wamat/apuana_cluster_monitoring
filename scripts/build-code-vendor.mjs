import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

const outdir = 'apuana/dashboard/static/vendor/generated';
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['chrome110'],
  legalComments: 'eof',
  loader: { '.ttf': 'file' },
  assetNames: '[name]-[hash]',
};

await build({
  ...common,
  entryPoints: ['scripts/vendor/monaco-entry.js'],
  outfile: `${outdir}/monaco.js`,
  format: 'iife',
});

await build({
  ...common,
  entryPoints: ['scripts/vendor/monaco-json-worker.js'],
  outfile: `${outdir}/monaco-json-worker.js`,
  format: 'iife',
});

await build({
  ...common,
  entryPoints: ['scripts/vendor/monaco-worker.js'],
  outfile: `${outdir}/monaco-worker.js`,
  format: 'iife',
});

await build({
  ...common,
  entryPoints: ['scripts/vendor/terminal-entry.js'],
  outfile: `${outdir}/terminal.js`,
  format: 'iife',
});
