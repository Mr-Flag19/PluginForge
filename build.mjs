// Build step: compiles the JSX and the Tailwind classes into files served from our own origin.
//   npm install && npm run build
// The compiled files in assets/ are committed, so Vercel needs no build command. CI rebuilds them and fails
// if they differ from what is committed.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'assets');
mkdirSync(out, { recursive: true });

// The page scripts use the global names React and ReactDOM; this supplies them from the bundled packages
writeFileSync(join(root, 'src/_react-shim.js'),
  "import * as React from 'react';\nimport * as ReactDOM from 'react-dom/client';\nexport { React, ReactDOM };\n");

const pages = [
  { name: 'home', html: 'index.html', entry: 'src/home.jsx' },
  { name: 'code', html: 'code/index.html', entry: 'src/code.jsx' },
  { name: 'admin', html: 'admin/index.html', entry: 'src/admin.js' },
];

for (const p of pages) {
  await build({
    entryPoints: [join(root, p.entry)],
    outfile: join(out, p.name + '.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    jsx: 'transform',
    loader: { '.js': 'jsx' },
    inject: p.entry.endsWith('.jsx') ? [join(root, 'src/_react-shim.js')] : [],
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'warning',
  });

  // Tailwind: its three layers first, then the page's own CSS (so the page's rules still win where they overlap)
  const input = join(root, 'src/_' + p.name + '.in.css');
  writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' + readFileSync(join(root, 'src/' + p.name + '.css'), 'utf8'));
  const cfg = join(root, 'src/_' + p.name + '.tw.cjs');
  writeFileSync(cfg, "module.exports = { content: [" + JSON.stringify(join(root, p.html)) + ", " + JSON.stringify(join(root, p.entry)) + "], theme: { extend: {} }, plugins: [] };\n");
  execFileSync(join(root, 'node_modules/.bin/tailwindcss'), ['-c', cfg, '-i', input, '-o', join(out, p.name + '.css'), '--minify'], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (const f of [input, cfg]) rmSync(f);
  console.log('built', p.name);
}
