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
// `snapshot` writes the set, the default branch, and every carrier with its labels to --out —
// issues (GitLab: every work item), change requests, and discussions where GitHub keeps them; an
// issue with `parent` (it has children) and `closedBy`, the full references of the requests that
// close it. It prints what it read: `read`, `complete` (false where a listing came back short or
// cut), `unavailable` (what this forge or server does not carry), `reason`. `check-roles` and
// `verify` answer `complete` too: nothing a snapshot read short says is the whole.
// `check-roles` lists under `bothWays` each carrier whose kind stands in a native type and a label
// both: whether the two agree is the reader's to judge.
//
// The plan (`--plan`) is JSON: { "create": [{ "name", "color", "description" }],
// "edit": [{ "name", "newName"?, "color"?, "description"? }], "delete": [name],
// "relabel": [{ "kind": "issue"|"request", "number", "add": [name], "remove": [name] }] }, a colour
// six hex digits without `#`. The roles (`--roles`) are JSON: { "families": [{ "prefix", "leaf": [min,
// max|null], "parent": [...], "request": [...], "whileOpen": bool? }], "skip": [name], "nativeKind":
// "<prefix>"?, "nativeTypes": [name]?, "parentLabel": name? }: `nativeKind` the prefix whose role a
// native type may carry instead — any GitHub issue type, or only the types `nativeTypes` names (on
// GitLab only those, every work item having a type by being one); `parentLabel` the label that marks
// a parent where the server carries no hierarchy.
//
// Exit: 0 whenever an answer is printed; 2 called wrong.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dirOk, hostOk, labelNameOk, parsePages, projectPathOk, repoOk, resolveRepository, runner, sameLabel, text, why, writeAll,
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
  if (i + 1 >= rest.length || rest[i + 1] === '' || rest[i + 1].startsWith('--')) die(`${flag} takes a value`);
  if (Object.hasOwn(opts, flag)) die(`${flag} given twice`);
  opts[flag] = rest[i += 1];
}
const out = (answer) => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const readJson = (file, flag) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return die(`${flag} '${file}' is not a JSON file`); }
};

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
  // `gh repo view` without a repository asks the CLI's own default host, never the one named.
  if (forgeArg === 'gh' && opts['--host'] && !opts['--repo']) die('--host on GitHub takes --repo with it');
  if (opts['--repo'] && forgeArg === 'gh' && !repoOk(opts['--repo'])) die('--repo on GitHub takes owner/name');

  const answer = { read: false, complete: null, forge: null, host: null, path: null, file: opts['--out'], counts: null, unavailable: [], reason: null };
  const resolved = resolveRepository({ dir, forge: forgeArg, host: opts['--host'] ?? null, repo: opts['--repo'] ?? null });
  if (resolved.reason) out({ ...answer, reason: text(resolved.reason) });
  const { forge, host, path } = resolved;
  Object.assign(answer, { forge, host, path });
  const cli = runner(dir, forge);
  const shortfalls = [];
  const unread = (what, r) => out({ ...answer, reason: text(`could not read ${what}: ${why(r)}`) });

  const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
  const one = (what, endpoint) => {
    const r = cli(['api', '--hostname', host, endpoint], 60000);
    if (!r.ok) unread(what, r);
    return parse(r) ?? out({ ...answer, reason: `${what} answered with something that is not JSON` });
  };
  // A GraphQL listing to its last page, one call a page: a whole listing in one answer outgrows
  // what a child process may hand back. Variables go as -f, a string each: -F would read a
  // number, a boolean or an `@file` out of an owner's name.
  const walk = (what, query, vars, pick) => {
    const items = [];
    let after = null;
    let total = null;
    for (let page = 0; ; page += 1) {
      if (page === 10000) { shortfalls.push(`${what}: stopped after ${page} pages`); break; }
      const args = ['api', 'graphql', '--hostname', host, '-f', `query=${query}`];
      for (const [k, v] of Object.entries({ ...vars, ...(after ? { after } : {}) })) args.push('-f', `${k}=${v}`);
      const r = cli(args, 120000);
      const v = parse(r);
      const errors = (Array.isArray(v?.errors) ? v.errors : []).map((e) => String(e?.message ?? ''));
      const conn = pick(v?.data);
      if (!conn || !Array.isArray(conn.nodes)) {
        if (!r.ok) unread(what, r);
        out({ ...answer, reason: text(`${what} answered without its list${errors.length ? ` — ${errors.join('; ')}` : ''}`) });
      }
      if (errors.length) shortfalls.push(`${what}: ${errors.join('; ')}`);
      total ??= Number.isInteger(conn.totalCount) ? conn.totalCount : (Number.isInteger(conn.count) ? conn.count : null);
      // A node the server could not resolve comes back null beside an error: it is not read.
      items.push(...conn.nodes.filter((n) => n && typeof n === 'object'));
      if (!conn.pageInfo?.hasNextPage) break;
      if (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === after) { shortfalls.push(`${what}: the cursor did not advance`); break; }
      after = conn.pageInfo.endCursor;
    }
    if (total === null || items.length !== total) shortfalls.push(`${what}: ${items.length} of ${total ?? 'an unknown number'} read`);
    return items;
  };
  // A carrier's labels, or none and a shortfall where they came back cut or not at all.
  const labelsOf = (conn, what, key, total) => {
    const nodes = Array.isArray(conn?.nodes) ? conn.nodes.filter((l) => typeof l?.[key] === 'string') : null;
    if (!nodes) { shortfalls.push(`${what}: its labels are unread`); return []; }
    if (!Number.isInteger(conn[total]) || conn[total] > nodes.length) shortfalls.push(`${what}: its labels are cut`);
    return nodes.map((l) => l[key]);
  };

  // The requests that close an issue: null where the server carries none, or where the list came
  // back cut or with an entry unread — a short read.
  const closers = (asked, conn, what, ref) => {
    if (!asked) return null;
    const refs = Array.isArray(conn?.nodes) ? conn.nodes.map(ref) : null;
    const total = Number.isInteger(conn?.totalCount) ? conn.totalCount : conn?.count;
    if (!refs || refs.includes(null) || !Number.isInteger(total) || total > refs.length) {
      shortfalls.push(`${what}: its closing requests are cut`);
      return null;
    }
    return refs;
  };

  const snap = { forge, host, path, readAt: new Date().toISOString(), defaultBranch: null, set: [], issues: [], requests: [], discussions: [], unavailable: [] };
  const enc = encodeURIComponent(path);
  const setOf = (what, endpoint) => {
    const r = cli(['api', '--hostname', host, '--paginate', endpoint], 300000);
    if (!r.ok) unread(what, r);
    const pages = parsePages(r.out);
    if (!pages || pages.some((p) => !Array.isArray(p))) out({ ...answer, reason: `${what} answered with something that is not a list` });
    return pages.flat();
  };

  if (forge === 'gh') {
    const repo = one('the repository', `repos/${path}`);
    snap.defaultBranch = repo?.default_branch ?? null;
    snap.set = setOf('the label set', `repos/${path}/labels?per_page=100`).map((l) => ({
      name: l.name, id: l.id ?? null, color: l.color ?? null, description: l.description ?? null,
      archived: Boolean(l.archived_at), inherited: false,
    }));
    // What this server's schema carries, asked once: a field it lacks fails the whole query.
    const schema = cli(['api', 'graphql', '--hostname', host, '-f', 'query={issue:__type(name:"Issue"){fields{name args{name}}}}'], 60000);
    const fields = parse(schema)?.data?.issue?.fields;
    if (!Array.isArray(fields)) {
      if (!schema.ok) unread('the schema', schema);
      out({ ...answer, reason: 'the schema answered without the fields of an issue' });
    }
    const has = (field, arg) => fields.some((x) => x?.name === field && (!arg || x.args?.some((a) => a?.name === arg)));
    const f = {
      children: has('subIssuesSummary'), type: has('issueType'), reason: has('stateReason'),
      closedBy: has('closedByPullRequestsReferences', 'includeClosedPrs'),
    };
    if (!f.children) snap.unavailable.push('sub-issue counts');
    if (!f.type) snap.unavailable.push('native issue types');
    if (!f.reason) snap.unavailable.push('the reason an issue closed');
    if (!f.closedBy) snap.unavailable.push('the change request that closed an issue');
    const [owner, name] = path.split('/');
    const vars = { owner, name };
    const head = 'query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){';
    const labels = 'labels(first:100){totalCount nodes{name}}';
    snap.issues = walk('issues', `${head}
      issues(first:100,after:$after,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor}
      nodes{number id state author{__typename} ${labels} ${f.reason ? 'stateReason' : ''}
      ${f.children ? 'subIssuesSummary{total}' : ''} ${f.type ? 'issueType{name}' : ''}
      ${f.closedBy ? 'closedByPullRequestsReferences(first:100,includeClosedPrs:true){totalCount nodes{number repository{nameWithOwner}}}' : ''}}}}}`,
    vars, (d) => d?.repository?.issues).map((n) => {
      const children = Number.isInteger(n.subIssuesSummary?.total) ? n.subIssuesSummary.total : null;
      return {
        number: n.number, id: n.id, state: n.state === 'OPEN' ? 'open' : 'closed', reason: n.stateReason ?? null,
        bot: n.author?.__typename === 'Bot', labels: labelsOf(n.labels, `issue ${n.number}`, 'name', 'totalCount'),
        children, parent: children === null ? null : children > 0, type: n.issueType?.name ?? null,
        closedBy: closers(f.closedBy, n.closedByPullRequestsReferences, `issue ${n.number}`,
          (p) => (typeof p?.repository?.nameWithOwner === 'string' && Number.isInteger(p.number) ? `${p.repository.nameWithOwner}#${p.number}` : null)),
      };
    });
    snap.requests = walk('pull requests', `${head}
      pullRequests(first:100,after:$after,states:[OPEN,MERGED,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor}
      nodes{number id state baseRefName author{__typename} ${labels}}}}}`,
    vars, (d) => d?.repository?.pullRequests).map((n) => ({
      number: n.number, id: n.id, state: String(n.state).toLowerCase(), base: n.baseRefName,
      bot: n.author?.__typename === 'Bot', labels: labelsOf(n.labels, `pull request ${n.number}`, 'name', 'totalCount'),
    }));
    // Discussions carry labels too, where the repository keeps them.
    if (repo?.has_discussions === true) {
      snap.discussions = walk('discussions', `${head}
        discussions(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{number id ${labels}}}}}`,
      vars, (d) => d?.repository?.discussions).map((n) => ({
        number: n.number, id: n.id, labels: labelsOf(n.labels, `discussion ${n.number}`, 'name', 'totalCount'),
      }));
    }
  } else {
    snap.defaultBranch = one('the project', `projects/${enc}`)?.default_branch ?? null;
    snap.set = setOf('the label set', `projects/${enc}/labels?per_page=100&include_ancestor_groups=true`).map((l) => ({
      name: l.name, id: l.id ?? null, color: typeof l.color === 'string' ? l.color.replace(/^#/, '') : null,
      description: l.description ?? null, archived: l.archived === true, inherited: l.is_project_label === false,
    }));
    const schema = cli(['api', 'graphql', '--hostname', host, '-f', 'query={dev:__type(name:"WorkItemWidgetDevelopment"){fields{name}}}'], 60000);
    const dev = parse(schema)?.data;
    if (!dev || typeof dev !== 'object') {
      if (!schema.ok) unread('the schema', schema);
      out({ ...answer, reason: 'the schema answered without its types' });
    }
    const closing = Array.isArray(dev.dev?.fields) && dev.dev.fields.some((x) => x?.name === 'closingMergeRequests');
    if (!closing) snap.unavailable.push('the change request that closed an issue');
    snap.unavailable.push('the reason an issue closed');
    const vars = { fullPath: path };
    const head = 'query($fullPath:ID!,$after:String){project(fullPath:$fullPath){';
    const labels = 'labels(first:100){count nodes{title}}';
    // Every work item type the project holds — issues, incidents, tasks — carries labels.
    snap.issues = walk('work items', `${head}
      workItems(first:100,after:$after,sort:CREATED_ASC){count pageInfo{hasNextPage endCursor}
      nodes{iid id state workItemType{name} author{bot} widgets{type ... on WorkItemWidgetLabels{${labels}}
      ... on WorkItemWidgetHierarchy{hasChildren children(first:1){count}}
      ${closing ? '... on WorkItemWidgetDevelopment{closingMergeRequests(first:100){count nodes{mergeRequest{reference(full:true)}}}}' : ''}}}}}}`,
    vars, (d) => d?.project?.workItems).map((w) => {
      const by = {};
      for (const x of Array.isArray(w.widgets) ? w.widgets : []) if (x?.type) by[x.type] = x;
      const h = by.HIERARCHY;
      return {
        number: Number(w.iid), id: w.id, state: w.state === 'OPEN' ? 'open' : 'closed', reason: null,
        bot: typeof w.author?.bot === 'boolean' ? w.author.bot : null,
        labels: by.LABELS ? labelsOf(by.LABELS.labels, `work item ${w.iid}`, 'title', 'count') : [],
        // `hasChildren` holds where the children themselves are hidden from this token.
        // A type without the hierarchy widget leaves its children unread, not absent.
        children: h ? (h.children?.count ?? null) : null, parent: h ? h.hasChildren === true : null,
        type: w.workItemType?.name ?? null,
        closedBy: closers(closing && by.DEVELOPMENT !== undefined, by.DEVELOPMENT?.closingMergeRequests, `work item ${w.iid}`,
          (m) => (typeof m?.mergeRequest?.reference === 'string' ? m.mergeRequest.reference : null)),
      };
    });
    snap.requests = walk('merge requests', `${head}
      mergeRequests(first:100,after:$after,sort:CREATED_ASC){count pageInfo{hasNextPage endCursor}
      nodes{iid id state targetBranch author{bot} ${labels}}}}}`,
    vars, (d) => d?.project?.mergeRequests).map((m) => ({
      number: Number(m.iid), id: m.id,
      // `locked` is a request mid-merge: still open.
      state: m.state === 'opened' || m.state === 'locked' ? 'open' : m.state, base: m.targetBranch,
      bot: typeof m.author?.bot === 'boolean' ? m.author.bot : null,
      labels: labelsOf(m.labels, `merge request ${m.iid}`, 'title', 'count'),
    }));
  }

  snap.complete = shortfalls.length === 0;
  try { writeFileSync(opts['--out'], `${JSON.stringify(snap, null, 1)}\n`); } catch {
    out({ ...answer, reason: `could not write ${opts['--out']}` });
  }
  out({
    ...answer, read: true, complete: snap.complete, unavailable: snap.unavailable,
    counts: { labels: snap.set.length, issues: snap.issues.length, requests: snap.requests.length, discussions: snap.discussions.length },
    reason: shortfalls.length ? text(shortfalls.join('; ')) : null,
  });
}

