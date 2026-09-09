#!/usr/bin/env node
// plugin-versions.mjs — which version of a plugin this session is running, which one is
// installed, which one came before it, and what the marketplace's own repository says now.
// Prints `key=value` lines on stdout and nothing else.
//
// Every answer degrades to `unknown` with a `<key>_reason` beside it: a number that could
// not be resolved is a line of the report, where a crash would take the whole re-read down
// with it. Exit 2 is kept for a call this script cannot act on at all — an unknown flag, a
// `--root` holding no plugin.
//
// Usage: node plugin-versions.mjs --root <plugin installation directory>
//
// The root comes from `${CLAUDE_PLUGIN_ROOT}`, which Claude Code substitutes into skill
// content: it names the tree this session's instructions were actually loaded from, which
// is the one question no registry can answer.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ORDER = [
  'plugin', 'marketplace',
  'loaded', 'loaded_root',
  'cache',
  'installed', 'installed_root', 'installed_source',
  'predecessor', 'predecessor_root',
  'upstream', 'upstream_repo',
  'read_root', 'reload_needed', 'update_pending',
];

const facts = new Map();
const set = (key, value, reason) => {
  facts.set(key, value);
  if (reason) facts.set(`${key}_reason`, reason);
};

const firstLine = (text) => (text || '').trim().split('\n')[0] || '';

function die(message) {
  process.stderr.write(`plugin-versions: ${message}\n`);
  process.stderr.write('usage: node plugin-versions.mjs --root <plugin installation directory>\n');
  process.exit(2);
}

// Never throws: a missing command is an answer ("unknown, because"), not an exception.
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) {
    return { ok: false, out: '', err: r.error.code === 'ENOENT' ? `${cmd} not found` : r.error.message };
  }
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// A cache directory is "named for the resolved version", which is a semver string for a
// plugin declaring one and a bare commit sha for one that does not. A sha carries no order,
// so it is left out of every comparison rather than sorted as text.
function parseVersion(value) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value || '');
  if (!m) return null;
  return { nums: [m[1], m[2], m[3]].map((n) => (n === undefined ? 0 : Number(n))), pre: m[4] || '' };
}

// null where either side is unorderable — the caller drops that candidate instead of
// ranking it, which is what keeps a sha-named sibling out of the maximum.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

const highest = (versions) =>
  versions.reduce((best, v) => {
    if (!parseVersion(v)) return best;
    if (best === null) return v;
    return compareVersions(v, best) === 1 ? v : best;
  }, null);

// ---------------------------------------------------------------- arguments

let root = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--root') {
    if (i + 1 >= argv.length) die('--root needs a value');
    root = argv[i + 1];
    i += 1;
  } else if (arg.startsWith('--root=')) {
    root = arg.slice('--root='.length);
  } else if (arg === '-h' || arg === '--help') {
    process.stdout.write('usage: node plugin-versions.mjs --root <plugin installation directory>\n');
    process.exit(0);
  } else {
    die(`unknown argument '${arg}'`);
  }
}
if (!root) die('--root is required — the plugin installation directory');

const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'));
if (!manifest) die(`no readable .claude-plugin/plugin.json under '${root}' — not a plugin root`);

// ------------------------------------------------------------------- loaded

const loaded = typeof manifest.version === 'string' ? manifest.version : null;
set('loaded', loaded || 'unknown', loaded ? null : 'the manifest declares no version');
set('loaded_root', root);

// The cache names each version's directory for the version itself, so a root whose own name
// is that version is one of those directories — and a root named anything else (a checkout,
// a --plugin-dir tree, a skills directory) has no siblings to compare or diff against.
const pluginDir = dirname(root);
const inCache = Boolean(loaded) && basename(root) === loaded;
set('cache', inCache ? 'present' : 'absent',
  inCache ? null : 'the root is not a version directory of the plugin cache');
set('plugin', inCache ? basename(pluginDir) : (manifest.name || basename(root)));
if (inCache) set('marketplace', basename(dirname(pluginDir)));

const plugin = facts.get('plugin');

// -------------------------------------------------------- versions on disk

const siblings = inCache
  ? readdirSync(pluginDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => existsSync(join(pluginDir, n, '.claude-plugin', 'plugin.json')))
  : [];

