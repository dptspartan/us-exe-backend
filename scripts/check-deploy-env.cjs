#!/usr/bin/env node
/**
 * Validate .env.dev / .env.prod before `deploy-supabase.cjs`.
 * Usage: node scripts/check-deploy-env.cjs [dev|prod|all]
 */
'use strict';

const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const TARGETS = { dev: '.env.dev', prod: '.env.prod' };
const REQUIRED = [
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'E2EE_MASTER_KEY',
];

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

function jwtRef(anonKey) {
  try {
    const payload = anonKey.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return json.ref ?? null;
  } catch {
    return null;
  }
}

function checkTarget(name) {
  const rel = TARGETS[name];
  const filePath = join(root, rel);
  const issues = [];

  if (!existsSync(filePath)) {
    return [`${rel} file missing`];
  }

  const env = parseEnvFile(filePath);
  for (const key of REQUIRED) {
    if (!env[key]?.trim()) issues.push(`${key} is empty`);
  }

  const ref = env.SUPABASE_PROJECT_REF?.trim();
  const url = env.SUPABASE_URL?.trim();
  if (ref && url && !url.includes(ref)) {
    issues.push('SUPABASE_URL does not match SUPABASE_PROJECT_REF');
  }

  const anonRef = jwtRef(env.SUPABASE_ANON_KEY ?? '');
  if (ref && anonRef && anonRef !== ref) {
    issues.push('SUPABASE_ANON_KEY JWT ref does not match SUPABASE_PROJECT_REF');
  }

  if (env.E2EE_MASTER_KEY && env.E2EE_MASTER_KEY.length < 32) {
    issues.push('E2EE_MASTER_KEY should be at least 32 characters');
  }

  if (issues.length) return issues.map((i) => `${rel}: ${i}`);
  return [];
}

function main() {
  const which = process.argv[2] || 'all';
  const names =
    which === 'all' ? Object.keys(TARGETS) : which in TARGETS ? [which] : null;

  if (!names) {
    console.error('Usage: node scripts/check-deploy-env.cjs [dev|prod|all]');
    process.exit(1);
  }

  const allIssues = names.flatMap(checkTarget);

  if (names.length === 2 && names.every((n) => existsSync(join(root, TARGETS[n])))) {
    const dev = parseEnvFile(join(root, TARGETS.dev));
    const prod = parseEnvFile(join(root, TARGETS.prod));
    if (
      dev.E2EE_MASTER_KEY &&
      prod.E2EE_MASTER_KEY &&
      dev.E2EE_MASTER_KEY === prod.E2EE_MASTER_KEY
    ) {
      allIssues.push('E2EE_MASTER_KEY must differ between dev and prod');
    }
  }

  if (allIssues.length) {
    console.error('\n[check-deploy-env] Not ready:\n');
    for (const issue of allIssues) console.error(`  - ${issue}`);
    console.error('');
    process.exit(1);
  }

  for (const name of names) {
    console.log(`[check-deploy-env] ${TARGETS[name]} OK`);
  }
}

main();
