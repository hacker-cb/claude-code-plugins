#!/usr/bin/env node
// landings.mjs — what the base took between two of its commits, as landings. Prints JSON.
//
// A master takes a landing per change request merged, not per commit: a rebase-merge lays a
// request's commits on the base one by one, and a push lays its own. Which request carries a
// commit is the forge's to say — git alone cannot — so each first-parent commit is asked
// about, and consecutive commits of one request, or of no request, are one landing. The
// forge asked is the one this checkout's CLI answers for, as every script here asks it.
//
// Usage: node landings.mjs --since <commit> --to <commit> --base <branch>
//          [--forge gh|glab | --no-forge] [--repo-dir <path>]
//
//   --since, --to  the range: `since.sha` and `since.to` of `master-tree.mjs --since`
//   --base         the branch they landed on, as the forge names it
//   --no-forge     every commit a landing of its own, for a local parent
//
// Exit 0 either way: `"read": true` with the landings, or `"read": false` with a `reason`.
// Exit 2 only for a call this script cannot act on at all.

import { dirOk, forgeFor, refNameOk, requestsOf, runner, why, writeAll } from '../../../scripts/lib/forge.mjs';

const USAGE = 'usage: node landings.mjs --since <commit> --to <commit> --base <branch>'
  + ' [--forge gh|glab | --no-forge] [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `landings: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { since: null, to: null, base: null, forge: true, cli: null, repoDir: null };
const FLAGS = { '--since': 'since', '--to': 'to', '--base': 'base', '--forge': 'cli', '--repo-dir': 'repoDir' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--no-forge') { opts.forge = false; continue; }
  const key = Object.hasOwn(FLAGS, argv[i]) ? FLAGS[argv[i]] : null;
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i += 1];
}
for (const f of ['since', 'to', 'base']) {
  if (!opts[f]) die(`--${f} is required`);
  if (!refNameOk(opts[f])) die(`--${f} '${opts[f]}' is not a ref this can read`);
}
if (opts.cli && !['gh', 'glab'].includes(opts.cli)) die(`--forge '${opts.cli}' is not gh or glab`);
if (opts.cli && !opts.forge) die('--no-forge asks no forge: --forge names one for a run that does');
if (opts.repoDir !== null && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
// Past this many commits the forge is not asked one by one: the range goes to the caller whole.
const MAX = 100;
// Asked no further past this, so an answer is printed before a caller waiting ten minutes stops
// waiting: the commits past it are `unread`, the ones already asked keep what they got.
const DEADLINE = Date.now() + 7.5 * 60 * 1000;

const answer = {
  read: false,
  since: null, to: null, base: opts.base,
  commits: null,
  // `asked: false` with --no-forge. `reason` where a forge was wanted and did not answer: the
  // commits from there on are `unread`, never a push, and the forge is asked nothing further.
  forge: { asked: opts.forge, cli: null, reason: null },
  // Oldest first. Each: `kind`, `number` for a request, `commits` ("<sha> <subject>", oldest
  // first) and `tip`, the newest of them — where its checks are read.
  //   request · a change request merged into the base, its merge commit inside the range
  //   push    · commits no such request carries
  //   commit  · one commit, with --no-forge
  //   unsure  · several such requests carry it and none by its merge commit: `requests`
  //   unread  · the forge was not asked, or did not answer
  landings: [],
  // `false` where a landing is `unsure` or `unread`, or the range ran past what is asked —
  // `landings` then empty, and `reason` says so.
  complete: false,
  reason: null,
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

const commitOf = (ref) => {
  const r = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  if (r.ok && r.out) return r.out;
  return refuse(r.code === 1 ? `${ref} is not a commit this checkout knows` : `could not read ${ref} (${why(r)})`);
};
answer.since = commitOf(opts.since);
answer.to = commitOf(opts.to);
const a = git(['merge-base', '--is-ancestor', answer.since, answer.to]);
if (!a.ok) {
  refuse(a.code === 1 ? `${opts.to} does not hold ${opts.since} — no range runs between them`
    : `could not read whether ${opts.to} holds ${opts.since} (${why(a)})`);
}

const range = [`${answer.since}..${answer.to}`, '--'];
const n = git(['rev-list', '--first-parent', '--count', ...range]);
if (!n.ok || !/^[0-9]+$/.test(n.out)) refuse(`could not count the commits between them (${why(n)})`);
answer.commits = Number(n.out);
if (opts.forge && answer.commits > MAX) {
  answer.read = true;
  refuse(`${answer.commits} commits — past the ${MAX} this asks the forge about one by one`);
}
const l = git(['log', '--no-show-signature', '--first-parent', '--reverse', '--format=%H %s', ...range]);
if (!l.ok) refuse(`could not list the commits between them (${why(l)})`);
answer.read = true;

// What each commit is, one at a time; runs of one request, or of none, are joined below.
const keyed = l.out.split('\n').filter(Boolean).map((line) => ({ sha: line.split(' ')[0], line, kind: 'commit' }));
// A request counts here only where its merge commit is in the range's history: one that took a
// commit of the range and merged after `--to` has not landed as far as this range goes.
const inRange = (q) => !q.mergeCommit || git(['merge-base', '--is-ancestor', q.mergeCommit, answer.to]).ok;
if (opts.forge) {
  const found = forgeFor(cwd, opts.cli, null);
  answer.forge.cli = found.cli;
  answer.forge.reason = found.reason;
  for (const k of keyed) {
    if (!answer.forge.reason && Date.now() > DEADLINE) answer.forge.reason = 'ran out of time before the rest were asked';
    // One refusal is the forge's answer for the rest of the range: asking on only multiplies it.
    if (answer.forge.reason) { k.kind = 'unread'; continue; }
    const got = requestsOf(found, cwd, null, k.sha);
    if (got.error) { answer.forge.reason = got.error; k.kind = 'unread'; continue; }
    const merged = got.rows.filter((q) => q.state === 'merged' && q.base === opts.base
      && Number.isInteger(q.number) && inRange(q));
    // A request's own merge commit settles it; otherwise one request, or none, is the answer.
    const own = merged.filter((q) => q.mergeCommit && q.mergeCommit.toLowerCase() === k.sha.toLowerCase());
    const pick = own.length === 1 ? own : merged;
    if (pick.length === 1) Object.assign(k, { kind: 'request', number: pick[0].number });
    else if (!pick.length) k.kind = 'push';
    else Object.assign(k, { kind: 'unsure', requests: pick.map((q) => q.number) });
  }
}

for (const k of keyed) {
  const last = answer.landings[answer.landings.length - 1];
  const joins = last && ((k.kind === 'request' && last.kind === 'request' && last.number === k.number)
    || (k.kind === 'push' && last.kind === 'push'));
  if (joins) { last.commits.push(k.line); last.tip = k.sha; continue; }
  answer.landings.push({ kind: k.kind, ...(k.number ? { number: k.number } : {}),
    ...(k.requests ? { requests: k.requests } : {}), commits: [k.line], tip: k.sha });
}
answer.complete = answer.landings.every((x) => x.kind !== 'unsure' && x.kind !== 'unread');
finish();
