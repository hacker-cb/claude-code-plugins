#!/usr/bin/env node
// copilot-findings.mjs — what has the automated reviewer actually said on this request,
// and what of it is still unanswered? Prints JSON.
//
// A review puts its findings in TWO places and only one of them opens threads. Reading
// one alone is half the review, and the half it drops is the half nothing else catches:
// a suppressed finding has no thread, so no gate holds it, no count includes it, and the
// check that unresolved threads are zero reads a clean field while it stands.
//
// This READS. It replies to nothing and resolves nothing — those are the caller's, and
// deliberately: a reply folded into the reading is sent before the reading is believed.
//
// Usage: node copilot-findings.mjs --pr <n> [--repo <owner/name>] [--repo-dir <path>]
//
// Exit 0 either way. Exit 2 only for a call this script cannot act on at all.

import { writeAll, hostOk, parsePages, repoOk, runner, text, isCopilot } from './lib/forge.mjs';

const USAGE = 'usage: node copilot-findings.mjs --pr <n> [--repo <owner/name>]'
  + ' [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `copilot-findings: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { pr: null, repo: null, repoDir: null };
const FLAGS = { '--pr': 'pr', '--repo': 'repo', '--repo-dir': 'repoDir' };
for (let i = 0; i < argv.length; i += 1) {
  const key = FLAGS[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i + 1];
  i += 1;
}
if (!opts.pr) die('--pr is required');
if (!/^[1-9][0-9]{0,9}$/.test(opts.pr)) die(`--pr '${opts.pr}' is not a request number`);
if (opts.repo && !repoOk(opts.repo)) die(`--repo '${opts.repo}' is not owner/name`);

const gh = runner(opts.repoDir || process.cwd());
const repoArgs = opts.repo ? ['--repo', opts.repo] : [];

const answer = {
  read: false, repo: null, pr: Number(opts.pr), head: null,
  // Each half says whether IT was read. One that failed leaves the other's findings
  // standing rather than emptying the whole answer — but `read` below stays false, so a
  // caller cannot act on a half while believing it has the review.
  threads: { read: false, reason: null, more: false, items: [] },
  bodies: { read: false, reason: null, items: [] },
  // Every thread still owed something, and WHICH of the ways it is owed — they take
  // different next steps, and a bare list of ids says none of them.
  open: [],
  reason: null, notes: [],
};
const finish = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };
const refuse = (reason) => { answer.reason = reason; finish(); };

// --- where the request lives
const view = gh(['pr', 'view', opts.pr, '--json', 'url,headRefOid', ...repoArgs]);
if (!view.ok) refuse(`could not read pull request ${opts.pr} (${view.line()})`);
let pr;
try { pr = JSON.parse(view.out); } catch { refuse('the pull request view was not JSON'); }
if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
  refuse('the pull request view came back in a shape this cannot read');
}
answer.head = typeof pr.headRefOid === 'string' ? pr.headRefOid : null;

// The host as well as the path: `gh pr view` finds an enterprise request through the
// remote, while `gh api graphql` defaults to the SaaS — and a same-named repository there
// answers with somebody else's threads rather than with an error.
let where = opts.repo || '';
let host = null;
if (typeof pr.url === 'string') {
  try {
    const u = new URL(pr.url);
    host = u.host;
    if (!where) where = u.pathname.slice(1);
  } catch { host = null; }
}
const hostArgs = hostOk(host) ? ['--hostname', host] : [];
const owner = where.split('/').slice(0, 2);
answer.repo = owner.length === 2 && owner.every(Boolean) ? owner.join('/') : null;

// --- reading one: the threads, and who last spoke in each
if (!answer.repo) {
  answer.threads.reason = 'which repository this request is in could not be read, and the'
    + ' thread query is asked of a repository by name';
} else {
  const q = gh(['api', ...hostArgs, 'graphql', '-f', `query=
    query($owner:String!,$repo:String!,$pr:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$pr){
          reviewThreads(first:100){
            pageInfo{ hasNextPage }
            nodes{ id isResolved isOutdated resolvedBy{ login }
                   comments(first:100){
                     pageInfo{ hasNextPage }
                     nodes{ databaseId author{login __typename} body path line } } }
          }
        }
      }
    }`,
  // `-f` for the strings and `-F` only for the number: the typed flag infers, so a
  // repository named `2048` travels as an integer and the query's `String!` refuses it.
  '-f', `owner=${owner[0]}`, '-f', `repo=${owner[1]}`, '-F', `pr=${opts.pr}`]);
  if (!q.ok) {
    answer.threads.reason = `the review threads could not be read (${q.line()})`;
  } else {
    let got = null;
    try { got = JSON.parse(q.out).data.repository.pullRequest.reviewThreads; } catch { got = null; }
    if (!got || !Array.isArray(got.nodes)) {
      answer.threads.reason = 'the review threads came back in a shape this cannot read';
    } else {
      answer.threads.more = got.pageInfo?.hasNextPage === true;
      for (const t of got.nodes) {
        const comments = Array.isArray(t?.comments?.nodes) ? t.comments.nodes : [];
        const rows = comments.map((c) => ({
          id: typeof c?.databaseId === 'number' ? c.databaseId : null,
          author: text(c?.author?.login),
          reviewer: isCopilot({ login: c?.author?.login, type: c?.author?.__typename }),
          path: text(c?.path), line: typeof c?.line === 'number' ? c.line : null,
          body: text(c?.body),
        }));
        const first = rows.findIndex((r) => r.reviewer);
        const it = {
          id: typeof t?.id === 'string' ? t.id : null,
          resolved: t?.isResolved === true,
          outdated: t?.isOutdated === true,
          // Typed as a plain user whoever closed it, so a bot carries no field to test:
          // this is the one place the login prefix stands alone, which is also what
          // covers every spelling this reviewer resolves under.
          resolvedBy: text(t?.resolvedBy?.login),
          byReviewer: /^copilot/i.test(t?.resolvedBy?.login || ''),
          // Not "somebody replied" but "somebody OTHER than the reviewer spoke after it
          // did". A thread the reviewer closed with nothing of ours in it is an open
          // finding wearing the resolved badge, and the merge gate is satisfied the
          // whole time it stands.
          answered: first !== -1 && rows.slice(first + 1).some((r) => !r.reviewer),
          fromReviewer: first !== -1,
          path: rows[0]?.path ?? null, line: rows[0]?.line ?? null,
          comments: rows,
        };
        // A thread whose own comments paginated is a thread this read only part of, and
        // the part it read is what `answered` is computed from.
        if (t?.comments?.pageInfo?.hasNextPage === true) {
          it.answered = null;
          answer.notes.push(`thread ${it.id} carries more comments than one page`);
        }
        answer.threads.items.push(it);
      }
      answer.threads.read = true;
    }
  }
}

