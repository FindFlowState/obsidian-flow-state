#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine mode and flags
const modeArg = process.argv.find(a => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'local'; // default local
const skipSentry = process.argv.includes('--skip-sentry');

// Resolve env file path
const projectRoot = resolve(__dirname, '..'); // apps/obsidian_plugin
// Repo root is two levels up from projectRoot: <repo>/
const repoRoot = resolve(projectRoot, '..', '..');
const envPath = mode === 'prod'
  ? resolve(repoRoot, '.env.prod')
  : resolve(repoRoot, '.env.local'); // envs moved to repo root

function parseEnvFile(p) {
  if (!existsSync(p)) return {};
  const txt = readFileSync(p, 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = parseEnvFile(envPath);
const SUPABASE_URL = env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
const INGEST_EMAIL_DOMAIN = env.INGEST_EMAIL_DOMAIN || '';
const ENV = env.ENV || (mode === 'prod' ? 'prod' : 'local');
const SENTRY_DSN = mode === 'prod' ? (env.SENTRY_DSN_OBSIDIAN || '') : '';
const SENTRY_AUTH_TOKEN = env.SENTRY_AUTH_TOKEN || '';

// Read version from manifest for Sentry release
const manifestPath = resolve(projectRoot, 'manifest.json');
const manifestData = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const SENTRY_RELEASE = `flow-state-obsidian@${manifestData.version || '0.0.0'}`;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !INGEST_EMAIL_DOMAIN) {
  console.warn(`[build] Warning: SUPABASE_URL or SUPABASE_ANON_KEY or INGEST_EMAIL_DOMAIN missing in ${envPath}. Settings fallback may be required.`);
}

if (mode === 'prod' && !SENTRY_DSN) {
  console.warn(`[build] Warning: SENTRY_DSN_OBSIDIAN missing in ${envPath}. Sentry error tracking will be disabled.`);
}

const define = {
  SUPABASE_URL: JSON.stringify(SUPABASE_URL),
  SUPABASE_ANON_KEY: JSON.stringify(SUPABASE_ANON_KEY),
  INGEST_EMAIL_DOMAIN: JSON.stringify(INGEST_EMAIL_DOMAIN),
  ENV: JSON.stringify(ENV),
  SENTRY_DSN: JSON.stringify(SENTRY_DSN),
  SENTRY_RELEASE: JSON.stringify(SENTRY_RELEASE),
};

const entry = resolve(projectRoot, 'src/main.ts');
// Output locations:
// - prod: emit main.js at project root (next to manifest.json)
// - local: emit to dist/local/main.js
const outDir = mode === 'prod'
  ? resolve(projectRoot, 'dist', 'prod')
  : resolve(projectRoot, 'dist', 'local');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, 'main.js');

const common = {
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: 'cjs',
  platform: 'browser',
  sourcemap: true,
  external: ['obsidian'],
  define,
};

build(common).then(() => {
  // Manifest handling:
  // - prod: manifest already lives at project root next to outfile, no change
  // - local: write a dev manifest into dist/local with modified id/name
  const manifestSrc = resolve(projectRoot, 'manifest.json');
  const manifestDst = join(outDir, 'manifest.json');
  if (existsSync(manifestSrc) && mode == 'prod') {
    // For prod, also place a copy of manifest.json in dist/prod for easy release uploads
    copyFileSync(manifestSrc, manifestDst);
    const versionsSrc = resolve(projectRoot, 'versions.json');
    const versionsDst = join(outDir, 'versions.json');
    if (existsSync(versionsSrc)) {
      copyFileSync(versionsSrc, versionsDst);
    }
  }
  if (existsSync(manifestSrc) && mode !== 'prod') {
    // local/dev manifest: override id and name so Obsidian treats it as a separate plugin
    const raw = readFileSync(manifestSrc, 'utf8');
    const json = JSON.parse(raw);
    json.id = 'flow-state-obsidian-dev';
    json.name = 'Flow State (Dev)';
    // keep all other fields identical
    const pretty = JSON.stringify(json, null, 2);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(manifestDst, pretty);
  }
  // Copy sourcemap if present
  const mapSrc = `${outfile}.map`;
  const mapDst = join(outDir, 'main.js.map');
  if (existsSync(mapSrc)) {
    copyFileSync(mapSrc, mapDst);
  }

  // Upload source maps to Sentry for prod builds (skip with --skip-sentry)
  if (mode === 'prod' && SENTRY_AUTH_TOKEN && SENTRY_DSN && !skipSentry) {
    console.log(`[build] Uploading source maps to Sentry (release: ${SENTRY_RELEASE})...`);
    try {
      execSync(
        `npx sentry-cli releases new ${SENTRY_RELEASE} --org=dune-ventures --project=flowstate-obsidian`,
        { stdio: 'inherit', env: { ...process.env, SENTRY_AUTH_TOKEN } }
      );
      execSync(
        `npx sentry-cli sourcemaps upload --org=dune-ventures --project=flowstate-obsidian --release=${SENTRY_RELEASE} ${outDir}`,
        { stdio: 'inherit', env: { ...process.env, SENTRY_AUTH_TOKEN } }
      );
      console.log(`[build] Source maps uploaded to Sentry`);
    } catch (e) {
      console.warn(`[build] Warning: Failed to upload source maps to Sentry:`, e.message);
    }
  }
  // console.log(`[build] Built (${mode}) -> ${outfile}`);
  // console.log(`[build] Ready to symlink: ${outDir}`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
