#!/usr/bin/env node
// check-fixtures.mjs — no private data reaches this public repository through a fixture.
//
// Fixtures are taken from real closed pull requests, because a made-up envelope teaches
// a script the shape its author imagined rather than the shape a forge sends. What makes
// them safe is that only the STRUCTURE is kept: every value that could identify a
// repository, a person, a branch or a commit is replaced before the file is written.
//
// This checks the result, and it checks by allow-list rather than by deny-list. A
// deny-list would have to name the very things it protects — real logins, real
// repositories — inside a public repo, which is the leak it was meant to stop. So
// instead: identifying values must match the invented shapes below, and anything else is
// a failure whether or not anyone thought of it in advance.
//
// Usage: node scripts/check-fixtures.mjs [--dir <fixtures root>]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The invented shapes. A sanitizer writes these; anything else is real data that leaked.
const SHAPES = {
  // Commit ids: 40 hex, but always led by a marker no real sha carries by accident.
  sha: /^f1x7[0-9a-f]{36}$/,
  // Anything naming a person, a bot, an owner or a repository. The bots below are kept
  // verbatim by the collector — their exact logins are what a filter under test has to
  // match, and they identify nobody — so the shape has to admit them too, or the gate
  // rejects what the sanitizer is supposed to produce.
  actor: /^(example|fixture|octo)[a-z0-9-]*(\[bot\])?$|^(copilot(-pull-request-reviewer)?|github-actions|dependabot)(\[bot\])?$/i,
  // Repositories and their owners, written as one string.
  repo: /^(example|fixture)[a-z0-9-]*\/(example|fixture)[a-z0-9-]*$/i,
  // Branch and ref names.
  ref: /^(example|fixture|main|master|dev|HEAD)[a-z0-9\/_-]*$/i,
  // URLs point at a host that does not exist.
  url: /^https:\/\/(github|gitlab)\.example(\/|$)/,
};

const KEY_SHAPE = [
  [/(^|_)(sha|oid)$|^commit_id$|^head_sha$|^merge_commit_sha$|^squash_commit_sha$/i, 'sha'],
  [/^(login|user|actor|owner|author|assignee|committer)$|_login$/i, 'actor'],
  [/^(full_name|nameWithOwner|repository|ruleset_source)$/i, 'repo'],
  [/^(ref|head_ref|base_ref|headRefName|baseRefName|branch|source_branch|target_branch)$/i, 'ref'],
  [/url$/i, 'url'],
];

// A real commit id anywhere in a value, whatever key it sits under.
const LOOSE_SHA = /\b(?!f1x7)[0-9a-f]{40}\b/;
// A real forge host anywhere at all.
const LOOSE_HOST = /\b(github|gitlab)\.com\b/i;

// The check above reads what it can see, and a forge's `node_id` is base64 of an object
// id — so a sha can sit inside a value that looks like nothing at all. Decode anything
// long enough to be packed data and look again. A probe that only reads the plain text
// is narrower than the thing it is probing for, which is how a leak passes a green gate.
function packedLeak(value) {
  if (!/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(value)) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  // A forge's node id is a prefix followed by base64 that is not aligned to the start of
  // the string, so decoding it whole returns noise. Try each of the four alignments, and
  // every suffix that could still hold a packed id: decoding is cheap and a leak that
  // only shows at offset 3 is a leak.
  for (let start = 0; start + 40 <= normalized.length; start += 1) {
    let decoded;
    try {
      decoded = Buffer.from(normalized.slice(start), 'base64').toString('utf8');
    } catch { continue; }
    if (LOOSE_SHA.test(decoded)) return 'a commit id';
    if (LOOSE_HOST.test(decoded)) return 'a forge host';
  }
  return null;
}

// Every detector above is checked against a value that must trip it and one that must
// not. A guard nothing can kill is a guard nobody proved, and these run in CI beside the
// real check — where a regex quietly stopping matching would otherwise read as "clean".
const SELF_TEST = [
  ['sha in the open', '18b5c1fd43f39a3a411db365e946c95f4e4d5ce3', true, (v) => LOOSE_SHA.test(v)],
  ['invented sha passes', `f1x7${'a'.repeat(36)}`, false, (v) => LOOSE_SHA.test(v)],
  ['real host', 'https://github.com/x/y', true, (v) => LOOSE_HOST.test(v)],
  ['invented host passes', 'https://github.example/x/y', false, (v) => LOOSE_HOST.test(v)],
  ['sha packed in a node id',
    'C_kwDOQCrDrNoAKDAzOTUxNGNkNTljYTllODJmN2I4ODUyNWI2NzgwZTJhNzYwZGUzODI',
    true, (v) => packedLeak(v) !== null],
  ['a timestamp is not packed data', '2026-09-15T19:42:06Z', false, (v) => packedLeak(v) !== null],
  ['an invented id is not packed data', 'example-id-82b8fa89', false, (v) => packedLeak(v) !== null],
  ['a human login fails the actor shape', 'real-person-42', false, (v) => SHAPES.actor.test(v)],
  ['an invented login passes', 'example-user-1a2b', true, (v) => SHAPES.actor.test(v)],
  ['a bot login is kept verbatim', 'copilot-pull-request-reviewer[bot]', true,
    (v) => SHAPES.actor.test(v)],
];

