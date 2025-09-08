#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine mode
const modeArg = process.argv.find(a => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'local'; // default local

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

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !INGEST_EMAIL_DOMAIN) {
  console.warn(`[build] Warning: SUPABASE_URL or SUPABASE_ANON_KEY or INGEST_EMAIL_DOMAIN missing in ${envPath}. Settings fallback may be required.`);
}

const define = {
  SUPABASE_URL: JSON.stringify(SUPABASE_URL),
  SUPABASE_ANON_KEY: JSON.stringify(SUPABASE_ANON_KEY),
  INGEST_EMAIL_DOMAIN: JSON.stringify(INGEST_EMAIL_DOMAIN),
  ENV: JSON.stringify(ENV)
};

const entry = resolve(projectRoot, 'src/main.ts');
// Emit into dedicated folders so we can install both dev and prod side-by-side
const outDir = resolve(projectRoot, 'dist', mode === 'prod' ? 'prod' : 'local');
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
  // Copy/transform manifest.json next to the built main.js
  const manifestSrc = resolve(projectRoot, 'manifest.json');
  const manifestDst = join(outDir, 'manifest.json');
  if (existsSync(manifestSrc)) {
    if (mode === 'prod') {
      copyFileSync(manifestSrc, manifestDst);
    } else {
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
  }
  // Copy sourcemap if present
  const mapSrc = `${outfile}.map`;
  const mapDst = join(outDir, 'main.js.map');
  if (existsSync(mapSrc)) {
    copyFileSync(mapSrc, mapDst);
  }
  // console.log(`[build] Built (${mode}) -> ${outfile}`);
  // console.log(`[build] Ready to symlink: ${outDir}`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
