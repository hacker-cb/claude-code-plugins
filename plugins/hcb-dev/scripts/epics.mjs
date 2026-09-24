#!/usr/bin/env node
// epics.mjs — which epics are open: every issue carrying the epic label, across every owner the
// account reaches, not the one repository a session happens to stand in.
//
// A coordinating session's epic is an issue with the plugin's `epic` label on it
// (`references/epic-structure.md`). Where they are is a forge search, and three things there are
// mechanical and easy to get silently wrong: the host (a search asked without one goes to the
// CLI's default host, not to the one this checkout lives on), the scope (GitLab's `all` is every
// issue the account can SEE, public projects of strangers included), and whether the list that
// came back is the whole set.
//
// With `--epic <n>` it lists that epic's waves instead: the issues under it carrying the wave label,
// open and closed — GitHub's sub-issues, GitLab's related links — in this checkout's repository,
// or the one `--repo` names.
//
// It READS and lists; what an epic's ledger says is `ledger.mjs`'s.

import { coord, dirOk, hostOk, parsePages, projectPathOk, refOk, repoOk, runner, text, writeAll } from './lib/forge.mjs';

const usage = 'usage: node epics.mjs [--forge gh|glab] [--host <host>] [--label <name>]'
  + ' [--owner <owner>]... [--epic <n> [--repo <path>]] [--repo-dir <path>]';

const die = (msg) => { writeAll(2, `epics: ${msg}\n${usage}\n`); process.exit(2); };

const opts = { forge: null, host: null, label: null, owners: [], epic: null, repo: null, dir: process.cwd() };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const val = () => { if (i + 1 >= argv.length) die(`${a} takes a value`); return argv[i += 1]; };
  if (a === '--forge') opts.forge = val();
  else if (a === '--host') opts.host = val();
  else if (a === '--label') opts.label = val();
  else if (a === '--owner') opts.owners.push(val());
  else if (a === '--epic') opts.epic = val();
  else if (a === '--repo') opts.repo = val();
  else if (a === '--repo-dir') opts.dir = val();
  else die(`unknown argument '${a}'`);
}