// ------------------------------------------------- what the registry installed

// The registry is the authority on what is installed: the cache also holds versions an
// update left orphaned, and after a downgrade its highest is not the one a restart loads.
let registry = null;
let registryReason = null;
const listed = run('claude', ['plugin', 'list', '--json']);
if (!listed.ok) {
  registryReason = `claude plugin list: ${firstLine(listed.err) || 'exited non-zero'}`;
} else {
  let parsed = null;
  try {
    parsed = JSON.parse(listed.out);
  } catch {
    parsed = null;
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.installed) ? parsed.installed : null);
  if (!entries) {
    registryReason = 'claude plugin list did not answer a JSON list';
  } else {
    const mine = entries.filter((e) => {
      if (!e || typeof e !== 'object') return false;
      if (typeof e.installPath === 'string' && (e.installPath === root || dirname(e.installPath) === pluginDir)) return true;
      return typeof e.id === 'string' && e.id.split('@')[0] === plugin;
    });
    if (mine.length === 0) {
      registryReason = `no entry for '${plugin}' — a plugin loaded with --plugin-dir is not listed`;
    } else {
      registry = highest(mine.map((e) => e.version).filter((v) => typeof v === 'string'));
      if (!registry) registryReason = 'the entries carry no orderable version';
      if (!facts.has('marketplace')) {
        const id = mine.map((e) => e.id).find((v) => typeof v === 'string' && v.includes('@'));
        if (id) set('marketplace', id.split('@')[1]);
      }
    }
  }
}

const fromCache = highest(siblings);
const installed = registry || fromCache || loaded;
set('installed', installed || 'unknown', installed ? null : (registryReason || 'no version could be resolved'));
set('installed_source', registry ? 'registry' : (fromCache ? 'cache' : 'loaded'),
  registry ? null : registryReason);

const installedRoot = installed && siblings.includes(installed) ? join(pluginDir, installed) : null;
set('installed_root', installedRoot || 'unknown',
  installedRoot ? null
    : (!inCache ? 'the root is outside the plugin cache'
      : (installed ? `no ${installed} directory beside the loaded one` : 'no installed version to point at')));

// ------------------------------------------------------------- predecessor

// The floor a diff stands on: the highest version below the one this session is running.
// Claude Code sweeps an orphaned version directory roughly two weeks after an update, so
// its absence is an ordinary answer and not a fault.
const below = loaded ? siblings.filter((v) => compareVersions(v, loaded) === -1) : [];
const predecessor = highest(below);
set('predecessor', predecessor || 'unknown',
  predecessor ? null
    : (!inCache ? 'the root is outside the plugin cache'
      : (!loaded ? 'the loaded version is unknown' : 'no earlier version is left in the cache')));
if (predecessor) set('predecessor_root', join(pluginDir, predecessor));

// ---------------------------------------------------------------- upstream

