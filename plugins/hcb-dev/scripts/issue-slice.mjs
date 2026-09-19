#!/usr/bin/env node
// issue-slice.mjs — every issue of a slice with its whole graph of links, one call per
// page, and whether what came back is the whole slice. Prints JSONL.
//
// Two tiers, because the cost of a slice is the reader's context rather than the forge's
// quota: bodies and comments weigh five times what everything else does. The WIDE tier
// reads every issue of a slice without them — state, type, milestone, labels, assignees,
// parent, children, blockers, closing change requests. The DEEP tier (`--deep`) reads the
// numbers named, in full: the same fields, the body, and every comment.
//
// Usage: node issue-slice.mjs [--forge gh|glab] [--repo <path>] [--host <host>]
//                             [--repo-dir <path>] [--state open|closed|all]
//                             [--label <name>] [--milestone <number|title>]
//        node issue-slice.mjs --deep <n>[,<n>…] [--forge …] [--repo …] [--host …]
//        node issue-slice.mjs --since <moment> [--was <file>] [the wide tier's flags]
//
// Line 1 is the verdict, `{"slice": {…}}`; every line after it is one issue. What the
// verdict separates, because each leads somewhere else:
//   read: false            nothing was read — the reason says why. Not an empty slice.
//   read: true, complete: false   some of it was read; the reason says what is missing.
//   read: true, complete: true    the whole slice, whatever its size — zero included.
// Exit 0 whenever a verdict was printed; 2 for a call this script cannot act on at all.
//
// The rest of the verdict:
//   forge, repo, host   which CLI answered, the repository it resolved, and where it lives
//   tier                `wide` with its `filter`, or `deep` with the numbers `asked`
//   total, fetched      the forge's own count, and how many issues came back
//   pages               the calls the issues took
//   types, untyped      issues per type — every GitLab work item has one; `untyped` is GitHub's
//   cut, hidden         numbers of the issues with a list cut short, or an end out of sight
//   unavailable         line keys this server cannot carry, and `hid.<key>` for a detector
//                       that cannot run there — never "nothing there". Always present: `[]`
//                       on a server that carries everything
//   missing, unread     deep only: numbers that are no issue here, and numbers whose lookup
//                       failed and so were not read
//   errors, notes       what the forge said beside the data, and what the verdict alone omits
//   cost, remaining     GitHub's points spent and left; `complexity` is GitLab's
//
// An issue line leaves off every key with nothing to say:
//   n t s u             number, title, `closed[:<reason>]` where not open, updated
//   ty m l a c          type, milestone (GitHub its number, GitLab its title), labels,
//                       assignees, comments (GitLab: discussion threads)
//   p ch                parent; children as `<done>/<total>`, `<done>+` where the list was cut
//   chl                 delta only: the children themselves, which `ch` only counts — a child
//                       swapped for another leaves that count where it was
//   bb bl rel pr        blocked by, blocking, related (GitLab), closing change requests: `#N`
//                       for this repository, `<path>#N` for another, `:closed`/`:merged` after
//                       an end not open, and `+N` last where the list was cut, `+?` where the
//                       forge counted nothing
//   hid cut             ends out of sight, by kind; the keys whose list was cut
//   b cm                deep only: the body, and every comment as `{a, d, b}`
//
// The DELTA (`--since`) is the wide tier read again and set against an earlier reading of the
// same slice (`--was`: this script's own output, or a projection of it keeping the verdict line,
// `n` and the link keys). A time filter cannot stand in for it: a link added, removed or moved
// raises no `updatedAt`, and neither does the other end of one closing. The verdict gains `delta`:
//   since, moment       the moment asked from; the forge's own clock at the first page, less ten
//                       seconds — the next reading's `since`
//   was                 how many issues the earlier reading held
//   entered, left       in the slice now and not then; then and not now
//   edited              `updatedAt` at or after `since`
//   linked              a link key — p ch bb bl rel pr — that differs from the earlier reading
//   cut                 a link list one reading or the other only saw a window of: what fell
//                       outside it is in neither, so no edge is taken from that key at all
//   events              the forge's own count of link events since `since`: GitHub's timeline,
//                       GitLab's links created since — which sees no link removed. Null where
//                       nothing counts; the kinds that go uncounted are `ev.<key>` in `unavailable`
//   added, removed      edges, each once whichever end it was read from
//   moved               ends whose state changed, written with the state they have now
//   check               an edge added or removed where the count covering its kind counted none
//   complete, reason    whether this is a whole delta, and what it lacks where it is not
// A list that cannot be known is null, never empty, and the verdict's own `read` and `complete`
// still answer for the SLICE — whether the delta is whole is `delta.complete` and nothing else.
// A line gains `ev`, its own count, and `was`, the earlier value of every link key that differs.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirOk, hostOk, readable, repoOk, text, writeAll } from './lib/forge.mjs';

const USAGE = 'usage: node issue-slice.mjs [--forge gh|glab] [--repo <path>] [--host <host>]'
  + ' [--repo-dir <path>] [--state open|closed|all] [--label <name>]'
  + ' [--milestone <number|title>] [--deep <n>[,<n>…]] [--since <moment> [--was <file>]]\n';
