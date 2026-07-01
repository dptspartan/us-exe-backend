#!/usr/bin/env node
/**
 * Deploy Supabase migrations + edge functions to dev or prod.
 *
 * Usage:
 *   node scripts/deploy-supabase.cjs dev              # push to dev only
 *   node scripts/deploy-supabase.cjs prod             # push to production (prompts)
 *   node scripts/deploy-supabase.cjs promote          # dev first, then prod (prompts)
 *   node scripts/deploy-supabase.cjs prod --yes       # skip confirmation
 *
 * Requires: Supabase CLI logged in (`supabase login`) and env files:
 *   .env.dev  — staging project
 *   .env.prod — production project
 *
 * Fill SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_PASSWORD from the dashboard
 * (Project Settings → API / Database). EXPO_ACCESS_TOKEN is optional.
 */
'use strict';

const { existsSync, readFileSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');
const readline = require('readline');

const root = join(__dirname, '..');
const ENV_FILES = { dev: '.env.dev', prod: '.env.prod' };
const FUNCTIONS = ['send-spark-push', 'send-sticky-note-push', 'get-couple-cek'];
const REQUIRED_KEYS = ['SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];

function fail(msg) {
  console.error(`\n[deploy-supabase] ${msg}\n`);
  process.exit(1);
}

function parseEnvFile(filePath) {
  const env = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function loadTargetEnv(target) {
  const rel = ENV_FILES[target];
  if (!rel) fail(`Unknown target "${target}". Use dev, prod, or promote.`);
  const filePath = join(root, rel);
  if (!existsSync(filePath)) {
    fail(`Missing ${rel}. Copy .env.example → ${rel} and fill in secrets.`);
  }
  const env = parseEnvFile(filePath);
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) fail(`${rel} must set ${key}`);
  }
  return { env, rel };
}

function supabaseBin() {
  const check = spawnSync('supabase', ['--version'], { encoding: 'utf8' });
  if (check.status === 0) return 'supabase';
  fail(
    'Supabase CLI not found. Install: https://supabase.com/docs/guides/cli/getting-started\n' +
      'Then run: supabase login',
  );
}

function run(bin, args, extraEnv = {}) {
  const result = spawnSync(bin, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ask(question) {
  if (process.argv.includes('--yes')) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function deployTarget(target, { db = true, functions = true, secrets = true } = {}) {
  const { env, rel } = loadTargetEnv(target);
  const bin = supabaseBin();
  const ref = env.SUPABASE_PROJECT_REF;

  console.log(`\n[deploy-supabase] → ${target} (${ref})\n`);

  const linkArgs = ['link', '--project-ref', ref];
  if (env.SUPABASE_DB_PASSWORD) {
    linkArgs.push('--password', env.SUPABASE_DB_PASSWORD);
  }
  run(bin, linkArgs);

  if (db) {
    console.log('\n[deploy-supabase] db push\n');
    run(bin, ['db', 'push']);
  }

  if (functions) {
    console.log('\n[deploy-supabase] functions deploy\n');
    for (const name of FUNCTIONS) {
      run(bin, ['functions', 'deploy', name]);
    }
  }

  if (secrets && env.EXPO_ACCESS_TOKEN) {
    console.log('\n[deploy-supabase] secrets set EXPO_ACCESS_TOKEN\n');
    run(bin, ['secrets', 'set', `EXPO_ACCESS_TOKEN=${env.EXPO_ACCESS_TOKEN}`]);
  } else if (secrets && !env.EXPO_ACCESS_TOKEN) {
    console.log('[deploy-supabase] Skipping EXPO_ACCESS_TOKEN (not set in ' + rel + ')');
  }

  if (secrets && env.E2EE_MASTER_KEY) {
    console.log('\n[deploy-supabase] secrets set E2EE_MASTER_KEY\n');
    run(bin, ['secrets', 'set', `E2EE_MASTER_KEY=${env.E2EE_MASTER_KEY}`]);
  } else if (secrets) {
    console.warn('[deploy-supabase] WARNING: E2EE_MASTER_KEY not set in ' + rel);
  }

  console.log(`\n[deploy-supabase] ✓ ${target} complete\n`);
}

async function main() {
  const command = process.argv[2];
  const skipDb = process.argv.includes('--skip-db');
  const skipFunctions = process.argv.includes('--skip-functions');
  const opts = { db: !skipDb, functions: !skipFunctions };

  if (!command || !['dev', 'prod', 'promote', 'help', '--help', '-h'].includes(command)) {
    fail(
      'Usage: node scripts/deploy-supabase.cjs <dev|prod|promote> [--yes] [--skip-db] [--skip-functions]',
    );
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(readFileSync(__filename, 'utf8').slice(0, 900));
    return;
  }

  if (command === 'dev') {
    deployTarget('dev', opts);
    return;
  }

  if (command === 'prod') {
    if (!(await ask('Deploy migrations + functions to PRODUCTION?'))) {
      console.log('Aborted.');
      return;
    }
    deployTarget('prod', opts);
    return;
  }

  if (command === 'promote') {
    deployTarget('dev', opts);
    console.log('[deploy-supabase] Dev deploy finished. Test staging before promoting.\n');
    if (!(await ask('Promote the same changes to PRODUCTION?'))) {
      console.log('Stopped after dev. Run `node scripts/deploy-supabase.cjs prod` when ready.');
      return;
    }
    deployTarget('prod', opts);
  }
}

main().catch((err) => fail(err.message ?? String(err)));
