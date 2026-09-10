#!/usr/bin/env node
// plugin-versions.mjs — which version of a plugin this session is running, which one is
// installed for it, which tree a diff stands on, and what the marketplace's own repository
// says now. Prints `key=value` lines on stdout and nothing else.
//
// Every answer degrades to `unknown` with a `<key>_reason` beside it: a number that could
// not be resolved is a line of the report, where a crash would take the whole re-read down
// with it. Exit 2 is kept for a call this script cannot act on at all — an unknown flag, a
// `--root` holding no plugin.
//
// Usage: node plugin-versions.mjs --root <plugin installation directory> [--project <dir>]
//        [--floor <version>]
//
// `--floor` is the version a caller has pinned — the one its durable record says it last
// reconciled against. It outranks what this script would infer, and resolves to the tree
// that version occupies.
//
// The root comes from `${CLAUDE_PLUGIN_ROOT}`, which Claude Code substitutes into skill
// content: it names the tree this session's instructions were actually loaded from, which
// is the one question no registry can answer.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ORDER = [
  'plugin', 'marketplace',
  'loaded', 'loaded_root',
  'cache',
  'installed', 'installed_root', 'installed_scope', 'installed_source',
  'predecessor', 'predecessor_root',
  'floor', 'floor_root', 'floor_source',
  'upstream', 'upstream_repo', 'upstream_ref',
  'read_root', 'reload_needed', 'update_pending',
];

const LOCAL_TIMEOUT = 15000;
const NETWORK_TIMEOUT = 60000;

const facts = new Map();
const set = (key, value, reason) => {
  facts.set(key, value);
  if (reason) facts.set(`${key}_reason`, reason);
};

const firstLine = (text) => (text || '').trim().split('\n')[0] || '';

const USAGE = 'usage: node plugin-versions.mjs --root <plugin installation directory>'
  + ' [--project <dir>] [--floor <version>]\n';

function die(message) {
  process.stderr.write(`plugin-versions: ${message}\n`);
  process.stderr.write(USAGE);
  process.exit(2);
}

// Never throws: a missing command, a refusal and a hung network are all answers
// ("unknown, because"), and the timeout is what keeps the last of those from becoming
// a session that waits for a forge forever.
function run(cmd, args, timeoutMs) {
  const limit = timeoutMs || LOCAL_TIMEOUT;
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: limit });
  const timedOut = `${cmd} timed out after ${Math.round(limit / 1000)}s`;
  if (r.error) {
    if (r.error.code === 'ENOENT') return { ok: false, out: '', err: `${cmd} not found` };
    if (r.error.code === 'ETIMEDOUT') return { ok: false, out: '', err: timedOut };
    return { ok: false, out: '', err: r.error.message };
  }
  if (r.signal) return { ok: false, out: '', err: timedOut };
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

// Two spellings can name one tree — a symlinked home or project directory, a trailing
// slash, a relative path — and the registry's spelling is not this run's.
function canonical(path) {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return a === b || canonical(a) === canonical(b);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A cache directory is named for the version it holds. Anything that is not a version this
// can rank is left out of every comparison rather than sorted as text.
function parseVersion(value) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value || '');
  if (!m) return null;
  return { nums: [m[1], m[2], m[3]].map((n) => (n === undefined ? 0 : Number(n))), pre: m[4] || '' };
}

// Prerelease identifiers compare one dot-separated field at a time, numeric fields
// numerically: `beta.10` is above `beta.2`, which a whole-string comparison reverses.
function comparePrerelease(a, b) {
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
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
  return comparePrerelease(pa.pre, pb.pre);
}

const highest = (versions) =>
  versions.reduce((best, v) => {
    if (!parseVersion(v)) return best;
    if (best === null) return v;
    return compareVersions(v, best) === 1 ? v : best;
  }, null);

// ---------------------------------------------------------------- arguments

