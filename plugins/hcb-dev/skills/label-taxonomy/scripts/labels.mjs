#!/usr/bin/env node
// labels.mjs — read a repository's label set and every carrier of it, and check a proposed set and
// a relabelling plan against what was read. Prints JSON. It reads and checks; writing a label onto a
// carrier is `scripts/label-write.mjs`'s.
//
// usage:
//   node labels.mjs snapshot --out <file> [--forge gh|glab] [--host <host>] [--repo <path>] [--repo-dir <path>]
//   node labels.mjs check-set --snapshot <file> --plan <file>
//   node labels.mjs check-roles --snapshot <file> --roles <file> [--plan <file>] [--rows <dir> --population issues|requests|all]
//   node labels.mjs verify --snapshot <file> --plan <file>
//
// `snapshot` writes the set, the default branch, every issue and every change request with its
// labels to --out, and prints what it read: `read`, `complete` (false where a listing came back
// short or cut), `unavailable` (what this forge or server does not carry), `reason`.
//
// The plan (`--plan`) is JSON: { "create": [{ "name", "color", "description" }],
// "edit": [{ "name", "newName"?, "color"?, "description"? }], "delete": [name],
// "relabel": [{ "kind": "issue"|"request", "number", "add": [name], "remove": [name] }] }, a colour
// six hex digits without `#`. The roles (`--roles`) are JSON: { "families": [{ "prefix", "leaf": [min,
// max|null], "parent": [...], "request": [...], "whileOpen": bool? }], "skip": [name], "nativeKind":
// "<prefix>"? } — the prefix whose role a native type may carry instead.
//
// Exit: 0 whenever an answer is printed; 2 called wrong.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dirOk, failureOf, hostOk, parsePages, projectPathOk, repoOk, resolveRepository, runner, text, writeAll,
} from '../../../scripts/lib/forge.mjs';

const usage = 'usage: node labels.mjs <snapshot|check-set|check-roles|verify> [flags] — see the header of this file';
const die = (msg) => { writeAll(2, `labels: ${msg}\n${usage}\n`); process.exit(2); };

const SPEC = {
  snapshot: ['--out', '--forge', '--host', '--repo', '--repo-dir'],
  'check-set': ['--snapshot', '--plan'],
  'check-roles': ['--snapshot', '--roles', '--plan', '--rows', '--population'],
  verify: ['--snapshot', '--plan'],
};
const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !Object.hasOwn(SPEC, cmd)) die(`the first word is one of ${Object.keys(SPEC).join(', ')}`);
const opts = {};
for (let i = 0; i < rest.length; i += 1) {
  const flag = rest[i];
  if (!SPEC[cmd].includes(flag)) die(`${cmd} takes no ${flag}`);
  if (i + 1 >= rest.length || rest[i + 1] === '') die(`${flag} takes a value`);
  if (Object.hasOwn(opts, flag)) die(`${flag} given twice`);
  opts[flag] = rest[i += 1];
}
const out = (answer) => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const readJson = (file, flag) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return die(`${flag} '${file}' is not a JSON file`); }
};
const nameOk = (n) => typeof n === 'string' && n !== '' && n.trim() === n && [...n].length <= 255;

