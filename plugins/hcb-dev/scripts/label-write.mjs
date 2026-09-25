#!/usr/bin/env node
// label-write.mjs — put labels on one issue or change request, and take them off, then read back
// what the carrier holds. Prints JSON.
//
// A label name is data the forge's own set handed over: it may carry `$`, quotes, backticks, a
// comma, a newline. Passed on a command line it is shell; passed through a CLI's label flag it is
// split on its commas. So the names arrive here as JSON files and leave as JSON bodies, and no
// name ever reaches a shell or a flag.
//
// usage: node label-write.mjs --number <n> --kind issue|request [--add <file>] [--remove <file>]
//          [--expect <file>] [--forge gh|glab] [--host <host>] [--repo <path>] [--repo-dir <path>]
//        node label-write.mjs --url <a change request's URL> [--add <file>] [--remove <file>]
//
// `--url` takes the request a CLI just opened by the URL it printed: forge, host, repository and
// number all come from it, the repository confirmed by the forge's own answer for it.
//
// `--add` / `--remove` each name a file holding a JSON array of label names; at least one is
// given. `--expect`, the same, names every label the carrier must hold before anything is written:
// a carrier that moved since the caller read it is refused. `--repo` names another repository than this checkout's, and takes `--forge` with it: a
// path alone answers on whichever forge happens to hold one of that name.
//
// Exit: 0 whenever an answer is printed — a refusal and an unread carrier included, told apart
// by `wrote` and `reason`; 2 called wrong.
//
// `wrote`: true — the carrier read back holding every name added and none taken off;
// false — nothing written: nothing was needed, or the forge refused before anything landed;
// null — writes ran and the read-back does not show what was meant, or could not be read.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dirOk, hostOk, labelNameOk, parsePages, projectPathOk, repoOk, resolveRepository, runner, sameLabel, text, why, writeAll,
} from './lib/forge.mjs';

const usage = 'usage: node label-write.mjs (--number <n> --kind issue|request | --url <request URL>)'
  + ' [--add <file>] [--remove <file>] [--forge gh|glab] [--host <host>] [--repo <path>] [--repo-dir <path>]';
const die = (msg) => { writeAll(2, `label-write: ${msg}\n${usage}\n`); process.exit(2); };

const FLAGS = {
  '--number': 'number', '--kind': 'kind', '--add': 'add', '--remove': 'remove', '--forge': 'forge',
  '--host': 'host', '--repo': 'repo', '--repo-dir': 'dir', '--url': 'url', '--expect': 'expect',
};
const opts = {
  number: null, kind: null, add: null, remove: null, forge: null, host: null, repo: null, dir: null, url: null, expect: null,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const key = Object.hasOwn(FLAGS, argv[i]) ? FLAGS[argv[i]] : null;
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (i + 1 >= argv.length || argv[i + 1] === '') die(`${argv[i]} takes a value`);
  if (opts[key] !== null) die(`${argv[i]} given twice`);
  opts[key] = argv[i += 1];
}
opts.dir ??= process.cwd();

let requestUrl = null;
if (opts.url !== null) {
  if (opts.number !== null || opts.kind !== null || opts.repo !== null || opts.forge !== null) {
    die('--url stands alone: the forge, repository and number all come from it');
  }
  try { requestUrl = new URL(opts.url); } catch { die('--url takes a change request\'s URL'); }
  const m = requestUrl.pathname.match(/\/(pull|-\/merge_requests)\/([1-9][0-9]{0,9})\/?$/);
  if (!/^https?:$/.test(requestUrl.protocol) || !m || !hostOk(requestUrl.host)) die('--url takes a change request\'s URL');
  opts.forge = m[1] === 'pull' ? 'gh' : 'glab';
  opts.number = m[2];
  opts.kind = 'request';
}
if (opts.number === null || !(/^[1-9][0-9]{0,9}$/.test(opts.number) && Number(opts.number) <= 2147483647)) {
  die('--number takes an issue or change-request number');
}
if (opts.kind !== 'issue' && opts.kind !== 'request') die('--kind takes issue or request');
if (opts.add === null && opts.remove === null) die('give --add, --remove, or both');
if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
if (opts.repo !== null && !projectPathOk(opts.repo)) die(`--repo '${opts.repo}' is not a repository path`);
if (opts.repo !== null && opts.forge === null) die('--repo takes --forge with it');
if (opts.forge === 'gh' && opts.host !== null && opts.repo === null && opts.url === null) die('--host on GitHub takes --repo with it');
// gh opens a request wherever GH_REPO points while `gh repo view` answers for the checkout: the
// number alone would then name another repository's request.
if (process.env.GH_REPO && opts.forge === 'gh' && opts.repo === null && opts.url === null) {
  die('GH_REPO is set: name the repository with --repo, or the request with --url');
}
// `gh repo view` reads a three-part argument as HOST/OWNER/REPO: a group path handed on would send
// the request, and the token for that host, to whatever its first segment names.
if (opts.repo !== null && opts.forge === 'gh' && !repoOk(opts.repo)) die('--repo on GitHub takes owner/name');