let root = null;
let project = process.cwd();
let pinned = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--root' || arg === '--project' || arg === '--floor') {
    if (i + 1 >= argv.length) die(`${arg} needs a value`);
    if (arg === '--root') root = argv[i + 1];
    else if (arg === '--project') project = argv[i + 1];
    else pinned = argv[i + 1];
    i += 1;
  } else if (arg.startsWith('--root=')) {
    root = arg.slice('--root='.length);
  } else if (arg.startsWith('--project=')) {
    project = arg.slice('--project='.length);
  } else if (arg.startsWith('--floor=')) {
    pinned = arg.slice('--floor='.length);
  } else if (arg === '-h' || arg === '--help') {
    process.stdout.write(USAGE);
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
// a --plugin-dir tree, a copy another host keeps for its own sessions) is not one.
const pluginDir = dirname(root);
const inCache = Boolean(loaded) && basename(root) === loaded;
set('cache', inCache ? 'present' : 'absent',
  inCache ? null : 'the root is not a version directory of the plugin cache');
set('plugin', inCache ? basename(pluginDir) : (manifest.name || basename(root)));
if (inCache) set('marketplace', basename(dirname(pluginDir)));

const plugin = facts.get('plugin');

// ------------------------------------------------- what the registry installed

// The registry is the authority on what is installed: the cache also holds versions an
// update left orphaned, and after a rollback its highest is not the one a restart loads.
//
// It answers for every scope on the machine at once — one record per project that pinned
// this plugin, each at its own version — so the records that do not apply here are dropped
// before any of them is read as the installed version. What applies: this very tree, a
// user-wide or managed install, and a project record whose directory holds this run.
const projectDir = canonical(project);
const within = (parent) => {
  const dir = canonical(parent);
  return projectDir === dir || projectDir.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
};

let registry = null;
let registryEntry = null;
let registryNamed = [];
let registryReason = null;
let registryAmbiguity = null;
let registryUnsettled = false;
const listed = run('claude', ['plugin', 'list', '--json']);
if (!listed.ok) {
  registryReason = `claude plugin list: ${firstLine(listed.err) || 'exited non-zero'}`;
} else {
  const parsed = parseJsonText(listed.out);
  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.installed) ? parsed.installed : null);
  if (!entries) {
    registryReason = 'claude plugin list did not answer a JSON list';
  } else {
    const known = facts.get('marketplace');
    const named = entries.filter((e) => {
      if (!e || typeof e !== 'object') return false;
      if (typeof e.installPath === 'string' && e.installPath === root) return true;
      if (typeof e.id !== 'string') return false;
      const [name, market] = e.id.split('@');
      if (name !== plugin) return false;
      // A plugin name belongs to its marketplace, not to every marketplace: another
      // catalog's plugin of the same name is a different plugin at a different version.
      return known ? market === known : true;
    });
    registryNamed = named;
    // A cache directory is shared between projects, so the loaded tree's path says which
    // plugin this is and nothing about whose install it is: applicability is the scope's.
    const applicable = named.filter((e) =>
      e.scope === 'user' || e.scope === 'managed'
      || (typeof e.projectPath === 'string' && within(e.projectPath)));
    // A disabled install is not one a restart loads, whatever version it carries.
    const mine = applicable.filter((e) => e.enabled !== false);

    if (named.length === 0) {
      registryReason = `no entry for '${plugin}' — a plugin loaded with --plugin-dir is not listed`;
    } else if (applicable.length === 0) {
      registryReason = `${named.length} entries for '${plugin}', none of them installed for this project`;
    } else if (mine.length === 0) {
      registryReason = `every applicable entry for '${plugin}' is disabled`;
    } else {
      const markets = [...new Set(mine
        .map((e) => (typeof e.id === 'string' ? e.id.split('@')[1] : null))
        .filter(Boolean))];
      if (!known && markets.length > 1) {
        registryReason = `entries for '${plugin}' come from several marketplaces: ${markets.join(', ')}`;
      } else {
        if (!known && markets.length === 1) set('marketplace', markets[0]);
        // An applicable record whose path IS the loaded tree is evidence rather than a
        // ranking: it says what this project resolved to, whatever a wider scope installed.
        const exact = mine.find((e) => samePath(e.installPath, root));
        const versions = [...new Set(mine.map((e) => e.version).filter((v) => typeof v === 'string'))];
        registry = exact && typeof exact.version === 'string' ? exact.version : highest(versions);
        if (!registry) registryReason = 'the applicable entries carry no orderable version';
        else {
          registryEntry = exact
            || mine.find((e) => e.version === registry && existsSync(e.installPath || ''))
            || mine.find((e) => e.version === registry) || null;
          // Which of several applicable installs a restart would load is the host's to
          // decide, and nothing here can read that order — so a disagreement is reported
          // rather than settled, whichever of them was picked to stand in the answer.
          registryUnsettled = !exact && versions.length > 1;
          if (versions.length > 1) {
            // The line lists the installs, so the count is of installs: counting the
            // versions among them names three records as two.
            registryAmbiguity = `${mine.length} installs apply here and disagree (`
              + `${mine.map((e) => `${e.scope || 'unknown'}:${e.version}`).join(', ')}) — `
              + (exact ? 'the one this session loaded is reported' : 'the highest is reported');
          }
        }
      }
    }
  }
}