// Read through the marketplace's own git checkout rather than a forge API: a marketplace
// lives on GitHub, GitLab or a self-managed host alike, and git answers for all of them
// without a per-forge command or an authenticated CLI.
function resolveUpstream() {
  const marketplace = facts.get('marketplace');
  if (!marketplace) return { reason: 'the marketplace this plugin came from is unknown' };

  const listedMarkets = run('claude', ['plugin', 'marketplace', 'list', '--json']);
  if (!listedMarkets.ok) {
    return { reason: `claude plugin marketplace list: ${firstLine(listedMarkets.err) || 'exited non-zero'}` };
  }
  let markets = null;
  try {
    markets = JSON.parse(listedMarkets.out);
  } catch {
    markets = null;
  }
  if (!Array.isArray(markets)) return { reason: 'claude plugin marketplace list did not answer a JSON list' };
  const entry = markets.find((m) => m && m.name === marketplace);
  if (!entry) return { reason: `marketplace '${marketplace}' is not configured here` };
  const location = typeof entry.installLocation === 'string' ? entry.installLocation : null;
  if (!location) return { reason: `marketplace '${marketplace}' names no checkout to read`, repo: entry.repo };

  const repo = typeof entry.repo === 'string' ? entry.repo : null;

  const remotes = run('git', ['-C', location, 'remote']);
  if (!remotes.ok) return { reason: `'${marketplace}' is not a git checkout`, repo };
  const names = remotes.out.split('\n').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return { reason: `the '${marketplace}' checkout has no remote`, repo };
  // One remote is the answer; with several, `origin` is a documented preference and
  // anything else stops rather than picking for the reader.
  const remote = names.length === 1 ? names[0] : (names.includes('origin') ? 'origin' : null);
  if (!remote) return { reason: `several remotes on the '${marketplace}' checkout: ${names.join(', ')}`, repo };

  // --symref reads the default branch and its tip in one call and writes nothing.
  const head = run('git', ['-C', location, 'ls-remote', '--symref', remote, 'HEAD']);
  if (!head.ok) return { reason: `ls-remote ${remote}: ${firstLine(head.err) || 'exited non-zero'}`, repo };
  const branch = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(head.out);
  const tip = /^([0-9a-f]{7,40})\s+HEAD/m.exec(head.out);
  if (!branch || !tip) return { reason: `${remote} names no default branch`, repo };

  const fetched = run('git', ['-C', location, 'fetch', '--quiet', remote, branch[1]]);
  if (!fetched.ok) return { reason: `fetch ${remote} ${branch[1]}: ${firstLine(fetched.err) || 'exited non-zero'}`, repo };

  const show = (path) => run('git', ['-C', location, 'show', `${tip[1]}:${path}`]);
  const marketManifest = show('.claude-plugin/marketplace.json');
  if (!marketManifest.ok) return { reason: `no marketplace manifest at ${remote}/${branch[1]}`, repo };
  let catalog = null;
  try {
    catalog = JSON.parse(marketManifest.out);
  } catch {
    catalog = null;
  }
  const plugins = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : null;
  if (!plugins) return { reason: 'the marketplace manifest carries no plugin list', repo };
  const record = plugins.find((p) => p && p.name === plugin);
  if (!record) return { reason: `no entry named '${plugin}' in the marketplace manifest`, repo };

  // A source that is a path in this same repository is the only one whose version can be
  // read here; a github / git / npm / command source is versioned somewhere else entirely.
  if (typeof record.source === 'string' && record.source.startsWith('./')) {
    const pluginManifest = show(`${record.source.slice(2)}/.claude-plugin/plugin.json`);
    if (pluginManifest.ok) {
      const upstream = readJsonText(pluginManifest.out);
      if (upstream && typeof upstream.version === 'string') return { version: upstream.version, repo };
    }
  }
  // The marketplace entry's own version is what a plugin declaring none resolves to.
  if (typeof record.version === 'string') return { version: record.version, repo };
  return { reason: `the entry for '${plugin}' declares no version this checkout can read`, repo };
}

function readJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const upstream = resolveUpstream();
set('upstream', upstream.version || 'unknown', upstream.version ? null : upstream.reason);
if (upstream.repo) set('upstream_repo', upstream.repo);

// ----------------------------------------------------------------- derived

// The tree to re-read from is the installed one, not the loaded one: an update that landed
// mid-session leaves the session reading text a restart has already replaced.
set('read_root', installedRoot || root);

// Only one direction calls for a reload. A loaded tree AHEAD of what is installed is a
// working copy or a --plugin-dir run, where there is nothing newer to pick up.
const drift = loaded && installed ? compareVersions(installed, loaded) : null;
set('reload_needed', drift === null ? 'unknown' : (drift === 1 ? 'yes' : 'no'),
  drift === null ? 'the loaded and installed versions cannot be compared'
    : (drift === -1 ? 'the loaded tree is ahead of what is installed' : null));

const behind = upstream.version && installed ? compareVersions(upstream.version, installed) : null;
set('update_pending', behind === null ? 'unknown' : (behind === 1 ? 'yes' : 'no'),
  behind === null ? 'the installed and upstream versions cannot be compared' : null);

// ------------------------------------------------------------------ report

const lines = [];
for (const key of ORDER) {
  if (facts.has(key)) lines.push(`${key}=${facts.get(key)}`);
  if (facts.has(`${key}_reason`)) lines.push(`${key}_reason=${facts.get(`${key}_reason`)}`);
}
process.stdout.write(`${lines.join('\n')}\n`);
