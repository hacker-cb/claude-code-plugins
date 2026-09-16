#!/usr/bin/env node
// cleanup-scan.mjs — what a sweep would find in this repository, and what each thing
// carries. Prints JSON.
//
// It READS and classifies; it deletes nothing. Two questions, answered separately
// because they fail separately: what git state each worktree is in, and what proof each
// branch has that its work landed. Who is IN a worktree is `worktree-owners.mjs`'s, and
// a caller needs both — a worktree clean here can still be somebody's.
//
// Usage: node cleanup-scan.mjs [--default <name>] [--default-ref <ref>]
//                              [--repo-dir <path>] [--repo <owner/name>] [--no-forge]
//
// `--default-ref` comes from `default-branch.mjs`, and only where it answered `confirmed`
// AND `resolved`. Without it every branch's merge question is UNKNOWN — which is not
// "not merged", and is why the two are named apart below.
//
// Exit 0 either way: `"read": true` with the scan, or `"read": false` with a `reason`.
// Exit 2 only for a call this script cannot act on at all.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeAll, readable, refOk, repoOk, runner, text, worktrees } from './lib/forge.mjs';

const USAGE = 'usage: node cleanup-scan.mjs [--default <name>] [--default-ref <ref>]'
  + ' [--repo-dir <path>] [--repo <owner/name>] [--no-forge]\n';