// --------------------------------------------- where the versions are kept

// One directory per version, named for it, grouped by marketplace and plugin — and the
// loaded root is one way to reach that directory, not the only one. A session reading a
// tree the registry never installed (another host's copy of the plugin, a working
// checkout) has the cache beside it all the same, and the registry carries the path it
// installs into. A floor resolves against that directory whatever the root is, and where
// no directory can be named, the reason says that rather than that the cache is empty.
let cacheDir = inCache ? pluginDir : null;
let cacheDirReason = null;
if (!cacheDir) {
  const market = facts.get('marketplace');
  const dirs = new Map();
  for (const e of registryNamed) {
    if (typeof e.installPath !== 'string' || typeof e.version !== 'string') continue;
    // Only an entry whose directory is named for the version it holds says where the
    // versions are kept; one of any other shape names a single tree and no siblings.
    if (basename(e.installPath) !== e.version) continue;
    if (market && typeof e.id === 'string' && e.id.split('@')[1] !== market) continue;
    const dir = dirname(e.installPath);
    if (!dirs.has(canonical(dir))) dirs.set(canonical(dir), dir);
  }
  const found = [...dirs.values()];
  // Which of several a version belongs to is not something this can settle, and picking
  // the first would resolve a floor to a tree from somewhere else entirely.
  if (found.length === 1) [cacheDir] = found;
  else if (found.length > 1) {
    cacheDirReason = `the registry installs '${plugin}' into several directories: ${found.join(', ')}`;
  } else {
    cacheDirReason = 'the root is outside the plugin cache, and no registry entry names a version directory';
  }
}

let siblings = [];
let listReason = null;
if (cacheDir) {
  try {
    // The manifest inside is what proves a name is a version tree, so the entry's own type
    // is not read: a development checkout symlinked in as a version entry is a directory
    // to everything that follows it, and a dirent that reports itself a link.
    siblings = readdirSync(cacheDir)
      .filter((n) => existsSync(join(cacheDir, n, '.claude-plugin', 'plugin.json')));
  } catch (e) {
    listReason = `the cache directory could not be listed: ${e.code || e.message}`;
  }
}

// Only the registry says what is installed. The cache deliberately keeps orphaned versions,
// so its highest is a candidate and never the answer: after a rollback it names the tree a
// restart will not load.
const installed = registry;
const candidates = siblings.length ? ` — the cache holds ${siblings.join(', ')}` : '';
set('installed', installed || 'unknown',
  installed ? registryAmbiguity : `${registryReason || 'no version could be resolved'}${candidates}`);
set('installed_source', installed ? 'registry' : 'unknown');
if (registryEntry && typeof registryEntry.scope === 'string') set('installed_scope', registryEntry.scope);

// A root the registry has no record of is a tree it says nothing about: a --plugin-dir run,
// a skills directory, a working copy, another host's own copy. What is installed elsewhere
// is still worth reporting, but it is not the tree this session reads.
const entryPath = registryEntry && typeof registryEntry.installPath === 'string' ? registryEntry.installPath : null;
const registryBacked = inCache || samePath(entryPath, root);
if (!registryBacked) {
  facts.set('loaded_reason',
    'read from a tree the registry did not install — a move in place since this session loaded it shows here as the loaded version');
}

// The registry carries the path it installed to; the cache layout is what answers when it
// could not be read, and neither is trusted past the directory actually being there.
const installedRoot = (entryPath && existsSync(entryPath) ? entryPath : null)
  || (installed && siblings.includes(installed) ? join(cacheDir, installed) : null);
set('installed_root', installedRoot || 'unknown',
  installedRoot ? null
    : (!installed ? 'no installed version to point at'
      : (cacheDir ? `nothing on disk at the ${installed} installation` : cacheDirReason)));

// ------------------------------------------------------------- predecessor

// Claude Code sweeps an orphaned version directory roughly two weeks after an update, so
// the absence of an earlier one is an ordinary answer and not a fault.
const below = loaded ? siblings.filter((v) => compareVersions(v, loaded) === -1) : [];
const predecessor = highest(below);
set('predecessor', predecessor || 'unknown',
  predecessor ? null
    : (cacheDir ? (listReason || 'no earlier version is left in the cache') : cacheDirReason));
