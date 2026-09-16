#!/usr/bin/env node
// ledger.mjs — where an epic's wave ledger lives, whether the next write fits in it, and
// what archives stand beside it.
//
// The coordinating session keeps its durable state in ONE comment on the epic issue, found
// by a marker rather than by position, with what has left it in archive comments the ledger
// indexes. Three things there are mechanical and were prose: finding the comment across a
// paginated feed, measuring a body against a cap that announces itself only by refusing the
// write, and checking that the index and the archives standing on the issue agree.
//
// It READS. Writing the ledger is the caller's, because what may be archived out of it is a
// judgement about the content — the journal while it is inline, then a closed wave — and a
// script that guessed would move what is still open.

import { readFileSync } from 'node:fs';
import { writeAll, runner, parsePages, readable, hostOk, text } from './lib/forge.mjs';

// Both markers are matched with the whitespace a hand-written one carries: `<!--wave-ledger-->`
// is the same marker, and a ledger this misses is a second ledger the caller then opens.
const LEDGER = /<!--\s*wave-ledger\s*-->/;
// `<n>` is the series; the pattern deliberately does not admit the ledger's own marker, so a
// search for one never returns the other however the two are spelled.
const ARCHIVE = /<!--\s*wave-journal-(\d{1,6})\s*-->/g;

// Measured once at 65536 on GitHub (`references/forge-behaviour.md`), and unmeasured on
// GitLab, which is why it is a flag with a default rather than a constant: a caller that
// knows its own forge's cap passes it, and one that does not gets the conservative number.
const DEFAULT_LIMIT = 65536;

const usage = 'usage: node ledger.mjs --issue <n> [--repo <owner/name>] [--forge gh|glab]'
  + ' [--host <host>] [--body-file <path>] [--limit <n>] [--repo-dir <path>]';

const opts = { issue: null, repo: null, forge: null, host: null, bodyFile: null,
  limit: DEFAULT_LIMIT, dir: process.cwd() };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  // A flag at the end of the line has no value, and `undefined` reaching `cwd` is silently the
  // current directory — a plausible ledger out of whatever repository this run happens to stand
  // in. A malformed invocation is refused instead.
  const val = () => {
    if (i + 1 >= argv.length) { writeAll(2, `ledger: ${a} takes a value\n${usage}\n`); process.exit(2); }
    return argv[i += 1];
  };
  if (a === '--issue') opts.issue = val();
  else if (a === '--repo') opts.repo = val();
  else if (a === '--forge') opts.forge = val();
  else if (a === '--host') opts.host = val();
  else if (a === '--body-file') opts.bodyFile = val();
  else if (a === '--limit') opts.limit = val();
  else if (a === '--repo-dir') opts.dir = val();
  else { writeAll(2, `ledger: unknown argument '${a}'\n${usage}\n`); process.exit(2); }
}

const die = (msg) => { writeAll(2, `ledger: ${msg}\n${usage}\n`); process.exit(2); };

// An issue number, not a ref: a value that is not digits would reach the url as a path of
// its own, and `0` names no issue on either forge.
if (!/^[1-9][0-9]{0,11}$/.test(String(opts.issue ?? ''))) die('--issue takes an issue number');
// Two to eleven segments — GitLab nests projects under subgroups — each held to the rule the
// rest of the plugin holds a path segment to. `..` above all: `repos/team/../issues/42` is
// normalised by the server into a request to somewhere else entirely.
const repoSegments = opts.repo === null ? [] : opts.repo.split('/');
if (opts.repo !== null && (repoSegments.length < 2 || repoSegments.length > 11
  || !repoSegments.every((seg) => readable(seg) && seg !== '.'))) {
  die('--repo takes <owner>/<name>, or a GitLab group path');
}
// Encoded segment by segment, never whole: a `/` between segments is the path, and encoding it
// would ask for one repository named with slashes in it.
const repoPath = repoSegments.map(encodeURIComponent).join('/');
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
// A count, and nothing about how big a sensible one is: what a forge accepts is the caller's
// to know, and a range invented here would refuse a cap somebody measured. Converted whatever
// it came as, so `limit` is a number in the answer even when the caller passed the default.
if (!/^[1-9][0-9]{0,8}$/.test(String(opts.limit))) die('--limit takes a character count');
opts.limit = Number(opts.limit);

const answer = {
  read: false,
  forge: null,
  // `id` is what a REST edit takes and `nodeId` what GraphQL takes: one is not the other, and a
  // caller handed the wrong one gets a 404 on the comment it just read.
  ledger: { found: false, id: null, nodeId: null, url: null, chars: null, utf16: null,
    ambiguous: false, at: null },
  archives: [],
  index: { listed: null, present: [], missing: [], unlisted: [] },
  write: { asked: false, chars: null, utf16: null, fits: null, headroom: null, limit: opts.limit },
  me: null,
  faults: [],
  reason: null,
};

