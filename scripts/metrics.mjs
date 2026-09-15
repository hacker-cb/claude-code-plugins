#!/usr/bin/env node
// metrics.mjs — how much instruction text a plugin carries, and what one skill costs to
// load. Prints a table on stdout, or JSON with --json.
//
// Three numbers matter, and only the third is obvious. Lines say how much there is.
// Words per sentence say how dense it is — prose an agent must parse, with fenced code
// excluded because a shell block is not a sentence. And the transitive closure of a
// skill's reference links says what invoking it actually costs: a 65-line skill whose
// references pull in twenty files is not a small skill.
//
// Usage: node scripts/metrics.mjs [--ref <git-ref>] [--plugin <name>] [--json]
//                                 [--baseline <file.json>]
//
// --ref measures a committed tree instead of the working one, which is how a baseline is
// taken from `origin/master` rather than from whatever the branch has already changed.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const CEILINGS = { skill: 200, reference: 150 };
// Two references are exempt: both are lookup tables that are supposed to grow, and a
// ceiling over them would lock the very layer the refactor exists to create.
const EXEMPT = new Set(['forge-docs.md', 'forge-behaviour.md']);

const USAGE = 'usage: node scripts/metrics.mjs [--ref <git-ref>] [--plugin <name>]'
  + ' [--json] [--baseline <file.json>]\n';

function die(message) {
  process.stderr.write(`metrics: ${message}\n${USAGE}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opts = { ref: null, plugin: 'hcb-dev', json: false, baseline: null };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (flag === '--json') { opts.json = true; continue; }
  if (!['--ref', '--plugin', '--baseline'].includes(flag)) die(`unknown argument '${flag}'`);
  if (value === undefined) die(`${flag} needs a value`);
  opts[flag.slice(2)] = value;
  i += 1;
}

const repoRoot = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) die('not inside a git checkout');
  return r.stdout.trim();
})();

const pluginDir = `plugins/${opts.plugin}`;

// One reader for both modes, so every measurement below is written once. A ref reads
// through git, the working tree through fs; nothing else in this file knows which.
const source = opts.ref
  ? {
    list() {
      const r = spawnSync('git', ['ls-tree', '-r', '--name-only', opts.ref, '--', pluginDir],
        { encoding: 'utf8', cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
      if (r.status !== 0) die(`cannot read ${opts.ref}: ${(r.stderr || '').trim()}`);
      return r.stdout.split('\n').filter((p) => p.endsWith('.md'));
    },
    read(path) {
      const r = spawnSync('git', ['show', `${opts.ref}:${path}`],
        { encoding: 'utf8', cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
      return r.status === 0 ? r.stdout : null;
    },
  }
  : {
    list() {
      const out = [];
      const walk = (dir) => {
        for (const entry of readdirSync(join(repoRoot, dir))) {
          const rel = `${dir}/${entry}`;
          if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel);
          else if (entry.endsWith('.md')) out.push(rel);
        }
      };
      if (!existsSync(join(repoRoot, pluginDir))) die(`no plugin at ${pluginDir}`);
      walk(pluginDir);
      return out;
    },
    read(path) {
      const abs = join(repoRoot, path);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    },
  };

// Indented fences count too: a block inside a list item carries the same shell, and
// leaving it in the prose totals inflates the word and sentence counts with code — then
// shifts them again the day someone merely un-indents it.
const stripFences = (text) => text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');

function measure(text) {
  // What `wc -l` counts: a trailing newline ends the last line rather than starting an
  // empty one. Counting the split's elements instead adds one per file, which inflates
  // every total and puts a file exactly at its ceiling over it.
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const prose = stripFences(text);
  const words = prose.split(/\s+/).filter(Boolean).length;
  // Sentence-enders followed by whitespace. Crude on purpose: what is compared is the
  // same crudeness before and after, and a parser here would be a dependency.
  const sentences = (prose.match(/[.!?](\s|$)/g) || []).length;
  let fenced = 0;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^[ \t]*```/.test(line)) { inFence = !inFence; fenced += 1; continue; }
    if (inFence) fenced += 1;
  }
  return { lines, words, sentences, fenced };
}