if (predecessor) set('predecessor_root', join(cacheDir, predecessor));

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
  const markets = parseJsonText(listedMarkets.out);
  if (!Array.isArray(markets)) return { reason: 'claude plugin marketplace list did not answer a JSON list' };
  const entry = markets.find((m) => m && m.name === marketplace);
  if (!entry) return { reason: `marketplace '${marketplace}' is not configured here` };
  const repo = typeof entry.repo === 'string' ? entry.repo : null;
  const location = typeof entry.installLocation === 'string' ? entry.installLocation : null;
  if (!location) return { reason: `marketplace '${marketplace}' names no checkout to read`, repo };

  // The checkout has to BE a repository, not merely sit inside one: a marketplace kept in
  // a directory of someone else's project would otherwise put the fetch below onto that
  // project's remote.
  const top = run('git', ['-C', location, 'rev-parse', '--show-toplevel']);
  if (!top.ok) return { reason: `'${marketplace}' is not a git checkout`, repo };
  let sameTree = false;
  try {
    sameTree = realpathSync(top.out.trim()) === realpathSync(location);
  } catch {
    sameTree = false;
  }
  if (!sameTree) return { reason: `the '${marketplace}' checkout sits inside another repository`, repo };

  const remotes = run('git', ['-C', location, 'remote']);
  if (!remotes.ok) return { reason: `no remote could be read for '${marketplace}'`, repo };
  const names = remotes.out.split('\n').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return { reason: `the '${marketplace}' checkout has no remote`, repo };
  // One remote is the answer; with several, `origin` is a documented preference and
  // anything else stops rather than picking for the reader.
  const remote = names.length === 1 ? names[0] : (names.includes('origin') ? 'origin' : null);
  if (!remote) return { reason: `several remotes on the '${marketplace}' checkout: ${names.join(', ')}`, repo };

  // A marketplace pinned to a branch or a tag is answered by that ref, not by the
  // repository's default branch — an update follows the pin, so a version elsewhere is
  // one nobody here can install. Absent a pin, the remote's own HEAD says which branch.
  let branch = typeof entry.ref === 'string' && entry.ref ? entry.ref : null;
  if (!branch) {
    const head = run('git', ['-C', location, 'ls-remote', '--symref', remote, 'HEAD'], NETWORK_TIMEOUT);
    if (!head.ok) return { reason: `ls-remote ${remote}: ${firstLine(head.err) || 'exited non-zero'}`, repo };
    const named = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(head.out);
    if (!named) return { reason: `${remote} names no default branch`, repo };
    branch = named[1];
  }
  const ref = `${remote}/${branch}`;

  const fetched = run('git', ['-C', location, 'fetch', '--quiet', remote, branch], NETWORK_TIMEOUT);
  if (!fetched.ok) return { reason: `fetch ${remote} ${branch}: ${firstLine(fetched.err) || 'exited non-zero'}`, repo, ref };

  const show = (path) => run('git', ['-C', location, 'show', `FETCH_HEAD:${path}`]);
  const catalog = parseJsonText(show('.claude-plugin/marketplace.json').out);
  const plugins = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : null;
  if (!plugins) return { reason: `no readable marketplace manifest at ${ref}`, repo, ref };
  const record = plugins.find((p) => p && p.name === plugin);
  if (!record) return { reason: `no entry named '${plugin}' in the manifest at ${ref}`, repo, ref };

  // A source that is a path in this same repository is the only one whose version can be
  // read here; a github / git / npm / command source is versioned somewhere else entirely.
  if (typeof record.source === 'string' && record.source.startsWith('./')) {
    const upstream = parseJsonText(show(`${record.source.slice(2)}/.claude-plugin/plugin.json`).out);
    if (upstream && typeof upstream.version === 'string') return { version: upstream.version, repo, ref };
  }
  // The marketplace entry's own version is what a plugin declaring none resolves to.
  if (typeof record.version === 'string') return { version: record.version, repo, ref };
  return { reason: `the entry for '${plugin}' declares no version readable at ${ref}`, repo, ref };
}

const upstream = resolveUpstream();
set('upstream', upstream.version || 'unknown', upstream.version ? null : upstream.reason);
if (upstream.repo) set('upstream_repo', upstream.repo);
if (upstream.ref) set('upstream_ref', upstream.ref);

// ----------------------------------------------------------------- derived

