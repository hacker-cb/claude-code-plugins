#!/usr/bin/env node
// ledger.mjs — where an epic's wave ledger lives, whether the next write fits in it, and
// what archives stand beside it.
//
// The coordinating session keeps its durable state in ONE comment on the epic issue, found
// by a marker rather than by position, with what has left it in archive comments the ledger
// indexes. Three things there are mechanical and were prose: finding the comment across a
// paginated feed, measuring a body against a cap whose own refusal names the wrong number and
// the wrong unit, and checking that the index and the archives standing on the issue agree.
//
// It READS, and writes only when asked: `--write` puts a ledger the caller composed on the issue,
// moving the journal's oldest entries into an archive of its own first where the body is over its
// budget — the journal being the one part of a ledger that may leave without anyone judging it —
// and `--append-archive` adds an account to that archive. What else may leave stays the caller's
// judgement. `--check` reads the text against its shape (`lib/ledger-body.mjs`).

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirOk, hostOk, parsePages, readable, runner, text, writeAll } from './lib/forge.mjs';
import { BUDGETS, FORMAT, LEDGER_LINE, MARKER, bytes, formatOf, journalOf, kindOf, lint, takeOldest, withIndex } from './lib/ledger-body.mjs';

// Both markers are matched with the whitespace a hand-written one carries: `<!--wave-ledger-->`
// is the same marker, and a ledger this misses is a second ledger the caller then opens.
const LEDGER = /<!--\s*wave-ledger\s*-->/;
// `<n>` is the series; the pattern deliberately does not admit the ledger's own marker, so a
// search for one never returns the other however the two are spelled.
const ARCHIVE = /<!--\s*wave-journal-(\d{1,6})\s*-->/g;

// GitHub's cap in UTF-8 BYTES, measured on both sides of the boundary
// (`references/forge-behaviour.md`). Its refusal says `maximum is 65536 characters`, which is
// neither the number nor the unit — a constant copied out of that text refuses bodies the forge
// stores. Unmeasured on GitLab, which is why it is a flag with a default rather than a constant:
// a caller that knows its own forge's cap passes it, and one that does not gets GitHub's.
const DEFAULT_LIMIT = 262144;
// What a ledger is kept under before its journal starts moving out — well short of the cap, so a
// write never meets the cap's own refusal, and a ledger stays readable in one go. Each kind has its
// own (`lib/ledger-body.mjs`); this one holds a text of neither kind.
const DEFAULT_BUDGET = 131072;
// Written on the second line of every archive this script opens: the one kind it adds to. An
// archive without it — a closed wave's snapshot, one written by hand — is never written into.
const KIND = '<!-- wave-journal-kind: journal -->';
const KIND_LINE = /^\s*<!--\s*wave-journal-kind:\s*journal\s*-->\s*$/;

const usage = 'usage: node ledger.mjs --issue <n> [--repo <owner/name>] [--forge gh|glab]'
  + ' [--host <host>] [--body-file <path>] [--limit <bytes>] [--me <login>] [--repo-dir <path>]'
  + ' [--check] [--budget <bytes>] [--write | --append-archive <file>] [--was <digest>] [--dump <path>]';

const opts = { issue: null, repo: null, forge: null, host: null, bodyFile: null,
  limit: DEFAULT_LIMIT, me: null, dir: process.cwd(), check: false, write: false, append: null,
  dump: null, budget: null, was: null };
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
  else if (a === '--me') opts.me = val();
  else if (a === '--repo-dir') opts.dir = val();
  else if (a === '--check') opts.check = true;
  else if (a === '--write') opts.write = true;
  else if (a === '--append-archive') opts.append = val();
  else if (a === '--dump') opts.dump = val();
  else if (a === '--budget') opts.budget = val();
  else if (a === '--was') opts.was = val();
  else { writeAll(2, `ledger: unknown argument '${a}'\n${usage}\n`); process.exit(2); }
}

const die = (msg) => { writeAll(2, `ledger: ${msg}\n${usage}\n`); process.exit(2); };

// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a forge that would not answer.
if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);

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
if (!/^[1-9][0-9]{0,8}$/.test(String(opts.limit))) die('--limit takes a byte count');
opts.limit = Number(opts.limit);
if (opts.budget !== null && !/^[1-9][0-9]{0,8}$/.test(String(opts.budget))) die('--budget takes a byte count');
if (opts.budget !== null) opts.budget = Number(opts.budget);
// The budget a text is kept under: the one named, else its kind's.
const budgetOf = (t) => opts.budget ?? BUDGETS[kindOf(t)] ?? DEFAULT_BUDGET;
// Acting is asked for, never inferred, and one act a run: what the body to write is, and what
// the account to add is, would otherwise be one file read two ways.
if (opts.write && opts.bodyFile === null) die('--write writes the body --body-file names');
if (opts.write && opts.append !== null) die('--write and --append-archive are two runs');
if (opts.append !== null && opts.bodyFile !== null) die('--append-archive takes no --body-file');
const acting = opts.write || opts.append !== null;
if (acting && opts.dump !== null) die('--dump is a read of its own, never beside a write');
if (opts.was !== null && !/^[0-9a-f]{16}$/.test(opts.was)) die('--was takes the digest a read answered');
// A login, which is neither a path segment nor a ref. Admitting what BOTH forges allow rather
// than one of them: GitHub takes letters, digits and hyphens up to 39; GitLab takes dots and
// underscores too and admits a LEADING underscore, up to 255; an App's own user carries a
// `[bot]` suffix. Held to the wider of the two on every axis: a name refused
// here is a real account this run then cannot claim anything as its own, which is the failure
// this flag exists to prevent.
if (opts.me !== null && !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}(?:\[bot\])?$/.test(opts.me)) {
  die(`--me '${opts.me}' is not a login`);
}

