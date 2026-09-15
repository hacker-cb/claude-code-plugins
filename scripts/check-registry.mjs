#!/usr/bin/env node
// check-registry.mjs — does every rule the refactor moved still exist somewhere?
//
// A refactor that deletes 4500 lines of instructions cannot be reviewed by reading the
// diff: "this no longer handles X" is true of the diff and false of the tree, because X
// moved. tests/rule-registry.tsv records where each rule went; this checks the record.
//
// A row is checked once its state is `done`. `pending` rows are the work not yet taken —
// counted, never failed — so the gate stays honest while the refactor is in flight.
// --strict refuses any pending row, which is what the final slice runs.
//
// Usage: node scripts/check-registry.mjs [--registry <file>] [--strict]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DROPPED = '(dropped)';
const USAGE = 'usage: node scripts/check-registry.mjs [--registry <file>] [--strict]\n';

function die(message) {
  process.stderr.write(`check-registry: ${message}\n${USAGE}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
let registryPath = 'tests/rule-registry.tsv';
let strict = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--strict') { strict = true; continue; }
  if (argv[i] === '--registry') {
    if (argv[i + 1] === undefined) die('--registry needs a value');
    registryPath = argv[i + 1];
    i += 1;
    continue;
  }
  die(`unknown argument '${argv[i]}'`);
}

const repoRoot = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) die('not inside a git checkout');
  return r.stdout.trim();
})();

// An absolute --registry is taken as it stands: joining it onto the repo root would
// build a path under the checkout that does not exist, and report the file as missing.
const registryAbs = isAbsolute(registryPath) ? registryPath : join(repoRoot, registryPath);
// A missing registry is not an empty one: the refactor's whole safety net would read as
// green. Say which it was.
if (!existsSync(registryAbs)) die(`no registry at ${registryPath}`);

const rows = [];
readFileSync(registryAbs, 'utf8').split('\n').forEach((line, i) => {
  if (!line.trim() || line.startsWith('#')) return;
  const cells = line.split('\t');
  if (cells.length < 6) {
    die(`${registryPath}:${i + 1}: needs six tab-separated columns, got ${cells.length}`);
  }
  // Trimmed: a CRLF checkout leaves `\r` on the last cell, and an assert compared with
  // it never matches anything — a red that says nothing about the rule it guards.
  const [id, state, rule, source, target, assertText] = cells.map((c) => c.trim());
  // An empty assert passes every check there is (`includes('')` is always true), so a
  // row carrying one asserts nothing while reading as green.
  if (!assertText) die(`${registryPath}:${i + 1}: empty assert — the row would pass vacuously`);
  rows.push({ id, state, rule, source, target, assertText, line: i + 1 });
});

if (rows.length === 0) die(`${registryPath} holds no row`);

// Every markdown file the plugins carry, read once: a (dropped) row has to be checked
// against all of them, and re-reading the tree per row would be quadratic for nothing.
const pluginFiles = new Map();
(function walk(dir) {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs)) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel);
    else if (entry.endsWith('.md')) pluginFiles.set(rel, readFileSync(join(repoRoot, rel), 'utf8'));
  }
}('plugins'));

// Markdown wraps, so a phrase measured on one line can end up split across two without
// a word of it changing. Compared raw, `prose copies drift` then "is not there" while it
// plainly is — a false green in the one check that is supposed to prove a removal.
const flatten = (text) => text.replace(/\s+/g, ' ');

const failures = [];
let checked = 0;
let pending = 0;

for (const row of rows) {
  if (row.state === 'pending') { pending += 1; continue; }
  if (row.state !== 'done') {
    failures.push(`${row.id}: unknown state '${row.state}' (known: pending, done)`);
    continue;
  }
  checked += 1;

  if (row.target === DROPPED) {
    // Against the source file alone, never the whole tree. The same wording can live
    // elsewhere as ordinary prose a slice never touches — `plugins/hcb-dev/README.md`
    // explains the same idea to a human reader — and searching everywhere would fail
    // this row over text nobody asked it to remove, while telling us nothing about
    // whether it left the file it was recorded in.
    const sourceFile = row.source.replace(/:\d+@.*$/, '');
    const text = pluginFiles.get(sourceFile);
    if (text === undefined) {
      // "The file is not there" is not "the text is gone": this refactor renames and
      // moves files, so the wording may have travelled with one. A typo in the path
      // reads identically. Either way the row proves nothing and must not pass.
      failures.push(`${row.id}: source ${sourceFile} is not in the tree — renamed, moved`
        + ', or a typo; re-point the row at where the text lives now');
      continue;
    }
    if (flatten(text).includes(flatten(row.assertText))) {
      failures.push(`${row.id}: ${sourceFile} still carries the dropped text`
        + ` — "${row.assertText}"`);
    }
    continue;
  }

  const text = pluginFiles.get(row.target);
  if (text === undefined) {
    failures.push(`${row.id}: target does not exist — ${row.target}`);
    continue;
  }
  if (!text.includes(row.assertText)) {
    failures.push(`${row.id}: ${row.target} does not carry its assert — "${row.assertText}"`);
  }
}

if (strict && pending) {
  failures.push(`--strict: ${pending} row(s) still pending — every rule must have moved`);
}

process.stdout.write(`registry: ${rows.length} rows — ${checked} checked, ${pending} pending\n`);
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.stdout.write(`\n${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write('all checked rows resolve\n');