const die = (m) => { writeAll(2, `cleanup-scan: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { base: null, baseRef: null, repoDir: null, repo: null, forge: true };
const FLAGS = { '--default': 'base', '--default-ref': 'baseRef',
  '--repo-dir': 'repoDir', '--repo': 'repo' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--no-forge') { opts.forge = false; continue; }
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i += 1];
}
if (opts.base && !refOk(opts.base)) die(`--default '${opts.base}' is not a branch name`);
if (opts.baseRef && !refOk(opts.baseRef)) die(`--default-ref '${opts.baseRef}' is not a ref`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);
// A ref to READ and a name to COMPARE are two values, and neither is the other trimmed:
// `${D#*/}` over a fully qualified ref yields `remotes/origin/master`, and the comparison
// guarding the default branch itself then never matches again.
if (opts.baseRef && !opts.base) {
  die('--default-ref needs --default: a ref to read and a name to compare are two values');
}

const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');
const gh = runner(cwd);

const answer = {
  read: false,
  // `usable: false` is "the merge question cannot be answered", which is not "nothing is
  // merged". Every branch surfaces then, and none is deleted.
  base: { name: opts.base, ref: opts.baseRef, usable: false },
  // `answered: false` beside `asked: true` is a forge that did not reply. The scan gets
  // NARROWER then, never wider: a squash-merged branch it cannot see stays standing.
  forge: { asked: false, answered: false, reason: null },
  worktrees: [], branches: [],
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

if (!git(['rev-parse', '--git-dir']).ok) die('not inside a git checkout');

// --- the base, verified rather than taken on trust
if (opts.baseRef) {
  answer.base.usable = git(['rev-parse', '--verify', '-q', `${opts.baseRef}^{commit}`]).ok;
  if (!answer.base.usable) {
    answer.notes.push(`${opts.baseRef} is not a commit this checkout carries, so every`
      + " branch's merge question is unknown");
  }
}

// --- the worktrees, in the git state each is in
const listed = worktrees(git);
if (listed.trees === null) refuse(`could not list this repository's worktrees (${listed.error})`);
for (const w of listed.trees) {
  const t = { ...w, dirty: null, submodules: null, modulesDir: null, blockers: [] };
  // `worktree list` never mentions modified or untracked files, so without this there is
  // no clean/dirty signal at all, and a removable worktree cannot be told from one
  // holding work.
  const status = git(['-C', w.path, 'status', '--porcelain', '-unormal']);
  if (status.ok) t.dirty = status.out !== '';
  else t.blockers.push(`its working tree could not be read (${status.line()})`);
  if (t.dirty) t.blockers.push('it has uncommitted or untracked changes');

  // Read for STATE, not for dirt: no line at all, or `-` leading every line, AND no
  // `modules` directory — that combination is the only answer meaning nothing is there.
  const sub = git(['-C', w.path, 'submodule', 'status']);
  if (sub.ok) t.submodules = sub.out.split('\n').filter(Boolean).some((l) => !l.startsWith('-'));
  else t.blockers.push(`its submodule state could not be read (${sub.line()})`);
  // `--absolute-git-dir`, not `--git-dir`: the latter answers `.git` for a primary
  // worktree, which then resolves against the CALLER's directory, not the worktree's.
  const admin = git(['-C', w.path, 'rev-parse', '--absolute-git-dir']);
  if (admin.ok) t.modulesDir = existsSync(join(admin.out, 'modules'));
  else t.blockers.push(`its admin directory could not be read (${admin.line()})`);
  if (t.submodules || t.modulesDir) {
    t.blockers.push('it holds a submodule, or a git directory for one — the removal takes'
      + ' whatever history that holds, and nothing here proves it empty');
  }
  if (t.prunable && t.pruneReason && /not.*exist|unreachable|no such/i.test(t.pruneReason)) {
    // An unmounted volume prints what a deleted directory prints, and pruning strands
    // the work the first one still holds.
    t.blockers.push('git calls it prunable because its path does not answer, which an'
      + ' unmounted volume does too');
  }
  answer.worktrees.push(t);
}

// --- the branches, in one pass
// A NUL between the fields and a sentinel before each record: a branch name can carry
// neither, and `worktreepath` is a filesystem path, which can carry a newline.
const SEP = '\u0000';
const REC = `${SEP}R${SEP}`;
// Both forms of the upstream, because a ref and a name are two values: the short one
// is what a report says, and the full one is what compares against a ref — `origin/master`
// against `refs/remotes/origin/master` never matches, and the default branch then gets
// its tracking "repaired" on every run.
const FIELDS = ['%(refname:lstrip=2)', '%(objectname)', '%(worktreepath)',
  '%(upstream:short)', '%(upstream)', '%(upstream:track)'];
const format = (extra) => `%00R%00${FIELDS.join('%00')}${extra}`;
// `ahead-behind` gives the count AND the containment in one pass — a branch is in the
// base exactly when it is ahead of it by nothing. It needs git 2.41 and a ref that
// resolves, so its absence is a fallback rather than a refusal.
const withCounts = answer.base.usable
  ? git(['for-each-ref', 'refs/heads/',
    `--format=${format(`%00%(ahead-behind:${opts.baseRef})`)}`])
  : { ok: false, out: '', line: () => 'no usable base' };
const counted = withCounts.ok;
const listing = counted ? withCounts
  : git(['for-each-ref', 'refs/heads/', `--format=${format('')}`]);
if (!listing.ok) refuse(`could not list this repository's branches (${listing.line()})`);
if (answer.base.usable && !counted) {
  answer.notes.push('this git does not take `ahead-behind`, so containment is measured'
    + ' one branch at a time');
}

for (const rec of listing.out.split(REC)) {
  if (!rec.trim()) continue;
  // `for-each-ref` ends every record with a newline, which lands in the last field —
  // whichever that is, since the counted form has one more.
  const f = rec.replace(/\n$/, '').split(SEP);
  const name = (f[0] || '').trim();
  if (!refOk(name)) {
    answer.notes.push(`a branch name this cannot read was skipped: ${text(name) || 'unnamed'}`);
    continue;
  }
  const b = {
    name, ref: `refs/heads/${name}`, oid: (f[1] || '').trim() || null,
    worktree: f[2] || null,
    upstream: f[3] || null,
    upstreamRef: f[4] || null,
    // `[gone]` is the upstream's OWN state, and it is not "merged": a branch whose remote
    // ref was deleted may hold the only copy of its commits.
    gone: (f[5] || '').includes('[gone]'),
    isDefault: opts.base ? name === opts.base : null,
    ownCommits: null, merged: null,
    requests: null, openRequest: null,
    proof: null, keeps: [], unproven: [], verdict: null, class: null,
    // What a branch that SURVIVES still needs done to it. A keep promises the branch
    // stays, never that nothing touches it.
    repair: null,
  };
  if (counted) {
    const ahead = Number.parseInt((f[6] || '').trim().split(/\s+/)[0], 10);
    if (Number.isInteger(ahead)) { b.ownCommits = ahead; b.merged = ahead === 0; }
  } else if (answer.base.usable) {
    const c = git(['rev-list', '--count', `${opts.baseRef}..${b.ref}`]);
    const n = c.ok ? Number.parseInt(c.out.trim(), 10) : NaN;
    if (Number.isInteger(n)) { b.ownCommits = n; b.merged = n === 0; }
  }
  answer.branches.push(b);
}

// --- what the forge says about each tip, which is the only place a squash merge shows
if (opts.forge && answer.branches.length) {
  answer.forge.asked = true;
  const repoArgs = opts.repo ? ['--repo', opts.repo] : [];
  let hostArgs = [];
  const view = gh(['repo', 'view', '--json', 'url', ...repoArgs]);
  if (view.ok) {
    try {
      const { url } = JSON.parse(view.out);
      const host = typeof url === 'string' ? new URL(url).host : null;
      // The host this repository actually lives on: a self-hosted instance asked of
      // github.com answers about somebody else's repository, or about nothing at all.
      if (host && readable(host)) hostArgs = ['--hostname', host];
    } catch { /* an unreadable url leaves the CLI to resolve its own host */ }
  }
  for (const b of answer.branches) {
    if (!b.oid || !refOk(b.oid)) continue;
    // By TIP, never by name: a merged `fix/login` may have come from a fork, and the
    // local branch of that name may have been recreated since. `--paginate`, or an open
    // request on page two is one the sweep deletes over.
    const r = gh(['api', ...hostArgs, '--paginate',
      `repos/{owner}/{repo}/commits/${b.oid}/pulls`, '--jq',
      '.[] | [.number, .state, (.merged_at // ""), (.merge_commit_sha // "")] | @tsv']);
    if (!r.ok) {
      if (!answer.forge.reason) answer.forge.reason = r.line();
      continue;
    }
    answer.forge.answered = true;
    b.requests = r.out.split('\n').filter(Boolean).map((line) => {
      const [number, state, mergedAt, mergeCommit] = line.split('\t');
      return { number: Number.parseInt(number, 10) || null, state: text(state),
        merged: Boolean(mergedAt), mergeCommit: refOk(mergeCommit || '') ? mergeCommit : null,
        mergeInBase: null };
    });
    b.openRequest = b.requests.some((q) => q.state === 'open');
    for (const q of b.requests) {
      if (!q.merged || !q.mergeCommit || !answer.base.usable) continue;
      // Where the merge LANDED settles it. An object this repository does not carry makes
      // the check die rather than answer no, and that is unknown, not unmerged.
      if (!git(['rev-parse', '--verify', '-q', `${q.mergeCommit}^{commit}`]).ok) continue;
      q.mergeInBase = git(['merge-base', '--is-ancestor', q.mergeCommit, opts.baseRef]).ok;
    }
  }
  if (!answer.forge.answered && !answer.forge.reason) {
    answer.forge.reason = 'no branch had a tip to ask about';
  }
}

// --- the verdicts, once, after every reading is in
for (const b of answer.branches) {
  if (b.isDefault) b.keeps.push("it is this repository's default branch");
  // Checked out anywhere is kept, and git says the same: `branch -D` refuses a branch
  // another worktree holds. Whether that worktree goes in this same run is not this
  // script's to know — who is in it is `worktree-owners.mjs`'s answer — so the branch is
  // named with its worktree and deleted after that worktree is gone, or not at all.
  if (b.worktree) b.keeps.push(`it is checked out in a worktree: ${b.worktree}`);
  if (b.openRequest) b.keeps.push('a change request on its tip is still open');
  if (answer.forge.asked && b.openRequest === null) {
    b.unproven.push('the forge did not answer for this tip, so a squash merge would not show');
  }

  if (b.merged === true) b.proof = 'git';
  else if (b.requests && b.requests.some((q) => q.mergeInBase === true)) b.proof = 'forge';

  if (!b.proof) {
    const q = b.requests || [];
    if (b.merged === null) b.unproven.push('the base could not be read, so containment is unknown');
    else if (q.some((r) => r.merged && r.mergeInBase === false)) {
      b.unproven.push('a merged request carries its tip, and that merge is not in the base');
    } else if (q.some((r) => r.merged && r.mergeInBase === null)) {
      b.unproven.push('a merged request carries its tip, and where it landed cannot be read here');
    } else if (b.gone) {
      b.unproven.push('its upstream is gone and nothing proves it landed — it may hold the only copy');
    } else b.unproven.push(`it carries ${b.ownCommits ?? 'commits'} the base does not`);
  }

  // One rule, said once: something that must stay, stays; otherwise a proof deletes it
  // and the absence of one surfaces it. No other field is a second gate.
  b.verdict = b.keeps.length ? 'keep' : b.proof ? 'delete' : 'surface';
  b.class = b.verdict === 'delete' ? 2 : b.verdict === 'surface' ? 3 : null;

  // Tracking, for the branches that stay. The default branch points at the base; any
  // other whose upstream is gone drops it, because a ref that no longer exists is not
  // an upstream and `-d` silently measures containment against it. Recoverable either
  // way: the next `push -u` restores what the second one drops.
  if (b.verdict !== 'delete') {
    if (b.isDefault && answer.base.usable && b.upstreamRef !== answer.base.ref) {
      b.repair = 'set-upstream';
    } else if (b.gone && !b.isDefault) b.repair = 'unset-upstream';
  }
}

answer.read = true;
finish();