const die = (m) => { writeAll(2, `issue-slice: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { forge: null, repo: null, host: null, dir: process.cwd(), state: null,
  label: null, milestone: null, deep: null, since: null, was: null };
const FLAGS = { '--forge': 'forge', '--repo': 'repo', '--host': 'host', '--repo-dir': 'dir',
  '--state': 'state', '--label': 'label', '--milestone': 'milestone', '--deep': 'deep',
  '--since': 'since', '--was': 'was' };
const seen = new Set();
for (let i = 0; i < argv.length; i += 1) {
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  // One label, not a list: GitHub reads several as ANY of them and GitLab as ALL of them,
  // so a second one would answer two different questions on the two forges. Every other
  // flag given twice is a caller that meant one of the two values, and this cannot tell
  // which.
  if (seen.has(key)) {
    die(key === 'label'
      ? '--label takes one label: GitHub reads several as any-of and GitLab as all-of'
      : `${argv[i]} given twice`);
  }
  seen.add(key);
  opts[key] = argv[i += 1];
}
if (opts.forge !== null && !['gh', 'glab'].includes(opts.forge)) die('--forge takes gh or glab');
// Two to eleven segments — GitLab nests projects under subgroups — each one path segment,
// and never `..`, which a server normalises into a request about somewhere else.
const repoSegments = opts.repo === null ? [] : opts.repo.split('/');
if (opts.repo !== null && (repoSegments.length < 2 || repoSegments.length > 11
  || !repoSegments.every((seg) => readable(seg) && seg !== '.'))) {
  die('--repo takes <owner>/<name>, or a GitLab group path');
}
if (opts.forge === 'gh' && opts.repo !== null && !repoOk(opts.repo)) {
  die('--repo on GitHub is <owner>/<name>');
}
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
// A host is where a repository lives, and without `--repo` the checkout names both: a GitHub
// probe then reads the repository — and its host — off the remote, and a host given beside it
// would be dropped without a word.
if (opts.host !== null && opts.repo === null) die('--host needs --repo: without one the checkout names the host');
// Passed on as `cwd`, a directory that is not there comes back as a call that failed with
// nothing on stderr — which reads as a forge that would not answer.
if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);
if (opts.state !== null && !['open', 'closed', 'all'].includes(opts.state)) {
  die('--state takes open, closed or all');
}
if (opts.label !== null && opts.label.trim() === '') die('--label takes a label name');
if (opts.milestone !== null && opts.milestone.trim() === '') die('--milestone takes a milestone');

// A GraphQL `Int` is 32-bit, and one number past it fails the whole request it rides in —
// every other number of its batch with it.
const intOk = (w) => /^[1-9][0-9]{0,9}$/.test(w) && Number(w) <= 2147483647;
let asked = null;
if (opts.deep !== null) {
  // A filter narrows a slice; the deep tier reads the numbers named, and a filter beside them
  // would narrow nothing while looking as though it had.
  if (opts.state !== null || opts.label !== null || opts.milestone !== null) {
    die('--deep reads the numbers named, so --state, --label and --milestone do not apply');
  }
  const words = opts.deep.split(/[\s,]+/).filter(Boolean);
  if (!words.length || !words.every(intOk)) die('--deep takes issue numbers, separated by commas');
  asked = [...new Set(words.map(Number))];
}
const state = opts.state || 'open';

// --- the delta: a moment, and the earlier reading it is set against
// A moment in UTC to the second, and one that exists: the forge's clock is what it is measured
// on, and an offset or a day past the month's end would move the window without a word.
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
let sinceMs = null;
if (opts.since !== null) {
  if (asked) die('--since reads the delta of a slice, and --deep reads the numbers named');
  sinceMs = Date.parse(opts.since);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(opts.since) || Number.isNaN(sinceMs)
    || iso(sinceMs) !== opts.since) {
    die('--since takes a moment in UTC, as 2026-01-02T03:04:05Z');
  }
}
// The earlier reading, as this script printed it — whole, or projected down to the verdict line,
// `n` and the link keys. A file that is not one is refused rather than compared: read as a slice
// that held nothing, it would report every issue as entered.
let pinned = null;
if (opts.was !== null) {
  if (opts.since === null) die('--was is the reading --since compares against, and needs --since');
  let raw = null;
  try { raw = readFileSync(opts.was, 'utf8'); } catch { die(`--was '${opts.was}' could not be read`); }
  const rows = [];
  for (const row of raw.split(/\r?\n/).filter((l) => l.trim() !== '')) {
    try { rows.push(JSON.parse(row)); } catch { die(`--was '${opts.was}' is not JSONL`); }
  }
  const v = rows.length && rows[0] && typeof rows[0] === 'object' ? rows[0].slice : null;
  if (!v || typeof v !== 'object' || v.tier !== 'wide') {
    die(`--was '${opts.was}' does not open with the verdict of a wide reading`);
  }
  const byN = new Map();
  for (const l of rows.slice(1)) {
    if (!l || typeof l !== 'object' || !Number.isInteger(l.n) || l.n < 1) {
      die(`--was '${opts.was}' holds a line that is no issue`);
    }
    if (byN.has(l.n)) die(`--was '${opts.was}' holds issue ${l.n} twice`);
    byN.set(l.n, l);
  }
  pinned = { v, byN };
}

// --- the verdict, and the one way out
const head = {
  read: false, complete: false, tier: asked ? 'deep' : 'wide',
  forge: null, repo: null, host: null,
  ...(asked ? { asked } : { filter: { state, label: opts.label, milestone: opts.milestone } }),
  // Keyed by names the forge hands back, so no key can be one an object already inherits:
  // a type called `constructor` would read a function where its count belongs.
  total: null, fetched: 0, pages: 0, types: Object.create(null), untyped: 0,
  ...(asked ? { missing: [], unread: [] } : {}),
  cut: [], hidden: [], unavailable: [],
  ...(opts.since === null ? {} : { delta: {
    since: opts.since, moment: null, was: pinned ? pinned.byN.size : null,
    entered: null, left: null, edited: null, linked: null, cut: null, events: null,
    added: null, removed: null, moved: null, check: null, complete: false, reason: null,
  } }),
  errors: [], reason: null, notes: [],
};
const lines = [];
const finish = () => {
  if (head.forge !== 'gh') delete head.untyped;
  if (head.delta && !head.delta.complete && !head.delta.reason) head.delta.reason = head.reason;
  // Bounded: a forge failing every page says the same thing on every page, and the verdict is
  // read before anything else on the output.
  if (head.errors.length > 20) head.errors = [...head.errors.slice(0, 20), `…and ${head.errors.length - 20} more`];
  const out = [JSON.stringify({ slice: head }), ...lines.map((l) => JSON.stringify(l))];
  writeAll(1, `${out.join('\n')}\n`);
  process.exit(0);
};
const unread = (reason) => {
  head.read = false; head.complete = false; head.reason = reason;
  // Nothing was read, so every number asked is one to ask again — none of them is missing.
  if (asked) { head.unread = [...asked]; head.missing = []; }
  finish();
};

// --- one call to a CLI
// The whole request goes on stdin as `{query, variables}`, never as `-f` fields: glab drops a
// list field (`-f 'labels[]=x'`) without a word and the filter silently widens to the whole
// project, and neither CLI's `--paginate` survives a nested `pageInfo`, which is the only mark
// a GitLab link list gives of being cut. `--input` alone sends no Content-Type, and GitLab then
// parses an empty document — so the header is named, on both CLIs alike.
const call = (cli, args, input = null, timeout = 120000) => {
  const r = spawnSync(cli, args, {
    cwd: opts.dir,
    encoding: 'utf8',
    timeout,
    maxBuffer: 256 * 1024 * 1024,
    ...(input === null ? {} : { input }),
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
  });
  const line = (r.stderr || '').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop()
    || 'no detail';
  return {
    ok: r.status === 0,
    // Killed by the timeout is not an answer of any kind, and a reader taking it for one
    // states what it never measured.
    timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
    missing: Boolean(r.error && r.error.code === 'ENOENT'),
    out: r.stdout || '',
    line: text(line),
  };
};
const failure = (cli, r) => (r.timedOut ? `${cli} timed out — that is no answer, not an empty one`
  : r.missing ? `${cli} is not on PATH`
    // Its own diagnostics already open with its name, and a second prefix reads as two
    // layers having failed.
    : String(r.line || '').startsWith(`${cli}:`) ? String(r.line) : `${cli}: ${r.line}`);

// --- which forge, which repository, which host
// Whichever CLI RESPONDS for this repository — a hostname cannot say it, since a self-hosted
// instance answers on any domain. Both answering is an ambiguity, not a race: a project
// mirrored under the same path on the other forge answers too, and reading the mirror's
// issues as this repository's is a wrong answer indistinguishable from the right one.
const PROBES = {
  gh: () => {
    // `gh repo view` reads a three-part argument as HOST/OWNER/REPO, so a GitLab group path
    // handed on would send the probe — and the token for that host — to whatever its first
    // segment names.
    if (opts.repo && !repoOk(opts.repo)) return { reason: 'gh: a group path is not a GitHub repository' };
    const target = opts.repo ? (opts.host ? `${opts.host}/${opts.repo}` : opts.repo) : null;
    const r = call('gh', ['repo', 'view', ...(target ? [target] : []), '--json', 'nameWithOwner,url'],
      null, 60000);
    if (!r.ok) return { reason: failure('gh', r) };
    try {
      const v = JSON.parse(r.out);
      const host = new URL(v.url).host;
      if (!repoOk(v.nameWithOwner) || !hostOk(host)) return { reason: 'gh: an unreadable repository' };
      return { repo: v.nameWithOwner, host };
    } catch { return { reason: 'gh: the repository answer was not JSON' }; }
  },
  glab: () => {
    const path = opts.repo ? `projects/${encodeURIComponent(opts.repo)}` : 'projects/:fullpath';
    const r = call('glab', ['api', ...(opts.host ? ['--hostname', opts.host] : []), path], null, 60000);
    if (!r.ok) return { reason: failure('glab', r) };
    try {
      const v = JSON.parse(r.out);
      const host = new URL(v.web_url).host;
      const full = v.namespace && typeof v.namespace.full_path === 'string' ? v.namespace.full_path : null;
      if (!full || typeof v.path !== 'string') return { reason: 'glab: an unreadable project' };
      const path = `${full}/${v.path}`;
      const segs = path.split('/');
      if (segs.length < 2 || !segs.every((s) => readable(s) && s !== '.') || !hostOk(host)) {
        return { reason: 'glab: an unreadable project' };
      }
      return { repo: path, host };
    } catch { return { reason: 'glab: the project answer was not JSON' }; }
  },
};
const answered = [];
const refusals = [];
for (const cli of opts.forge ? [opts.forge] : ['gh', 'glab']) {
  const p = PROBES[cli]();
  if (p.reason) refusals.push(p.reason);
  else answered.push({ cli, ...p });
}
if (answered.length > 1) {
  unread(`both ${answered.map((a) => a.cli).join(' and ')} answer for this repository — name`
    + ' one with --forge, since the wrong one answers about a mirror');
}
if (answered.length === 0) unread(`no forge answered for this repository (${refusals.join('; ')})`);
const { cli } = answered[0];
head.forge = cli;
head.repo = answered[0].repo;
head.host = answered[0].host;
// Each forge names a milestone by what its own filter takes — GitHub the number, GitLab the
// title — and which one this call is talking to is known only now. A title passed to GitHub
// would reach `milestone(number:)` as nothing at all, and the slice would come back empty
// rather than refused.
if (cli === 'gh' && opts.milestone !== null && !intOk(opts.milestone)) {
  die(`--milestone on GitHub is the milestone's number, and '${opts.milestone}' is not one`);
}
// `include` asks for the response's headers too — both CLIs print them, a blank line, then the
// body — for the one header the delta needs: `Date`, the forge's own clock.
const gql = (body, include = false) => {
  const input = JSON.stringify(body);
  const args = ['api', ...(include ? ['--include'] : []), '--hostname', head.host, 'graphql',
    '-H', 'Content-Type: application/json', '--input', '-'];
  // Twice, where the first call brought back nothing that parses. A page of a long read is
  // lost to a gateway or a dropped connection often enough that one retry is the difference
  // between a slice and a refusal — and where the refusal is the forge's own answer to this
  // query, the second call says the same thing at the cost of one round trip. Never after a
  // timeout: that one was killed at the deadline, and a second wait only doubles it.
  for (let attempt = 0; ; attempt += 1) {
    const r = call(cli, args, input);
    let out = r.out;
    let date = null;
    const gap = include ? /\r?\n\r?\n/.exec(out) : null;
    if (gap && /^HTTP\/\S+ \d{3}/.test(out)) {
      const m = out.slice(0, gap.index).match(/^date:[ \t]*(.*?)[ \t]*\r?$/im);
      date = m ? m[1] : null;
      out = out.slice(gap.index + gap[0].length);
    }
    // Both CLIs exit 1 on a PARTIAL error with the good data already on stdout, so the exit
    // status decides nothing here: what was printed does.
    let json = null;
    try { json = JSON.parse(out); } catch { json = null; }
    if (json && typeof json === 'object') return { json, reason: null, date };
    if (attempt > 0 || r.timedOut || r.missing) return { json: null, reason: failure(cli, r), date: null };
  }
};
// GraphQL errors, and the bare `{"message": …}` an HTTP refusal carries instead — a token
// refused or a rate limit spent arrives in that shape, and read as no data at all it would
// pass for a repository that is not there.
const messages = (json) => [
  ...(Array.isArray(json.errors) ? json.errors : [])
    .map((e) => text(e && typeof e.message === 'string' ? e.message : 'an error with no message')),
  ...(!json.data && typeof json.message === 'string' ? [text(json.message)] : []),
];

// --- how a link end is written: `#12` for this repository, `owner/name#12` for another,
// with `:closed` / `:merged` after an end that is not open
const suffix = (s) => {
  const v = String(s || '').toLowerCase();
  return v === '' || v === 'open' || v === 'opened' ? '' : `:${v}`;
};
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
// GitHub hands a link end as a URL and nothing else: `--json` carries no repository on it,
// and a number read without its owner is read as this repository's. The owner is in the path.
const ghRef = (node) => {
  let path = null;
  try { path = new URL(node.url).pathname; } catch { path = null; }
  const m = path && path.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)$/);
  if (!m) return `${text(node.url) || '?'}${suffix(node.state)}`;
  const where = same(`${m[1]}/${m[2]}`, head.repo) ? '' : `${m[1]}/${m[2]}`;
  return `${where}#${m[3]}${suffix(node.state)}`;
};
// GitLab writes the owner into the reference itself — `group/project#12`, `group/project!3`,
// `group&5` for an epic — so only this project's own prefix comes off.
const glRef = (reference, st) => {
  const r = String(reference || '?');
  const own = head.repo.toLowerCase();
  const low = r.toLowerCase();
  const short = (low.startsWith(`${own}#`) || low.startsWith(`${own}!`)) ? r.slice(own.length) : r;
  return `${short}${suffix(st)}`;
};
// A list cut short says by how much, as its last entry, and the line names it under `cut`.
const capped = (cut, key, items, total) => {
  if (!Number.isInteger(total) || total <= items.length) return items;
  cut.push(key);
  return [...items, `+${total - items.length}`];
};
// An empty value is left off the line rather than written: at a hundred issues a page, the
// keys an issue does not use are most of what the line would weigh.
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null
  && v !== undefined && v !== '' && v !== 0 && !(Array.isArray(v) && v.length === 0)
  && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)));

