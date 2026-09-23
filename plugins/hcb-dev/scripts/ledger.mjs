#!/usr/bin/env node
// ledger.mjs — where an epic's wave ledger lives, whether the next write fits in it, and
// what archives stand beside it.
//
// The coordinating session keeps its durable state in ONE comment on the epic issue, found
// by the marker it opens with rather than by position, with what has left it in archive
// comments the ledger indexes. Three things there are mechanical and were prose: finding the comment across a
// paginated feed, measuring a body against a cap whose own refusal names the wrong number and
// the wrong unit, and checking that the index and the archives standing on the issue agree.
//
// It READS. Writing the ledger is the caller's, because what may be archived out of it is a
// judgement about the content — the journal while it is inline, then a closed wave — and a
// script that guessed would move what is still open.

import { readFileSync } from 'node:fs';
import { dirOk, hostOk, parsePages, readable, runner, text, writeAll } from './lib/forge.mjs';

// A marker is what a comment OPENS with — the ledger and every archive are written that way —
// never a mention further in: a report quoting `<!-- wave-ledger -->` in its prose read as a
// marker turns the one ledger into two, and two publish no coordinate. Both are matched with the
// whitespace a hand-written one carries, inside the marker and ahead of it: `<!--wave-ledger-->`
// is the same marker, and a ledger this misses is a second ledger the caller then opens.
const LEDGER = /^\s*<!--\s*wave-ledger\s*-->/;
// `<n>` is the series; the pattern deliberately does not admit the ledger's own marker, so a
// search for one never returns the other however the two are spelled.
const ARCHIVE_OPEN = /^\s*<!--\s*wave-journal-(\d{1,6})\s*-->/;
// The ledger's own INDEX lists its archives by these same markers, inline wherever its text
// names them — the one place a marker is read anywhere in a body.
const ARCHIVE = /<!--\s*wave-journal-(\d{1,6})\s*-->/g;

// GitHub's cap in UTF-8 BYTES, measured on both sides of the boundary
// (`references/forge-behaviour.md`). Its refusal says `maximum is 65536 characters`, which is
// neither the number nor the unit — a constant copied out of that text refuses bodies the forge
// stores. Unmeasured on GitLab, which is why it is a flag with a default rather than a constant:
// a caller that knows its own forge's cap passes it, and one that does not gets GitHub's.
const DEFAULT_LIMIT = 262144;

const usage = 'usage: node ledger.mjs --issue <n> [--repo <owner/name>] [--forge gh|glab]'
  + ' [--host <host>] [--body-file <path>] [--limit <bytes>] [--me <login>] [--repo-dir <path>]';

const opts = { issue: null, repo: null, forge: null, host: null, bodyFile: null,
  limit: DEFAULT_LIMIT, me: null, dir: process.cwd() };
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
  ledger: { found: false, id: null, nodeId: null, url: null, bytes: null, chars: null, utf16: null,
    ambiguous: false, at: null, author: null, mine: null },
  archives: [],
  index: { listed: null, present: [], missing: [], unlisted: [] },
  write: { asked: false, bytes: null, chars: null, utf16: null, fits: null, headroom: null,
    limit: opts.limit },
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
    // The ledger's own INDEX is written in the archive markers — a pointer standing where the
    // text used to be. A comment opening with the ledger marker is the ledger, and the archive
    // markers in it are what it lists, never archives of its own.
    marked.push({ kind: 'ledger', id: text(String(id)), nodeId, url, at, body: b, author, mine });
    continue;
  }
  // One archive per comment, named by the marker it opens with: an archive quoting the markers
  // of the ones before it is the ordinary case, and those quotes are its text, not more archives.
  const opened = ARCHIVE_OPEN.exec(b);
  if (opened === null) continue;
  marked.push({ kind: 'archive', n: Number(opened[1]), id: text(String(id)), url, at, body: b,
    author, mine });
}

const ledgers = marked.filter((m) => m.kind === 'ledger');
const archives = marked.filter((m) => m.kind === 'archive');

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
    chars: m.chars, utf16: m.utf16, ambiguous: false, at: l.at, author: l.author, mine: l.mine };
}

// One archive per number is the shape: what leaves the ledger goes under a marker of its own.
const byN = new Map();
for (const a of archives) {
  const m = measure(a.body);
  const row = { n: a.n, id: a.id, url: a.url, bytes: m.bytes, chars: m.chars, utf16: m.utf16,
    author: a.author, mine: a.mine };
  const held = byN.get(a.n);
  if (held === undefined) { byN.set(a.n, row); continue; }
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
  answer.write.bytes = m.bytes;
  answer.write.chars = m.chars;
  answer.write.utf16 = m.utf16;
  answer.write.fits = m.bytes <= opts.limit;
  answer.write.headroom = opts.limit - m.bytes;
}

out();
