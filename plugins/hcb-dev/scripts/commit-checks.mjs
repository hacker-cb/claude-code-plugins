#!/usr/bin/env node
// commit-checks.mjs — what the two check feeds say about ONE commit. Prints JSON on stdout.
//
// This is deliberately ONE question. "Is this pull request mergeable" is a different one:
// it answers from the request's own rollup, which is not the set on the commit, and
// conflating them is how a merge is declared green over checks nobody read.
//
// There are two feeds and they are not the same feed. `check-runs` carries what the
// Checks API knows; `status` carries the older commit statuses, which an external CI may
// post to and nothing else. A reader of one is blind to the other however red it is.
//
// Usage: node commit-checks.mjs (--pr <n> | --repo <owner/name>) --sha head|merge|<oid>
//                               [--require <name>]... [--repo-dir <path>]
//
// Exit 0 either way: `"read": true` with what the feeds held, or `"read": false` with a
// `reason`. A read that did not happen is not a commit with nothing on it — unread is not
// empty, and a caller that cannot tell them apart reports a base as quiet because the
// call 404'd. Exit 2 only for a call this script cannot act on at all.

import { spawnSync } from 'node:child_process';

const USAGE = 'usage: node commit-checks.mjs (--pr <n> | --repo <owner/name>)'
  + ' --sha head|merge|<oid> [--require <name>]... [--repo-dir <path>]\n';