// --- reading two: the bodies, where the findings that opened no thread are
//
// Markup stripped before either count is read: both labels arrive as a heading or a bold
// run as often as plain text, and the forge may reword either of them.
const plain = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[*_#]/g, ' ');
// `null` and not `0`: a body carrying no such block and a block reporting none are
// different readings, and they take different next steps.
const countIn = (body, re) => {
  const m = re.exec(plain(body));
  return m ? Number.parseInt(m[1], 10) : null;
};
// The placeholders where the url did not parse: `gh` fills them from the current
// directory, which is the same repository `gh pr view` resolved a moment ago — so the two
// halves still describe one request. Only the thread query is left out, GraphQL needing a
// repository by name rather than by context.
const reviews = gh(['api', '--paginate', `repos/${owner[0] || '{owner}'}/${owner[1] || '{repo}'}/pulls/${opts.pr}/reviews`,
  ...hostArgs]);
if (!reviews.ok) {
  answer.bodies.reason = `the review bodies could not be read (${reviews.line()})`;
} else {
  const pages = parsePages(reviews.out);
  if (pages === null) {
    answer.bodies.reason = 'the reviews came back as something this cannot parse';
  } else {
    for (const page of pages) {
      if (!Array.isArray(page)) { answer.bodies.reason = 'a page of reviews was not a list'; break; }
      for (const r of page) {
        if (!isCopilot({ login: r?.user?.login, type: r?.user?.type })) continue;
        const body = typeof r?.body === 'string' ? r.body : '';
        const commit = typeof r?.commit_id === 'string' ? r.commit_id : null;
        answer.bodies.items.push({
          at: text(r?.submitted_at), commit, state: text(r?.state),
          // Every review that posted is read, whichever commit it covers: the head handed
          // in may never earn one of its own, and a later review carries findings an
          // earlier one did not.
          head: commit !== null && answer.head !== null ? commit === answer.head : null,
          // The body's first line and nothing more — where the assessment sits when the
          // review carries one, and a pointer to the body rather than a substitute for it.
          opening: text((body.split('\n')[0] || '').replace(/^#+ *|\s+$/g, '')),
          suppressed: countIn(body, /[Ss]uppressed[^(]{0,40}\((\d+)\)/),
          // What the review OPENED, which is a count of threads and never of findings: a
          // review whose findings all went to the suppressed block opened none, so zero
          // here is that class's signature rather than evidence against it.
          opened: countIn(body, /[Cc]omments generated[^0-9]{0,20}(\d+)/),
        });
      }
    }
    if (answer.bodies.reason === null) answer.bodies.read = true;
  }
}

// --- what is still owed
if (answer.threads.read) {
  for (const t of answer.threads.items) {
    // A thread this reviewer never spoke in is somebody's conversation, not its finding.
    if (!t.fromReviewer) continue;
    let why = null;
    if (t.answered === null) {
      why = 'this read only part of its comments, so whether an answer is in it is unknown';
    } else if (!t.answered) {
      why = t.resolved
        ? 'this reviewer closed it with no answer of ours in it — an open finding wearing'
          + ' the resolved badge, and the gate satisfied the whole time it stands'
        : 'nothing has answered it';
    } else if (!t.resolved) {
      why = 'answered and still open — the resolve lands after the reply rather than with it';
    }
    if (why) answer.open.push({ id: t.id, why });
  }
}
// Set last, and only where BOTH halves answered: one of them read is half a review, and a
// caller acting on half of it drops exactly the findings nothing else would catch.
answer.read = answer.threads.read && answer.bodies.read && !answer.threads.more;
if (!answer.read && answer.reason === null) {
  answer.reason = answer.threads.more
    ? 'the request carries more threads than the first page this asked for'
    : (answer.threads.reason || answer.bodies.reason);
}
finish();