// ---------------------------------------------------------------- snapshot
function snapshot() {
  if (!opts['--out']) die('snapshot takes --out <file>');
  const dir = opts['--repo-dir'] ?? process.cwd();
  if (!dirOk(dir)) die(`--repo-dir '${dir}' is not a directory`);
  const forgeArg = opts['--forge'] ?? null;
  if (forgeArg !== null && forgeArg !== 'gh' && forgeArg !== 'glab') die('--forge takes gh or glab');
  if (opts['--host'] && !hostOk(opts['--host'])) die('--host takes a forge host');
  if (opts['--repo'] && !projectPathOk(opts['--repo'])) die(`--repo '${opts['--repo']}' is not a repository path`);
  if (opts['--repo'] && forgeArg === null) die('--repo takes --forge with it');
  if (opts['--repo'] && forgeArg === 'gh' && !repoOk(opts['--repo'])) die('--repo on GitHub takes owner/name');

  const answer = { read: false, complete: null, forge: null, host: null, path: null, file: opts['--out'], counts: null, unavailable: [], reason: null };
  const resolved = resolveRepository({ dir, forge: forgeArg, host: opts['--host'] ?? null, repo: opts['--repo'] ?? null });
  if (resolved.reason) out({ ...answer, reason: text(resolved.reason) });
  const { forge, host, path } = resolved;
  Object.assign(answer, { forge, host, path });
  const cli = runner(dir, forge);
  const shortfalls = [];
  const unread = (what, r) => out({ ...answer, reason: text(`could not read ${what}: ${failureOf(r)}`) });

  // A REST listing to its last page.
  const rest = (what, endpoint) => {
    const r = cli(['api', '--hostname', host, '--paginate', endpoint], 300000);
    if (!r.ok) unread(what, r);
    const pages = parsePages(r.out);
    if (!pages || pages.some((p) => !Array.isArray(p))) out({ ...answer, reason: `${what} answered with something that is not a list` });
    return pages.flat();
  };
  const one = (what, endpoint) => {
    const r = cli(['api', '--hostname', host, endpoint], 60000);
    if (!r.ok) unread(what, r);
    try { return JSON.parse(r.out); } catch { return out({ ...answer, reason: `${what} answered with something that is not JSON` }); }
  };

  const snap = { forge, host, path, readAt: new Date().toISOString(), defaultBranch: null, set: [], issues: [], requests: [], unavailable: [] };
  const enc = encodeURIComponent(path);

  if (forge === 'gh') {
    snap.defaultBranch = one('the repository', `repos/${path}`)?.default_branch ?? null;
    snap.set = rest('the label set', `repos/${path}/labels?per_page=100`).map((l) => ({
      name: l.name, id: l.id ?? null, color: l.color ?? null, description: l.description ?? null,
      archived: Boolean(l.archived_at), inherited: false,
    }));
    const [owner, name] = path.split('/');
    // GraphQL to its last page; a field the server lacks is dropped once, and named.
    const walk = (what, build, pick) => {
      const items = [];
      let fields = { children: true, type: true };
      let after = null;
      let total = null;
      for (let page = 0; page < 10000; page += 1) {
        const q = build(fields);
        const args = ['api', 'graphql', '--hostname', host, '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `query=${q}`];
        if (after) args.push('-f', `after=${after}`);
        const r = cli(args, 120000);
        let v = null;
        try { v = JSON.parse(r.out); } catch { /* read below */ }
        const errors = (v?.errors ?? []).map((e) => String(e?.message ?? ''));
        const missing = errors.find((m) => /subIssuesSummary|issueType/.test(m) && /doesn't exist|undefined field|not exist/i.test(m));
        if (missing && page === 0 && (fields.children || fields.type)) {
          if (/subIssuesSummary/.test(missing)) { fields = { ...fields, children: false }; snap.unavailable.push('sub-issue counts'); }
          if (/issueType/.test(missing)) { fields = { ...fields, type: false }; snap.unavailable.push('native issue types'); }
          page -= 1;
          continue;
        }
        const conn = pick(v?.data?.repository);
        if (!r.ok && !conn) unread(what, r);
        if (!conn) out({ ...answer, reason: text(`${what} answered without its list${errors.length ? ` — ${errors.join('; ')}` : ''}`) });
        if (errors.length) shortfalls.push(`${what}: ${errors.join('; ')}`);
        total ??= conn.totalCount;
        items.push(...conn.nodes);
        if (!conn.pageInfo?.hasNextPage) break;
        if (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === after) { shortfalls.push(`${what}: the cursor did not advance`); break; }
        after = conn.pageInfo.endCursor;
      }
      if (total !== null && items.length !== total) shortfalls.push(`${what}: ${items.length} of ${total} read`);
      return items;
    };
    const labelsOf = (n, what) => {
      if (n.labels.totalCount > n.labels.nodes.length) shortfalls.push(`${what} ${n.number}: its labels are cut`);
      return n.labels.nodes.map((l) => l.name);
    };
    snap.issues = walk('issues', (f) => `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){
      issues(first:100,after:$after,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor}
      nodes{number id state stateReason author{__typename login} labels(first:100){totalCount nodes{name}}
      ${f.children ? 'subIssuesSummary{total}' : ''} ${f.type ? 'issueType{name}' : ''}
      closedByPullRequestsReferences(first:25,includeClosedPrs:true){totalCount nodes{number}}}}}}`,
    (repo) => repo?.issues).map((n) => ({
      number: n.number, id: n.id, state: n.state === 'OPEN' ? 'open' : 'closed', reason: n.stateReason ?? null,
      bot: n.author?.__typename === 'Bot', labels: labelsOf(n, 'issue'),
      children: n.subIssuesSummary ? n.subIssuesSummary.total : null, type: n.issueType?.name ?? null,
      closedBy: n.closedByPullRequestsReferences.totalCount > n.closedByPullRequestsReferences.nodes.length
        ? null : n.closedByPullRequestsReferences.nodes.map((p) => p.number),
    }));
    snap.requests = walk('pull requests', () => `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){
      pullRequests(first:100,after:$after,states:[OPEN,MERGED,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor}
      nodes{number id state baseRefName author{__typename login} labels(first:100){totalCount nodes{name}}}}}}`,
    (repo) => repo?.pullRequests).map((n) => ({
      number: n.number, id: n.id, state: n.state.toLowerCase(), base: n.baseRefName,
      bot: n.author?.__typename === 'Bot', labels: labelsOf(n, 'pull request'),
    }));
  } else {
    snap.defaultBranch = one('the project', `projects/${enc}`)?.default_branch ?? null;
    snap.set = rest('the label set', `projects/${enc}/labels?per_page=100&include_ancestor_groups=true&with_counts=true`).map((l) => ({
      name: l.name, id: l.id ?? null, color: typeof l.color === 'string' ? l.color.replace(/^#/, '') : null,
      description: l.description ?? null, archived: l.archived === true, inherited: l.is_project_label === false,
    }));
    snap.issues = rest('issues', `projects/${enc}/issues?state=all&per_page=100&scope=all`).map((i) => ({
      number: i.iid, id: i.id, state: i.state === 'opened' ? 'open' : 'closed', reason: null,
      bot: null, labels: Array.isArray(i.labels) ? i.labels : [], children: null, type: i.issue_type ?? i.type ?? null, closedBy: null,
    }));
    snap.requests = rest('merge requests', `projects/${enc}/merge_requests?state=all&per_page=100&scope=all`).map((m) => ({
      number: m.iid, id: m.id, state: m.state === 'opened' ? 'open' : m.state, base: m.target_branch,
      bot: null, labels: Array.isArray(m.labels) ? m.labels : [],
    }));
    snap.unavailable.push('sub-issue counts', 'bot authors', 'the change request that closed an issue');
  }

  snap.complete = shortfalls.length === 0;
  try { writeFileSync(opts['--out'], `${JSON.stringify(snap, null, 1)}\n`); } catch {
    out({ ...answer, reason: `could not write ${opts['--out']}` });
  }
  out({
    ...answer, read: true, complete: shortfalls.length === 0, unavailable: snap.unavailable,
    counts: { labels: snap.set.length, issues: snap.issues.length, requests: snap.requests.length },
    reason: shortfalls.length ? text(shortfalls.join('; ')) : null,
  });
}

// ---------------------------------------------------------------- plan and snapshot readers
const loadSnapshot = () => {
  if (!opts['--snapshot']) die(`${cmd} takes --snapshot <file>`);
  const s = readJson(opts['--snapshot'], '--snapshot');
  if (!s || !Array.isArray(s.set) || !Array.isArray(s.issues) || !Array.isArray(s.requests) || (s.forge !== 'gh' && s.forge !== 'glab')) {
    die('--snapshot is not a file `snapshot` wrote');
  }
  return s;
};
const loadPlan = (required) => {
  if (!opts['--plan']) { if (required) die(`${cmd} takes --plan <file>`); return { create: [], edit: [], delete: [], relabel: [] }; }
  const p = readJson(opts['--plan'], '--plan');
  const plan = { create: p?.create ?? [], edit: p?.edit ?? [], delete: p?.delete ?? [], relabel: p?.relabel ?? [] };
  if (![plan.create, plan.edit, plan.delete, plan.relabel].every(Array.isArray)) die('--plan: create, edit, delete and relabel are lists');
  for (const c of plan.create) if (!nameOk(c?.name)) die('--plan: a create without a label name');
  for (const e of plan.edit) if (!nameOk(e?.name) || (e.newName !== undefined && !nameOk(e.newName))) die('--plan: an edit without label names');
  for (const d of plan.delete) if (!nameOk(d)) die('--plan: a delete that is not a label name');
  for (const r of plan.relabel) {
    if ((r?.kind !== 'issue' && r?.kind !== 'request') || !Number.isInteger(r.number) || r.number < 1
      || ![r.add ?? [], r.remove ?? []].every((l) => Array.isArray(l) && l.every(nameOk))) die('--plan: a relabel row is { kind, number, add, remove }');
  }
  return plan;
};
const sameAs = (forge) => (forge === 'gh' ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b);

// The labels a carrier holds once the plan's renames and its own row are applied.
const afterPlan = (snap, plan) => {
  const same = sameAs(snap.forge);
  const renames = plan.edit.filter((e) => e.newName !== undefined);
  const rename = (n) => renames.find((e) => same(e.name, n))?.newName ?? n;
  const rows = new Map(plan.relabel.map((r) => [`${r.kind}:${r.number}`, r]));
  const apply = (kind) => (c) => {
    const row = rows.get(`${kind}:${c.number}`);
    let labels = c.labels.map(rename);
    if (row) {
      labels = labels.filter((l) => !(row.remove ?? []).some((n) => same(rename(n), l)));
      for (const n of row.add ?? []) if (!labels.some((l) => same(l, rename(n)))) labels.push(rename(n));
    }
    return { ...c, labels };
  };
  return { issues: snap.issues.map(apply('issue')), requests: snap.requests.map(apply('request')) };
};

// ---------------------------------------------------------------- check-set
function checkSet() {
  const snap = loadSnapshot();
  const plan = loadPlan(true);
  const same = sameAs(snap.forge);
  const problems = [];
  const flag = (op, name, problem) => problems.push({ op, name, problem });
  const held = (n) => snap.set.find((l) => same(l.name, n));
  const colourOk = (c) => typeof c === 'string' && /^[0-9a-fA-F]{6}$/.test(c);
  const descOk = (d) => d === undefined || d === null || (typeof d === 'string' && (snap.forge !== 'gh' || [...d].length <= 100));

  for (const c of plan.create) {
    if (held(c.name)) flag('create', c.name, 'already in the set');
    if (!colourOk(c.color)) flag('create', c.name, 'the colour is not six hex digits without #');
    if (!descOk(c.description)) flag('create', c.name, 'the description is over 100 characters, GitHub\'s limit');
    if (snap.forge === 'glab' && c.name.includes(',')) flag('create', c.name, 'GitLab refuses a comma in a label name');
  }
  const renamed = new Set();
  for (const e of plan.edit) {
    const l = held(e.name);
    if (!l) { flag('edit', e.name, 'not in the set'); continue; }
    if (l.inherited) flag('edit', e.name, 'a label its group passes down: the project cannot change it');
    if (e.color !== undefined && !colourOk(e.color)) flag('edit', e.name, 'the colour is not six hex digits without #');
    if (!descOk(e.description)) flag('edit', e.name, 'the description is over 100 characters, GitHub\'s limit');
    if (e.newName !== undefined) {
      if (snap.forge === 'glab' && e.newName.includes(',')) flag('edit', e.name, 'GitLab refuses a comma in a label name');
      renamed.add(e.name);
    }
  }
  // A rename lands on a free name: not one the set keeps, not one another rename or a create takes.
  // A rename chain or cycle — one label taking a name another is leaving — is refused whole: the
  // order that would make it safe is not the plan's to guess.
  const renames = plan.edit.filter((e) => e.newName !== undefined);
  for (const e of renames) {
    const target = held(e.newName);
    if (target && !same(target.name, e.name)) {
      flag('edit', e.name, renames.some((o) => same(o.name, e.newName)) ? 'renames into a name another rename is leaving: a chain or a cycle' : `renames into ${e.newName}, which the set keeps`);
    }
    if (renames.filter((o) => same(o.newName, e.newName)).length > 1) flag('edit', e.name, `two renames take ${e.newName}`);
    if (plan.create.some((c) => same(c.name, e.newName))) flag('edit', e.name, `a create takes ${e.newName} too`);
  }
  // A deletion stands only on carriers read whole, and only where the plan takes the label off each.
  const after = afterPlan(snap, plan);
  for (const d of plan.delete) {
    const l = held(d);
    if (!l) { flag('delete', d, 'not in the set'); continue; }
    if (l.inherited) flag('delete', d, 'a label its group passes down: the project cannot delete it');
    if (snap.complete === false) flag('delete', d, 'the snapshot read the carriers short, so who holds it is unread');
    const holders = [...after.issues.map((c) => ({ kind: 'issue', c })), ...after.requests.map((c) => ({ kind: 'request', c }))]
      .filter(({ c }) => c.labels.some((n) => same(n, d)));
    if (holders.length) flag('delete', d, `still on ${holders.slice(0, 10).map(({ kind, c }) => `${kind} ${c.number}`).join(', ')}${holders.length > 10 ? ` and ${holders.length - 10} more` : ''}`);
  }
  for (const r of plan.relabel) {
    for (const n of r.add ?? []) {
      const known = held(n) && !held(n).archived;
      const coming = plan.create.some((c) => same(c.name, n)) || renames.some((e) => same(e.newName, n));
      if (!known && !coming) flag('relabel', n, `added to ${r.kind} ${r.number}, and neither in the set nor created by the plan`);
      if (plan.delete.some((d) => same(d, n))) flag('relabel', n, `added to ${r.kind} ${r.number} and deleted by the same plan`);
    }
    const where = r.kind === 'issue' ? snap.issues : snap.requests;
    if (!where.some((c) => c.number === r.number)) flag('relabel', `${r.kind} ${r.number}`, 'no such carrier in the snapshot');
  }
  out({ ok: problems.length === 0, forge: snap.forge, problems });
}

// ---------------------------------------------------------------- check-roles
function checkRoles() {
  const snap = loadSnapshot();
  const plan = loadPlan(false);
  if (!opts['--roles']) die('check-roles takes --roles <file>');
  const roles = readJson(opts['--roles'], '--roles');
  const range = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && v[0] >= 0 && (v[1] === null || (Number.isInteger(v[1]) && v[1] >= v[0]));
  if (!Array.isArray(roles?.families) || !roles.families.every((f) => typeof f?.prefix === 'string' && f.prefix !== ''
    && range(f.leaf) && range(f.parent) && range(f.request))) {
    die('--roles: families are { prefix, leaf: [min, max|null], parent: [...], request: [...] }');
  }
  const skip = Array.isArray(roles.skip) ? roles.skip : [];
  const same = sameAs(snap.forge);
  const after = afterPlan(snap, plan);
  const violations = [];
  const skipped = (c) => c.bot === true || c.labels.some((l) => skip.some((s) => same(s, l)));

  const check = (kind, c, place) => {
    for (const f of roles.families) {
      let n = c.labels.filter((l) => l.startsWith(f.prefix)).length;
      if (roles.nativeKind === f.prefix && c.type) n += 1;
      let [min, max] = f[place];
      if (f.whileOpen && c.state !== 'open') { min = 0; max = 0; }
      if (n < min || (max !== null && n > max)) violations.push({ kind, number: c.number, place, family: f.prefix, count: n, want: [min, max] });
    }
  };
  for (const c of after.issues) {
    if (skipped(c)) continue;
    check('issue', c, c.children ? 'parent' : 'leaf');
  }
  const intoDefault = (c) => snap.defaultBranch !== null && c.base === snap.defaultBranch;
  for (const c of after.requests) {
    if (skipped(c) || !intoDefault(c) || c.state === 'closed') continue;
    check('request', c, 'request');
  }

  let coverage = null;
  if (opts['--rows'] !== undefined) {
    const population = opts['--population'];
    if (!['issues', 'requests', 'all'].includes(population)) die('--rows takes --population issues|requests|all');
    if (!dirOk(opts['--rows'])) die(`--rows '${opts['--rows']}' is not a directory`);
    const seen = new Map();
    const bad = [];
    for (const f of readdirSync(opts['--rows'])) {
      if (!f.endsWith('.jsonl')) continue;
      for (const [i, line] of readFileSync(join(opts['--rows'], f), 'utf8').split('\n').entries()) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { bad.push(`${f}:${i + 1}`); continue; }
        if ((row?.kind !== 'issue' && row?.kind !== 'request') || !Number.isInteger(row.number)) { bad.push(`${f}:${i + 1}`); continue; }
        const key = `${row.kind} ${row.number}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    const want = [
      ...(population !== 'requests' ? snap.issues.filter((c) => !skipped(c)).map((c) => `issue ${c.number}`) : []),
      ...(population !== 'issues' ? snap.requests.filter((c) => !skipped(c) && intoDefault(c) && c.state !== 'closed').map((c) => `request ${c.number}`) : []),
    ];
    coverage = {
      missing: want.filter((k) => !seen.has(k)),
      twice: [...seen].filter(([, n]) => n > 1).map(([k]) => k),
      extra: [...seen.keys()].filter((k) => !want.includes(k)),
      unreadable: bad,
    };
  }
  out({
    ok: violations.length === 0 && (!coverage || Object.values(coverage).every((l) => l.length === 0)),
    forge: snap.forge, violations, coverage,
  });
}

// ---------------------------------------------------------------- verify
function verify() {
  const snap = loadSnapshot();
  const plan = loadPlan(true);
  const same = sameAs(snap.forge);
  const mismatches = [];
  const want = (what, problem) => mismatches.push({ what, problem });
  const held = (n) => snap.set.find((l) => same(l.name, n));
  for (const c of plan.create) {
    const l = held(c.name);
    if (!l) want(c.name, 'not created');
    else if (l.color?.toLowerCase() !== c.color.toLowerCase() || (c.description ?? null) !== (l.description ?? null)) want(c.name, 'created, but not as planned');
  }
  for (const e of plan.edit) {
    const name = e.newName ?? e.name;
    const l = held(name);
    if (!l) { want(name, e.newName !== undefined ? 'not renamed' : 'not in the set'); continue; }
    if (e.newName !== undefined && held(e.name) && !same(e.name, e.newName)) want(e.name, 'still in the set beside its new name');
    if (e.color !== undefined && l.color?.toLowerCase() !== e.color.toLowerCase()) want(name, 'the colour is not the planned one');
    if (e.description !== undefined && (l.description ?? null) !== (e.description ?? null)) want(name, 'the description is not the planned one');
  }
  for (const d of plan.delete) if (held(d)) want(d, 'not deleted');
  for (const r of plan.relabel) {
    const c = (r.kind === 'issue' ? snap.issues : snap.requests).find((x) => x.number === r.number);
    if (!c) { want(`${r.kind} ${r.number}`, 'not in the snapshot'); continue; }
    for (const n of r.add ?? []) if (!c.labels.some((l) => same(l, n))) want(`${r.kind} ${r.number}`, `does not hold ${n}`);
    for (const n of r.remove ?? []) if (c.labels.some((l) => same(l, n))) want(`${r.kind} ${r.number}`, `still holds ${n}`);
  }
  out({ ok: mismatches.length === 0 && snap.complete !== false, forge: snap.forge, mismatches });
}

({ snapshot, 'check-set': checkSet, 'check-roles': checkRoles, verify })[cmd]();