// --- GitHub
// The link fields arrived in stages — types, parents and sub-issues on GHES 3.17,
// dependencies on 3.19 — and one field a server lacks fails the whole query. So the fields
// are read off the server's own schema before the first page, on whatever host answered:
// one call, and the fragment carries what that server has. Filled in below the probe.
let GH_WIDE = null;
// The delta's count: every link event on an issue's timeline since the moment, one connection
// asking nothing but `filteredCount` — `totalCount` there ignores `since` and counts the whole
// history. An event lands on both ends of its edge. Each kind is counted by both of its events,
// and only where the server has them. Filled in below the probe too.
const EVENTS = {
  p: ['PARENT_ISSUE_ADDED_EVENT', 'PARENT_ISSUE_REMOVED_EVENT'],
  ch: ['SUB_ISSUE_ADDED_EVENT', 'SUB_ISSUE_REMOVED_EVENT'],
  bb: ['BLOCKED_BY_ADDED_EVENT', 'BLOCKED_BY_REMOVED_EVENT'],
  bl: ['BLOCKING_ADDED_EVENT', 'BLOCKING_REMOVED_EVENT'],
};
let GH_EV = '';
const evKinds = [];
const ghWide = (has) => [
  'number title state stateReason updatedAt milestone { number }',
  'labels(first: 30) { totalCount nodes { name } }',
  'assignees(first: 10) { totalCount nodes { login } }',
  has('issueType') && 'issueType { name }',
  has('parent') && 'parent { url state }',
  has('subIssues') && (opts.since === null ? 'subIssues { totalCount }'
    : 'subIssues(first: 30) { totalCount nodes { url state } }'),
  has('subIssuesSummary') && 'subIssuesSummary { total completed }',
  has('issueDependenciesSummary') && 'issueDependenciesSummary { blockedBy blocking }',
  has('blockedBy') && 'blockedBy(first: 30) { totalCount nodes { url state } }',
  has('blocking') && 'blocking(first: 30) { totalCount nodes { url state } }',
  has('closedByPullRequestsReferences', 'includeClosedPrs')
    && 'closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { totalCount nodes { url state } }',
].filter(Boolean).join('\n  ');
// What a line cannot carry on this server. A detector whose summary is missing is named too:
// it cannot fire there, and its silence must not read as nothing hidden.
const ghLacks = (has) => [
  ['ty', has('issueType')], ['p', has('parent')], ['ch', has('subIssuesSummary')],
  ['bb', has('blockedBy')], ['bl', has('blocking')],
  ['pr', has('closedByPullRequestsReferences', 'includeClosedPrs')],
  ['hid.ch', has('subIssuesSummary') && has('subIssues')],
  ['hid.bb', has('issueDependenciesSummary') && has('blockedBy')],
  ['hid.bl', has('issueDependenciesSummary') && has('blocking')],
].filter(([, ok]) => !ok).map(([key]) => key);
// `comments` twice with different arguments is a conflict GitHub refuses outright, so the
// wide count and the deep page are two fragments rather than one with an extra field.
const GH_COMMENTS = 'comments(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor }'
  + ' nodes { author { login } createdAt body } }';