const out = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };

// The body to be written, read before any network call: a caller that named a file it cannot
// read learns so without spending a forge round trip.
let body = null;
if (opts.bodyFile !== null) {
  try { body = readFileSync(opts.bodyFile, 'utf8'); }
  catch (e) { answer.reason = text(`--body-file could not be read: ${e.code || 'error'}`); out(); }
  answer.write.asked = true;
}

// Which CLI answers for THIS REPOSITORY, never which one has an account: `auth status` succeeds
// wherever a login exists on any host. But answering is not enough either — a GitLab project
// mirrored on GitHub under the same path answers on both, and a first-success order would read
// issue 42 of the mirror and call it this epic's ledger. **Both answering is an ambiguity**,
// refused the way a base with several unpreferred remotes is refused, because the wrong answer
// here is indistinguishable from the right one.
const answered = opts.forge ? [opts.forge] : ['gh', 'glab'].filter((cmd) => {
  const args = ['api'];
  if (opts.host) args.push('--hostname', opts.host);
  args.push(cmd === 'gh'
    ? (opts.repo ? `repos/${repoPath}` : 'repos/{owner}/{repo}')
    : `projects/${opts.repo ? encodeURIComponent(opts.repo) : ':fullpath'}`);
  return runner(opts.dir, cmd)(args, 60000).ok;
});
if (answered.length === 0) { answer.reason = 'no forge CLI answered for this repository'; out(); }
if (answered.length > 1) {
  answer.reason = 'both forges answer for this repository — name one with --forge';
  out();
}
const forge = answered[0];
answer.forge = forge;

const cli = runner(opts.dir, forge);

// The comment feed, to the END of it. A first page is not the list, and the ledger is the
// comment opened when the role was assumed — which on a long epic is behind every later one.
const feed = () => {
  if (forge === 'gh') {
    const args = ['api', '--paginate'];
    if (opts.host) args.push('--hostname', opts.host);
    // `{owner}`/`{repo}` are substituted by `gh` from the CURRENT directory, which is the
    // repository this run stands in — named explicitly wherever the caller passed one.
    args.push(opts.repo
      ? `repos/${repoPath}/issues/${encodeURIComponent(opts.issue)}/comments`
      : `repos/{owner}/{repo}/issues/${encodeURIComponent(opts.issue)}/comments`);
    return cli(args, 180000);
  }
  const args = ['api', '--paginate'];
  if (opts.host) args.push('--hostname', opts.host);
  const project = opts.repo ? encodeURIComponent(opts.repo) : ':fullpath';
  args.push(`projects/${project}/issues/${encodeURIComponent(opts.issue)}/notes?per_page=100`);
  return cli(args, 180000);
};

const res = feed();
if (!res.ok) {
  // A 404 is an ANSWER, not a silence: measured on both forges — `gh: Not Found (HTTP 404)`
  // and `glab: 404 Not found (HTTP 404)` — it says this issue is not there, which a caller
  // fixes by correcting the coordinate rather than by retrying. It is also what either forge
  // answers where the token cannot see the issue at all, and the two are indistinguishable
  // from here, so the line says both.
  //
  // Read out of stderr ALONE, and by the parenthesised status rather than by the words. A
  // paginated read prints the pages it already got to stdout, so a walk that died on page two
  // carries every comment body with it — and an epic discussing a forge's 404s is the ordinary
  // case, not a contrived one. Matched there, a failure to finish reading reports as a
  // coordinate to correct, which is the mistake this branch exists to prevent.
  const status = /\(HTTP (\d{3})\)/.exec(res.err);
  // GitLab says which thing was not found — `404 Project Not Found` is the project, and the
  // probe above already proved the project answers, so that one is a race. GitHub says only
  // `Not Found`, so a repository renamed between the probe and this read is indistinguishable
  // from a wrong issue number: the line names both rather than sending the caller to fix a
  // number that may be right.
  const aboutProject = /project not found/i.test(res.err);
  answer.reason = status?.[1] === '404' && !aboutProject
    ? text(`no issue ${opts.issue} here — the repository answered the probe, so it is the issue,`
      + ` this token's view of it, or a rename in between: ${res.line()}`)
    : text(`the comment feed could not be read: ${res.line()}`);
  out();
}

const pages = parsePages(res.out);
if (pages === null) { answer.reason = 'the comment feed was not JSON'; out(); }

const rows = [];
for (const page of pages) {
  if (Array.isArray(page)) rows.push(...page);
  // A single object where a list was expected is an answer that is not the list: it is not
  // an empty feed, and folding it in as one comment would be inventing the shape.
  else { answer.reason = 'the comment feed answered with something that is not a list'; out(); }
}

answer.read = true;

// UTF-16 units and characters are two numbers, and which one a forge counts is not stated
// anywhere: an emoji is one character and two units. Both travel, and `fits` is judged on the
// larger, so a body that fits under either measure is the only one called safe.
const measure = (s) => ({ chars: [...String(s)].length, utf16: String(s).length });