// The names, exactly as written: a name is compared and sent whole, never trimmed or quoted for
// a reader, since a name changed on the way is another label.
const names = (file, flag) => {
  if (file === null) return [];
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { die(`${flag} '${file}' is not a JSON file`); }
  if (!Array.isArray(parsed)) die(`${flag} takes a JSON array of label names`);
  for (const n of parsed) {
    if (!labelNameOk(n)) {
      die(`${flag} holds something that is not a label name`);
    }
  }
  return [...new Set(parsed)];
};
const add = names(opts.add, '--add');
const remove = names(opts.remove, '--remove');
const expect = opts.expect === null ? null : names(opts.expect, '--expect');
if (add.some((n) => remove.includes(n))) die('a name is both added and taken off');

const answer = {
  read: false,
  forge: null,
  host: null,
  carrier: { kind: opts.kind, number: Number(opts.number) },
  before: null,
  add,
  remove,
  ran: [],
  after: null,
  unknown: [],
  missing: [],
  standing: [],
  lost: [],
  wrote: false,
  reason: null,
};
const out = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (msg) => { answer.reason = text(msg); out(); };

const resolved = resolveRepository({
  dir: opts.dir, forge: opts.forge, host: opts.host, repo: opts.repo, url: requestUrl, number: opts.number,
});
if (resolved.reason) refuse(resolved.reason);
const { forge, host, path } = resolved;
answer.forge = forge;
answer.host = host;
// GitHub reads two spellings as one label: added and taken off at once, that is a contradiction.
if (forge === 'gh' && add.some((n) => remove.some((m) => sameLabel(forge)(m, n)))) {
  refuse('a name is both added and taken off, in two spellings GitHub reads as one');
}
const cli = runner(opts.dir, forge);

// GitHub keeps a pull request's labels on the issue of the same number; GitLab on the request.
const carrierPath = forge === 'gh'
  ? `repos/${path}/issues/${opts.number}`
  : `projects/${encodeURIComponent(path)}/${opts.kind === 'issue' ? 'issues' : 'merge_requests'}/${opts.number}`;

const read = () => {
  const r = cli(['api', '--hostname', host, carrierPath], 60000);
  if (!r.ok) return { ok: false, why: why(r) };
  try {
    const v = JSON.parse(r.out);
    if (!Array.isArray(v?.labels)) return { ok: false, why: 'the carrier answered without its labels' };
    return {
      ok: true,
      isRequest: forge === 'gh' ? Boolean(v.pull_request) : opts.kind === 'request',
      labels: v.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter((l) => typeof l === 'string'),
    };
  } catch {
    return { ok: false, why: 'the carrier answered with something that is not JSON' };
  }
};

// GitLab takes its label lists comma-separated, and a comma inside a name would split into two —
// one it has never seen being created. Its own set holds none: it refuses the comma in a title.
if (forge === 'glab' && [...add, ...remove].some((n) => n.includes(','))) {
  refuse('a name holding a comma cannot be written on GitLab: its API takes the list comma-separated');
}

const before = read();
if (!before.ok) refuse(`could not read ${opts.kind} ${opts.number}: ${before.why}`);
answer.read = true;
answer.before = before.labels;
if (before.isRequest !== (opts.kind === 'request')) {
  refuse(`${opts.number} is ${before.isRequest ? 'a change request' : 'an issue'}, not the ${opts.kind} asked for`);
}
// GitHub matches label names without regard to case; GitLab by the exact name.
const same = sameLabel(forge);
const holds = (list, n) => list.some((l) => same(l, n));
if (expect !== null && !(expect.every((n) => holds(before.labels, n)) && before.labels.every((l) => holds(expect, l)))) {
  refuse('the carrier does not hold the labels --expect names: it moved since it was read');
}
const toAdd = add.filter((n) => !holds(before.labels, n));
// Taken off under the spelling the carrier holds it by: that is the name the forge knows.
const toRemove = before.labels.filter((l) => remove.some((n) => same(l, n)));

// A name the set does not hold is refused, never sent: GitLab creates one it has not seen, and
// GitHub creates it too for an account that may. The set is read whole, every page — GitLab's
// with the labels its groups pass down, which apply, and without the archived ones, which do not.
const setPath = forge === 'gh'
  ? `repos/${path}/labels?per_page=100`
  : `projects/${encodeURIComponent(path)}/labels?per_page=100&include_ancestor_groups=true`;