const ghLine = (i) => {
  const cut = [];
  const mark = (key, items, total) => capped(cut, key, items, total);
  const nodes = (c) => (c && Array.isArray(c.nodes) ? c.nodes.filter(Boolean) : []);
  const bb = nodes(i.blockedBy);
  const bl = nodes(i.blocking);
  const hid = {};
  // The summaries are counted by the server whatever the token may see, while `nodes` and
  // `totalCount` drop what it may not. More in the summary than in sight is an end this
  // token cannot see — a blocker above all, which a graph built from sight alone reads as
  // no blocker at all. Open ends only: a hidden blocker that is closed blocks nothing.
  const sum = i.issueDependenciesSummary || {};
  const openIn = (xs) => xs.filter((n) => n.state === 'OPEN').length;
  if (Number.isInteger(sum.blockedBy) && i.blockedBy && i.blockedBy.totalCount <= bb.length) {
    if (sum.blockedBy > openIn(bb)) hid.bb = sum.blockedBy - openIn(bb);
  }
  if (Number.isInteger(sum.blocking) && i.blocking && i.blocking.totalCount <= bl.length) {
    if (sum.blocking > openIn(bl)) hid.bl = sum.blocking - openIn(bl);
  }
  const ss = i.subIssuesSummary;
  if (ss && i.subIssues && ss.total > i.subIssues.totalCount) hid.ch = ss.total - i.subIssues.totalCount;
  const line = compact({
    n: i.number,
    t: i.title,
    s: i.state === 'OPEN' ? null : `closed${i.stateReason ? `:${String(i.stateReason).toLowerCase()}` : ''}`,
    u: i.updatedAt,
    ty: i.issueType ? i.issueType.name : null,
    m: i.milestone ? i.milestone.number : null,
    l: mark('l', nodes(i.labels).map((x) => x.name), i.labels ? i.labels.totalCount : null),
    a: mark('a', nodes(i.assignees).map((x) => x.login), i.assignees ? i.assignees.totalCount : null),
    c: i.comments ? i.comments.totalCount : null,
    p: i.parent ? ghRef(i.parent) : null,
    ch: ss && ss.total > 0 ? `${ss.completed}/${ss.total}` : null,
    chl: opts.since === null ? [] : mark('chl', nodes(i.subIssues).map(ghRef),
      i.subIssues ? i.subIssues.totalCount : null),
    bb: mark('bb', bb.map(ghRef), i.blockedBy ? i.blockedBy.totalCount : null),
    bl: mark('bl', bl.map(ghRef), i.blocking ? i.blocking.totalCount : null),
    pr: mark('pr', nodes(i.closedByPullRequestsReferences).map(ghRef),
      i.closedByPullRequestsReferences ? i.closedByPullRequestsReferences.totalCount : null),
    hid,
    cut,
  });
  return line;
};

// --- GitLab
const GL_WIDE = `iid title state updatedAt userDiscussionsCount workItemType { name }
  widgets {
    type
    ... on WorkItemWidgetHierarchy { hasParent parent { reference(full: true) state } hasChildren children(first: 20) { count nodes { state${opts.since === null ? '' : ' reference(full: true)'} } } }
    ... on WorkItemWidgetLinkedItems { linkedItems(first: 20) { pageInfo { hasNextPage } nodes { linkType${opts.since === null ? '' : ' linkCreatedAt'} workItemState workItem { reference(full: true) } } } }
    ... on WorkItemWidgetMilestone { milestone { title } }
    ... on WorkItemWidgetDevelopment { closingMergeRequests(first: 5) { count nodes { mergeRequest { reference(full: true) state } } } }
    ... on WorkItemWidgetLabels { labels { count nodes { title } } }
    ... on WorkItemWidgetAssignees { assignees { count nodes { username } } }
  }`;
const GL_NOTES = 'notes(filter: ONLY_COMMENTS, first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor }'
  + ' nodes { author { username } createdAt body } }';