const marked = [];
for (const c of rows) {
  const b = typeof c?.body === 'string' ? c.body : null;
  if (b === null) continue;
  const id = c?.id ?? null;
  const nodeId = typeof c?.node_id === 'string' ? text(c.node_id) : null;
  const at = text(c?.created_at ?? null);
  const url = text(c?.html_url ?? c?.url ?? null);
  if (LEDGER.test(b)) {
    // The ledger's own INDEX is written in these same markers — a pointer standing where the
    // text used to be. A comment carrying the ledger marker is the ledger, and the archive
    // markers in it are what it lists, never archives of its own.
    marked.push({ kind: 'ledger', id: text(String(id)), nodeId, url, at, body: b });
    continue;
  }
  ARCHIVE.lastIndex = 0;
  const ns = new Set();
  let m;
  while ((m = ARCHIVE.exec(b)) !== null) ns.add(Number(m[1]));
  if (ns.size === 0) continue;
  // One archive per comment is the shape. A body carrying two of them — an archive quoting the
  // markers of the ones before it is the ordinary way that happens — is malformed rather than
  // two archives, and counted as two it invents a duplicate of a number nobody wrote twice.
  if (ns.size > 1) {
    marked.push({ kind: 'malformed', ns: [...ns].sort((x, y) => x - y), id: text(String(id)) });
    continue;
  }
  marked.push({ kind: 'archive', n: [...ns][0], id: text(String(id)), url, at, body: b });
}

const ledgers = marked.filter((m) => m.kind === 'ledger');
const archives = marked.filter((m) => m.kind === 'archive');
for (const bad of marked.filter((m) => m.kind === 'malformed')) {
  answer.faults.push({ fault: `one comment carries the archive markers ${bad.ns.join(', ')}`,
    ids: [bad.id] });
}

if (ledgers.length > 1) {
  // A coordinate resolving to two states resolves to neither, so NO coordinate is published:
  // `found` stays false and the ids travel in the fault. Publishing the first one would hand
  // the next write a comment picked by age out of two nobody has reconciled.
  answer.ledger.ambiguous = true;
  answer.faults.push({ fault: 'two comments carry the ledger marker',
    ids: ledgers.map((l) => l.id) });
} else if (ledgers.length === 1) {
  const l = ledgers[0];
  const m = measure(l.body);
  answer.ledger = { found: true, id: l.id, nodeId: l.nodeId, url: l.url, chars: m.chars,
    utf16: m.utf16, ambiguous: false, at: l.at };
}

// One archive per comment is the shape; a comment carrying two markers is a fault rather than
// two archives, since what leaves the ledger goes under a marker of its own.
const byN = new Map();
for (const a of archives) {
  const m = measure(a.body);
  const row = { n: a.n, id: a.id, url: a.url, chars: m.chars, utf16: m.utf16 };
  if (byN.has(a.n)) {
    answer.faults.push({ fault: `two comments carry the archive marker ${a.n}`,
      ids: [byN.get(a.n).id, a.id] });
  } else byN.set(a.n, row);
}
answer.archives = [...byN.values()].sort((x, y) => x.n - y.n);
answer.index.present = answer.archives.map((a) => a.n);

// What the ledger SAYS it has archived, against what the issue actually carries. Read out of
// the ledger's own text: the index is a list of the same markers, written inline where the
// block used to stand.
const listed = new Set();
if (answer.ledger.found) {
  ARCHIVE.lastIndex = 0;
  let m;
  while ((m = ARCHIVE.exec(ledgers[0].body)) !== null) listed.add(Number(m[1]));
  answer.index.listed = [...listed].sort((x, y) => x - y);
  answer.index.missing = answer.index.listed.filter((n) => !byN.has(n));
  for (const n of answer.index.missing) {
    answer.faults.push({ fault: `the ledger lists archive ${n}, and no comment carries it` });
  }
}
// Reconciled whether or not a ledger stands: one deleted, or two of them, leaves its archives
// on the issue, and `listed` empty then is "nothing indexes these" rather than "nothing to
// check". A caller reading no fault there opens a fresh ledger over archives nobody indexes.
answer.index.unlisted = answer.index.present.filter((n) => !listed.has(n));
for (const n of answer.index.unlisted) {
  answer.faults.push({ fault: answer.ledger.found
    ? `archive ${n} stands on the issue and the ledger does not list it`
    : `archive ${n} stands on the issue and no ledger indexes it` });
}

if (answer.write.asked) {
  const m = measure(body);
  answer.write.chars = m.chars;
  answer.write.utf16 = m.utf16;
  const used = Math.max(m.chars, m.utf16);
  answer.write.fits = used <= opts.limit;
  answer.write.headroom = opts.limit - used;
}

out();
