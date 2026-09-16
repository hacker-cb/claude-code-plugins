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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// The invented shapes. A sanitizer writes these; anything else is real data that leaked.
const SHAPES = {
  // Commit ids: 40 hex, but always led by a marker no real sha carries by accident.
  sha: /^f1x7[0-9a-f]{36}$/,
  // Anything naming a person, a bot, an owner or a repository. The collector writes
  // `example-user-<8 hex>`, so the shape says exactly that rather than "starts with
  // example": a prefix test passes `example-user-from-acme` and `octopus-inc` too, which
  // is real data wearing the right first word. The bots are kept verbatim by the
  // collector — their exact logins are what a filter under test has to match, and they
  // identify nobody — so the shape admits them by name.
  actor: /^(example|fixture|octo)-[a-z]+-[0-9a-f]{8}$|^(copilot(-pull-request-reviewer)?|github-actions|dependabot)(\[bot\])?$/i,
  // Repositories and their owners, written as one string.
  repo: /^(example|fixture)[a-z0-9-]*\/(example|fixture)[a-z0-9-]*$/i,
  // Branch and ref names. Same reasoning as `actor`: the collector writes
  // `example-branch-<8 hex>`, and a prefix test would pass `dev-acme-migration`, which
  // names a customer while looking like a default branch.
  ref: /^example-branch-[0-9a-f]{8}$|^(main|master|dev|HEAD)$/i,
  // URLs point at a host that does not exist.
  url: /^https:\/\/(github|gitlab)\.example(\/|$)/,
  // A check's name is a workflow's name, which routinely carries a product or a
  // customer, so the collector hashes it — except for a handful of literals that name
  // nobody and that a filter under test has to match. This gate keeps its OWN copy of
  // that handful deliberately: a name the collector starts passing through without
  // telling the gate fails here, and failing closed is the only safe way for two lists
  // that must agree to disagree.
  check: /^example-check-[0-9a-f]{8}$|^(ci success|validate marketplace & plugins|copilot-pull-request-reviewer)$/i,
  // Opaque ids the collector replaces wholesale.
  id: /^example-id-[0-9a-f]{8}$/,
};

