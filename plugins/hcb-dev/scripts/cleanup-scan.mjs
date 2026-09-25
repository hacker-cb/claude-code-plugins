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
import { dirname, join } from 'node:path';
import { dirOk, forgeFor, nameSafe, refNameOk, refOk, repoOk, runner, text, worktrees, writeAll } from './lib/forge.mjs';

const USAGE = 'usage: node cleanup-scan.mjs [--default <name>] [--default-ref <ref>]'
  + ' [--repo-dir <path>] [--repo <owner/name>] [--no-forge]\n';
const die = (m) => { writeAll(2, `cleanup-scan: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { base: null, baseRef: null, repoDir: null, repo: null, forge: true, cli: null };
const FLAGS = { '--default': 'base', '--default-ref': 'baseRef',
  '--repo-dir': 'repoDir', '--repo': 'repo', '--forge': 'cli' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--no-forge') { opts.forge = false; continue; }
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i += 1];
}
if (opts.base && !refNameOk(opts.base)) die(`--default '${opts.base}' is not a branch name`);
if (opts.baseRef && !refOk(opts.baseRef)) die(`--default-ref '${opts.baseRef}' is not a ref`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);
if (opts.cli && !['gh', 'glab'].includes(opts.cli)) die(`--forge '${opts.cli}' is not gh or glab`);
// A ref to READ and a name to COMPARE are two values, and neither is the other trimmed:
// `${D#*/}` over a fully qualified ref yields `remotes/origin/master`, and the comparison
// guarding the default branch itself then never matches again.
if (opts.baseRef && !opts.base) {
  die('--default-ref needs --default: a ref to read and a name to compare are two values');
}

// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a forge that would not answer.
if (opts.repoDir && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);
const cwd = opts.repoDir || process.cwd();
const git = runner(cwd, 'git');

// `%(upstream)` is always fully qualified and `--default-ref` is however the caller spelled
// it, so `origin/master` and `refs/remotes/origin/master` are the same ref written two ways.
// Compared raw, a correctly tracking default branch is prescribed `set-upstream` on every
// run — a repair that changes nothing, reported forever.
const shortRef = (v) => String(v ?? '').replace(/^refs\/(remotes|heads)\//, '');
const sameRef = (a, b) => a !== null && b !== null && shortRef(a) === shortRef(b);

const answer = {
  read: false,
  // `usable: false` is "the merge question cannot be answered", which is not "nothing is
  // merged". Every branch surfaces then, and none is deleted.
  base: { name: opts.base, ref: opts.baseRef, usable: false },
  // `answered: false` beside `asked: true` is a forge that did not reply. The scan gets
  // NARROWER then, never wider: a squash-merged branch it cannot see stays standing.
  forge: { asked: false, cli: null, answered: false, reason: null },
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
  const t = { ...w, onDisk: null, parentOnDisk: null, dirty: null, submodules: null,
    modulesDir: null, blockers: [] };
  if (w.prunable) {
    // git's word for the registration, and its PROSE is free to change: `gitdir file
    // points to non-existent location` is what it writes for a worktree whose directory
    // was deleted — measured — while `gitdir file does not exist` names a directory that
    // may still be full of work. Matching either is matching wording. The paths are the
    // question, and it takes BOTH of them.
    t.onDisk = existsSync(w.path);
    t.parentOnDisk = existsSync(dirname(w.path));
    if (!t.onDisk && !t.parentOnDisk) {
      // The directory above it is gone too, which is what an unmounted volume looks
      // like — indistinguishable from a deleted worktree, and pruning it strands
      // whatever the volume still holds.
      t.blockers.push('its path and the directory above it both fail to answer, which is'
        + ' what an unmounted volume looks like');
    }
    if (!t.onDisk) {
      // Nothing here to read, whichever of the two it is: asking git about a directory
      // that is not there only produces failures to report.
      answer.worktrees.push(t);
      continue;
    }
    // The directory is there and git still calls the registration prunable, so a prune
    // would take a working tree that still exists.
    t.blockers.push('git calls it prunable although its path is still there');
  }
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
  answer.worktrees.push(t);
}

// --- the branches, in one pass
// A NUL between the fields and a COUNT, not a marker, for where each record ends. Any
// marker is a string some field can hold: a branch tracking a local branch named `R`
// prints exactly the sequence that used to separate records, which truncated its own
// record and invented one after it. Nothing can forge a boundary that is a count.
const SEP = '\u0000';
// Both forms of the upstream, because a ref and a name are two values: the short one
// is what a report says, and the full one is what compares against a ref — `origin/master`
// against `refs/remotes/origin/master` never matches, and the default branch then gets
// its tracking "repaired" on every run.
const FIELDS = ['%(refname:lstrip=2)', '%(objectname)', '%(worktreepath)',
  '%(upstream:short)', '%(upstream)', '%(upstream:track)'];
const format = (extra) => `${FIELDS.join('%00')}${extra}%00`;
// `ahead-behind` gives the count AND the containment in one pass — a branch is in the
// base exactly when it is ahead of it by nothing. It needs git 2.41 and a ref that
// resolves, so its absence is a fallback rather than a refusal.
const withCounts = answer.base.usable
  ? git(['for-each-ref', 'refs/heads/',
    `--format=${format(`%00%(ahead-behind:${opts.baseRef})`)}`])
  : { ok: false, out: '', line: () => 'no usable base' };
// One more field in the counted form, and the count is what says where a record ends.
const WIDE = FIELDS.length + (answer.base.usable && withCounts.ok ? 1 : 0);
const counted = withCounts.ok;
const listing = counted ? withCounts
  : git(['for-each-ref', 'refs/heads/', `--format=${format('')}`]);
if (!listing.ok) refuse(`could not list this repository's branches (${listing.line()})`);
if (answer.base.usable && !counted) {
  answer.notes.push('this git does not take `ahead-behind`, so containment is measured'
    + ' one branch at a time');
}

// `for-each-ref` ends every record with a newline of its own, which lands between the
// record's closing NUL and the next record's first field. Taken out here, so no field
// carries it and no field is trimmed for it.
const fields = listing.out.split(SEP).map((v, i) => (i === 0 ? v : v.replace(/^\n/, '')));
if (fields.length && fields[fields.length - 1] === '') fields.pop();
for (let at = 0; at + WIDE <= fields.length; at += WIDE) {
  const f = fields.slice(at, at + WIDE);
  // Not trimmed: the record-ending newline is taken out above, once, where it is a
  // structural thing rather than something a name carries. Trimming here as well
  // would make that pass redundant, and a redundant guard is one nothing holds.
  const name = f[0] || '';
  // By GIT's rules: `feature#123` and `feature%123` are branches a URL-segment class
  // refuses, and a sweep that cannot read them leaves them out of its own answer.
  if (!refNameOk(name)) {
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
    // git accepts `$ ( ) ; & | ' \" < >` in a branch name. `false` here does not stop the
    // branch being read — it says this name reaches a command through a VARIABLE, never
    // through the text of one.
    nameSafe: nameSafe(name),
    ownCommits: null, merged: null,
    requests: null, openRequest: null,
    proof: null, keeps: [], unproven: [], verdict: null, class: null,
    // What a branch that SURVIVES still needs done to it. A keep promises the branch
    // stays, never that nothing touches it.
    repair: null,
    // The worktree that is the ONLY thing keeping it, where there is one.
    freedBy: null,
  };
  if (counted) {
    const ahead = Number.parseInt((f[FIELDS.length] || '').trim().split(/\s+/)[0], 10);
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
  const found = forgeFor(cwd, opts.cli, opts.repo);
  const reader = found.reader;
  answer.forge.cli = found.cli;
  answer.forge.reason = found.reason;
  if (reader) {
    const forge = runner(cwd, answer.forge.cli);
    const { hostArgs } = found;
    for (const b of answer.branches) {
      if (!b.oid || !refOk(b.oid)) continue;
      // By TIP, never by name: a merged `fix/login` may have come from a fork, and the
      // local branch of that name may have been recreated since. `--paginate`, or an open
      // request on page two is one the sweep deletes over. The repository goes in the
      // PATH, because neither CLI's `api` takes a `--repo` — it would read the one the
      // working directory names and answer about somebody else's requests.
      const r = forge(['api', ...hostArgs, '--paginate', reader.path(opts.repo, b.oid)]);
      if (!r.ok) {
        if (!answer.forge.reason) answer.forge.reason = r.line();
        continue;
      }
      const rows = reader.read(r.out);
      if (rows === null) {
        if (!answer.forge.reason) answer.forge.reason = 'the answer was not JSON';
        continue;
      }
      answer.forge.answered = true;
      b.requests = rows.filter((q) => q && typeof q === 'object').map((q) => (
        { ...reader.row(q), mergeInBase: null }));
      b.openRequest = b.requests.some((q) => q.state === 'open');
      for (const q of b.requests) {
        if (q.state !== 'merged' || !q.mergeCommit || !answer.base.usable) continue;
        // Where the merge LANDED settles it. An object this repository does not carry
        // makes the check die rather than answer no — unknown, which is not unmerged.
        // `rev-parse` resolves a NAME as readily as an id, so a forge answering
        // `master` where a merge commit belongs would clear the guard and prove the
        // branch landed. An id is a prefix of what it resolves to; a name is not.
        const at = git(['rev-parse', '--verify', '-q', `${q.mergeCommit}^{commit}`]);
        if (!at.ok || !at.out.toLowerCase().startsWith(q.mergeCommit.toLowerCase())) continue;
        q.mergeInBase = git(['merge-base', '--is-ancestor', q.mergeCommit, opts.baseRef]).ok;
      }
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
  // script's to know — who is in it is `worktree-owners.mjs`'s answer — so the branch
  // says WHICH worktree holds it, and `freedBy` below says that is the only thing
  // holding it.
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
    else if (q.some((r) => r.state === 'merged' && r.mergeInBase === false)) {
      b.unproven.push('a merged request carries its tip, and that merge is not in the base');
    } else if (q.some((r) => r.state === 'merged' && r.mergeInBase === null)) {
      b.unproven.push('a merged request carries its tip, and where it landed cannot be read here');
    } else if (b.gone) {
      b.unproven.push('its upstream is gone and nothing proves it landed — it may hold the only copy');
    } else b.unproven.push(`it carries ${b.ownCommits ?? 'commits'} the base does not`);
  }

  // One rule, said once: something that must stay, stays; otherwise a proof deletes it
  // and the absence of one surfaces it. No other field is a second gate.
  b.verdict = b.keeps.length ? 'keep' : b.proof ? 'delete' : 'surface';
  b.class = b.verdict === 'delete' ? 2 : b.verdict === 'surface' ? 3 : null;
  // The common case, and the one a flat `keep` loses: a branch kept ONLY because a
  // worktree holds it, where that worktree is itself going. Remove the worktree, run
  // this again, and the branch answers `delete` on the proof it already has — so the
  // gate presents it with the deletions rather than among the things that stay.
  if (b.verdict === 'keep' && b.proof && b.keeps.length === 1 && b.worktree
    && b.keeps[0].endsWith(b.worktree)) {
    b.freedBy = b.worktree;
  }

  // Tracking, for the branches that stay. The default branch points at the base; any
  // other whose upstream is gone drops it, because a ref that no longer exists is not
  // an upstream and `-d` silently measures containment against it. Recoverable either
  // way: the next `push -u` restores what the second one drops.
  if (b.verdict !== 'delete') {
    if (b.isDefault && answer.base.usable && !sameRef(b.upstreamRef, answer.base.ref)) {
      b.repair = 'set-upstream';
    } else if (b.gone && !b.isDefault) b.repair = 'unset-upstream';
  }
}

// A worktree's own git state is not the whole of what keeps it: removing one destroys
// the working copy of whatever is checked out there, so a branch that must stay keeps
// its worktree too. The pass runs last, after every branch has a verdict, and adds only
// to the worktree — nothing above reads these, so there is no circle.
const byPath = new Map(answer.worktrees.map((w) => [w.path, w]));
for (const b of answer.branches) {
  const w = b.worktree ? byPath.get(b.worktree) : null;
  if (!w) continue;
  if (b.openRequest) {
    w.blockers.push(`a change request on its branch is still open: ${b.name}`);
  } else if (!b.proof) {
    // Never `verdict === 'surface'`: a branch with a worktree is kept BY that worktree,
    // so that test can only ever be false here. What the worktree turns on is whether
    // the branch has a proof at all.
    w.blockers.push(`its branch has no proof it landed: ${b.name}`);
  }
}

answer.read = true;
finish();