const die = (m) => { process.stderr.write(`commit-checks: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { pr: null, repo: null, sha: null, repoDir: null, require: [] };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (!['--pr', '--repo', '--sha', '--repo-dir', '--require'].includes(flag)) {
    die(`unknown argument '${flag}'`);
  }
  if (value === undefined) die(`${flag} needs a value`);
  if (flag === '--require') opts.require.push(value);
  else if (flag === '--repo-dir') opts.repoDir = value;
  else opts[flag.slice(2)] = value;
  i += 1;
}
if (!opts.sha) die('--sha is required: head, merge, or a commit id');
if (!opts.pr && !opts.repo) die('one of --pr or --repo is required');
// `--sha head` and `--sha merge` are the pull request's, so they need one named.
if (!opts.pr && (opts.sha === 'head' || opts.sha === 'merge')) {
  die(`--sha ${opts.sha} names a pull request's commit — pass --pr, or an explicit id`);
}
// Shape-checked HERE, before any call goes out: a bad value caught after `gh pr view`
// has already run has cost a round trip to learn what the argument said all along.
//
// Not hex, and deliberately. This endpoint takes a ref, so a branch name reaches it as
// legitimately as an object id — the check that matters is that the value is ONE path
// segment and cannot steer the url somewhere else. Length keeps a stray word out.
const SEGMENT = /^[^/\\\s?#%]{7,64}$/;
if (opts.sha !== 'head' && opts.sha !== 'merge'
    && (!SEGMENT.test(opts.sha) || opts.sha.includes('..'))) {
  die(`--sha '${opts.sha}' is not a commit id or a ref this can read`);
}
if (opts.repo && !/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

const cwd = opts.repoDir || process.cwd();
const gh = (args) => {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

const answer = {
  // `read` is the only field a caller may act on without saying it did not look: BOTH
  // feeds answered. It is set last, after everything that can refuse has refused.
  read: false, repo: null, sha: null,
  runs: [], statuses: [], rollup: null, rollupSpeaks: false,
  counts: { runs: 0, statuses: 0, unfinished: 0, failing: 0 },
  empty: false, unfinished: [], failing: [], required: [],
  reason: null, notes: [],
};
const finish = () => { process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

// A paginated `gh api` prints one JSON document per page, concatenated. Parsed as one
// document that is a syntax error; parsed as the first page it is the first page — which
// is the "first page is not the list" failure happening inside the reader written to
// prevent it. Split on brace depth outside strings, then merge the lists.
const parsePages = (text) => {
  const pages = [];
  let rest = text.trim();
  while (rest) {
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
    if (end === -1) return null;
    try { pages.push(JSON.parse(rest.slice(0, end))); } catch { return null; }
    rest = rest.slice(end).trim();
  }
  return pages;
};

let repo = opts.repo;
let sha = opts.sha;

if (opts.pr) {
  const view = gh(['pr', 'view', opts.pr, '--json', 'url,headRefOid,mergeCommit',
    ...(opts.repo ? ['--repo', opts.repo] : [])]);
  if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.err.split('\n')[0] || 'no detail'})`);
  let pr;
  try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
  // The request's OWN repository, taken from its url — never gh's default, which in a
  // fork checkout is the parent, where this commit does not exist and every read below
  // 404s into a silence that looks exactly like a commit with nothing on it. The host is
  // stripped rather than matched: an Enterprise instance serves its own.
  if (!repo) {
    const m = String(pr.url || '').match(/^https?:\/\/[^/]+\/(.+?)\/pull\/\d+/);
    if (!m) refuse(`could not read the repository out of the pull request url '${pr.url}'`);
    repo = m[1];
  }
  if (sha === 'head') sha = pr.headRefOid || '';
  else if (sha === 'merge') sha = (pr.mergeCommit && pr.mergeCommit.oid) || '';
  // Empty until the merge commit is published — a queue, a replica behind. Refusing is
  // the whole point: an empty id builds a url that 404s, and a 404 prints no rows, which
  // a caller reads as a base with nothing to run.
  if (!sha) {
    refuse(opts.sha === 'merge'
      ? `pull request ${opts.pr} carries no merge commit yet — re-poll rather than reading an empty id`
      : `pull request ${opts.pr} reports no ${opts.sha} commit`);
  }
}

// What the request answered with is checked too — it is data from a forge, not argv, so
// it refuses rather than dying: a caller gating on `read` is told the question could not
// be answered, which is what every other refusal here says.
if (!SEGMENT.test(sha) || sha.includes('..')) refuse(`the pull request named '${sha}' as its ${opts.sha} commit, which is not a ref this can read`);
if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) refuse(`'${repo}' is not owner/name`);
answer.repo = repo;
answer.sha = sha;

// Both feeds paginate. Both are captured with their exit status rather than piped
// onward: a call that failed prints no rows, exactly as a commit with nothing on it
// does, and the two take different steps.
const feed = (path) => {
  const r = gh(['api', '--paginate', `repos/${repo}/commits/${sha}/${path}`]);
  if (!r.ok) return { ok: false, err: r.err.split('\n').filter(Boolean).pop() || 'no detail' };
  const pages = parsePages(r.out);
  if (pages === null) return { ok: false, err: `could not parse the ${path} response` };
  return { ok: true, pages };
};

const runsFeed = feed('check-runs');
if (!runsFeed.ok) refuse(`the check-runs feed could not be read (${runsFeed.err})`);
const statusFeed = feed('status');
if (!statusFeed.ok) refuse(`the status feed could not be read (${statusFeed.err})`);

// Keyed by id, not by name: a name is not unique on a commit — one measured merge commit
// carried `audit-full` three times from three matrix legs — so a caller collapsing by
// name reads three runs as one and calls the set finished while two are still going.
const runsById = new Map();
for (const page of runsFeed.pages) {
  for (const run of (page && page.check_runs) || []) {
    if (run && run.id !== undefined) runsById.set(String(run.id), run);
  }
}
answer.runs = [...runsById.values()].map((r) => ({
  id: String(r.id), name: r.name ?? null,
  status: r.status ?? null, conclusion: r.conclusion ?? null,
}));

const statuses = [];
let rollup = null;
for (const page of statusFeed.pages) {
  if (!page) continue;
  // The rollup line repeats once per page, identically — it is a property of the commit,
  // not of the page. Taking the last is taking the same value the first page carried.
  if (page.state !== undefined) rollup = page.state;
  for (const s of page.statuses || []) statuses.push({ context: s.context ?? null, state: s.state ?? null });
}
answer.statuses = statuses;
answer.rollup = rollup;
// A rollup says something only beside a non-empty list. Measured on seven commits across
// four repositories, every one of them with completed check-runs: this feed answers
// `pending` over zero statuses — its empty answer wearing the shape of a run in flight.
// A caller polling on `.state` alone waits for a list that will never arrive.
answer.rollupSpeaks = statuses.length > 0;
if (rollup && !answer.rollupSpeaks) {
  answer.notes.push(`the status feed is empty and its rollup reads '${rollup}' —`
    + ' that is this feed having nothing, not a run in flight');
}

// A run is unfinished until `status` says completed. `conclusion` is null while it runs,
// and null is not a pass.
for (const r of answer.runs) {
  if (r.status !== 'completed') { answer.unfinished.push(r.name); continue; }
  if (!['success', 'neutral', 'skipped'].includes(String(r.conclusion))) answer.failing.push(r.name);
}
for (const s of answer.statuses) {
  if (s.state === 'pending') answer.unfinished.push(s.context);
  else if (s.state !== 'success') answer.failing.push(s.context);
}

answer.counts = {
  runs: answer.runs.length, statuses: answer.statuses.length,
  unfinished: answer.unfinished.length, failing: answer.failing.length,
};

// Empty is both feeds carrying nothing, and it is never a verdict. A run registers after
// the push that triggers it, so an empty pair right after a merge is the answer arriving
// rather than the answer. What tells that apart from a commit nothing runs on is the
// same read on the commit before it — which is this script called again, not a branch
// inside it.
answer.empty = answer.runs.length === 0 && answer.statuses.length === 0;
if (answer.empty) {
  answer.notes.push('both feeds are empty — nothing has registered yet, or nothing runs'
    + ' here; read the commit before this one to tell which');
}

// Waiting by name, never for the count to settle. Measured: the aggregate check is born
// LAST — it started three seconds after the last of the other nineteen completed — so at
// the instant "every check has finished" became true, the one that gates the merge did
// not yet exist.
for (const name of opts.require) {
  const matching = answer.runs.filter((r) => r.name === name)
    .concat(answer.statuses.filter((s) => s.context === name)
      .map((s) => ({ name: s.context, status: s.state === 'pending' ? 'in_progress' : 'completed', conclusion: s.state })));
  answer.required.push({
    name,
    present: matching.length > 0,
    finished: matching.length > 0 && matching.every((r) => r.status === 'completed'),
    conclusion: matching.length === 1 ? matching[0].conclusion : matching.map((r) => r.conclusion),
  });
}

// Set last, and only here. Every refusal above returns with it false, so a caller gating
// on it can never be handed an empty list that no call actually produced.
answer.read = true;
finish();