const KEY_SHAPE = [
  [/(^|_)(sha|oid)$|^commit_id$|^head_sha$|^merge_commit_sha$|^squash_commit_sha$/i, 'sha'],
  [/^(login|user|actor|owner|author|assignee|committer)$|_login$/i, 'actor'],
  [/^(full_name|nameWithOwner|repository|ruleset_source)$/i, 'repo'],
  [/^(ref|head_ref|base_ref|headRefName|baseRefName|branch|source_branch|target_branch)$/i, 'ref'],
  [/url$/i, 'url'],
  [/^(name|context|slug)$/i, 'check'],
  [/^id$/i, 'id'],
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

// Keys a forge writes and nobody sits down and invents: the bookkeeping around the fields
// a script actually reads. The collector keeps only what its allow-list names, so a
// sanitized capture carries NONE of these — which is what makes their presence a reading
// about provenance rather than about content. Two in one object, because a single one is
// something a hand-written envelope legitimately spells (`node_id: "IC_1"` names a comment
// in half the suites here), while two together is the shape of a reply nobody cleaned.
// Both forges, and enough of each. A GitLab note's author object carries `web_url` and
// `avatar_url` and little else from this list — one key alone would have let an entire raw
// `/notes` reply through, and on a self-hosted instance the loose host check does not fire
// either, so the usernames and bodies in it would have passed a green gate.
const FORGE_NOISE = /^(gravatar_id|site_admin|received_events_url|organizations_url|subscriptions_url|starred_url|following_url|followers_url|gists_url|events_url|repos_url|node_id|path_with_namespace|http_url_to_repo|ssh_url_to_repo|namespace_id|web_url|avatar_url|noteable_type|noteable_iid)$/;
const forgeNoise = (node) => (node === null || typeof node !== 'object' || Array.isArray(node)
  ? [] : Object.keys(node).filter((k) => FORGE_NOISE.test(k)));

// Where a document first looks like a reply nobody cleaned, or `null`. Provenance, not
// content: a file carrying a forge's own bookkeeping was not written by hand, and one that
// was not written by hand and is not marked CAPTURED went through no sanitizer — so nothing
// in it has been held to the invented shapes at all. Envelopes are opened on the way down,
// since a reply pasted into one is exactly the case this reads for.
function rawReplyIn(node, path = '$') {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') {
    const docs = nestedDocs(node);
    if (docs === null) return null;
    for (let i = 0; i < docs.length; i += 1) {
      const hit = rawReplyIn(docs[i], docs.length > 1 ? `${path}<json ${i}>` : `${path}<json>`);
      if (hit) return hit;
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const hit = rawReplyIn(node[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const keys = forgeNoise(node);
  if (keys.length >= 2) return { path, keys };
  for (const [key, value] of Object.entries(node)) {
    const hit = rawReplyIn(value, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

// A fixture is often an ENVELOPE: the forge's reply carried as a STRING of JSON, which is
// how a suite hands its stub what to print. The key shapes read key names, and a string has
// none — so a reply pasted into an envelope by hand was checked for a bare commit id and a
// bare host, and for nothing else. Parse what parses, and walk that too.
//
// EVERY document in it, not the first. `gh api --paginate` concatenates its pages — `[…][…]`,
// which `JSON.parse` refuses whole — and a paginated reply is exactly what a hand-captured
// envelope carries. Parsed with one `try`, such a string reads as "not JSON" and is walked no
// further, so the pages pass unread: the failure is silent and looks like a clean gate.
//
// The brace scan is this file's own on purpose. `parsePages` in the plugin does the same walk,
// but this gate is what stands between four private repositories and a public one — and a gate
// that imports the code it guards fails the day that code changes for its own reasons.
function nestedDocs(value) {
  let rest = value.trim();
  if (rest.length < 2 || (rest[0] !== '{' && rest[0] !== '[')) return null;
  const docs = [];
  while (rest) {
    if (rest[0] !== '{' && rest[0] !== '[') break;
    let depth = 0; let inString = false; let escaped = false; let end = -1;
    for (let i = 0; i < rest.length; i += 1) {
      const c = rest[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '[' || c === '{') depth += 1;
      else if (c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) break;
    try { docs.push(JSON.parse(rest.slice(0, end))); } catch { break; }
    rest = rest.slice(end).trim();
  }
  return docs.length ? docs : null;
}

// Every detector above is checked against a value that must trip it and one that must
// not. A guard nothing can kill is a guard nobody proved, and these run in CI beside the
// real check — where a regex quietly stopping matching would otherwise read as "clean".
// Read from the directory's own listing, not by asking whether a path exists. macOS is
// case-insensitive, so `existsSync(<dir>/CAPTURED)` is TRUE of a directory named
// `captured` sitting there — which is precisely what the collector's own output is
// called. The gate would then mark a whole suite captured on a developer's machine and
// not in CI, and a rule that answers differently per filesystem is worse than no rule.
// A listing compares exactly, and `isFile` keeps a directory from ever being a marker.
const hasMarker = (dir) => {
  try {
    return readdirSync(dir).includes('CAPTURED') && statSync(join(dir, 'CAPTURED')).isFile();
  } catch {
    // A directory that cannot be listed is not a directory without a marker. Say so
    // rather than answering "no" — the caller below turns this into a failure.
    return null;
  }
};


// The nearest ancestor carrying a marker, `null` for none, `undefined` for a directory
// that could not be read — three answers, because "unknown" taking the shape of "no" is
// how a gate reports a clean tree it never managed to look at.
function markedAncestor(dir, stopAt, cache = new Map(), alsoMarked = new Set()) {
  let at = dir;
  for (;;) {
    // Two sources, UNIONED. Replacing one with the other is what went wrong twice: git's
    // listing alone missed a marker git cannot see, and the filesystem alone missed one
    // that is staged but deleted from the working tree — which is precisely a pre-commit
    // run, `rm CAPTURED` with the deletion not committed. Either source saying "marker"
    // is a marker; only both saying "no" is no.
    if (alsoMarked.has(at)) return at;
    if (!cache.has(at)) {
      const seen = hasMarker(at);
      if (seen === null) return undefined;
      cache.set(at, seen);
    }
    if (cache.get(at)) return at;
    if (at === stopAt) return null;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

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
  ['an invented login passes', 'example-user-1a2b3c4d', true, (v) => SHAPES.actor.test(v)],
  ['a bot login is kept verbatim', 'copilot-pull-request-reviewer[bot]', true,
    (v) => SHAPES.actor.test(v)],
  // The prefix is not the shape: these wear the right first word and carry real names.
  ['a real name behind the right prefix fails', 'example-user-from-acme', false,
    (v) => SHAPES.actor.test(v)],
  ['an org name starting with octo fails', 'octopus-inc', false, (v) => SHAPES.actor.test(v)],
  ['a customer branch behind a default name fails', 'dev-acme-migration', false,
    (v) => SHAPES.ref.test(v)],
  ['a bare default branch passes', 'dev', true, (v) => SHAPES.ref.test(v)],
  ['an invented branch passes', 'example-branch-1a2b3c4d', true, (v) => SHAPES.ref.test(v)],
  ['a raw forge reply is recognised by its bookkeeping',
    '{"login":"x","node_id":"MDQ6","gravatar_id":"","site_admin":false}', true,
    (v) => rawReplyIn(JSON.parse(v)) !== null],
  ['one such key alone is a hand-written envelope', '{"id":1,"node_id":"IC_1","body":"x"}',
    false, (v) => rawReplyIn(JSON.parse(v)) !== null],
  ['a sanitized capture carries none of it',
    '{"id":"example-id-a3f0919c","name":"CI success","conclusion":"success"}', false,
    (v) => rawReplyIn(JSON.parse(v)) !== null],
  // The case the marker rule was written for: a live reply pasted into a stub's envelope,
  // where every key sits inside a string and the shapes never reached it.
  ['a reply pasted into an envelope is found through the string',
    '{"comments":"[{\\"node_id\\":\\"x\\",\\"gravatar_id\\":\\"\\"}]"}', true,
    (v) => rawReplyIn(JSON.parse(v)) !== null],
  ['and the envelope this suite writes by hand is not',
    '{"comments":"[{\\"id\\":1,\\"body\\":\\"chatter\\"}]"}', false,
    (v) => rawReplyIn(JSON.parse(v)) !== null],
  // A GitLab note from a self-hosted instance: no `github.com`, no `node_id`, and a plain
  // username the actor shape would never see, because nothing marked this as a capture.
  ['a raw GitLab note is recognised too',
    '{"id":9,"body":"x","author":{"username":"realperson","state":"active",'
    + '"avatar_url":"https://forge.internal/uploads/a.png","web_url":"https://forge.internal/realperson"}}',
    true, (v) => rawReplyIn(JSON.parse(v)) !== null],
  ['json carried as a string is unpacked', '[{"body":"x"}]', true, (v) => nestedDocs(v) !== null],
  ['prose that opens with a brace is not json', '{not json at all', false,
    (v) => nestedDocs(v) !== null],
  ['a scalar is not a document', '42', false, (v) => nestedDocs(v) !== null],
  // What `gh api --paginate` writes: page after page, concatenated. One `JSON.parse` refuses
  // the whole thing, and every page would then go unread.
  ['concatenated pages are all unpacked', '[{"a":1}] [{"b":2}]', true,
    (v) => (nestedDocs(v) || []).length === 2],
  ['a bracket inside a string does not end a page', '[{"a":"]["}] [{"b":2}]', true,
    (v) => (nestedDocs(v) || []).length === 2],
  ['a reply on a later page is still found',
    '[{"id":1,"body":"x"}] [{"author":{"web_url":"https://f.internal/u",'
    + '"avatar_url":"https://f.internal/a.png"}}]', true,
    (v) => rawReplyIn(JSON.parse(`{"comments":${JSON.stringify(v)}}`)) !== null],
];

// Two of the probes below are about the WALK rather than a detector, so they need a
// tree. It is built in a temp directory and torn down: a probe that asserts against the
// repository's own layout stops proving anything the day that layout changes.
function treeProbes() {
  let base;
  try {
    base = mkdtempSync(join(tmpdir(), 'hcb-fixture-probe-'));
  } catch (error) {
    // Said out loud and failed, never skipped. These probes cover the branch that decides
    // whether the gate opens or closes, and a self-test that quietly runs fewer of them
    // reports "every detector reads both ways" over detectors it never touched.
    process.stderr.write('check-fixtures: the walk probes need a writable temp directory'
      + ` — ${error.message}\n`);
    process.exit(2);
  }
  try {
    mkdirSync(join(base, 'marked', 'sub'), { recursive: true });
    writeFileSync(join(base, 'marked', 'CAPTURED'), 'x\n');
    // A DIRECTORY called `captured` — which is what the collector's own output is named,
    // and what a case-insensitive filesystem hands back for a query about `CAPTURED`.
    mkdirSync(join(base, 'plain', 'captured'), { recursive: true });
    // No marker on disk anywhere under it — the probe hands the git-listing set instead.
    mkdirSync(join(base, 'staged', 'sub'), { recursive: true });
    return [
      ['a marker file is a marker', join(base, 'marked'), true, (v) => hasMarker(v) === true],
      ['a directory named captured is not', join(base, 'plain'), false, (v) => hasMarker(v) === true],
      ['the marker reaches a subdirectory', join(base, 'marked', 'sub'), true,
        (v) => markedAncestor(v, base) === join(base, 'marked')],
      ['and does not reach a sibling', join(base, 'plain'), false,
        (v) => markedAncestor(v, base) !== null],
      // Why the call site passes the CHECKOUT root and never the scan root: a boundary
      // set below the marker hides it, and the file then gets the loose probes alone.
      // `--dir` narrowing is exactly what would set such a boundary.
      ['a boundary below the marker hides it', join(base, 'marked', 'sub'), true,
        (v) => markedAncestor(v, v) === null],
      // The branch that decides whether the gate opens or closes, and it had no probe.
      // A directory that cannot be read must answer "unknown" — never "no marker".
      ['an unreadable directory answers unknown', join(base, 'gone'), true,
        (v) => hasMarker(v) === null],
      ['and unknown reaches the caller as unknown', join(base, 'gone'), true,
        (v) => markedAncestor(v, base) === undefined],
      // Either source alone is enough: git's listing marks a directory whose marker is
      // not in the working tree at all, which is what a pre-commit run looks like.
      ['git\'s listing alone marks a directory', join(base, 'staged', 'sub'), true,
        (v) => markedAncestor(v, base, new Map(), new Set([join(base, 'staged')]))
          === join(base, 'staged')],
    ].map(([name, value, want, probe]) => [name, value, want, probe, probe(value)]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function selfTest() {
  const bad = [];
  // Evaluated while the tree still stands; the rows carry their answers.
  const tree = treeProbes();
  for (const [name, value, want, probe, answered] of [...SELF_TEST, ...tree]) {
    const got = answered !== undefined ? answered : probe(value);
    if (got !== want) bad.push(`${name}: expected ${want}, got ${got} — "${value}"`);
  }
  process.stdout.write(`self-test: ${SELF_TEST.length + tree.length} probe(s)\n`);
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
// The whole repository, not one directory inside it. The collector's `--out` accepts any
// path, so a capture written beside the script it serves carries its marker there and a
// gate rooted at `tests/suites` never visits it — the same defect as walking by path
// instead of by marker, one level up. `--dir` narrows this for a one-off check.
let root = '.';
let rootWasGiven = false;
let wantSelfTest = false;
for (let i = 0; i < argv.length; i += 1) {
  // Recorded, not run here: running it mid-parse exits before a --dir beside it is ever
  // read, so `--dir X --self-test` would report success having inspected nothing in X.
  if (argv[i] === '--self-test') { wantSelfTest = true; continue; }
  if (argv[i] !== '--dir') die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die('--dir needs a value');
  root = argv[i + 1];
  rootWasGiven = true;
  i += 1;
}

if (wantSelfTest && !rootWasGiven) selfTest();

const repoRoot = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) die('not inside a git checkout');
  return r.stdout.trim();
})();

if (wantSelfTest) die('--self-test takes no --dir: it probes the detectors, not a tree');

// `resolve` and not `join`: a trailing slash — which shell completion supplies for
// `--dir tests/suites/` — survives `join`, while `dirname` never produces one, so the
// ancestry walk never met its stop point and climbed past the checkout to `/`.
const rootAbs = resolve(isAbsolute(root) ? root : join(repoRoot, root));
if (!existsSync(rootAbs)) die(`no directory at ${root}`);

// Two kinds of fixture, and they earn different checks. A fixture written by hand is
// synthetic: it never touched a private repository, and holding it to the invented
// shapes would fail honest names like `release/1.x`. A fixture CAPTURED from a real pull
// request is the one this file exists for, and a `CAPTURED` marker in its directory says
// so — written by the collector, never by hand.
//
// **The marker decides, never the path.** Scoping by a `fixtures/` segment made the gate
// blind to any other directory name: a capture under `captured/`, `data/` or `fixture/`
// was walked past in silence, and an unsanitized file there passed CI green. The
// collector accepts any `--out`, so that was not a hypothetical spelling — it was the
// default outcome of naming the directory anything else.
//
// The loose checks run over both kinds: a real commit id or a real forge host has no
// business in either, and that guard costs nothing.
//
// The WALK, though, is the whole repository, while what it INSPECTS is fixtures alone.
// Those are two different scopes and collapsing them breaks the gate either way: rooted
// at `tests/suites` it never visits a capture the collector's `--out` put somewhere else
// — the marker-not-path defect one level up — and inspecting everything it walks fails
// the manifests, which carry this project's own real repository url by design.
// Where a fixture may live besides a marked directory: the suites tree, whose json IS
// fixture data whether or not it was captured.
const SUITES = join(repoRoot, 'tests', 'suites');
const isFixtureTree = (dir) => dir === SUITES || dir.startsWith(`${SUITES}/`);

// WHAT to walk is git's answer, not the filesystem's. A plain recursive walk from the
// repository root descends into `.claude/worktrees/`, where this project keeps its linked
// checkouts — every one of them a full copy of the tree, on another branch, with another
// branch's captures in it. The gate would then read files that are not in this checkout's
// history, fail on somebody else's half-finished capture, and take every suite down with
// it. `--cached --others --exclude-standard` lists exactly what is committed or about to
// be: an ignored path cannot reach a public history, and anything that can is here.
const listed = spawnSync('git', ['-C', rootAbs, 'ls-files', '--cached', '--others',
  '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let tracked;
if (listed.status === 0) {
  tracked = listed.stdout.split('\0').filter(Boolean);
} else if (rootWasGiven && spawnSync('git', ['-C', rootAbs, 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).status !== 0) {
  // An explicit `--dir` may name a directory git knows nothing about — a capture checked
  // where the collector wrote it, BEFORE it is moved into the repository, which is the
  // one moment checking it still costs nothing. There is no listing to ask, and no
  // worktree problem either: the caller named this directory.
  //
  // The check is "outside a checkout", never "the listing failed". A corrupt index or an
  // output too large for the buffer would otherwise switch the gate to a filesystem walk
  // silently — losing every marker that lives in the index alone, which is the case this
  // whole union exists for.
  tracked = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else tracked.push(abs.slice(rootAbs.length + 1));
    }
  }(rootAbs));
} else {
  // Under the default root a failed listing is not an empty repository. Refusing is the
  // point: the alternative is a gate reporting a clean tree because it could not see one.
  die(`could not list the tree under ${root} (${(listed.stderr || '').trim().split('\n')[0] || 'no detail'})`);
}

const failures = [];
const fixtures = [];
const capturedDirs = new Set();

// THE RULE, stated once, because getting it wrong four different ways is what this
// paragraph is paying for: a json is strictly checked when ANY signal says its own
// directory or an ancestor is a capture. The signals are git's listing and the
// filesystem, they are UNIONED, and an ancestor that cannot be read counts as a capture.
// Every past hole here was the same shape — one signal replacing another, or a narrower
// scope quietly becoming a weaker rule.
const markedByGit = new Set();
for (const rel of tracked) {
  if (rel !== 'CAPTURED' && !rel.endsWith('/CAPTURED')) continue;
  // Unconditionally. Asking `hasMarker` to confirm it is what let a staged-but-deleted
  // marker drop out — and a directory that cannot be listed drop out silently with it.
  markedByGit.add(dirname(join(rootAbs, rel)));
}
// Seeded here, not discovered later. Building `capturedDirs` out of the fixtures that
// found a marker means a capture holding NO listed json never enters the set at all —
// and the check below, whose whole job is to notice a marker nothing was checked
// against, then has nothing to notice.
for (const dir of markedByGit) capturedDirs.add(dir);

const markerAt = new Map();
// Up to the CHECKOUT root, never to the scan root: stopping at `rootAbs` made the
// classification depend on `--dir`, so `--dir captured/sub` never saw `captured/CAPTURED`
// and the same unsanitized login a full scan rejects passed under the loose probes.
// Narrowing says where to look. It never says what the rules are.
const nearestMarker = (dir) => {
  const hit = markedAncestor(dir, repoRoot, markerAt, markedByGit);
  if (hit === undefined) {
    failures.push(`${dir}: could not be listed, so whether it carries a CAPTURED marker`
      + ' is unknown — which is not the same as carrying none');
    return dir;
  }
  if (hit !== null) capturedDirs.add(hit);
  return hit;
};

for (const rel of tracked) {
  if (!rel.endsWith('.json')) continue;
  const abs = join(rootAbs, rel);
  // `--cached` lists a file whose deletion is not committed yet. It is a path with no
  // bytes behind it, and reading it as an unparseable fixture would fail the gate over a
  // file that carries nothing.
  if (!existsSync(abs)) continue;
  const marker = nearestMarker(dirname(abs));
  const captured = marker !== null;
  // Inspected where a fixture may live: under a marked directory, and in the suites
  // tree whose json IS fixture data. Elsewhere the manifests carry this project's own
  // real url by design, so everything else is listed for markers and read as nothing —
  // and that rule does NOT bend for an explicit `--dir`, which narrows where to look
  // and never what counts. Letting it widen the rule made one tree answer two ways:
  // `--dir .` failed on the manifests that the default run over the same tree passed.
  if (!captured && !isFixtureTree(dirname(abs))) continue;
  fixtures.push({ abs, captured, marker });
}

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
  // Numbers are coerced rather than skipped. A forge sends `id` as an integer, the
  // collector replaces it with a string, and returning early on a non-string means the
  // one shape that proves the replacement happened is never checked on the value that
  // did not get it. Booleans and the rest carry nothing and are let go.
  if (typeof node === 'number') node = String(node);
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
  // An envelope's payload is a document in its own right: walked with a key name of its own
  // rather than the string's, so the shapes read the forge's field names and not `comments`.
  const docs = nestedDocs(node);
  if (docs !== null) {
    docs.forEach((doc, i) => inspect(doc,
      docs.length > 1 ? `${path}<json ${i}>` : `${path}<json>`, file, null, captured));
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
  // Asked once per file: a captured feed is a list, and one line per object would bury every
  // other failure in the run.
  const raw = captured ? null : rawReplyIn(parsed);
  if (raw !== null) {
    failures.push(`${rel}: ${raw.path} carries ${raw.keys.join(', ')} — a forge's own`
      + ' bookkeeping, which a hand-written fixture does not invent and the collector strips.'
      + ' Nothing here has been sanitized: take it with scripts/collect-fixtures.mjs, which'
      + ' writes the CAPTURED marker this directory has not got.');
  }
}

process.stdout.write(`fixtures: ${fixtures.length} file(s) under ${root}`
  + `, ${capturedCount} captured, ${capturedDirs.size} marked director${capturedDirs.size === 1 ? 'y' : 'ies'}\n`);

// An explicit --dir naming a directory with no fixture in it is a question that went
// unanswered, not a clean answer: the caller pointed at something it wanted checked.
// Under the default root, zero is the honest state of a tree that has captured nothing
// yet.
if (rootWasGiven && fixtures.length === 0) {
  process.stdout.write(`  FAIL  ${root} holds no fixture — nothing was checked\n`);
  process.exit(1);
}

// A marker with nothing beside it is the same unanswered question, and this one fires
// under the default root too: it is how a capture whose files were moved away, or
// written under a name this walk cannot see, stops reading as "checked".
for (const dir of capturedDirs) {
  // A fixture whose NEAREST marker is this one answers for it — not merely one under
  // this path, which would let a nested capture vouch for its parent. Requiring a
  // sibling, as this did before the marker began reaching downward, failed a capture
  // whose files had just been inspected successfully.
  if (fixtures.some(({ marker }) => marker === dir)) continue;
  const rel = dir.startsWith(`${repoRoot}/`) ? dir.slice(repoRoot.length + 1) : dir;
  failures.push(`${rel}: CAPTURED marker with no fixture beside it — nothing was checked`);
}
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.stdout.write(`\n${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write(fixtures.length ? 'no private data found\n' : 'nothing to check yet\n');
