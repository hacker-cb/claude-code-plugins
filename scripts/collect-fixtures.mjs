#!/usr/bin/env node
// collect-fixtures.mjs — take a test fixture from a real pull request, keeping the shape
// and none of the content.
//
// A hand-written envelope teaches a script the shape its author imagined. A real one
// teaches it the shape the forge actually sends — which is the whole point, since every
// silent failure this refactor is fixing came from a field behaving unlike anyone
// assumed. So the structure is captured, and everything that could identify a
// repository, a person, a branch or a commit is replaced on the way out.
//
// Replacement is deterministic: the same input always yields the same invented value, so
// re-collecting a fixture does not churn the file, and one commit referenced from three
// endpoints stays one commit across all three.
//
// What survives verbatim: field names, enum values, event ordering, timestamps, counts,
// and the structural markers a reviewer's body carries. What does not: everything else
// in that body, which is replaced by a marker rather than trimmed, so a reader can see
// that something stood there.
//
// Usage: node scripts/collect-fixtures.mjs --repo <owner/name> --pr <n> --out <dir>
//                                          [--kind reviews|timeline|checks|status|rules]
//                                          [--sha <oid>]   (default: the pull request's head)
//
// Writes <out>/<kind>.json plus a CAPTURED marker, which is what tells
// scripts/check-fixtures.mjs to hold these files to the invented shapes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const KINDS = {
  reviews: (repo, pr) => ['api', '--paginate', `repos/${repo}/pulls/${pr}/reviews`],
  timeline: (repo, pr) => ['api', '--paginate', `repos/${repo}/issues/${pr}/timeline`],
  checks: (repo, pr, sha) => ['api', '--paginate', `repos/${repo}/commits/${sha}/check-runs`],
  status: (repo, pr, sha) => ['api', '--paginate', `repos/${repo}/commits/${sha}/status`],
  // --paginate like the rest: a base carrying more than one page of rules would
  // otherwise be captured as its first page, which is the "first page is not the list"
  // invariant failing inside the tooling written to enforce it.
  rules: (repo, pr, sha, base) => ['api', '--paginate', `repos/${repo}/rules/branches/${base}`],
};

// Only these reach the fixture. Anything else in the response is dropped outright: a
// field no script reads cannot fail a test, and it can leak.
// `node_id` is deliberately absent: it is base64 of a real object id, so keeping it
// would smuggle the very commit sha the replacement above removes — through a field no
// script under test reads. `app` goes for the same reason, minus the pretext.
//
// Every key here is either replaced by a rule in `sanitize()` or listed in STRUCTURAL
// below as carrying nothing identifying. `assertKeepIsCovered()` holds the two lists to
// that, because a key admitted here without a rule passes through verbatim — which is
// how `ruleset_source`, naming the real repository or organization, went out under an
// allow-list that claimed to be exhaustive.
const KEEP = new Set([
  // shared
  'id', 'state', 'status', 'conclusion', 'event', 'type', 'name', 'login',
  'created_at', 'submitted_at', 'started_at', 'completed_at', 'updated_at',
  // reviews
  'user', 'commit_id', 'body', 'author_association',
  // timeline
  'requested_reviewer', 'actor',
  // checks and statuses
  'check_runs', 'total_count', 'statuses', 'context', 'sha',
  // rules
  'ruleset_id', 'ruleset_source_type', 'ruleset_source', 'parameters',
  'review_on_push', 'review_draft_pull_requests', 'dismiss_stale_reviews_on_push',
  'required_approving_review_count', 'required_review_thread_resolution',
  'require_code_owner_review', 'require_last_push_approval', 'allowed_merge_methods',
  'required_status_checks', 'strict_required_status_checks_policy',
]);