// ---------------------------------------------------------------- plan and snapshot readers
const loadSnapshot = () => {
  if (!opts['--snapshot']) die(`${cmd} takes --snapshot <file>`);
  const s = readJson(opts['--snapshot'], '--snapshot');
  if (!s || !Array.isArray(s.set) || !Array.isArray(s.issues) || !Array.isArray(s.requests) || !Array.isArray(s.discussions)
    || (s.forge !== 'gh' && s.forge !== 'glab') || typeof s.complete !== 'boolean' || !Object.hasOwn(s, 'defaultBranch')) {
    die('--snapshot is not a file `snapshot` wrote');
  }
  return s;
};
const descOk = (d) => d === undefined || d === null || typeof d === 'string';
const loadPlan = (required, forge) => {
  if (!opts['--plan']) { if (required) die(`${cmd} takes --plan <file>`); return { create: [], edit: [], delete: [], relabel: [] }; }
  const p = readJson(opts['--plan'], '--plan');
  if (p === null || typeof p !== 'object' || Array.isArray(p)) die('--plan is a JSON object');
  const plan = { create: p?.create ?? [], edit: p?.edit ?? [], delete: p?.delete ?? [], relabel: p?.relabel ?? [] };
  if (![plan.create, plan.edit, plan.delete, plan.relabel].every(Array.isArray)) die('--plan: create, edit, delete and relabel are lists');
  for (const c of plan.create) {
    if (!labelNameOk(c?.name) || typeof c.color !== 'string' || !descOk(c.description)) die('--plan: a create is { name, color, description }');
  }
  for (const e of plan.edit) {
    if (!labelNameOk(e?.name) || (e.newName !== undefined && !labelNameOk(e.newName))
      || (e.color !== undefined && typeof e.color !== 'string') || !descOk(e.description)) die('--plan: an edit is { name, newName?, color?, description? }');
  }
  for (const d of plan.delete) if (!labelNameOk(d)) die('--plan: a delete that is not a label name');
  const same = sameLabel(forge);
  const rows = new Set();
  for (const r of plan.relabel) {
    if ((r?.kind !== 'issue' && r?.kind !== 'request') || !Number.isInteger(r.number) || r.number < 1
      || ![r.add ?? [], r.remove ?? []].every((l) => Array.isArray(l) && l.every(labelNameOk))) die('--plan: a relabel row is { kind, number, add, remove }');
    // One row a carrier, and no name both added and taken off: the writer refuses either.
    if (rows.has(`${r.kind} ${r.number}`)) die(`--plan: two relabel rows for ${r.kind} ${r.number}`);
    rows.add(`${r.kind} ${r.number}`);
    const both = (r.add ?? []).find((n) => (r.remove ?? []).some((m) => same(m, n)));
    if (both !== undefined) die(`--plan: ${r.kind} ${r.number} both adds and takes off ${both}`);
  }
  return plan;
};