if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
// A GraphQL Int is 32-bit: one past it fails the request rather than naming an issue.
if (opts.epic !== null && !(/^[1-9][0-9]{0,9}$/.test(opts.epic) && Number(opts.epic) <= 2147483647)) die('--epic takes an issue number');
if (opts.epic !== null && opts.owners.length) die('--epic lists one epic of this repository, never an owner\'s');
if (opts.repo !== null && opts.epic === null) die('--repo names the repository an --epic lives in');
const repoSegments = opts.repo === null ? [] : opts.repo.split('/');
if (opts.repo !== null && !projectPathOk(opts.repo)) die(`--repo '${opts.repo}' is not a repository path`);
// The label listed by: the epic's, or with --epic the wave's.
opts.label ??= opts.epic === null ? 'epic' : 'wave';
// A label name travels inside a quoted search phrase and a URL: a quote or a backslash would end
// or escape the phrase, a comma is GitLab's list separator, and a control character is no label
// anyone wrote.
if (opts.label.trim() !== opts.label || opts.label === ''
  || /[",\\\u0000-\u001f\u007f]/.test(opts.label) || opts.label.length > 100) {
  die('--label takes a label name');
}
for (const o of opts.owners) {
  if (!refOk(o) || o.split('/').length > 20) die(`--owner '${o}' is not an owner`);
}
// An owner named twice is read once.
opts.owners = [...new Set(opts.owners)];

const answer = {
  read: false,
  forge: null,
  host: null,
  label: opts.label,
  owners: opts.owners,
  epic: opts.epic === null ? null : Number(opts.epic),
  epics: [],
  waves: opts.epic === null ? null : [],
  // With --epic: the epic's other children — the work no wave has taken — counted, and whether
  // the server carries a hierarchy at all.
  rest: opts.epic === null ? null : { total: 0, closed: 0 },
  hierarchy: opts.epic === null ? null : true,
  count: null,
  complete: null,
  reason: null,
};
const out = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
// Refused once reading has begun: an answer, not a usage error, so it stays JSON — and nothing
// read before it stands as a list.
const refuse = (msg) => {
  answer.reason = text(msg);
  answer.epics = [];
  if (answer.waves !== null) answer.waves = [];
  answer.complete = null;
  out();
};

// What a call that did not answer says about it — a timeout names itself, since a killed process
// leaves no line of its own.
const why = (r) => (r.timedOut ? 'no answer in time' : r.line());

// Which forge, and which HOST, this checkout lives on — read off what answers for it. `gh repo
// view` resolves the repository and its host from the remote, where `gh api` would ask the
// default host; `glab api` resolves both from the checkout itself. Every later call names the
// host outright, since a search carries no repository to resolve one from.
const probe = (cmd) => {
  const args = cmd === 'gh' ? ['repo', 'view', '--json', 'url']
    : ['api', ...(opts.host ? ['--hostname', opts.host] : []), 'projects/:fullpath'];
  const r = runner(opts.dir, cmd)(args, 60000);
  if (!r.ok) return { cmd, ok: false, why: `${cmd}: ${why(r)}` };
  let host = null;
  try {
    const parsed = JSON.parse(r.out);
    host = new URL(cmd === 'gh' ? parsed?.url : parsed?.web_url).host;
  } catch { /* no host to name */ }
  return { cmd, ok: true, host };
};

// Both named: nothing is left for a repository to answer, and the listing runs from anywhere.
const probed = opts.forge && opts.host ? [{ cmd: opts.forge, ok: true, host: opts.host }]
  : (opts.forge ? [opts.forge] : ['gh', 'glab']).map(probe);
// A host named beside a forge left open holds the probe to it: a checkout living elsewhere is
// not the forge that host runs.
for (const p of probed) {
  if (p.ok && opts.host && !opts.forge && p.host !== opts.host) {
    Object.assign(p, { ok: false, why: `${p.cmd}: this checkout lives on ${p.host ?? 'no host it named'}` });
  }
}
const answered = probed.filter((p) => p.ok);
if (answered.length === 0) refuse(`no forge CLI answered for this repository — ${probed.map((p) => p.why).join('; ')}`);
if (answered.length > 1) refuse('both forges answer for this repository — name one with --forge');
const forge = answered[0].cmd;
const host = opts.host ?? answered[0].host;
if (!hostOk(host)) refuse('the repository answered without a host this run can name');
answer.forge = forge;
answer.host = host;
const cli = runner(opts.dir, forge);

// One epic reached twice — two owners that overlap, a page that shifted under a paginated walk —
// is listed once. Each query keeps its own tally of what it reached, repeats counted once and a
// row with no key to know it by counted as it comes, and is whole where that reaches the
// largest count the forge gave it.
const seen = new Set();
const query = () => {
  const keys = new Set();
  let keyless = 0;
  return {
    add: ({ repo, number, title, url, updated, children }) => {
      const row = { repo: coord(repo), number: Number.isInteger(number) ? number : null,
        title: text(title), url: coord(url), updated: text(updated), children };
      const key = row.url ?? (row.repo && row.number !== null ? `${row.repo}#${row.number}` : null);
      if (key === null) { keyless += 1; answer.epics.push(row); return; }
      keys.add(key);
      if (!seen.has(key)) { seen.add(key); answer.epics.push(row); }
    },
    // No count at all leaves nothing to check against, which is unknown rather than whole.
    settle: (total) => {
      if (total === null) { if (answer.complete !== false) answer.complete = null; }
      else if (keys.size + keyless < total) answer.complete = false;
    },
  };
};
answer.complete = true;

// A child of the epic: a wave where it carries the label and lives in the epic's own repository —
// listed once however often the pages repeat it — and the work no wave has taken otherwise.
const want = opts.label.toLowerCase();
const seenChild = new Set();
const child = ({ key, own, labelled, number, title, url, state, reason, children }) => {
  if (key !== null && seenChild.has(key)) return false;
  if (key !== null) seenChild.add(key);
  if (own && labelled) {
    answer.waves.push({ number: Number.isInteger(number) ? number : null, title: text(title),
      url: coord(url), state: text(state), reason: text(reason), children });
  } else {
    // Work no wave has taken, in whichever repository it lives.
    answer.rest.total += 1;
    if (state === 'closed') answer.rest.closed += 1;
  }
  return true;
};

if (opts.epic !== null && forge === 'gh') {
  if (opts.repo !== null && !repoOk(opts.repo)) refuse(`'${opts.repo}' is no GitHub repository: it takes <owner>/<name>`);
  // A repository named travels raw (`-f`): typed, a value opening with `@` would be read as a file,
  // and a name of digits would stop being a string. Only this checkout's placeholders go typed.
  const where = opts.repo === null ? ['-F', 'owner={owner}', '-F', 'name={repo}']
    : ['-f', `owner=${repoSegments[0]}`, '-f', `name=${repoSegments[1]}`];
  // The epic's sub-issues, a hundred a page, every one read; GraphQL, which carries them on every
  // server that has them — the REST form is absent from GHES (`references/forge-docs.md`). The
  // epic's own summary counts children the token cannot see, which the list leaves out.
  const Q = 'query($owner: String!, $name: String!, $n: Int!, $after: String) { repository(owner: $owner, name: $name) { nameWithOwner issue(number: $n) { subIssuesSummary { total } subIssues(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { number title url state stateReason repository { nameWithOwner } labels(first: 100) { totalCount nodes { name } } subIssuesSummary { total completed } } } } } }';
  let after = null;
  let reached = 0;
  let total = null;
  for (let walked = 0; ; walked += 1) {
    if (walked >= 100) refuse(`the sub-issues of #${opts.epic} ran past 100 pages`);
    const r = cli(['api', 'graphql', '--hostname', host, ...where, '-F', `n=${opts.epic}`,
      '-f', `query=${Q}`, ...(after ? ['-f', `after=${after}`] : [])], 120000);
    if (!r.ok) {
      const said = `${r.err}\n${r.out}`;
      if (/subIssues/.test(said) && /doesn't exist|does not exist/i.test(said)) {
        answer.hierarchy = false;
        refuse('this server carries no sub-issues');
      }
      if (/Could not resolve to an? (Issue|Repository)/i.test(said)) refuse(`issue #${opts.epic} is not there, or not visible to this token`);
      refuse(`the sub-issues of #${opts.epic} could not be read: ${why(r)}`);
    }
    let page = null;
    try { page = JSON.parse(r.out); } catch { /* below */ }
    if (!page || typeof page !== 'object') refuse(`the sub-issues of #${opts.epic} were not JSON`);
    const repo = page?.data?.repository;
    const issue = repo?.issue;
    if (issue === null) refuse(`issue #${opts.epic} is not there, or not visible to this token`);
    const subs = issue?.subIssues;
    if (!subs || !Array.isArray(subs.nodes)) refuse(`the sub-issues of #${opts.epic} answered with something that is not a page`);
    // Errors beside the data mean the data may be partial: what came back stands, never as whole.
    if (Array.isArray(page.errors) && page.errors.length) answer.complete = false;
    const home = typeof repo?.nameWithOwner === 'string' ? repo.nameWithOwner.toLowerCase() : null;
    if (Number.isInteger(subs.totalCount)) total = Math.max(total ?? 0, subs.totalCount);
    const summary = issue?.subIssuesSummary?.total;
    if (Number.isInteger(summary) && Number.isInteger(subs.totalCount) && summary > subs.totalCount) answer.complete = false;
    for (const it of subs.nodes) {
      const labels = it?.labels;
      // A label list cut short cannot say the label is absent.
      if (!Array.isArray(labels?.nodes) || (Number.isInteger(labels.totalCount) && labels.totalCount > labels.nodes.length)) {
        answer.complete = false;
      }
      const sub = it?.subIssuesSummary;
      const there = typeof it?.repository?.nameWithOwner === 'string' ? it.repository.nameWithOwner.toLowerCase() : null;
      const counted = child({
        key: typeof it?.url === 'string' ? it.url : null,
        own: home !== null && there === home,
        labelled: (labels?.nodes ?? []).some((l) => typeof l?.name === 'string' && l.name.toLowerCase() === want),
        number: it?.number, title: it?.title, url: it?.url,
        state: typeof it?.state === 'string' ? it.state.toLowerCase() : null,
        reason: typeof it?.stateReason === 'string' ? it.stateReason.toLowerCase().replace('_', ' ') : null,
        children: sub && Number.isInteger(sub.total)
          ? { total: sub.total, completed: Number.isInteger(sub.completed) ? sub.completed : null } : null,
      });
      if (counted) reached += 1;
    }
    if (subs.pageInfo?.hasNextPage !== true) break;
    after = typeof subs.pageInfo?.endCursor === 'string' ? subs.pageInfo.endCursor : null;
    if (after === null) refuse(`the sub-issues of #${opts.epic} say more follow and name no cursor`);
  }
  if (total === null) { if (answer.complete !== false) answer.complete = null; }
  else if (reached < total) answer.complete = false;
} else if (opts.epic !== null) {
  const project = opts.repo === null ? ':fullpath' : encodeURIComponent(opts.repo);
  // The project's own id, by which each link names the project its far end lives in.
  const pr = cli(['api', '--hostname', host, `projects/${project}`], 60000);
  let pid = null;
  if (pr.ok) { try { pid = JSON.parse(pr.out)?.id; } catch { /* below */ } }
  if (!Number.isInteger(pid)) {
    refuse(pr.ok ? 'the project answered without its id' : `the project could not be read: ${why(pr)}`);
  }
  // The epic's related links, one list: GitLab pages none of it. A related link is the one kind
  // every tier carries, and the one the master hangs work by; the others are dependencies.
  const r = cli(['api', '--hostname', host, `projects/${project}/issues/${opts.epic}/links`], 120000);
  if (!r.ok) {
    refuse(/\(HTTP 404\)/.test(r.err) ? `issue #${opts.epic} is not there, or not visible to this token: ${why(r)}`
      : `the links of #${opts.epic} could not be read: ${why(r)}`);
  }
  let rows = null;
  try { rows = JSON.parse(r.out); } catch { /* below */ }
  if (!Array.isArray(rows)) refuse(`the links of #${opts.epic} answered with something that is not a list`);
  for (const it of rows) {
    if (it?.link_type !== 'relates_to') continue;
    child({
      key: typeof it?.web_url === 'string' ? it.web_url : null,
      own: it?.project_id === pid,
      labelled: Array.isArray(it?.labels) && it.labels.some((l) => typeof l === 'string' && l.toLowerCase() === want),
      number: it?.iid, title: it?.title, url: it?.web_url,
      state: it?.state === 'opened' ? 'open' : (typeof it?.state === 'string' ? it.state : null),
      // No reason on a GitLab close, and no count of an issue's own links.
      reason: null, children: null,
    });
  }
  // GitLab counts none of it, and shows only the links this token may see.
  answer.complete = null;
} else if (forge === 'gh') {
  // One query per owner, each an organisation or a user by its own qualifier; without owners,
  // `author:@me` — the account's own epics, wherever they stand — is one query over every owner.
  // A single owner reads alike in the default search and the advanced one, where several joined
  // in one query do not (`references/forge-behaviour.md`).
  const scopes = [];
  for (const o of opts.owners) {
    if (o.includes('/')) refuse(`owner '${o}' is a path, and a GitHub owner is one account`);
    const who = cli(['api', '--hostname', host, `users/${encodeURIComponent(o)}`], 60000);
    let type = null;
    if (who.ok) { try { type = JSON.parse(who.out)?.type; } catch { /* no type */ } }
    if (type !== 'Organization' && type !== 'User') {
      refuse(`owner '${o}' could not be resolved: ${who.ok ? 'no type in the answer' : why(who)}`);
    }
    scopes.push(`${type === 'Organization' ? 'org' : 'user'}:${o}`);
  }
  if (scopes.length === 0) scopes.push('author:@me');
  for (const scope of scopes) {
    const what = `the search over ${scope}`;
    // Each page cut down to what a row takes before it reaches this process: issue bodies would
    // otherwise ride along, a page at a time, into one buffer.
    const r = cli(['api', '--hostname', host, '--paginate', '-X', 'GET', 'search/issues',
      '-f', `q=is:issue is:open label:"${opts.label}" ${scope}`, '-f', 'per_page=100', '--jq',
      '{total_count, incomplete_results, items: [.items[]? | {number, title, html_url, repository_url, updated_at, sub_issues_summary}]}'],
    180000);
    if (!r.ok) refuse(`${what} could not be read: ${why(r)}`);
    const pages = parsePages(r.out);
    if (pages === null) refuse(`${what} was not JSON`);
    const q = query();
    let total = null;
    for (const p of pages) {
      if (!p || typeof p !== 'object' || !Array.isArray(p.items)) refuse(`${what} answered with something that is not a result page`);
      // The largest count any page reported: one that shrank between pages is no licence to
      // call a shorter list whole.
      if (Number.isInteger(p.total_count)) total = Math.max(total ?? 0, p.total_count);
      // A search the forge timed out on says so only in its flag.
      if (p.incomplete_results === true) answer.complete = false;
      for (const it of p.items) {
        const sub = it?.sub_issues_summary;
        q.add({
          repo: typeof it?.repository_url === 'string' ? it.repository_url.split('/').slice(-2).join('/') : null,
          number: it?.number,
          title: it?.title,
          url: it?.html_url,
          updated: it?.updated_at,
          children: sub && Number.isInteger(sub.total)
            ? { total: sub.total, completed: Number.isInteger(sub.completed) ? sub.completed : null }
            : null,
        });
      }
    }
    // A search stops at 1 000 hits and says so only in its count.
    q.settle(total);
  }
} else {
  // GitLab's own words for "none" and "any" are no label to list by.
  if (/^(none|any|no label)$/i.test(opts.label)) refuse(`'${opts.label}' is GitLab's own word, not a label to list by`);
  // Without owners, what the account created — never `all`, which on a public instance is every
  // issue the account can see. An owner is a group, read through the group's own listing.
  // Archived projects included: an epic open there is still open.
  const params = `labels=${encodeURIComponent(opts.label)}&state=opened&non_archived=false&per_page=100`;
  const lists = opts.owners.length
    ? opts.owners.map((o) => ({ path: `groups/${encodeURIComponent(o)}/issues?${params}`, what: `group '${o}'`, group: true }))
    : [{ path: `issues?${params}&scope=created_by_me`, what: 'the listing', group: false }];
  for (const list of lists) {
    // Walked a page at a time with its headers: each page carries the count and where the next
    // one is, and one page's rows are all a buffer ever holds. GitLab leaves the count out past
    // a size it will not count.
    const q = query();
    let total = null;
    let page = '1';
    for (let walked = 0; page !== ''; walked += 1) {
      if (walked >= 100) refuse(`${list.what} ran past 100 pages`);
      const r = cli(['api', '--hostname', host, '-i', `${list.path}&page=${page}`], 120000);
      if (!r.ok) {
        refuse(list.group && /\(HTTP 404\)/.test(r.err)
          ? `${list.what} is not a group this account can read: ${why(r)}`
          : `${list.what} could not be read: ${why(r)}`);
      }
      const split = /\r?\n\r?\n/.exec(r.out);
      const head = split ? r.out.slice(0, split.index) : '';
      let rows = null;
      try { rows = JSON.parse(split ? r.out.slice(split.index + split[0].length) : r.out); } catch { /* below */ }
      if (!Array.isArray(rows)) refuse(`${list.what} answered with something that is not a list`);
      const t = /^x-total:\s*(\d+)\s*$/im.exec(head);
      if (t) total = Math.max(total ?? 0, Number(t[1]));
      page = (/^x-next-page:[ \t]*(\d*)[ \t]*$/im.exec(head)?.[1]) ?? '';
      for (const it of rows) {
        const ref = typeof it?.references?.full === 'string' ? it.references.full : null;
        q.add({
          repo: ref ? ref.replace(/#\d+$/, '') : null,
          number: it?.iid,
          title: it?.title,
          url: it?.web_url,
          updated: it?.updated_at,
          // A related link is listed, not counted: GitLab keeps no child count for an issue.
          children: null,
        });
      }
    }
    q.settle(total);
  }
}

answer.count = opts.epic === null ? answer.epics.length : answer.waves.length;
answer.read = true;
out();