// A bot is not private data, and its exact login is what a filter under test has to
// match — `copilot-pull-request-reviewer[bot]` on one surface, `Copilot` on another.
// Keeping them is the point; a human login in the same field is not.
const PUBLIC_ACTORS = new Set([
  'copilot-pull-request-reviewer[bot]', 'copilot-pull-request-reviewer', 'copilot',
  'github-actions[bot]', 'github-actions', 'dependabot[bot]', 'dependabot',
]);

// Structural markers a review body carries that a script actually parses, each paired
// with the canonical form written in its place.
//
// The canon is the point. Keeping the matched text looks safe and is not: two of these
// anchors are a word, then arbitrary text, then a number — so `suppressed for
// northwind-bank (2)` matches, and the customer's name rides along inside the match.
// The parser downstream reads the number and the anchor, never the middle
// (`copilot.md`'s body reader captures `(?<n>[0-9]+)` alone), so rebuilding the marker
// from the capture loses nothing and carries nothing.
const BODY_MARKERS = [
  [/comments?\s+generated\D{0,20}?(\d+)/i, (m) => `Comments generated: ${m[1]}`],
  [/suppressed\D{0,40}?\((\d+)\)/i, (m) => `suppressed (${m[1]})`],
  [/needs?\s+a\s+closer\s+look/i, () => 'Needs a closer look'],
  [/final\s+human\s+review/i, () => 'final human review'],
  [/no\s+(?:new\s+)?comments/i, () => 'No comments'],
];

const USAGE = 'usage: node scripts/collect-fixtures.mjs --repo <owner/name> --pr <n>'
  + ' --out <dir> [--kind reviews|timeline|checks|status|rules] [--sha <oid>]\n';

