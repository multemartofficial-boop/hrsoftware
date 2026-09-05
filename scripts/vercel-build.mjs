// Vercel build script — produces a Build Output API tree (.vercel/output) that
// contains BOTH parts of this app in one project:
//   1. The TanStack Start SPA (static assets + Nitro __server function) via
//      `vite build` with NITRO_PRESET=vercel.
//   2. The Express API as an additional serverless function (api.func) which
//      wraps backend/app.js — routes stay under /api/*.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.vercel', 'output');
const funcsDir = path.join(outDir, 'functions');
const apiFuncDir = path.join(funcsDir, 'api.func');

const log = (m) => console.log(`[vercel-build] ${m}`);

// 1. Build the frontend (Nitro emits .vercel/output with static + __server.func)
log('building frontend (NITRO_PRESET=vercel)...');
execSync('npx vite build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NITRO_PRESET: 'vercel' },
});

if (!fs.existsSync(path.join(outDir, 'config.json'))) {
  throw new Error('Expected .vercel/output/config.json — Nitro vercel preset did not run.');
}

// 2. Assemble the API serverless function
log('assembling api.func...');
fs.rmSync(apiFuncDir, { recursive: true, force: true });
fs.mkdirSync(apiFuncDir, { recursive: true });

const copy = (src, dest, filter) => {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (filter && !filter(entry)) continue;
      copy(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
};

// Backend source (no tests, uploads, .env or helper scripts)
const backend = path.join(root, 'backend');
for (const item of ['app.js', 'config', 'middleware', 'routes', 'utils']) {
  copy(path.join(backend, item), path.join(apiFuncDir, 'backend', item));
}
// Backend dependencies — installed by `npm --prefix backend install`
copy(path.join(backend, 'node_modules'), path.join(apiFuncDir, 'node_modules'));

// CJS context + handler
fs.writeFileSync(path.join(apiFuncDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
fs.writeFileSync(
  path.join(apiFuncDir, 'index.js'),
  `// Wraps the Express app; Vercel keeps the original req.url so /api/* routes match.
const { app, ready } = require('./backend/app');

module.exports = async (req, res) => {
  try {
    await ready;
  } catch (e) {
    console.error('Startup check failed:', e);
  }
  return app(req, res);
};
`,
);
fs.writeFileSync(
  path.join(apiFuncDir, '.vc-config.json'),
  JSON.stringify({
    handler: 'index.js',
    runtime: 'nodejs22.x',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
  }),
);

// 3. Route /api/* (and /uploads/*) to the api function, before the SPA catch-all,
//    and register the daily cron for the expiry check.
log('patching routes + cron...');
const cfgPath = path.join(outDir, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const apiRoutes = [
  { src: '/api/(.*)', dest: '/api' },
  { src: '/uploads/(.*)', dest: '/api' },
];
// insert before the catch-all route to /__server (keep "filesystem" handling first)
const catchAll = cfg.routes.findIndex((r) => r.dest === '/__server');
cfg.routes.splice(catchAll === -1 ? cfg.routes.length : catchAll, 0, ...apiRoutes);

cfg.crons = [{ path: '/api/cron/expiry-check', schedule: '0 6 * * *' }];

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
log('done. .vercel/output is ready.');