const glLine = (w) => {
  const cut = [];
  const mark = (key, items, total) => capped(cut, key, items, total);
  const by = {};
  for (const x of Array.isArray(w.widgets) ? w.widgets : []) if (x && x.type) by[x.type] = x;
  const nodes = (c) => (c && Array.isArray(c.nodes) ? c.nodes.filter(Boolean) : []);
  const h = by.HIERARCHY || {};
  const li = by.LINKED_ITEMS && by.LINKED_ITEMS.linkedItems;
  const links = nodes(li);
  // Counted here from the edges, not asked of the server: `blockedByCount` and `blocked` are
  // not in a Community Edition schema, and one unknown field fails the whole query there.
  const kind = (k) => links.filter((x) => x.linkType === k).map((x) => glRef(x.workItem && x.workItem.reference, x.workItemState));
  const hid = {};
  // A parent the token cannot see still leaves `hasParent` set; children the same with
  // `hasChildren`. Both are the server's own word beside what it showed.
  if (h.hasParent && !h.parent) hid.p = 1;
  if (h.hasChildren && h.children && h.children.count === 0) hid.ch = 1;
  const kids = h.children ? nodes(h.children) : [];
  const line = compact({
    n: Number(w.iid),
    t: w.title,
    s: w.state === 'OPEN' ? null : 'closed',
    u: w.updatedAt,
    // Always, including `Issue`: the slice holds tasks beside the issues they belong to, and
    // a count that cannot tell them apart counts every child twice.
    ty: w.workItemType ? w.workItemType.name : null,
    m: by.MILESTONE && by.MILESTONE.milestone ? by.MILESTONE.milestone.title : null,
    l: mark('l', nodes(by.LABELS && by.LABELS.labels).map((x) => x.title),
      by.LABELS && by.LABELS.labels ? by.LABELS.labels.count : null),
    a: mark('a', nodes(by.ASSIGNEES && by.ASSIGNEES.assignees).map((x) => x.username),
      by.ASSIGNEES && by.ASSIGNEES.assignees ? by.ASSIGNEES.assignees.count : null),
    c: Number.isInteger(w.userDiscussionsCount) ? w.userDiscussionsCount : null,
    p: h.parent ? glRef(h.parent.reference, h.parent.state) : null,
    ch: h.children && h.children.count > 0
      ? `${kids.filter((k) => k.state !== 'OPEN').length}${h.children.count > kids.length ? '+' : ''}/${h.children.count}`
      : null,
    chl: opts.since === null ? [] : mark('chl', kids.map((k) => glRef(k.reference, k.state)),
      h.children ? h.children.count : null),
    bb: kind('is_blocked_by'),
    bl: kind('blocks'),
    rel: kind('relates_to'),
    pr: mark('pr', nodes(by.DEVELOPMENT && by.DEVELOPMENT.closingMergeRequests)
      .map((x) => x.mergeRequest && glRef(x.mergeRequest.reference, x.mergeRequest.state)).filter(Boolean),
    by.DEVELOPMENT && by.DEVELOPMENT.closingMergeRequests ? by.DEVELOPMENT.closingMergeRequests.count : null),
    hid,
    cut,
  });
  // The link list carries no count at all, only whether another page exists, so how much is
  // missing — and from which of the three kinds — cannot be said; only that something is.
  if (li && li.pageInfo && li.pageInfo.hasNextPage) {
    line.cut = [...(line.cut || []), 'links'];
    for (const k of ['bb', 'bl', 'rel']) line[k] = [...(line[k] || []), '+?'];
  }
  if (h.children && h.children.count > kids.length) line.cut = [...(line.cut || []), 'ch'];
  return line;
};

const take = (line) => {
  lines.push(line);
  if (line.ty) head.types[line.ty] = (head.types[line.ty] || 0) + 1;
  else head.untyped += 1;
  if (line.cut) head.cut.push(line.n);
  if (line.hid) head.hidden.push(line.n);
};

// --- the wide tier: every page of the slice, to the end
// The delta's count rides every page as one more field and one more variable; without it the
// request is the wide tier's, word for word.
const evVar = () => (GH_EV ? ', $since: DateTime!' : '');
const evField = () => (GH_EV ? ` ${GH_EV}` : '');
const WIDE = {
  gh: {
    // A milestone is read through the milestone's OWN connection, not through
    // `filterBy: {milestoneNumber}`: measured on a repository of a quarter-million issues,
    // the filtered form answers HTTP 502 at every page size down to ten, while the
    // milestone's own answers in three seconds. Its `totalCount` is also the honest
    // denominator — the milestone's `open_issues`/`closed_issues` count pull requests in.
    query: () => (opts.milestone === null
      ? `query($owner: String!, $repo: String!, $endCursor: String, $states: [IssueState!], $labels: [String!]${evVar()}) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $repo) {
    issues(first: 100, after: $endCursor, states: $states, labels: $labels, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      totalCount
      nodes { ${GH_WIDE} comments { totalCount }${evField()} }
    }
  }
}`
      : `query($owner: String!, $repo: String!, $endCursor: String, $states: [IssueState!], $labels: [String!], $milestoneNumber: Int!${evVar()}) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $repo) {
    milestone(number: $milestoneNumber) {
      issues(first: 100, after: $endCursor, states: $states, labels: $labels, orderBy: {field: CREATED_AT, direction: ASC}) {
        pageInfo { hasNextPage endCursor }
        totalCount
        nodes { ${GH_WIDE} comments { totalCount }${evField()} }
      }
    }
  }
}`),
    variables: () => {
      const [owner, repo] = head.repo.split('/');
      return { owner, repo,
        states: state === 'all' ? ['OPEN', 'CLOSED'] : [state.toUpperCase()],
        labels: opts.label === null ? null : [opts.label],
        ...(opts.milestone === null ? {} : { milestoneNumber: Number(opts.milestone) }),
        ...(GH_EV ? { since: opts.since } : {}) };
    },
    // Where the slice lives in the answer, and null where the answer holds neither the
    // repository nor the milestone.
    at: (d) => {
      if (!d || !d.repository) return null;
      return opts.milestone === null ? d.repository.issues
        : (d.repository.milestone ? d.repository.milestone.issues : null);
    },
    total: (c) => c.totalCount,
    number: (n) => n.number,
    line: ghLine,
    ev: (n) => (n.timelineItems && Number.isInteger(n.timelineItems.filteredCount) ? n.timelineItems.filteredCount : null),
    spend: (d) => { if (d && d.rateLimit) { head.cost = (head.cost || 0) + d.rateLimit.cost; head.remaining = d.rateLimit.remaining; } },
    none: (d) => (d && d.repository
      ? `there is no milestone ${opts.milestone} in this repository`
      : 'the repository was not found, or this token cannot see it'),
  },
  glab: {
    // A milestone title that matches nothing filters to nothing, and GitLab answers that with
    // an empty list and no error — so the milestone is looked up beside the slice, by exact
    // title, its ancestor groups' included, and a slice under a milestone that is not there is
    // unread rather than empty.
    query: () => `query($fullPath: ID!, $endCursor: String, $state: IssuableState, $milestoneTitle: [String!], $labelName: [String!]${opts.milestone === null ? '' : ', $milestone: String'}) {
  queryComplexity { score limit }
  project(fullPath: $fullPath) {
    ${opts.milestone === null ? '' : 'milestones(title: $milestone, includeAncestors: true, first: 1) { nodes { title } }'}
    workItems(state: $state, types: [ISSUE, TASK], milestoneTitle: $milestoneTitle, labelName: $labelName, sort: CREATED_ASC, first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${GL_WIDE} }
      count
    }
  }
}`,
    variables: () => ({ fullPath: head.repo, state: state === 'open' ? 'opened' : state,
      milestoneTitle: opts.milestone === null ? null : [opts.milestone],
      labelName: opts.label === null ? null : [opts.label],
      ...(opts.milestone === null ? {} : { milestone: opts.milestone }) }),
    at: (d) => {
      if (!d || !d.project) return null;
      if (opts.milestone !== null && !(d.project.milestones && Array.isArray(d.project.milestones.nodes)
        && d.project.milestones.nodes.length)) return null;
      return d.project.workItems;
    },
    total: (c) => c.count,
    number: (n) => Number(n.iid),
    line: glLine,
    // No count of events here: a link created since the moment carries the moment itself. A link
    // removed and the hierarchy leave nothing behind, so only the comparison sees those.
    ev: (w) => {
      const li = (Array.isArray(w.widgets) ? w.widgets : []).find((x) => x && x.type === 'LINKED_ITEMS');
      const got = li && li.linkedItems && Array.isArray(li.linkedItems.nodes) ? li.linkedItems.nodes : [];
      return got.filter((x) => x && Date.parse(x.linkCreatedAt) >= sinceMs).length;
    },
    spend: (d) => {
      const q = d && d.queryComplexity;
      if (q && (!head.complexity || q.score > head.complexity.score)) head.complexity = { score: q.score, limit: q.limit };
    },
    // GitLab answers a project it will not show with `null` and NO error: without this, a
    // project the token cannot see reads as a project with no issues.
    none: (d) => (d && d.project
      ? `there is no milestone ${opts.milestone} in this project`
      : 'the project was not found, or this token cannot see it'),
  },
};