const setRead = toAdd.length ? cli(['api', '--hostname', host, '--paginate', setPath], 120000) : null;
const pages = setRead === null ? [[]] : (setRead.ok ? parsePages(setRead.out) : null);
if (!pages || pages.some((pg) => !Array.isArray(pg))) {
  refuse(`could not read the label set: ${setRead.ok ? 'it answered with something that is not a list' : why(setRead)}`);
}
// Archived is `archived` on GitLab, `archived_at` on GitHub: neither applies.
const held = pages.flat().filter((l) => l && typeof l.name === 'string' && l.archived !== true && !l.archived_at)
  .map((l) => l.name);
answer.unknown = toAdd.filter((n) => !holds(held, n));
if (answer.unknown.length) refuse('a name to add is not in the repository\'s label set');

if (toAdd.length === 0 && toRemove.length === 0) {
  answer.after = before.labels;
  answer.reason = 'the carrier already holds what was asked';
  out();
}

const dir = mkdtempSync(join(tmpdir(), 'label-write-'));
const body = (value) => {
  const file = join(dir, `b${answer.ran.length}.json`);
  writeFileSync(file, JSON.stringify(value));
  return file;
};
const failures = [];
let unanswered = false;
const send = (args, label, absentOk = false) => {
  const r = cli(args, 60000);
  answer.ran.push(label);
  if (r.ok) return;
  // A label already off answers 404 to its DELETE: nothing was refused.
  if (absentOk && /\bHTTP 404\b/.test(r.err)) return;
  failures.push(`${label}: ${why(r)}`);
  // Only the forge's own refusal of the request — a 4xx — says it will not land. A timeout, a
  // killed process, a closed connection or a 5xx from a proxy leaves it free to land yet.
  if (r.timedOut || r.code === null || !/\bHTTP 4\d\d\b/.test(r.err)) unanswered = true;
};
try {
  if (forge === 'gh') {
    // Off before on: a sibling swapped out of a one-value family never stands beside its successor.
    const addBody = toAdd.length ? body({ labels: toAdd }) : null;
    // A name of dots stays a name: unencoded, `.` and `..` are path steps a server resolves away.
    const seg = (n) => encodeURIComponent(n).replace(/\./g, '%2E');
    for (const n of toRemove) {
      send(['api', '--hostname', host, '--method', 'DELETE', `${carrierPath}/labels/${seg(n)}`], 'take one off', true);
    }
    // A removal that failed holds the addition back, so a swapped-out value never stands beside
    // its successor.
    if (toAdd.length && failures.length === 0) {
      send(['api', '--hostname', host, '--method', 'POST', `${carrierPath}/labels`, '--input', addBody],
        `add ${toAdd.length}`);
    }
  } else {
    const payload = {};
    if (toAdd.length) payload.add_labels = toAdd.join(',');
    if (toRemove.length) payload.remove_labels = toRemove.join(',');
    send(['api', '--hostname', host, '--method', 'PUT', carrierPath, '-H', 'Content-Type: application/json',
      '--input', body(payload)], `add ${toAdd.length}, take ${toRemove.length} off`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// What landed is what the carrier holds now, whatever each write answered.
const after = read();
if (!after.ok) {
  answer.wrote = null;
  refuse(`wrote, then could not read ${opts.kind} ${opts.number} back: ${after.why}`);
}
answer.after = after.labels;
answer.missing = add.filter((n) => !holds(after.labels, n));
answer.standing = remove.filter((n) => holds(after.labels, n));
// What nobody asked to take off and is gone: a write that reached further than it was sent.
// On GitLab a scoped label (`key::value`) displaces its sibling of the same key: that one leaving
// is what the platform does with the addition, not a write that reached too far.
const scope = (n) => (n.includes('::') ? n.slice(0, n.lastIndexOf('::')) : null);
const displaced = (l) => forge === 'glab' && scope(l) !== null && toAdd.some((n) => scope(n) === scope(l));
answer.lost = before.labels.filter((l) => !toRemove.includes(l) && !holds(after.labels, l) && !displaced(l));
const changed = after.labels.length !== before.labels.length
  || after.labels.some((n) => !before.labels.includes(n));
if (answer.missing.length === 0 && answer.standing.length === 0 && answer.lost.length === 0) {
  answer.wrote = true;
  if (failures.length) answer.reason = text(`landed, though the forge answered: ${failures.join('; ')}`);
} else if (!changed && !unanswered) {
  // Nothing moved and every call was answered: refused — outright, or with a success that applied
  // nothing, as an account that may not label can be answered.
  answer.wrote = false;
  answer.reason = text(failures.length ? `refused: ${failures.join('; ')}`
    : 'refused: the forge accepted the write and applied none of it');
} else {
  answer.wrote = null;
  answer.reason = text(`${unanswered ? 'a write went unanswered and may land yet' : 'did not read back as written'}${
    failures.length ? ` — ${failures.join('; ')}` : ''}`);
}
out();