// The plan's renames, as a function from a name to the one it will carry.
const renamer = (plan, same) => {
  const renames = plan.edit.filter((e) => e.newName !== undefined);
  return (n) => renames.find((e) => same(e.name, n))?.newName ?? n;
};
// The labels a carrier holds once the plan's renames and its own row are applied.
const afterPlan = (snap, plan) => {
  const same = sameLabel(snap.forge);
  const rename = renamer(plan, same);
  const rows = new Map(plan.relabel.map((r) => [`${r.kind}:${r.number}`, r]));
  const apply = (kind) => (c) => {
    const row = rows.get(`${kind}:${c.number}`);
    let labels = c.labels.map(rename);
    if (row) {
      const remove = (row.remove ?? []).map(rename);
      labels = labels.filter((l) => !remove.some((n) => same(n, l)));
      for (const n of (row.add ?? []).map(rename)) if (!labels.some((l) => same(l, n))) labels.push(n);
    }
    return { ...c, labels };
  };
  return { issues: snap.issues.map(apply('issue')), requests: snap.requests.map(apply('request')), discussions: snap.discussions.map(apply('discussion')) };
};

// ---------------------------------------------------------------- check-set
function checkSet() {
  const snap = loadSnapshot();
  const plan = loadPlan(true, snap.forge);
  const same = sameLabel(snap.forge);
  const problems = [];
  const flag = (op, name, problem) => problems.push({ op, name, problem });
  const held = (n) => snap.set.find((l) => same(l.name, n));
  const colourOk = (c) => typeof c === 'string' && /^[0-9a-fA-F]{6}$/.test(c);
  const descFits = (d) => typeof d !== 'string' || snap.forge !== 'gh' || [...d].length <= 100;

  for (const [i, c] of plan.create.entries()) {
    if (held(c.name)) flag('create', c.name, 'already in the set');
    if (plan.create.findIndex((o) => same(o.name, c.name)) !== i) flag('create', c.name, 'created twice by the plan');
    if (!colourOk(c.color)) flag('create', c.name, 'the colour is not six hex digits without #');
    if (!descFits(c.description)) flag('create', c.name, 'the description is over 100 characters, GitHub\'s limit');
    if (snap.forge === 'glab' && c.name.includes(',')) flag('create', c.name, 'GitLab refuses a comma in a label name');
  }
  for (const [i, e] of plan.edit.entries()) {
    const l = held(e.name);
    if (!l) { flag('edit', e.name, 'not in the set'); continue; }
    if (plan.edit.findIndex((o) => same(o.name, e.name)) !== i) flag('edit', e.name, 'edited twice by the plan: one row a label');
    if (plan.delete.some((d) => same(d, e.name))) flag('edit', e.name, 'edited and deleted by the same plan');
    if (l.inherited) flag('edit', e.name, 'a label its group passes down: the project cannot change it');
    if (e.color !== undefined && !colourOk(e.color)) flag('edit', e.name, 'the colour is not six hex digits without #');
    if (!descFits(e.description)) flag('edit', e.name, 'the description is over 100 characters, GitHub\'s limit');
    if (e.newName !== undefined && snap.forge === 'glab' && e.newName.includes(',')) flag('edit', e.name, 'GitLab refuses a comma in a label name');
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
  const carriers = [...after.issues.map((c) => ({ kind: 'issue', c })), ...after.requests.map((c) => ({ kind: 'request', c })),
    ...after.discussions.map((c) => ({ kind: 'discussion', c }))];
  for (const d of plan.delete) {
    const l = held(d);
    if (!l) { flag('delete', d, 'not in the set'); continue; }
    if (l.inherited) flag('delete', d, 'a label its group passes down: the project cannot delete it');
    if (!snap.complete) flag('delete', d, 'the snapshot read the carriers short, so who holds it is unread');
    const holders = carriers.filter(({ c }) => c.labels.some((n) => same(n, d)));
    if (holders.length) flag('delete', d, `still on ${holders.slice(0, 10).map(({ kind, c }) => `${kind} ${c.number}`).join(', ')}${holders.length > 10 ? ` and ${holders.length - 10} more` : ''}`);
  }
  const rename = renamer(plan, same);
  for (const r of plan.relabel) {
    const both = (r.add ?? []).find((n) => (r.remove ?? []).some((m) => same(rename(m), rename(n))));
    if (both !== undefined) flag('relabel', both, `added to and taken off ${r.kind} ${r.number} once the plan's renames apply`);
    // Where GitLab's tier keeps one value a scope, adding one takes the other off; where it does not,
    // both stay. The plan says which by taking the old value off itself.
    const carrier = (r.kind === 'issue' ? snap.issues : snap.requests).find((c) => c.number === r.number);
    if (snap.forge === 'glab' && carrier) {
      const key = (n) => (n.includes('::') ? n.slice(0, n.lastIndexOf('::')) : null);
      const removed = (r.remove ?? []).map(rename);
      const added = (r.add ?? []).map(rename);
      const kept = carrier.labels.map(rename);
      for (const n of added) {
        const other = key(n) !== null && kept.find((l) => key(l) === key(n) && l !== n && !removed.includes(l));
        if (other) flag('relabel', n, `added to ${r.kind} ${r.number} beside ${other}: take ${other} off in the same row`);
        const twin = key(n) !== null && added.find((l) => key(l) === key(n) && l !== n);
        if (twin) flag('relabel', n, `added to ${r.kind} ${r.number} with ${twin}, a value of the same scope`);
      }
    }
    for (const n of r.add ?? []) {
      const l = held(n);
      // A renamed label keeps what it was: an archived one renamed is still archived.
      const coming = plan.create.some((c) => same(c.name, n)) || renames.some((e) => same(e.newName, n) && !held(e.name)?.archived);
      if (!(l && !l.archived) && !coming) flag('relabel', n, `added to ${r.kind} ${r.number}, and neither a live label of the set nor created by the plan`);
      if (plan.delete.some((d) => same(d, n))) flag('relabel', n, `added to ${r.kind} ${r.number} and deleted by the same plan`);
    }
    const where = r.kind === 'issue' ? snap.issues : snap.requests;
    if (!where.some((c) => c.number === r.number)) flag('relabel', `${r.kind} ${r.number}`, `no such carrier in the snapshot${!snap.complete ? ', which read short' : ''}`);
  }
  out({ ok: problems.length === 0, forge: snap.forge, problems });
}

// ---------------------------------------------------------------- check-roles
function checkRoles() {
  const snap = loadSnapshot();
  const plan = loadPlan(false, snap.forge);
  if (!opts['--roles']) die('check-roles takes --roles <file>');
  const roles = readJson(opts['--roles'], '--roles');
  if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) die('--roles is a JSON object');
  const range = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && v[0] >= 0 && (v[1] === null || (Number.isInteger(v[1]) && v[1] >= v[0]));
  if (!Array.isArray(roles?.families) || !roles.families.every((f) => typeof f?.prefix === 'string' && f.prefix !== ''
    && range(f.leaf) && range(f.parent) && range(f.request))) {
    die('--roles: families are { prefix, leaf: [min, max|null], parent: [...], request: [...] }');
  }
  if (roles.skip !== undefined && !(Array.isArray(roles.skip) && roles.skip.every((s) => typeof s === 'string'))) die('--roles: skip is a list of label names');
  if (roles.nativeTypes !== undefined && !(Array.isArray(roles.nativeTypes) && roles.nativeTypes.every((t) => typeof t === 'string'))) die('--roles: nativeTypes is a list of type names');
  if (roles.parentLabel !== undefined && !labelNameOk(roles.parentLabel)) die('--roles: parentLabel is a label name');
  const skip = roles.skip ?? [];
  const same = sameLabel(snap.forge);
  const fold = snap.forge === 'gh' ? (s) => s.toLowerCase() : (s) => s;
  const after = afterPlan(snap, plan);
  const violations = [];
  const bothWays = [];
  const skipped = (c) => c.bot === true || c.labels.some((l) => skip.some((s) => same(s, l)));
  const inScope = (c) => !skipped(c) && snap.defaultBranch !== null && c.base === snap.defaultBranch && c.state !== 'closed';

  const native = (c) => typeof c.type === 'string'
    && (roles.nativeTypes ? roles.nativeTypes.includes(c.type) : snap.forge === 'gh');
  // Where the server carries no hierarchy, the label the roles name marks a parent.
  const isParent = (c) => c.parent === true
    || (c.parent === null && roles.parentLabel !== undefined && c.labels.some((l) => same(l, roles.parentLabel)));
  const check = (kind, c, place) => {
    for (const f of roles.families) {
      let n = c.labels.filter((l) => fold(l).startsWith(fold(f.prefix))).length;
      // A native type names the role where it is one the roles adopt; beside a label of the family
      // it is the same value carried two ways, not a second one.
      if (roles.nativeKind === f.prefix && native(c)) {
        // Whether the two name the same kind is the reader's to judge: they are listed.
        if (n > 0) bothWays.push({ kind, number: c.number, type: c.type, labels: c.labels.filter((l) => fold(l).startsWith(fold(f.prefix))) });
        n = Math.max(n, 1);
      }
      let [min, max] = f[place];
      if (f.whileOpen && c.state !== 'open') { min = 0; max = 0; }
      if (n < min || (max !== null && n > max)) violations.push({ kind, number: c.number, place, family: f.prefix, count: n, want: [min, max] });
    }
  };
  for (const c of after.issues) if (!skipped(c)) check('issue', c, isParent(c) ? 'parent' : 'leaf');
  for (const c of after.requests) if (inScope(c)) check('request', c, 'request');

  let coverage = null;
  if (opts['--rows'] !== undefined) {
    const population = opts['--population'];
    if (!['issues', 'requests', 'all'].includes(population)) die('--rows takes --population issues|requests|all');
    if (!dirOk(opts['--rows'])) die(`--rows '${opts['--rows']}' is not a directory`);
    const seen = new Map();
    const bad = [];
    const read = (file) => { try { return readFileSync(join(opts['--rows'], file), 'utf8'); } catch { return die(`--rows: ${file} is not a readable file`); } };
    for (const f of readdirSync(opts['--rows'])) {
      if (!f.endsWith('.jsonl')) continue;
      for (const [i, line] of read(f).replace(/^\uFEFF/, '').split('\n').entries()) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { bad.push(`${f}:${i + 1}`); continue; }
        if ((row?.kind !== 'issue' && row?.kind !== 'request') || !Number.isInteger(row.number)) { bad.push(`${f}:${i + 1}`); continue; }
        const key = `${row.kind} ${row.number}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    const want = new Set([
      ...(population !== 'requests' ? after.issues.filter((c) => !skipped(c)).map((c) => `issue ${c.number}`) : []),
      ...(population !== 'issues' ? after.requests.filter(inScope).map((c) => `request ${c.number}`) : []),
    ]);
    coverage = {
      missing: [...want].filter((k) => !seen.has(k)),
      twice: [...seen].filter(([, n]) => n > 1).map(([k]) => k),
      extra: [...seen.keys()].filter((k) => !want.has(k)),
      unreadable: bad,
    };
  }
  // A snapshot read short counts only what it read, and one without the default branch no request.
  const complete = snap.complete && snap.defaultBranch !== null;
  out({
    ok: complete && violations.length === 0 && (!coverage || Object.values(coverage).every((l) => l.length === 0)),
    forge: snap.forge, complete, violations, bothWays, coverage,
  });
}

// ---------------------------------------------------------------- verify
function verify() {
  const snap = loadSnapshot();
  const plan = loadPlan(true, snap.forge);
  const same = sameLabel(snap.forge);
  const rename = renamer(plan, same);
  const mismatches = [];
  const want = (what, problem) => mismatches.push({ what, problem });
  const held = (n) => snap.set.find((l) => same(l.name, n));
  // A label created or edited without a description reads back as either empty or null.
  const desc = (d) => d ?? '';
  for (const c of plan.create) {
    const l = held(c.name);
    if (!l) want(c.name, 'not created');
    else if (String(l.color).toLowerCase() !== c.color.toLowerCase() || desc(c.description) !== desc(l.description)) want(c.name, 'created, but not as planned');
  }
  for (const e of plan.edit) {
    const name = e.newName ?? e.name;
    // A rename is read by its exact spelling: on GitHub a change of case alone matches either way.
    const l = e.newName !== undefined ? snap.set.find((x) => x.name === e.newName) : held(e.name);
    if (!l) { want(name, e.newName !== undefined ? 'not renamed' : 'not in the set'); continue; }
    // The old name is gone: by its exact spelling where only its case changes, as the forge reads it otherwise.
    const stays = same(e.name, e.newName ?? e.name) ? snap.set.some((x) => x.name === e.name) : Boolean(held(e.name));
    if (e.newName !== undefined && e.name !== e.newName && stays) want(e.name, 'still in the set beside its new name');
    if (e.color !== undefined && String(l.color).toLowerCase() !== e.color.toLowerCase()) want(name, 'the colour is not the planned one');
    if (e.description !== undefined && desc(l.description) !== desc(e.description)) want(name, 'the description is not the planned one');
  }
  for (const d of plan.delete) if (held(d)) want(d, 'not deleted');
  for (const r of plan.relabel) {
    const c = (r.kind === 'issue' ? snap.issues : snap.requests).find((x) => x.number === r.number);
    if (!c) { want(`${r.kind} ${r.number}`, 'not in the snapshot'); continue; }
    for (const n of (r.add ?? []).map(rename)) if (!c.labels.some((l) => same(l, n))) want(`${r.kind} ${r.number}`, `does not hold ${n}`);
    for (const n of (r.remove ?? []).map(rename)) if (c.labels.some((l) => same(l, n))) want(`${r.kind} ${r.number}`, `still holds ${n}`);
  }
  const { complete } = snap;
  out({ ok: complete && mismatches.length === 0, forge: snap.forge, complete, mismatches });
}

({ snapshot, 'check-set': checkSet, 'check-roles': checkRoles, verify })[cmd]();