const wide = () => {
  const w = WIDE[cli];
  const got = new Map();
  let cursor = null;
  let pageCap = null;
  const totals = [];
  for (;;) {
    const first = head.pages === 0;
    const { json, reason, date } = gql({ query: w.query(), variables: { ...w.variables(), endCursor: cursor } },
      head.delta !== undefined && first);
    if (head.delta && first) clock = date;
    if (!json) {
      if (head.pages === 0) unread(reason);
      head.reason = `page ${head.pages + 1} could not be read (${reason})`;
      break;
    }
    const errs = messages(json);
    head.errors.push(...errs);
    w.spend(json.data);
    const conn = w.at(json.data);
    if (!conn || !Array.isArray(conn.nodes)) {
      if (head.pages === 0) unread(errs.length ? errs[0] : w.none(json.data));
      head.reason = `page ${head.pages + 1} held no slice${errs.length ? ` (${errs[0]})` : ''}`;
      break;
    }
    head.pages += 1;
    head.read = true;
    totals.push(w.total(conn));
    for (const n of conn.nodes.filter(Boolean)) {
      const k = w.number(n);
      if (got.has(k)) continue;
      got.set(k, true);
      const line = w.line(n);
      const ev = head.delta ? w.ev(n) : null;
      if (ev) line.ev = ev;
      take(line);
    }
    const pi = conn.pageInfo || {};
    if (!pi.hasNextPage) break;
    // A cursor that does not move asks for the same page forever — the loop `--paginate`
    // falls into when the variable is misnamed. Refused here whatever the cause.
    if (!pi.endCursor || pi.endCursor === cursor) { head.reason = 'the forge offered another page with no new cursor'; break; }
    // More pages than the total can fill is a forge that will not stop; the slice is whatever
    // arrived, and it is said to be short.
    if (pageCap === null) pageCap = Math.ceil(Math.max(totals[0], 1) / 100) + 2;
    if (head.pages >= pageCap) { head.reason = 'the forge kept offering pages past its own total'; break; }
    cursor = pi.endCursor;
  }
  head.fetched = got.size;
  head.total = totals.length ? totals[totals.length - 1] : null;
  // A total that moved between pages means the pages are not one moment's slice, whatever the
  // counts come to at the end: one issue gone and another come leaves them equal.
  if (!head.reason && new Set(totals).size > 1) {
    head.reason = `the slice changed while it was read — its total went ${totals.join(' → ')}; read it again`;
  }
  if (!head.reason && head.errors.length) head.reason = 'the forge reported errors beside the data';
  if (!head.reason && head.fetched !== head.total) head.reason = `${head.fetched} of ${head.total} issues came back`;
  head.complete = head.read && !head.reason;
};

