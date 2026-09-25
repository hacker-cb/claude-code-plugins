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
//          [--forge gh|glab] [--host <host>] [--repo <path>] [--repo-dir <path>]
//
// `--add` / `--remove` each name a file holding a JSON array of label names; at least one is
// given. `--repo` names another repository than this checkout's.
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
import { dirOk, hostOk, parsePages, projectPathOk, runner, text, writeAll } from './lib/forge.mjs';

const usage = 'usage: node label-write.mjs --number <n> --kind issue|request [--add <file>]'
  + ' [--remove <file>] [--forge gh|glab] [--host <host>] [--repo <path>] [--repo-dir <path>]';
const die = (msg) => { writeAll(2, `label-write: ${msg}\n${usage}\n`); process.exit(2); };

const FLAGS = {
  '--number': 'number', '--kind': 'kind', '--add': 'add', '--remove': 'remove', '--forge': 'forge',
  '--host': 'host', '--repo': 'repo', '--repo-dir': 'dir',
};
const opts = { number: null, kind: null, add: null, remove: null, forge: null, host: null, repo: null, dir: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (i + 1 >= argv.length || argv[i + 1] === '') die(`${argv[i]} takes a value`);
  if (opts[key] !== null) die(`${argv[i]} given twice`);
  opts[key] = argv[i += 1];
}
opts.dir ??= process.cwd();

if (opts.number === null || !(/^[1-9][0-9]{0,9}$/.test(opts.number) && Number(opts.number) <= 2147483647)) {
  die('--number takes an issue or change-request number');
}
if (opts.kind !== 'issue' && opts.kind !== 'request') die('--kind takes issue or request');
if (opts.add === null && opts.remove === null) die('give --add, --remove, or both');
if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
if (opts.repo !== null && !projectPathOk(opts.repo)) die(`--repo '${opts.repo}' is not a repository path`);

// The names, exactly as written: a name is compared and sent whole, never trimmed or quoted for
// a reader, since a name changed on the way is another label.
const names = (file, flag) => {
  if (file === null) return [];
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { die(`${flag} '${file}' is not a JSON file`); }
  if (!Array.isArray(parsed)) die(`${flag} takes a JSON array of label names`);
  for (const n of parsed) {
    if (typeof n !== 'string' || n === '' || n.trim() !== n || n.length > 255) {
      die(`${flag} holds something that is not a label name`);
    }
  }
  return [...new Set(parsed)];
};
const add = names(opts.add, '--add');
const remove = names(opts.remove, '--remove');
const both = add.filter((n) => remove.includes(n));
if (both.length) die('a name is both added and taken off');

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
  wrote: false,
  reason: null,
};
const out = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (msg) => { answer.reason = text(msg); out(); };
const why = (r) => (r.timedOut ? 'no answer in time' : r.line());

// Which forge and host this repository lives on — what answers for it, never the hostname.
const probe = (cmd) => {
  const args = cmd === 'gh'
    ? ['repo', 'view', ...(opts.repo ? [opts.repo] : []), '--json', 'url']
    : ['api', ...(opts.host ? ['--hostname', opts.host] : []),
      opts.repo ? `projects/${encodeURIComponent(opts.repo)}` : 'projects/:fullpath'];
  const r = runner(opts.dir, cmd)(args, 60000);
  if (!r.ok) return { cmd, ok: false, why: `${cmd}: ${why(r)}` };
  try {
    const parsed = JSON.parse(r.out);
    const url = new URL(cmd === 'gh' ? parsed?.url : parsed?.web_url);
    return { cmd, ok: true, host: url.host, path: url.pathname.replace(/^\/+|\/+$/g, '') };
  } catch {
    return { cmd, ok: false, why: `${cmd}: answered without a repository URL` };
  }
};
const probed = (opts.forge ? [opts.forge] : ['gh', 'glab']).map(probe);
for (const p of probed) {
  if (p.ok && opts.host && p.host !== opts.host) {
    Object.assign(p, { ok: false, why: `${p.cmd}: this repository lives on ${p.host}` });
  }
}
const answered = probed.filter((p) => p.ok);
if (answered.length === 0) refuse(`no forge CLI answered for this repository — ${probed.map((p) => p.why).join('; ')}`);
if (answered.length > 1) refuse('both forges answer for this repository — name one with --forge');
const { cmd: forge, host, path } = answered[0];
if (!hostOk(host) || !projectPathOk(path)) refuse('the repository answered without a host and path this run can name');
answer.forge = forge;
answer.host = host;
const cli = runner(opts.dir, forge);

