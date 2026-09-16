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
import { writeAll, runner, parsePages, repoOk, hostOk, text } from './lib/forge.mjs';

const LEDGER = '<!-- wave-ledger -->';
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
  const val = () => argv[i += 1];
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
if (opts.repo !== null && !repoOk(opts.repo) && !/^[A-Za-z0-9._~@+-]+(\/[A-Za-z0-9._~@+-]+){1,10}$/.test(opts.repo)) {
  die('--repo takes <owner>/<name>, or a GitLab group path');
}
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
if (String(opts.limit) !== String(DEFAULT_LIMIT)) {
  // A count, and nothing about how big a sensible one is: what a forge accepts is the
  // caller's to know, and a range invented here would refuse a cap somebody measured.
  if (!/^[1-9][0-9]{0,8}$/.test(String(opts.limit))) die('--limit takes a character count');
  opts.limit = Number(opts.limit);
}

const answer = {
  read: false,
  forge: null,
  ledger: { found: false, id: null, url: null, chars: null, utf16: null, ambiguous: false, at: null },
  archives: [],
  index: { listed: null, present: [], missing: [], unlisted: [] },
  write: { asked: false, chars: null, utf16: null, fits: null, headroom: null, limit: opts.limit },
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

const forge = opts.forge || (() => {
  // Which CLI answers HERE, never the hostname: a self-hosted instance lives on an arbitrary
  // domain, and the remote's url says nothing about which forge serves it.
  for (const [cmd, name] of [['gh', 'gh'], ['glab', 'glab']]) {
    const probe = runner(opts.dir, cmd)(['auth', 'status'], 60000);
    if (probe.ok) return name;
  }
  return null;
})();
if (forge === null) { answer.reason = 'no forge CLI answered here'; out(); }
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
      ? `repos/${opts.repo}/issues/${encodeURIComponent(opts.issue)}/comments`
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
if (!res.ok) { answer.reason = text(`the comment feed could not be read: ${res.line()}`); out(); }

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
  const id = c?.node_id ?? c?.id ?? null;
  const at = text(c?.created_at ?? null);
  const url = text(c?.html_url ?? c?.url ?? null);
  if (b.includes(LEDGER)) {
    // The ledger's own INDEX is written in these same markers — a pointer standing where the
    // text used to be. A comment carrying the ledger marker is the ledger, and the archive
    // markers in it are what it lists, never archives of its own.
    marked.push({ kind: 'ledger', id: text(String(id)), url, at, body: b });
    continue;
  }
  ARCHIVE.lastIndex = 0;
  let m;
  while ((m = ARCHIVE.exec(b)) !== null) {
    marked.push({ kind: 'archive', n: Number(m[1]), id: text(String(id)), url, at, body: b });
  }
}

const ledgers = marked.filter((m) => m.kind === 'ledger');
const archives = marked.filter((m) => m.kind === 'archive');

if (ledgers.length > 1) {
  answer.ledger.ambiguous = true;
  // A coordinate resolving to two states resolves to neither: the caller repairs before the
  // next write, and nothing here picks one of them to go on with.
  answer.faults.push({ fault: 'two comments carry the ledger marker',
    ids: ledgers.map((l) => l.id) });
}
if (ledgers.length >= 1) {
  const l = ledgers[0];
  const m = measure(l.body);
  answer.ledger = { found: true, id: l.id, url: l.url, chars: m.chars, utf16: m.utf16,
    ambiguous: ledgers.length > 1, at: l.at };
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
if (answer.ledger.found) {
  const l = ledgers[0].body;
  const listed = new Set();
  ARCHIVE.lastIndex = 0;
  let m;
  while ((m = ARCHIVE.exec(l)) !== null) listed.add(Number(m[1]));
  answer.index.listed = [...listed].sort((x, y) => x - y);
  answer.index.missing = answer.index.listed.filter((n) => !byN.has(n));
  answer.index.unlisted = answer.index.present.filter((n) => !listed.has(n));
  for (const n of answer.index.missing) {
    answer.faults.push({ fault: `the ledger lists archive ${n}, and no comment carries it` });
  }
  for (const n of answer.index.unlisted) {
    answer.faults.push({ fault: `archive ${n} stands on the issue and the ledger does not list it` });
  }
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