// --- the deep tier: the numbers named, each with its body and every comment
const DEEP = {
  gh: {
    batch: 50,
    query: (nums) => `query($owner: String!, $repo: String!, $endCursor: String) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $repo) { ${nums.map((n) => `i${n}: issue(number: ${n}) { ...deep }`).join(' ')} }
}
fragment deep on Issue { ${GH_WIDE} body ${GH_COMMENTS} }`,
    variables: () => { const [owner, repo] = head.repo.split('/'); return { owner, repo, endCursor: null }; },
    items: (d) => {
      if (!d || !d.repository) return null;
      return Object.values(d.repository).filter((v) => v && typeof v === 'object');
    },
    // The lookup itself missing: a NOT_FOUND naming an alias that came back null. One on a
    // field of an issue that WAS found — `repository.i12.parent` — is that field failing to
    // read, and taking it for an absence would pass a short read off as a whole one.
    miss: (e, d) => Boolean(e && e.type === 'NOT_FOUND' && Array.isArray(e.path)
      && e.path[0] === 'repository' && /^i\d+$/.test(String(e.path[1]))
      && d && d.repository && d.repository[e.path[1]] === null),
    // A number is settled when its alias came back as an issue, or as that miss. Null beside
    // any other error is a lookup that failed, not an absence.
    settled: (d, nums, errors) => new Set(nums.filter((n) => {
      const v = d && d.repository ? d.repository[`i${n}`] : undefined;
      if (v) return true;
      return v === null && errors.some((e) => DEEP.gh.miss(e, d) && e.path[1] === `i${n}`);
    })),
    number: (n) => n.number,
    line: ghLine,
    body: (n) => n.body,
    comments: (n) => n.comments,
    comment: (c) => ({ a: c.author ? c.author.login : null, d: c.createdAt, b: c.body }),
    more: (n) => ({
      query: `query($owner: String!, $repo: String!, $endCursor: String) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $repo) { issue(number: ${n}) { ${GH_COMMENTS} } }
}`,
      variables: DEEP.gh.variables(),
      at: (d) => (d && d.repository && d.repository.issue ? d.repository.issue.comments : null),
    }),
    // GitHub counts the comments; a page run that ends short of the count lost some.
    counted: (c) => c.totalCount,
    spend: WIDE.gh.spend,
    none: () => 'the repository was not found, or this token cannot see it',
  },
  glab: {
    // Ten references per list is the server's own ceiling, refused past it; five lists share
    // one call inside the complexity limit.
    batch: 50,
    query: (nums) => {
      const groups = [];
      for (let k = 0; k < nums.length; k += 10) groups.push(nums.slice(k, k + 10));
      return `query($ctx: ID!, $endCursor: String) {
  queryComplexity { score limit }
  ${groups.map((g, k) => `b${k}: workItemsByReference(contextNamespacePath: $ctx, refs: ${JSON.stringify(g.map((n) => `#${n}`))}, first: 10) { nodes { ...deep } }`).join('\n  ')}
}
fragment deep on WorkItem { ${GL_WIDE} widgets { ... on WorkItemWidgetDescription { description } ... on WorkItemWidgetNotes { ${GL_NOTES} } } }`;
    },
    variables: () => ({ ctx: head.repo, endCursor: null }),
    items: (d) => {
      if (!d) return null;
      const lists = Object.entries(d).filter(([k, v]) => /^b\d+$/.test(k) && v && Array.isArray(v.nodes));
      return lists.length ? lists.flatMap(([, v]) => v.nodes.filter(Boolean)) : null;
    },
    // GitLab drops a reference it cannot resolve without an error, so no error is a miss.
    miss: () => false,
    // A list that came back clean settles its ten references, found or dropped. One that came
    // back null, or beside an error naming it, settles none: a node that failed to read is
    // dropped from the list as silently as a reference that resolved to nothing.
    settled: (d, nums, errors) => new Set(nums.filter((n, i) => {
      const key = `b${Math.floor(i / 10)}`;
      const list = d ? d[key] : null;
      return Boolean(list && Array.isArray(list.nodes))
        && !errors.some((e) => e && Array.isArray(e.path) && e.path[0] === key);
    })),
    number: (n) => Number(n.iid),
    line: glLine,
    body: (n) => {
      const d = (n.widgets || []).find((x) => x && x.type === 'DESCRIPTION');
      return d ? d.description : null;
    },
    comments: (n) => {
      const x = (n.widgets || []).find((y) => y && y.type === 'NOTES');
      return x ? x.notes : null;
    },
    comment: (c) => ({ a: c.author ? c.author.username : null, d: c.createdAt, b: c.body }),
    more: (n) => ({
      query: `query($ctx: ID!, $endCursor: String) {
  queryComplexity { score limit }
  b0: workItemsByReference(contextNamespacePath: $ctx, refs: ${JSON.stringify([`#${n}`])}, first: 1) { nodes { widgets { type ... on WorkItemWidgetNotes { ${GL_NOTES} } } } }
}`,
      variables: DEEP.glab.variables(),
      at: (d) => {
        const node = d && d.b0 && Array.isArray(d.b0.nodes) ? d.b0.nodes[0] : null;
        return node ? DEEP.glab.comments(node) : null;
      },
    }),
    // GitLab counts no comments here, so the run ends on the forge's own last page.
    counted: () => null,
    spend: WIDE.glab.spend,
    none: () => 'the project was not found, or this token cannot see it',
  },
};

const deep = () => {
  const w = DEEP[cli];
  const got = new Map();
  // The numbers an answer settled. Only those can be missing: a number whose lookup never came
  // back was not read, and calling it absent would say what nobody measured.
  const answered = new Set();
  for (let at = 0; at < asked.length; at += w.batch) {
    const nums = asked.slice(at, at + w.batch);
    const { json, reason } = gql({ query: w.query(nums), variables: w.variables() });
    if (!json) {
      if (head.pages === 0) unread(reason);
      head.reason = `a batch could not be read (${reason})`;
      break;
    }
    w.spend(json.data);
    const items = w.items(json.data);
    // GitHub answers a number that is not an issue with `null` and an error naming it; that
    // one is missing, not a failure of the read. Every other error stands as one.
    const errs = (Array.isArray(json.errors) ? json.errors : []).filter((e) => !w.miss(e, json.data));
    // The response as it came, the missing numbers' own errors taken out: a bare HTTP refusal
    // carries its message outside `errors`, and dropping the rest of the response drops it.
    head.errors.push(...messages({ ...json, errors: errs }));
    if (!items) {
      if (head.pages === 0) unread(head.errors.length ? head.errors[0] : w.none(json.data));
      head.reason = 'a batch held no issues';
      break;
    }
    head.pages += 1;
    head.read = true;
    for (const k of w.settled(json.data, nums, Array.isArray(json.errors) ? json.errors : [])) answered.add(k);
    for (const n of items) {
      const k = w.number(n);
      if (!nums.includes(k) || got.has(k)) continue;
      got.set(k, n);
    }
  }
  for (const k of asked) {
    const n = got.get(k);
    // GitLab drops a reference it cannot resolve without a word, so what came back is checked
    // against what was asked for rather than trusted to have said so.
    if (!n) { (answered.has(k) ? head.missing : head.unread).push(k); continue; }
    const line = w.line(n);
    const c = w.comments(n);
    const cm = [];
    let conn = c;
    let short = null;
    const counted = c ? w.counted(c) : null;
    // More pages than the count can fill is a forge that will not stop. GitLab counts nothing
    // here, so its bound is only a backstop against a run that never ends.
    const cap = counted === null ? 1000 : Math.ceil(Math.max(counted, 1) / 100) + 2;
    const cursors = new Set();
    let pages = 1;
    while (conn && Array.isArray(conn.nodes)) {
      cm.push(...conn.nodes.filter(Boolean).map(w.comment));
      const pi = conn.pageInfo || {};
      if (!pi.hasNextPage) break;
      // A cursor already asked for is the same page again, and following it appends the same
      // comments until something else stops the loop.
      if (!pi.endCursor || cursors.has(pi.endCursor)) { short = 'its comment pages would not advance'; break; }
      if (pages >= cap) { short = 'its comment pages ran past their own count'; break; }
      cursors.add(pi.endCursor);
      pages += 1;
      const more = w.more(k);
      const { json, reason } = gql({ query: more.query, variables: { ...more.variables, endCursor: pi.endCursor } });
      if (!json) { short = `a page of its comments could not be read (${reason})`; break; }
      w.spend(json.data);
      head.errors.push(...messages(json));
      conn = more.at(json.data);
      if (!conn) { short = 'a page of its comments held none'; break; }
    }
    if (!c) short = 'its comments were not in the answer';
    if (!short && counted !== null && counted !== cm.length) short = `${cm.length} of its ${counted} comments came back`;
    if (short) {
      head.notes.push(`#${k}: ${short}`);
      line.cut = [...(line.cut || []), 'cm'];
    }
    line.b = w.body(n) ?? '';
    line.cm = cm;
    take(line);
  }
  head.fetched = got.size;
  head.total = asked.length;
  if (!head.reason && head.unread.length) head.reason = `${head.unread.length} of the numbers asked could not be read`;
  if (!head.reason && head.missing.length) head.reason = `${head.missing.length} of the numbers asked are not issues this token can see`;
  if (!head.reason && head.errors.length) head.reason = 'the forge reported errors beside the data';
  if (!head.reason && lines.some((l) => (l.cut || []).includes('cm'))) head.reason = 'some comments did not come back';
  head.complete = head.read && !head.reason;
};

// --- the delta: this reading set against the earlier one
const LINKS = ['p', 'ch', 'chl', 'bb', 'bl', 'rel', 'pr'];
// An end as a map of where it points to the state it is in: `#12:closed` points at `#12`, closed.
// A `+N` or `+?` closing a cut list is no end, and a value in any order is the same set.
const ends = (v) => {
  const out = new Map();
  for (const ref of (Array.isArray(v) ? v : v ? [v] : []).map(String)) {
    if (ref.startsWith('+')) continue;
    const m = ref.match(/^(.*?)(?::([a-z_]+))?$/);
    out.set(m[1], m[2] || 'open');
  }
  return out;
};
const setOf = (v) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v ?? null);
// A list the forge cut short is a window and not a set: an end outside it is in neither reading,
// so the window sliding would write edges nobody added and hide the ones somebody did.
const windowed = (key, v) => (Array.isArray(v) ? v.some((x) => String(x).startsWith('+'))
  : key === 'ch' && typeof v === 'string' && v.includes('+'));