const answer = {
  read: false,
  forge: null,
  // `id` is what a REST edit takes and `nodeId` what GraphQL takes: one is not the other, and a
  // caller handed the wrong one gets a 404 on the comment it just read.
  //
  // `mine` is three-valued on purpose: true, false, and null for a run that could not name its
  // own user. A ledger nobody can confirm as ours is not a ledger proved foreign.
  // `digest` names this version of the ledger's text: handed back as `--was`, it refuses a write
  // over a ledger that changed since it was read.
  ledger: { found: false, id: null, nodeId: null, url: null, bytes: null, chars: null, utf16: null,
    ambiguous: false, at: null, author: null, mine: null, digest: null },
  archives: [],
  index: { listed: null, present: [], missing: [], unlisted: [] },
  write: { asked: false, bytes: null, chars: null, utf16: null, fits: null, headroom: null,
    limit: opts.limit, budget: opts.budget, wrote: acting ? false : null,
    moved: null, ran: [], archived: [], account: null },
  // The stored ledger's format, against the one this plugin writes.
  format: { found: null, current: FORMAT, kind: null },
  // What `--check` read in the text — the body to be written where one was handed in, else the
  // stored ledger. `null` where nothing was asked.
  lint: null,
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
let account = null;
if (opts.append !== null) {
  try { account = readFileSync(opts.append, 'utf8'); }
  catch (e) { answer.reason = text(`--append-archive could not be read: ${e.code || 'error'}`); out(); }
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

// Who this run is, because a marker alone does not say whose state it found. The marker is an
// HTML comment — invisible in either forge's UI — so on a repository anyone can comment on,
// a stranger's comment carrying it is indistinguishable from the coordinating session's own.
//
// Read, not assumed, and a read that fails leaves `me` null rather than a guess: a repository's
// own `GITHUB_TOKEN` and an App installation token both get 403 from `/user`, and a run under
// one of those knows the ledger's author without being able to name itself. `--me` is how such
// a caller says so, and an explicit value spends no round trip.
let meRaw = null;
if (opts.me !== null) meRaw = opts.me;
else {
  const args = ['api'];
  if (opts.host) args.push('--hostname', opts.host);
  args.push('user');
  const who = cli(args, 60000);
  let parsed = null;
  if (who.ok) { try { parsed = JSON.parse(who.out); } catch { parsed = null; } }
  // Each forge names the field itself: `login` on GitHub, `username` on GitLab. Taken by the
  // forge already resolved rather than by trying both, so a shape that changes is a null here
  // instead of a value read out of whatever field happens to be present.
  const login = forge === 'gh' ? parsed?.login : parsed?.username;
  // An empty string is not a login. Left as one it would match a comment whose author field is
  // also empty, which is attribution by coincidence — `copilot-findings.mjs` normalises it away
  // for the same reason.
  meRaw = typeof login === 'string' && login !== '' ? login : null;
}
// Quoted for the answer, kept whole for the comparison. `text()` bounds a value another process
// wrote at 200 characters, which is right for something travelling into a reader's context and
// wrong for an identity: GitLab admits 255, so a long login would be compared against its own
// truncation and read as foreign, and two logins sharing 200 characters would read as one.
answer.me = text(meRaw);
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

// The cap is in UTF-8 bytes, and `fits` is judged on bytes alone. Characters and UTF-16 units
// travel beside them because they are what a reader has to hand (`jq length` counts one of
// them), and a character count falls short of the cap's own count by half on Cyrillic and by
// three quarters on an emoji — wrong by unit, not by margin.
// A link travels whole: `text()` bounds prose at 200 characters, and a url cut there names
// another comment.
const digestOf = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const coord = (v) => (typeof v === 'string' && v !== '' ? v.replace(/[\u0000-\u001f\u007f]/g, '') : null);
const measure = (s) => ({ bytes: Buffer.byteLength(String(s), 'utf8'), chars: [...String(s)].length,
  utf16: String(s).length });

// Whose comment this is, by the field the resolved forge uses for it. Compared case-folded:
// both forges treat a login as case-insensitive and hand back the canonical spelling, while
// `--me` carries whatever a person or a CI variable typed — and an exact comparison there turns
// one account into two, which reads as a foreign ledger on the one run that needed the flag.
// Three values again:
// null where the comment names no author (a deleted account comes back as `null` on GitHub)
// or where this run could not name itself — never folded into false, which would read as
// "proved to be somebody else's".
const fold = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
const mineness = (author) => (meRaw === null || author === null
  ? null : fold(author) === fold(meRaw));

const marked = [];
for (const c of rows) {
  const b = typeof c?.body === 'string' ? c.body : null;
  if (b === null) continue;
  const id = c?.id ?? null;
  const nodeId = typeof c?.node_id === 'string' ? text(c.node_id) : null;
  const at = text(c?.created_at ?? null);
  const url = text(c?.html_url ?? c?.url ?? null);
  const wrote = forge === 'gh' ? c?.user?.login : c?.author?.username;
  const rawAuthor = typeof wrote === 'string' ? wrote : null;
  const author = text(rawAuthor);
  const mine = mineness(rawAuthor);
  if (LEDGER.test(b)) {
    // The ledger's own INDEX is written in these same markers — a pointer standing where the
    // text used to be. A comment carrying the ledger marker is the ledger, and the archive
    // markers in it are what it lists, never archives of its own.
    marked.push({ kind: 'ledger', id: text(String(id)), nodeId, url, at, body: b, author, mine });
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
    marked.push({ kind: 'malformed', ns: [...ns].sort((x, y) => x - y), id: text(String(id)),
      author, mine });
    continue;
  }
  marked.push({ kind: 'archive', n: [...ns][0], id: text(String(id)), url, at, body: b,
    author, mine, link: typeof c?.html_url === 'string' ? c.html_url : null });
}

const ledgers = marked.filter((m) => m.kind === 'ledger');
const archives = marked.filter((m) => m.kind === 'archive');
for (const bad of marked.filter((m) => m.kind === 'malformed')) {
  answer.faults.push({ fault: `one comment carries the archive markers ${bad.ns.join(', ')}`,
    ids: [bad.id], authors: [bad.author], mine: [bad.mine] });
}

// Authorship is read to SAY whose a comment is, and never to pick between two of them. Breaking
// the tie in favour of ours looks safe and is not: the ledger opened under ANOTHER token — a
// master session handed over, a run from CI, which is the case the identity read exists for —
// is then the one left out, and the next write lands in the newer comment while the state
// stands in the older. Losing the state costs more than stopping does. So two markers still
// publish no coordinate; what this changed is that the caller is now told which is which.
const ours = ledgers.filter((l) => l.mine === true);
if (ledgers.length > 1) {
  // A coordinate resolving to two states resolves to neither, so NO coordinate is published:
  // `found` stays false and the ids travel in the fault. Publishing one of them would hand the
  // next write a comment picked out of two nobody has reconciled.
  answer.ledger.ambiguous = true;
  // Four different repairs, and conflating them is the mistake this whole reading exists to
  // avoid. One of ours beside another: the caller knows which to keep, and can say so. Two of
  // ours: a session opened a second ledger over its own. None ours, all attributed: a tie this
  // run has no standing to break. Anything unattributed — an author the feed did not carry, or
  // a run that could not name itself — is UNKNOWN, and calling that "none of them is ours"
  // would be reading a negative out of a blank.
  const unknown = ledgers.some((l) => l.mine === null);
  answer.faults.push({
    fault: ours.length === 1
      ? 'two comments carry the ledger marker, and one of them is ours'
      : (ours.length > 1
        ? 'two comments of ours carry the ledger marker'
        : (unknown
          ? 'two comments carry the ledger marker, and this run cannot tell which is ours'
            // Two unknowns, and only one has a flag for its repair: a run that could not name
            // ITSELF is what `--me` answers, while a comment the feed gave no author for stays
            // unattributable however this run is named.
            + (answer.me === null
              ? ' — pass --me <login> where the token cannot read its own user'
              : ' — a marked comment carries no author')
          : 'two comments carry the ledger marker, and none of them is ours')),
    ids: ledgers.map((l) => l.id),
    authors: ledgers.map((l) => l.author),
    ours: ours.map((l) => l.id),
  });
} else if (ledgers.length === 1) {
  const l = ledgers[0];
  const m = measure(l.body);
  // A lone ledger is still the ledger whoever wrote it — the token may have changed since it
  // was opened, and refusing it would send the caller to open a second one over live state.
  // What changed is that a comment proved foreign now says so, which is the reading that was
  // missing entirely: the marker is an HTML comment, invisible in either forge's UI.
  if (l.mine === false) {
    answer.faults.push({ fault: 'the only ledger comment is not ours', ids: [l.id],
      authors: [l.author] });
  }
  answer.ledger = { found: true, id: l.id, nodeId: l.nodeId, url: l.url, bytes: m.bytes,
    chars: m.chars, utf16: m.utf16, ambiguous: false, at: l.at, author: l.author, mine: l.mine,
    digest: digestOf(l.body) };
}

// One archive per comment is the shape; a comment carrying two markers is a fault rather than
// two archives, since what leaves the ledger goes under a marker of its own.
const byN = new Map();
const archOf = new Map();
for (const a of archives) {
  const m = measure(a.body);
  const row = { n: a.n, id: a.id, url: a.url, bytes: m.bytes, chars: m.chars, utf16: m.utf16,
    author: a.author, mine: a.mine };
  const held = byN.get(a.n);
  if (held === undefined) { byN.set(a.n, row); archOf.set(a.n, a); continue; }
  // The first read stays, and authorship travels beside it rather than reordering anything:
  // new journal entries go INTO the most recent archive, so picking between two comments that
  // claim one number is the same write-to-the-wrong-comment risk the ledger's own tie carries.
  // A duplicate marker is a fault to repair, not a choice for this to make.
  answer.faults.push({ fault: `two comments carry the archive marker ${a.n}`,
    ids: [held.id, a.id], authors: [held.author, a.author],
    mine: [held.mine, a.mine] });
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
    answer.faults.push({ fault: `the ledger lists archive ${n}, and no comment carries it`, n, missing: true });
  }
}
// Reconciled whether or not a ledger stands: one deleted, or two of them, leaves its archives
// on the issue, and `listed` empty then is "nothing indexes these" rather than "nothing to
// check". A caller reading no fault there opens a fresh ledger over archives nobody indexes.
answer.index.unlisted = answer.index.present.filter((n) => !listed.has(n));
for (const n of answer.index.unlisted) {
  answer.faults.push({ fault: answer.ledger.found
    ? `archive ${n} stands on the issue and the ledger does not list it`
    : `archive ${n} stands on the issue and no ledger indexes it`, n, unlisted: true });
}

const stored = answer.ledger.found ? ledgers[0].body : null;
if (stored !== null) Object.assign(answer.format, { found: formatOf(stored), kind: kindOf(stored) });
if (opts.dump !== null) {
  if (stored === null) { answer.reason = 'no ledger to dump'; out(); }
  try { writeFileSync(opts.dump, stored); }
  catch (e) { answer.reason = text(`--dump could not be written: ${e.code || 'error'}`); out(); }
}
let next = body;
const measureWrite = () => {
  if (!answer.write.asked) return;
  const m = measure(body);
  Object.assign(answer.write, { bytes: m.bytes, chars: m.chars, utf16: m.utf16,
    fits: m.bytes <= opts.limit, headroom: opts.limit - m.bytes });
};
const finish = () => {
  answer.write.budget ??= budgetOf(body ?? stored ?? '');
  if (opts.check) answer.lint = lint(body ?? stored ?? '', { budget: answer.write.budget });
  measureWrite();
  out();
};
// Refused before anything is written: `wrote` stays false, and nothing stands to be read again.
const refuse = (msg) => {
  answer.reason = text(msg);
  if (answer.write.moved) answer.write.moved = 0;
  finish();
};
if (!acting) finish();

// Every fault holds a write save two the write itself settles: an archive of ours the ledger does
// not list yet — an interrupted write, a closed wave moved by hand — which it indexes, and an
// archive the stored ledger names and no comment carries, which the body written is checked for.
const holding = answer.faults.filter((f) => !f.missing && !(f.unlisted && byN.get(f.n)?.mine === true));
if (answer.ledger.ambiguous || holding.length) refuse('faults stand on the issue — repaired before anything is written');
if (answer.ledger.found && answer.ledger.mine !== true) {
  refuse(answer.ledger.mine === null ? 'whose ledger this is cannot be told — pass the login this run writes as, --me' : 'the ledger is not ours');
}
if (opts.write && answer.ledger.found && opts.was === null) refuse('writing over a ledger takes --was, the digest the read of it answered');
if (opts.was !== null && answer.ledger.digest !== opts.was) refuse('the ledger changed since it was read — read it again');

// Archives of this run's own that carry the kind line. The one added to is the newest archive on
// the issue where it is one of these — never an older one, which would put events out of order.
const ownArchives = [...byN.values()]
  .filter((a) => a.mine === true && KIND_LINE.test(archOf.get(a.n).body.split('\n', 2)[1] ?? ''))
  .sort((x, y) => y.n - x.n);
// The index names the archives that stand, and those this run opens; a new one takes a number no
// archive holds and no index ever listed.
const numbers = [...answer.index.present];
let top = Math.max(0, ...listed, ...numbers);
const last = ownArchives[0] && ownArchives[0].n === numbers[numbers.length - 1] ? ownArchives[0] : null;
let current = last ? { n: last.n, id: last.id, text: archOf.get(last.n).body.trimEnd() } : null;
const plan = [];
// Onto the archive in hand where it still fits under the cap, its closing newline counted, else
// into a new one under the next number no archive holds. Answers why not, where it cannot go.
const place = (entry) => {
  if (MARKER.test(entry)) return 'a text carrying a marker of this plugin cannot move into an archive';
  const fresh = (n) => `<!-- wave-journal-${n} -->\n${KIND}`;
  if (bytes(`${fresh(999999)}\n${entry}\n`) > opts.limit) return 'a text larger than an archive can hold — split it into texts of its own';
  if (current === null || bytes(`${current.text}\n${entry}\n`) > opts.limit) {
    const n = top + 1;
    if (n > 999999) return 'no archive number is left';
    top = n;
    numbers.push(n);
    current = { n, id: null, text: fresh(n) };
  }
  current.text = `${current.text}\n${entry}`;
  if (!plan.includes(current)) plan.push(current);
  return null;
};

let accountIn = null;
let already = null;
// Exactly the format written here — a newer one carries what this script cannot keep — and one of
// the two kinds, with the journal that moves out.
const shaped = (t) => formatOf(t) === FORMAT && kindOf(t) !== null && journalOf(t).section !== null;
// A ledger still in format 1 takes an account all the same — the reasoning a rebuild keeps goes
// into an archive first — and stays as it stands: the --write of its rebuilt body indexes it.
const older = stored !== null && formatOf(stored) < FORMAT;
// Until its rebuild, a format-1 ledger is written in format 1 as it stands: nothing moves out of
// it, and the shape it never had is not asked of it. A body carrying the new shape's markers is
// the rebuild, and takes the new shape's checks.
const asItStands = opts.write && older && formatOf(next) < FORMAT
  && !/<!--\s*wave-(?:ledger-format|section):/.test(next);
if (opts.write) {
  if (!LEDGER_LINE.test(next.split('\n', 1)[0])) refuse('the body does not open with the ledger marker');
  if (!asItStands && !shaped(next)) refuse(`the body is not format ${FORMAT}, of one kind, with a journal section — --check says where`);
  // A marker of another kind in the ledger's text makes the comment that kind's too.
  const foreign = lint(next, { budget: budgetOf(next) }).find((f) => f.rule === 'marker-unknown');
  if (foreign) refuse(`${foreign.detail} — a ledger carries its own markers alone`);
  // A format-1 index is whatever its text names, so every archive it lists and the issue carries
  // stays named: one left out would stand unlisted, a fault holding every later write.
  const names = new Set([...next.matchAll(ARCHIVE)].map((m) => Number(m[1])));
  const dropped = asItStands ? [...listed].filter((n) => byN.has(n) && !names.has(n)) : [];
  if (dropped.length) refuse(`the body leaves out archive ${dropped[0]}, which the ledger lists and the issue carries`);
  // One issue keeps one kind: an epic's body over a wave's ledger would take the wave's place.
  const was = stored === null ? null : kindOf(stored);
  const whose = (k) => (k === 'epic' ? 'the epic\'s' : 'a wave\'s');
  if (!asItStands && was !== null && kindOf(next) !== was) refuse(`the body is ${whose(kindOf(next))} ledger, and the issue holds ${whose(was)}`);
} else {
  if (stored === null) refuse('no ledger to index the archive');
  if (!older && !shaped(stored)) refuse(`the ledger is not format ${FORMAT}, of one kind, with a journal section to index the archive`);
  if (account.trim() === '') refuse('the account is empty');
  // Already in an archive of ours, whole lines and all — a run that did not settle, sent again:
  // its link, not a copy.
  const whole = (t) => `\n${t.trimEnd()}\n`.includes(`\n${account.trimEnd()}\n`);
  already = ownArchives.find((a) => whole(archOf.get(a.n).body)) ?? null;
  next = stored;
}
// An archive the stored ledger lists and no comment carries leaves the index only where the text
// handed in no longer names it — never in silence.
const lost = answer.index.missing.filter((n) => [...next.matchAll(ARCHIVE)].some((m) => Number(m[1]) === n));
if (lost.length) {
  refuse(`archive ${lost[0]} is listed and no comment carries it — ${opts.write
    ? 'leave it out of the body to write without it' : 'a --write of a body without it repairs the index first'}`);
}
// Every other archive the text names has to stand, or the next read finds it missing and holds writes.
const named = [...withIndex(next, numbers).matchAll(ARCHIVE)].map((m) => Number(m[1])).filter((n) => !numbers.includes(n));
if (named.length) refuse(`the body names archive ${named[0]}, which no comment carries`);

answer.write.moved = 0;
let blocked = null;
if (opts.write && !asItStands) {
  // The journal's oldest lines out, one at a time, until the body is under its budget — never
  // above the cap — or the next one cannot move; the index rewritten every time, so a body
  // composed before an archive was added still names it.
  answer.write.budget = budgetOf(next);
  const ceiling = Math.min(answer.write.budget, opts.limit);
  for (;;) {
    next = withIndex(next, numbers);
    if (bytes(next) <= ceiling) break;
    const taken = takeOldest(next);
    if (taken.moved === null) break;
    blocked = place(taken.moved);
    if (blocked) break;
    next = taken.body;
    answer.write.moved += 1;
  }
} else if (!opts.write) {
  // An account is added and indexed, and nothing else moves in the same run; the ledger is
  // rewritten only where its index no longer names every archive.
  if (!already) {
    const why = place(account.trimEnd());
    if (why) refuse(why);
    accountIn = current;
  }
  const same = numbers.length === listed.size && numbers.every((n) => listed.has(n));
  if (!same && !older) next = withIndex(next, numbers);
}
if (bytes(next) > opts.limit) {
  refuse(blocked ?? (opts.write ? 'over the cap with the journal out — what else may leave is the caller\'s to judge'
    : 'the ledger would pass the cap — a --write moves its journal out first'));
}

// The writes, in order: every archive first, the ledger last, so an interruption leaves an archive
// nothing points at — which the next write indexes — rather than an index naming what was never
// written. Each is read back: a write's exit status is not what it stored.
const base = forge === 'gh'
  ? (opts.repo ? `repos/${repoPath}` : 'repos/{owner}/{repo}')
  : `projects/${opts.repo ? encodeURIComponent(opts.repo) : ':fullpath'}`;
const issuePath = `${base}/issues/${encodeURIComponent(opts.issue)}`;
const commentPath = (id) => (forge === 'gh' ? `${base}/issues/comments/${id}` : `${issuePath}/notes/${id}`);
const host = opts.host ? ['--hostname', opts.host] : [];
const json = (r) => { if (!r.ok) return null; try { return JSON.parse(r.out); } catch { return null; } };
// A note carries no link of its own on GitLab; it is built from the project's.
let project = null;
const linkOf = (c) => {
  if (forge === 'gh') return c.html_url ?? null;
  project ??= json(cli(['api', ...host, base], 60000))?.web_url ?? '';
  return project ? `${project}/-/issues/${opts.issue}#note_${c.id}` : null;
};
if (already) answer.write.account = { n: already.n, url: coord(linkOf({ id: already.id, html_url: archOf.get(already.n).link })) };
if (plan.length === 0 && next === stored) { answer.write.wrote = true; finish(); }
const scratch = mkdtempSync(join(tmpdir(), 'ledger-'));
const done = () => rmSync(scratch, { recursive: true, force: true });
// One body on the issue: a new comment, or an edit of `id` holding `before`. Every write is read
// back from the comment itself, never from the write's own answer. A create is sent once — one that
// answered nothing readable may stand under an id this run never saw; an edit is sent again once,
// and only where the comment still holds `before`: anything else there is somebody's change.
// A refusal by size is the forge's answer, not transport.
const holds = (c, t) => c?.body?.trimEnd() === t.trimEnd();
const put = (id, textBody, what, before) => {
  const file = join(scratch, `${answer.write.ran.length}.md`);
  try { writeFileSync(file, textBody); } catch (e) { return { why: `the body could not be staged: ${e.code || 'error'}`, unsent: true }; }
  for (let attempt = 0; ; attempt += 1) {
    const r = cli(['api', ...host, '--method', id ? (forge === 'gh' ? 'PATCH' : 'PUT') : 'POST',
      id ? commentPath(id) : (forge === 'gh' ? `${issuePath}/comments` : `${issuePath}/notes`),
      '-F', `body=@${file}`], 120000);
    answer.write.ran.push(`${id ? 'edit' : 'create'} ${what}${attempt ? ' (again)' : ''}`);
    if (!r.ok && /too long \(maximum is/i.test(`${r.err}\n${r.out}`)) {
      return { why: `the forge refused ${what} as too long — run again with its cap as --limit`, size: true };
    }
    const at = id ?? json(r)?.id;
    const got = at === null || at === undefined ? null : json(cli(['api', ...host, commentPath(at)], 60000));
    if (holds(got, textBody)) return { comment: got };
    if (!id || attempt || !holds(got, before)) break;
  }
  return { why: `${what} did not read back as written — read the issue before writing again` };
};
// A failure after the first write leaves what stands on the issue unknown: `wrote` is null.
const failed = (r) => {
  done();
  if ((r.size && answer.write.ran.length === 1) || (r.unsent && answer.write.ran.length === 0)) refuse(r.why);
  answer.write.wrote = null;
  answer.reason = text(r.why);
  finish();
};

for (const a of plan) {
  const r = put(a.id, `${a.text}\n`, `archive ${a.n}`, a.id ? archOf.get(a.n).body : '');
  if (r.why) failed(r);
  const row = { n: a.n, id: text(String(r.comment.id)), url: coord(linkOf(r.comment)) };
  answer.write.archived.push(row);
  if (a === accountIn) answer.write.account = { n: a.n, url: row.url };
}
if (next !== stored) {
  const r = put(answer.ledger.found ? answer.ledger.id : null, next, 'ledger', stored ?? '');
  if (r.why) failed(r);
  if (!answer.ledger.found) {
    answer.ledger = { ...answer.ledger, found: true, id: text(String(r.comment.id)),
      nodeId: typeof r.comment.node_id === 'string' ? text(r.comment.node_id) : null,
      url: coord(linkOf(r.comment)), at: text(r.comment.created_at ?? null), author: text(meRaw),
      mine: true };
  }
  const m = measure(r.comment.body);
  Object.assign(answer.ledger, { bytes: m.bytes, chars: m.chars, utf16: m.utf16, digest: digestOf(r.comment.body) });
}
// What stands now: the index names every archive, and the faults the write settled are gone — save
// under a format-1 ledger, left as it stood, whose new archive waits for the rebuilt body's index.
if (older && (!opts.write || asItStands)) {
  const listedNow = new Set([...next.matchAll(ARCHIVE)].map((m) => Number(m[1])));
  const unlisted = numbers.filter((u) => !listedNow.has(u));
  answer.faults = answer.faults.filter((f) => !f.unlisted && !f.missing);
  answer.index = { ...answer.index, listed: [...listedNow].sort((x, y) => x - y), present: [...numbers], missing: [], unlisted };
  for (const u of unlisted) {
    answer.faults.push({ fault: `archive ${u} stands on the issue and the ledger does not list it`, n: u, unlisted: true });
  }
} else {
  answer.faults = answer.faults.filter((f) => !f.missing && !f.unlisted);
  answer.index = { ...answer.index, listed: [...numbers], present: [...numbers], missing: [], unlisted: [] };
}
for (const [i, a] of plan.entries()) {
  const m = measure(`${a.text}\n`);
  const row = { n: a.n, id: answer.write.archived[i].id, url: answer.write.archived[i].url, bytes: m.bytes,
    chars: m.chars, utf16: m.utf16, author: text(meRaw), mine: true };
  answer.archives = [...answer.archives.filter((x) => x.n !== a.n), row].sort((x, y) => x.n - y.n);
}
answer.write.wrote = true;
done();
finish();