// GitHub keeps a pull request's labels on the issue of the same number; GitLab on the request.
const carrierPath = forge === 'gh'
  ? `repos/${path}/issues/${opts.number}`
  : `projects/${encodeURIComponent(path)}/${opts.kind === 'issue' ? 'issues' : 'merge_requests'}/${opts.number}`;

const read = () => {
  const r = cli(['api', '--hostname', host, carrierPath], 60000);
  if (!r.ok) return { ok: false, why: why(r) };
  try {
    const labels = JSON.parse(r.out)?.labels;
    if (!Array.isArray(labels)) return { ok: false, why: 'the carrier answered without its labels' };
    return { ok: true, labels: labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter((l) => typeof l === 'string') };
  } catch {
    return { ok: false, why: 'the carrier answered with something that is not JSON' };
  }
};

const before = read();
if (!before.ok) refuse(`could not read ${opts.kind} ${opts.number}: ${before.why}`);
answer.read = true;
answer.before = before.labels;

// GitLab takes its label lists comma-separated, and a comma inside a name would split into two —
// one it has never seen being created. Its own set holds none: it refuses the comma in a title.
if (forge === 'glab' && [...add, ...remove].some((n) => n.includes(','))) {
  refuse('a name holding a comma cannot be written on GitLab: its API takes the list comma-separated');
}

// A name the set does not hold is refused, never sent: GitLab creates one it has not seen, and
// GitHub creates it too for an account that may. The set is read whole, every page — GitLab's
// with the labels its groups pass down, which apply, and without the archived ones, which do not.
const setPath = forge === 'gh'
  ? `repos/${path}/labels?per_page=100`
  : `projects/${encodeURIComponent(path)}/labels?per_page=100&include_ancestor_groups=true`;
const setRead = cli(['api', '--hostname', host, '--paginate', setPath], 120000);
const pages = setRead.ok ? parsePages(setRead.out) : null;
if (!pages || pages.some((pg) => !Array.isArray(pg))) {
  refuse(`could not read the label set: ${setRead.ok ? 'it answered with something that is not a list' : why(setRead)}`);
}
const held = new Set(pages.flat().filter((l) => l && l.archived !== true).map((l) => l.name));
answer.unknown = add.filter((n) => !held.has(n));
if (answer.unknown.length) refuse('a name to add is not in the repository\'s label set');

const toAdd = add.filter((n) => !before.labels.includes(n));
const toRemove = remove.filter((n) => before.labels.includes(n));
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
const send = (args, label) => {
  const r = cli(args, 60000);
  answer.ran.push(label);
  if (!r.ok) failures.push(`${label}: ${why(r)}`);
};
try {
  if (forge === 'gh') {
    if (toAdd.length) {
      send(['api', '--hostname', host, '--method', 'POST', `${carrierPath}/labels`, '--input', body({ labels: toAdd })],
        `add ${toAdd.length}`);
    }
    for (const n of toRemove) {
      send(['api', '--hostname', host, '--method', 'DELETE', `${carrierPath}/labels/${encodeURIComponent(n)}`],
        'take one off');
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
answer.missing = add.filter((n) => !after.labels.includes(n));
answer.standing = remove.filter((n) => after.labels.includes(n));
const changed = after.labels.length !== before.labels.length
  || after.labels.some((n) => !before.labels.includes(n));
if (answer.missing.length === 0 && answer.standing.length === 0) {
  answer.wrote = true;
  if (failures.length) answer.reason = text(`landed, though the forge answered: ${failures.join('; ')}`);
} else if (!changed) {
  answer.wrote = false;
  answer.reason = text(failures.length ? `refused: ${failures.join('; ')}` : 'nothing landed');
} else {
  answer.wrote = null;
  answer.reason = text(`did not read back as written${failures.length ? ` — ${failures.join('; ')}` : ''}`);
}
out();