function die(message) {
  process.stderr.write(`collect-fixtures: ${message}\n${USAGE}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opts = { repo: null, pr: null, out: null, kind: null, sha: null };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  if (!['--repo', '--pr', '--out', '--kind', '--sha'].includes(flag)) die(`unknown argument '${flag}'`);
  if (argv[i + 1] === undefined) die(`${flag} needs a value`);
  opts[flag.slice(2)] = argv[i + 1];
  i += 1;
}
if (!opts.repo || !opts.pr || !opts.out) die('--repo, --pr and --out are all required');
const kinds = opts.kind ? [opts.kind] : Object.keys(KINDS);
for (const k of kinds) if (!KINDS[k]) die(`unknown kind '${k}' (known: ${Object.keys(KINDS).join(', ')})`);

// A pseudonym must be stable — so re-collecting a fixture does not churn it, and one
// commit stays one commit across endpoints — without being reproducible by anyone
// holding the published file. An unsalted hash gives the first and not the second: the
// inputs are logins, branch names and workflow names, all low-entropy and guessable, so
// a reader with a candidate list confirms each guess with one local hash. The salt is
// random, kept outside the repository, and never published.
const saltPath = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
  'hcb-collect-fixtures-salt');
const salt = (() => {
  if (existsSync(saltPath)) {
    const stored = readFileSync(saltPath, 'utf8').trim();
    // An empty file — truncated, or created by `touch` — would leave the digest
    // unsalted and every pseudonym guessable again, silently. Refuse rather than
    // degrade: the salt is the whole of what stops the fixture being an oracle.
    if (!stored) die(`the salt at ${saltPath} is empty — delete it to have a new one written`);
    return stored;
  }
  const fresh = randomBytes(32).toString('hex');
  mkdirSync(dirname(saltPath), { recursive: true });
  writeFileSync(saltPath, `${fresh}\n`, { mode: 0o600 });
  process.stderr.write(`collect-fixtures: new pseudonym salt at ${saltPath}\n`);
  return fresh;
})();

const digest = (value, n) => createHash('sha256').update(salt).update(String(value))
  .digest('hex').slice(0, n);

const invented = {
  // 40 hex led by the marker scripts/check-fixtures.mjs looks for.
  sha: (value) => `f1x7${digest(value, 36)}`,
  actor: (value) => (PUBLIC_ACTORS.has(String(value).toLowerCase())
    ? value
    : `example-user-${digest(value, 8)}`),
  repo: () => 'example-org/example-repo',
  ref: (value) => `example-branch-${digest(value, 8)}`,
  url: (value) => `https://github.example/example-org/example-repo/${digest(value, 8)}`,
  context: (value) => `example-check-${digest(value, 8)}`,
};

// A check's name is often a workflow name, which can carry a product or customer. Two
// exceptions: the aggregate every repo of this user runs, and the reviewer bot's own
// check — both name nobody, and both are literals a script under test has to recognise.
// The reviewer's is the one that distinguishes the head's feed from the merge
// commit's, so hashing it would erase the very difference a fixture is taken for.
const PUBLIC_CHECK_NAMES = new Set([
  'ci success', 'validate marketplace & plugins', 'copilot-pull-request-reviewer',
]);

function sanitizeBody(body) {
  if (typeof body !== 'string' || body === '') return body;
  const kept = [];
  for (const line of body.split('\n')) {
    // Every marker on the line, not the first. A body reporting `Comments generated: 0;
    // Suppressed comments (2)` carries two signals the parser reads separately, and
    // stopping at the first publishes a fixture that says the suppressed block is
    // absent — a fixture asserting the opposite of what was measured.
    for (const [marker, canon] of BODY_MARKERS) {
      const hit = line.match(marker);
      if (hit) kept.push(canon(hit));
    }
  }
  // The marker says something stood here, so an empty body and a redacted one stay
  // different readings — which is exactly the distinction a body-parsing test needs.
  return [...kept, '[body redacted by collect-fixtures]'].join('\n');
}

// Keys that carry nothing identifying: enums, booleans, counts, timestamps, and the
// containers holding other keys. Everything else in KEEP must match a rule below.
const STRUCTURAL = new Set([
  'state', 'status', 'conclusion', 'event', 'type', 'author_association',
  'created_at', 'submitted_at', 'started_at', 'completed_at', 'updated_at',
  'user', 'requested_reviewer', 'check_runs', 'statuses', 'total_count', 'parameters',
  'ruleset_source_type', 'review_on_push', 'review_draft_pull_requests',
  'dismiss_stale_reviews_on_push', 'required_approving_review_count',
  'required_review_thread_resolution', 'require_code_owner_review',
  'require_last_push_approval', 'allowed_merge_methods', 'required_status_checks',
  'strict_required_status_checks_policy',
]);

// The rules as data, so the coverage check below can ask the same question `sanitize`
// answers rather than a re-typed copy of it that can drift.
const RULES = [
  /^body$/,
  /^(id|ruleset_id)$/,
  /(^|_)(sha|oid)$|^commit_id$/i,
  /^(login|actor|owner|author)$|_login$/i,
  /^(full_name|repository|ruleset_source)$/i,
  /^(ref|head_ref|base_ref|branch)$/i,
  /url$/i,
  /^(name|context|slug)$/,
];

// A key admitted into KEEP without a rule passes through verbatim. That is exactly how
// `ruleset_source` — the private repository's own name — left under an allow-list whose
// comment called itself exhaustive. So the two lists are held to each other here, at
// startup, where a future addition fails loudly instead of leaking quietly.
function assertKeepIsCovered() {
  const bare = [...KEEP].filter((k) => !STRUCTURAL.has(k) && !RULES.some((re) => re.test(k)));
  if (bare.length) {
    die(`KEEP carries ${bare.length} key(s) with no replacement rule and not marked`
      + ` structural: ${bare.join(', ')} — add a rule or list them in STRUCTURAL`);
  }
}

function sanitize(node, key) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((item) => sanitize(item, key));
  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (!KEEP.has(k)) continue;
      out[k] = sanitize(v, k);
    }
    return out;
  }
  // Ids arrive as numbers, and a number falls through the string branch below untouched
  // — which would leave a real check-run id in the fixture. Handle it here.
  if (key === 'id' || key === 'ruleset_id') return `example-id-${digest(node, 8)}`;
  if (typeof node !== 'string') return node;

  if (key === 'body') return sanitizeBody(node);
  if (/(^|_)(sha|oid)$|^commit_id$/i.test(key)) return invented.sha(node);
  if (/^(login|actor|owner|author)$|_login$/i.test(key)) return invented.actor(node);
  // `ruleset_source` holds the real `owner/repo` for a repository ruleset and the
  // organization's login for an org-level one — the two things a private repository is
  // most identified by, arriving through the endpoint collected by default.
  if (/^(full_name|repository|ruleset_source)$/i.test(key)) return invented.repo();
  if (/^(ref|head_ref|base_ref|branch)$/i.test(key)) return invented.ref(node);
  if (/url$/i.test(key)) return invented.url(node);
  if (key === 'name' || key === 'context' || key === 'slug') {
    return PUBLIC_CHECK_NAMES.has(node.toLowerCase()) ? node : invented.context(node);
  }
  return node;
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    // The call failing and the endpoint being empty print the same thing downstream, so
    // say which this was rather than writing an empty fixture.
    die(`gh ${args.join(' ')} failed: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

// --paginate concatenates one JSON document per page. Parse them in sequence rather than
// as one value, then merge: an array-valued endpoint concatenates, an object-valued one
// keeps the first page's envelope and grows the list it carries.
function parsePages(text) {
  const pages = [];
  let rest = text.trim();
  while (rest) {
    let depth = 0;
    let end = -1;
    let inString = false;
    let escaped = false;
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
    if (end === -1) die('could not split the paginated response into documents');
    pages.push(JSON.parse(rest.slice(0, end)));
    rest = rest.slice(end).trim();
  }
  if (pages.length === 0) return [];
  if (Array.isArray(pages[0])) return pages.flat();
  const merged = { ...pages[0] };
  for (const listKey of ['check_runs', 'statuses']) {
    if (!Array.isArray(merged[listKey])) continue;
    merged[listKey] = pages.flatMap((p) => p[listKey] || []);
  }
  return merged;
}

assertKeepIsCovered();

// Parsed with its own refusal: `gh` printing an auth prompt or a proxy's error page would
// otherwise end the capture with a SyntaxError, which says nothing about what went wrong.
let head;
try {
  head = JSON.parse(gh(['pr', 'view', opts.pr, '--repo', opts.repo,
    '--json', 'headRefOid,baseRefName']));
} catch (e) {
  process.stderr.write(`collect-fixtures: the pull request view was not JSON (${e.message})\n`);
  process.exit(1);
}
if (!head || typeof head !== 'object' || Array.isArray(head)) {
  process.stderr.write('collect-fixtures: the pull request view came back in a shape this'
    + ' cannot read\n');
  process.exit(1);
}
// The head is the default, never the only choice: what a base runs on the commit a
// merge lands is a different set from what the pull request ran, and only the second
// can be reached from the head. `--sha` is how a fixture is taken of the first.
const sha = opts.sha || head.headRefOid;
const outAbs = isAbsolute(opts.out) ? opts.out : join(process.cwd(), opts.out);
mkdirSync(outAbs, { recursive: true });
writeFileSync(join(outAbs, 'CAPTURED'),
  'Fixtures here were captured from a real pull request and sanitized by\n'
  + 'scripts/collect-fixtures.mjs. scripts/check-fixtures.mjs holds them to the\n'
  + 'invented shapes because of this marker. Never add a file here by hand.\n');

for (const kind of kinds) {
  const args = KINDS[kind](opts.repo, opts.pr, sha, head.baseRefName);
  const clean = sanitize(parsePages(gh(args)), null);
  const path = join(outAbs, `${kind}.json`);
  writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`);
  const size = Array.isArray(clean) ? clean.length : Object.keys(clean).length;
  process.stdout.write(`${kind}: ${size} item(s) → ${path}\n`);
}
