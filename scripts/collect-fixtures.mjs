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
//
// Writes <out>/<kind>.json plus a CAPTURED marker, which is what tells
// scripts/check-fixtures.mjs to hold these files to the invented shapes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const KINDS = {
  reviews: (repo, pr) => ['api', '--paginate', `repos/${repo}/pulls/${pr}/reviews`],
  timeline: (repo, pr) => ['api', '--paginate', `repos/${repo}/issues/${pr}/timeline`],
  checks: (repo, pr, sha) => ['api', '--paginate', `repos/${repo}/commits/${sha}/check-runs`],
  status: (repo, pr, sha) => ['api', '--paginate', `repos/${repo}/commits/${sha}/status`],
  rules: (repo, pr, sha, base) => ['api', `repos/${repo}/rules/branches/${base}`],
};

// Only these reach the fixture. Anything else in the response is dropped outright: a
// field no script reads cannot fail a test, and it can leak.
// `node_id` is deliberately absent: it is base64 of a real object id, so keeping it
// would smuggle the very commit sha the replacement above removes — through a field no
// script under test reads. `app` goes for the same reason, minus the pretext.
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

// Structural markers a review body carries that a script actually parses. Everything
// else in the body is replaced.
const BODY_MARKERS = [
  /comments? generated[^0-9]{0,20}\d+/i,
  /suppressed[^(]{0,40}\(\d+\)/i,
  /needs? a closer look/i,
  /final human review/i,
  /no (new )?comments/i,
];

const USAGE = 'usage: node scripts/collect-fixtures.mjs --repo <owner/name> --pr <n>'
  + ' --out <dir> [--kind reviews|timeline|checks|status|rules]\n';

function die(message) {
  process.stderr.write(`collect-fixtures: ${message}\n${USAGE}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opts = { repo: null, pr: null, out: null, kind: null };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  if (!['--repo', '--pr', '--out', '--kind'].includes(flag)) die(`unknown argument '${flag}'`);
  if (argv[i + 1] === undefined) die(`${flag} needs a value`);
  opts[flag.slice(2)] = argv[i + 1];
  i += 1;
}
if (!opts.repo || !opts.pr || !opts.out) die('--repo, --pr and --out are all required');
const kinds = opts.kind ? [opts.kind] : Object.keys(KINDS);
for (const k of kinds) if (!KINDS[k]) die(`unknown kind '${k}' (known: ${Object.keys(KINDS).join(', ')})`);

const digest = (value, n) => createHash('sha256').update(String(value)).digest('hex').slice(0, n);

const invented = {
  // 40 hex led by the marker scripts/check-fixtures.mjs looks for.
  sha: (value) => `f1x7${digest(value, 36)}`,
  actor: (value) => (PUBLIC_ACTORS.has(String(value).toLowerCase())
    ? value
    : `example-user-${digest(value, 4)}`),
  repo: () => 'example-org/example-repo',
  ref: (value) => `example-branch-${digest(value, 4)}`,
  url: (value) => `https://github.example/example-org/example-repo/${digest(value, 8)}`,
  context: (value) => `example-check-${digest(value, 4)}`,
};

// A check's name is often a workflow name, which can carry a product or customer. The
// exception is the aggregate every repo of this user runs, whose literal name is what a
// script under test has to recognise.
const PUBLIC_CHECK_NAMES = new Set(['ci success', 'validate marketplace & plugins']);

function sanitizeBody(body) {
  if (typeof body !== 'string' || body === '') return body;
  const kept = [];
  for (const line of body.split('\n')) {
    for (const marker of BODY_MARKERS) {
      if (marker.test(line)) { kept.push(line.trim()); break; }
    }
  }
  // The marker says something stood here, so an empty body and a redacted one stay
  // different readings — which is exactly the distinction a body-parsing test needs.
  return [...kept, '[body redacted by collect-fixtures]'].join('\n');
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
  if (key === 'id') return `example-id-${digest(node, 8)}`;
  if (typeof node !== 'string') return node;

  if (key === 'body') return sanitizeBody(node);
  if (/(^|_)(sha|oid)$|^commit_id$/i.test(key)) return invented.sha(node);
  if (/^(login|actor|owner|author)$|_login$/i.test(key)) return invented.actor(node);
  if (/^(full_name|repository)$/i.test(key)) return invented.repo();
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

const head = JSON.parse(gh(['pr', 'view', opts.pr, '--repo', opts.repo,
  '--json', 'headRefOid,baseRefName']));
const outAbs = isAbsolute(opts.out) ? opts.out : join(process.cwd(), opts.out);
mkdirSync(outAbs, { recursive: true });
writeFileSync(join(outAbs, 'CAPTURED'),
  'Fixtures here were captured from a real pull request and sanitized by\n'
  + 'scripts/collect-fixtures.mjs. scripts/check-fixtures.mjs holds them to the\n'
  + 'invented shapes because of this marker. Never add a file here by hand.\n');

for (const kind of kinds) {
  const args = KINDS[kind](opts.repo, opts.pr, head.headRefOid, head.baseRefName);
  const clean = sanitize(parsePages(gh(args)), null);
  const path = join(outAbs, `${kind}.json`);
  writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`);
  const size = Array.isArray(clean) ? clean.length : Object.keys(clean).length;
  process.stdout.write(`${kind}: ${size} item(s) → ${path}\n`);
}