// What settles a reload first is whether the registry installed this tree at all; after that
// it is simply whether the installed version is the loaded one, in either direction — an
// update and a rollback both leave the session holding text a restart would replace.
//
// A tree it did not install is not thereby a tree nothing swaps: another host keeps its own
// copies and moves them in place, under one path, while the sessions holding the old text go
// on running. Neither side of that is readable here, so neither is answered.
const sameVersion = Boolean(loaded) && loaded === installed;
if (!registryBacked) {
  set('reload_needed', 'unknown',
    'the registry did not install this tree — what a restart lands on is the business of whatever host keeps it, and nothing here records what this session loaded');
} else if (!loaded || !installed) {
  set('reload_needed', 'unknown', 'one of the two versions is unknown');
} else if (sameVersion) {
  set('reload_needed', 'no');
} else if (registryUnsettled) {
  set('reload_needed', 'unknown', registryAmbiguity);
} else {
  set('reload_needed', 'yes');
}

// The tree to re-read from is the installed one: an update that landed mid-session leaves
// the session reading text a restart has already replaced. A tree the registry did not
// install reads itself — there is no second copy of it to prefer — and where the installed
// one cannot be found the report says so rather than letting the fallback pass for it.
let readReason = null;
if (registryBacked && !installedRoot) {
  readReason = installed
    ? (sameVersion ? null : `the ${installed} tree could not be found — this is the loaded tree, not the installed one`)
    : 'the installed version is unknown — this is the loaded tree';
}
const readRoot = registryBacked ? (installedRoot || root) : root;
// Everything below is read from that tree, so everything below is said about its version —
// which is the installed one only where the tree read is the installed one.
const readVersion = readRoot === root ? loaded : installed;
set('read_root', readRoot, readReason);

// The floor a diff stands on is the tree this session has been acting under. A version the
// caller pinned answers that outright; absent one, still running older text makes it the
// loaded tree itself, and already being on the installed one makes it the version before
// that, where the cache kept it.
const pinnedInCache = pinned && cacheDir && siblings.includes(pinned) ? join(cacheDir, pinned) : null;
// A version the cache no longer keeps can still be on disk where the registry installed it.
const pinnedEntry = pinned && !pinnedInCache
  ? registryNamed.find((e) => e.version === pinned && typeof e.installPath === 'string'
    && existsSync(e.installPath))
  : null;
const pinnedRoot = pinnedInCache || (pinnedEntry ? pinnedEntry.installPath : null);
if (pinned) {
  set('floor', pinned);
  set('floor_root', pinnedRoot || 'unknown',
    pinnedRoot ? null
      : (cacheDir
        ? `no ${pinned} tree in the cache at ${cacheDir} — the pin has nothing left to diff against`
        : `${cacheDirReason} — the pin resolves to no tree`));
  set('floor_source', 'pinned');
} else if (facts.get('reload_needed') === 'yes') {
  set('floor', loaded);
  set('floor_root', root);
  set('floor_source', 'loaded');
} else if (predecessor) {
  set('floor', predecessor);
  set('floor_root', join(cacheDir, predecessor));
  set('floor_source', 'predecessor');
} else {
  set('floor', 'unknown', facts.get('predecessor_reason') || 'no earlier tree to diff against');
  set('floor_source', 'none');
}

// What is left to pull is measured against the tree this run reads, not against a record of
// an install it does not read: a session on a copy that already carries what the marketplace
// carries is not waiting for the update some other copy of the plugin is.
const behind = upstream.version && readVersion ? compareVersions(upstream.version, readVersion) : null;
let pendingReason = null;
if (behind === null) {
  pendingReason = 'the read and upstream versions cannot be compared';
} else if (behind === -1) {
  pendingReason = `nothing to pull: the marketplace carries ${upstream.version}, behind the ${readVersion} this run reads`;
} else if (behind === 0 && upstream.version !== readVersion) {
  pendingReason = `the two differ only in build metadata: ${upstream.version} against ${readVersion}`;
}
// The registry's own install is a second tree with its own lag, and sessions that load from
// it read that one: where the two part company, the verdict says which it answered for.
if (installed && readVersion && readVersion !== installed) {
  const aside = `judged against the ${readVersion} this run reads, not the ${installed} the registry installed`;
  pendingReason = pendingReason ? `${pendingReason}; ${aside}` : aside;
}
set('update_pending', behind === null ? 'unknown' : (behind === 1 ? 'yes' : 'no'), pendingReason);

// ------------------------------------------------------------------ report

const lines = [];
for (const key of ORDER) {
  if (facts.has(key)) lines.push(`${key}=${facts.get(key)}`);
  if (facts.has(`${key}_reason`)) lines.push(`${key}_reason=${facts.get(`${key}_reason`)}`);
}
process.stdout.write(`${lines.join('\n')}\n`);
