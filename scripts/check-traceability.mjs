#!/usr/bin/env node
/**
 * Scenario traceability gate.
 *
 * Every `#### Scenario: <name>` in the OpenSpec source of truth (openspec/specs) and in
 * in-flight changes (openspec/changes/<id>/specs, excluding archive and REMOVED sections)
 * must be referenced by at least one test title containing `Scenario: <name>`.
 *
 * Usage: node scripts/check-traceability.mjs [--json] [--change <id>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const onlyChange = args.includes('--change') ? args[args.indexOf('--change') + 1] : undefined;

const TEST_DIRS = ['apps', 'packages', 'e2e'];
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'archive']);

function walk(dir, match, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}

/** Extracts scenario names from a spec file, ignoring REMOVED/RENAMED sections. */
function scenariosIn(file) {
  const scenarios = [];
  let section = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && !line.startsWith('###')) section = h2[1].toUpperCase();
    const sc = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
    if (sc && !section.startsWith('REMOVED') && !section.startsWith('RENAMED')) {
      scenarios.push(sc[1]);
    }
  }
  return scenarios;
}

const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const specFiles = onlyChange
  ? walk(join(root, 'openspec/changes', onlyChange, 'specs'), (f) => f.endsWith('spec.md'))
  : [
      ...walk(join(root, 'openspec/specs'), (f) => f.endsWith('spec.md')),
      ...walk(join(root, 'openspec/changes'), (f) => f.endsWith('spec.md')),
    ];

const testFiles = TEST_DIRS.flatMap((d) => walk(join(root, d), (f) => TEST_FILE.test(f)));
const testSources = testFiles.map((f) => ({
  file: relative(root, f),
  text: normalize(readFileSync(f, 'utf8')),
}));

const results = [];
for (const specFile of specFiles) {
  for (const scenario of scenariosIn(specFile)) {
    const needle = normalize(`Scenario: ${scenario}`);
    const coveredBy = testSources.filter((t) => t.text.includes(needle)).map((t) => t.file);
    results.push({ spec: relative(root, specFile), scenario, coveredBy });
  }
}

const missing = results.filter((r) => r.coveredBy.length === 0);

if (asJson) {
  console.log(JSON.stringify({ total: results.length, missing, results }, null, 2));
} else {
  for (const r of results) {
    const mark = r.coveredBy.length ? '✓' : '✗';
    const where = r.coveredBy.length ? r.coveredBy.join(', ') : 'NO TEST';
    console.log(`${mark} [${r.spec}] Scenario: ${r.scenario}  →  ${where}`);
  }
  console.log(
    `\n${results.length - missing.length}/${results.length} scenarios covered by tests` +
      (missing.length ? ` — ${missing.length} missing` : ''),
  );
  if (missing.length) {
    console.log("\nName a test after each missing scenario, e.g. it('Scenario: <name> — …', …)");
  }
}

process.exit(missing.length ? 1 : 0);