// An edge written the same from either end, so the two ends of one count once.
const edge = (key, end, n) => {
  const own = `#${n}`;
  if (key === 'p') return `${end} parent of ${own}`;
  if (key === 'chl') return `${own} parent of ${end}`;
  if (key === 'bb') return `${end} blocks ${own}`;
  if (key === 'bl') return `${own} blocks ${end}`;
  if (key === 'pr') return `${end} closes ${own}`;
  return `${[end, own].sort().join(' relates to ')}`;
};
// Whether the count covers an edge of this kind: GitHub's timeline both ways for every kind it
// has both events of; GitLab's links created since, one way, and none of the hierarchy.
const covers = (key, added) => (cli === 'gh' ? evKinds.includes(key === 'chl' ? 'ch' : key)
  : added && ['bb', 'bl', 'rel'].includes(key));
let clock = null;

const delta = () => {
  const d = head.delta;
  d.edited = lines.filter((l) => Date.parse(l.u) >= sinceMs).map((l) => l.n);
  const counted = cli === 'glab' || GH_EV !== '';
  d.events = counted ? lines.filter((l) => l.ev > 0).map((l) => l.n) : null;
  const why = [];
  const clockMs = clock ? Date.parse(clock) : NaN;
  if (Number.isNaN(clockMs)) {
    head.notes.push('the forge sent no Date with the first page, so this reading names no moment:'
      + ' the next one needs a moment from before this read began');
  } else {
    // Ten seconds under the forge's own clock: an event is stamped a second or two apart from
    // the change it records, and a window that overlaps the last one loses nothing to that.
    d.moment = iso(clockMs - 10000);
    if (sinceMs > clockMs) why.push(`--since is later than the forge's own clock (${text(clock)})`);
  }
  const pm = pinned && pinned.v.delta && typeof pinned.v.delta.moment === 'string' ? pinned.v.delta.moment : null;
  if (pm && sinceMs > Date.parse(pm)) {
    why.push(`--since is later than the moment the reading in --was names (${text(pm)}), so an edit between the two is in neither`);
  }
  if (!pinned) {
    why.push('no earlier reading was given (--was): an edge removed and an end that changed state'
      + ' cannot be seen without one — this reading is the one to keep');
  } else if (pinned.v.read !== true || pinned.v.complete !== true) {
    why.push(`the reading in --was is not whole${pinned.v.reason ? ` (${text(pinned.v.reason)})` : ''}`);
  } else {
    const now = new Set(lines.map((l) => l.n));
    d.entered = lines.filter((l) => !pinned.byN.has(l.n)).map((l) => l.n);
    // A page that did not come back holds issues that are still there, and would read as gone.
    d.left = head.complete ? [...pinned.byN.keys()].filter((n) => !now.has(n)).sort((a, b) => a - b) : null;
    d.linked = [];
    d.cut = [];
    d.check = counted ? [] : null;
    const added = new Set();
    const removed = new Set();
    const moved = new Set();
    for (const l of lines) {
      const was = pinned.byN.get(l.n);
      if (!was) continue;
      // Named whether or not anything visible differs: a change outside the window shows nowhere
      // else, and an issue whose links cannot be compared is one to read by hand.
      const cut = LINKS.filter((k) => windowed(k, l[k]) || windowed(k, was[k]));
      if (cut.length) d.cut.push(l.n);
      const diff = LINKS.filter((k) => setOf(l[k]) !== setOf(was[k]));
      if (!diff.length) continue;
      d.linked.push(l.n);
      l.was = Object.fromEntries(diff.map((k) => [k, was[k] ?? null]));
      let uncounted = false;
      for (const k of LINKS.filter((x) => x !== 'ch' && !cut.includes(x))) {
        const a = ends(was[k]);
        const b = ends(l[k]);
        for (const [e, st] of b) {
          if (!a.has(e)) { added.add(edge(k, e, l.n)); uncounted ||= covers(k, true); }
          else if (a.get(e) !== st) moved.add(`${e}:${st}`);
        }
        for (const e of a.keys()) {
          if (!b.has(e)) { removed.add(edge(k, e, l.n)); uncounted ||= covers(k, false); }
        }
      }
      if (counted && uncounted && !(l.ev > 0)) d.check.push(l.n);
    }
    d.added = [...added].sort();
    d.removed = [...removed].sort();
    d.moved = [...moved].sort();
  }
  if (!head.complete) why.push(`this reading is not whole (${head.reason})`);
  d.complete = why.length === 0;
  d.reason = why.length ? why.join('; ') : null;
};

// The earlier reading is of this slice or of none: set against another repository's, or another
// filter's, every issue would read as entered or left.
if (pinned) {
  const v = pinned.v;
  const f = v.filter && typeof v.filter === 'object' ? v.filter : {};
  if (v.forge !== cli || typeof v.repo !== 'string' || !same(v.repo, head.repo)
    || typeof v.host !== 'string' || !same(v.host, head.host)
    || (f.state ?? null) !== state || (f.label ?? null) !== opts.label
    || (f.milestone ?? null) !== opts.milestone) {
    die('the reading in --was is of another slice: another forge, repository, host or filter');
  }
}

if (cli === 'gh') {
  const { json, reason } = gql({ query: `query { rateLimit { cost remaining } issue: __type(name: "Issue") { fields { name args { name } } }${head.delta ? ' events: __type(name: "IssueTimelineItemsItemType") { enumValues { name } }' : ''} }`, variables: {} });
  // A schema that would not read is an unread slice, never a server that carries nothing:
  // the second would drop every link from every line and call the slice whole.
  if (!json) unread(reason);
  WIDE.gh.spend(json.data);
  const fields = json.data && json.data.issue && Array.isArray(json.data.issue.fields) ? json.data.issue.fields : null;
  if (!fields) unread(messages(json)[0] || 'the server did not say which fields an issue carries');
  const schema = new Map(fields.filter((f) => f && typeof f.name === 'string')
    .map((f) => [f.name, new Set((Array.isArray(f.args) ? f.args : []).map((a) => a && a.name))]));
  const has = (field, arg) => schema.has(field) && (arg === undefined || schema.get(field).has(arg));
  GH_WIDE = ghWide(has);
  head.unavailable = ghLacks(has);
  if (head.delta) {
    // Only a kind the line itself carries is counted, and only by both of its events: a kind
    // whose removals went uncounted would pass a removed edge as one nobody touched.
    const names = new Set(json.data.events && Array.isArray(json.data.events.enumValues)
      ? json.data.events.enumValues.map((e) => e && e.name) : []);
    const counts = has('timelineItems', 'since') && has('timelineItems', 'itemTypes');
    const types = [];
    for (const [key, pair] of Object.entries(EVENTS)) {
      if (head.unavailable.includes(key)) continue;
      if (counts && pair.every((t) => names.has(t))) { evKinds.push(key); types.push(...pair); }
      else head.unavailable.push(`ev.${key}`);
    }
    GH_EV = types.length ? `timelineItems(since: $since, itemTypes: [${types.join(', ')}]) { filteredCount }` : '';
    if (!has('subIssues')) head.unavailable.push('chl');
  }
}
// GitLab's hierarchy carries no moment at all, so nothing counts a parent set or removed there.
if (cli === 'glab' && head.delta) head.unavailable.push('ev.p', 'ev.ch');

if (asked) deep();
else {
  wide();
  if (head.delta) delta();
}
finish();