// Relative markdown links only. A `${CLAUDE_PLUGIN_ROOT}` path or an http URL is not a
// file this tree can follow, and counting it would inflate the closure with nothing.
function linksOf(path, text) {
  const out = new Set();
  for (const m of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const target = m[1];
    if (/^https?:/.test(target) || target.includes('$')) continue;
    out.add(normalize(join(dirname(path), target)));
  }
  return out;
}

const files = new Map();
for (const path of source.list()) {
  const text = source.read(path);
  if (text === null) continue;
  files.set(path, { text, ...measure(text) });
}
if (files.size === 0) die(`no markdown under ${pluginDir}${opts.ref ? ` at ${opts.ref}` : ''}`);

const links = new Map();
for (const [path, file] of files) links.set(path, linksOf(path, file.text));

function closure(seed) {
  const seen = new Set();
  const stack = [seed];
  while (stack.length) {
    const path = stack.pop();
    if (seen.has(path) || !files.has(path)) continue;
    seen.add(path);
    for (const next of links.get(path) || []) stack.push(next);
  }
  return seen;
}

const isSkill = (p) => p.endsWith('/SKILL.md');
const isReadme = (p) => p.endsWith('/README.md');

const totals = { files: 0, lines: 0, words: 0, sentences: 0, fenced: 0 };
for (const [path, file] of files) {
  if (isReadme(path)) continue;          // a README is for people, not for the agent
  totals.files += 1;
  totals.lines += file.lines;
  totals.words += file.words;
  totals.sentences += file.sentences;
  totals.fenced += file.fenced;
}
totals.wordsPerSentence = totals.sentences ? +(totals.words / totals.sentences).toFixed(1) : 0;

const skills = [];
for (const path of [...files.keys()].filter(isSkill).sort()) {
  const reached = closure(path);
  let lines = 0;
  for (const p of reached) lines += files.get(p).lines;
  skills.push({
    name: path.split('/').slice(-2)[0],
    own: files.get(path).lines,
    closureFiles: reached.size,
    closureLines: lines,
  });
}

const over = [];
for (const [path, file] of files) {
  if (isReadme(path)) continue;
  const base = path.split('/').pop();
  if (EXEMPT.has(base)) continue;
  const ceiling = isSkill(path) ? CEILINGS.skill : CEILINGS.reference;
  if (file.lines > ceiling) over.push({ path, lines: file.lines, ceiling });
}
over.sort((a, b) => b.lines - a.lines);

const report = {
  ref: opts.ref || 'working tree',
  plugin: opts.plugin,
  totals,
  skills: skills.sort((a, b) => b.closureLines - a.closureLines),
  overCeiling: over,
};

if (opts.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const baseline = opts.baseline
  ? JSON.parse(readFileSync(relative(process.cwd(), opts.baseline) || opts.baseline, 'utf8'))
  : null;
const delta = (now, was) => (was === undefined || was === null ? '' : ` (${now - was >= 0 ? '+' : ''}${now - was})`);

const b = baseline ? baseline.totals : {};
process.stdout.write(`${report.plugin} @ ${report.ref}\n\n`);
process.stdout.write(`  markdown files      ${totals.files}${delta(totals.files, b.files)}\n`);
process.stdout.write(`  lines               ${totals.lines}${delta(totals.lines, b.lines)}\n`);
process.stdout.write(`  prose words         ${totals.words}${delta(totals.words, b.words)}\n`);
process.stdout.write(`  words per sentence  ${totals.wordsPerSentence}\n`);
process.stdout.write(`  lines inside fences ${totals.fenced}${delta(totals.fenced, b.fenced)}\n\n`);

process.stdout.write('  skill                      own   files   closure\n');
for (const s of report.skills) {
  process.stdout.write(`  ${s.name.padEnd(24)}${String(s.own).padStart(5)}`
    + `${String(s.closureFiles).padStart(8)}${String(s.closureLines).padStart(10)}\n`);
}

if (over.length) {
  process.stdout.write(`\n  over ceiling (${over.length}):\n`);
  for (const o of over) {
    process.stdout.write(`    ${String(o.lines).padStart(5)} > ${o.ceiling}   ${o.path}\n`);
  }
} else {
  process.stdout.write('\n  over ceiling: none\n');
}