function selfTest() {
  const bad = [];
  for (const [name, value, want, probe] of SELF_TEST) {
    const got = probe(value);
    if (got !== want) bad.push(`${name}: expected ${want}, got ${got} — "${value}"`);
  }
  process.stdout.write(`self-test: ${SELF_TEST.length} probe(s)\n`);
  for (const b of bad) process.stdout.write(`  FAIL  ${b}\n`);
  if (bad.length) {
    process.stdout.write(`\n${bad.length} detector(s) no longer work\n`);
    process.exit(1);
  }
  process.stdout.write('every detector reads both ways\n');
  process.exit(0);
}

const USAGE = 'usage: node scripts/check-fixtures.mjs [--dir <fixtures root>] [--self-test]\n';

function die(message) {
  process.stderr.write(`check-fixtures: ${message}\n${USAGE}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
let root = 'tests/suites';
let rootWasGiven = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--self-test') { selfTest(); }
  if (argv[i] !== '--dir') die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die('--dir needs a value');
  root = argv[i + 1];
  rootWasGiven = true;
  i += 1;
}

const repoRoot = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) die('not inside a git checkout');
  return r.stdout.trim();
})();

const rootAbs = isAbsolute(root) ? root : join(repoRoot, root);
if (!existsSync(rootAbs)) die(`no directory at ${root}`);

// Two kinds of fixture, and they earn different checks. A fixture written by hand is
// synthetic: it never touched a private repository, and holding it to the invented
// shapes would fail honest names like `release/1.x`. A fixture CAPTURED from a real pull
// request is the one this file exists for, and a `CAPTURED` marker beside it says so —
// written by the collector, never by hand.
//
// The loose checks below run over both: a real commit id or a real forge host has no
// business in either, and that guard costs nothing.
const fixtures = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) { walk(abs); continue; }
    if (!entry.endsWith('.json') || !abs.includes(`${join('', 'fixtures')}/`)) continue;
    const captured = existsSync(join(dir, 'CAPTURED'));
    fixtures.push({ abs, captured });
  }
}(rootAbs));

const failures = [];

function inspect(node, path, file, keyName, captured) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => inspect(item, `${path}[${i}]`, file, keyName, captured));
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      inspect(value, `${path}.${key}`, file, key, captured);
    }
    return;
  }
  if (typeof node !== 'string') return;

  if (LOOSE_SHA.test(node)) {
    failures.push(`${file}: ${path} carries what looks like a real commit id — "${node}"`);
    return;
  }
  if (LOOSE_HOST.test(node)) {
    failures.push(`${file}: ${path} names a real forge host — "${node}"`);
    return;
  }
  const packed = packedLeak(node);
  if (packed) {
    failures.push(`${file}: ${path} decodes to ${packed} — "${node}"`);
    return;
  }
  if (!captured || !keyName) return;
  for (const [keyPattern, shape] of KEY_SHAPE) {
    if (!keyPattern.test(keyName)) continue;
    if (SHAPES[shape].test(node)) return;
    failures.push(`${file}: ${path} is a ${shape} outside the invented shape — "${node}"`);
    return;
  }
}

let capturedCount = 0;
for (const { abs, captured } of fixtures) {
  if (captured) capturedCount += 1;
  // Only strip the repo root when the path is actually under it: a --dir elsewhere
  // would otherwise be reported with its first characters cut off.
  const rel = abs.startsWith(`${repoRoot}/`) ? abs.slice(repoRoot.length + 1) : abs;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    // Unparseable is not clean: it is a fixture nothing could inspect.
    failures.push(`${rel}: not valid JSON — ${error.message}`);
    continue;
  }
  inspect(parsed, '$', rel, null, captured);
}

process.stdout.write(`fixtures: ${fixtures.length} file(s) under ${root}`
  + `, ${capturedCount} captured\n`);

// An explicit --dir naming a directory with no fixture in it is a question that went
// unanswered, not a clean answer: the caller pointed at something it wanted checked.
// Under the default root, zero is the honest state of a tree that has captured nothing
// yet.
if (rootWasGiven && fixtures.length === 0) {
  process.stdout.write(`  FAIL  ${root} holds no fixture — nothing was checked\n`);
  process.exit(1);
}
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.stdout.write(`\n${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write(fixtures.length ? 'no private data found\n' : 'nothing to check yet\n');
