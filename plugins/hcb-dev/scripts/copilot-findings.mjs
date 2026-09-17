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
// Usage: node copilot-findings.mjs --pr <n> [--repo <owner/name>] [--me <login>]
//                                  [--repo-dir <path>]
//
// Exit 0 either way. Exit 2 only for a call this script cannot act on at all.

import { dirOk, hostOk, isCopilot, parsePages, repoOk, runner, text, writeAll } from './lib/forge.mjs';

// A finding's own words, kept whole. `text()` is for the short identity fields beside
// them — a login, a state, a timestamp — and its 200 characters would take the rationale
// off a real finding and leave a path naming no file. Control characters still go, since
// they would end a line in a reader's terminal, and the ceiling is high enough that only
// something pathological reaches it — which then SAYS it was clipped rather than looking
// like the whole of it.
const CEILING = 20000;
const whole = (v) => (typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, CEILING) : null);
const clipped = (v) => typeof v === 'string' && v.length > CEILING;

const USAGE = 'usage: node copilot-findings.mjs --pr <n> [--repo <owner/name>]'
  + ' [--me <login>] [--repo-dir <path>]\n';
const die = (m) => { writeAll(2, `copilot-findings: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { pr: null, repo: null, repoDir: null, me: null };
const FLAGS = { '--pr': 'pr', '--repo': 'repo', '--repo-dir': 'repoDir', '--me': 'me' };
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
// A login, which is not a path segment and not a ref: letters, digits and hyphens is what
// both forges allow, and an App's own user carries a `[bot]` suffix.
if (opts.me !== null && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(opts.me)) {
  die(`--me '${opts.me}' is not a login`);
}

// A directory, proved here: passed on as `cwd` it would come back as a call that failed
// with nothing on stderr, which reads as a forge that would not answer.
if (opts.repoDir && !dirOk(opts.repoDir)) die(`--repo-dir '${opts.repoDir}' is not a directory`);
const gh = runner(opts.repoDir || process.cwd());
const repoArgs = opts.repo ? ['--repo', opts.repo] : [];

const answer = {
  read: false, repo: null, pr: Number(opts.pr), head: null,
  // Each half says whether IT was read. One that failed leaves the other's findings
  // standing rather than emptying the whole answer — but `read` below stays false, so a
  // caller cannot act on a half while believing it has the review.
  // Who "ours" is. Every judgement below about whether a finding was answered rests on
  // it: on a public repository anyone at all can reply in a review thread, and a reply
  // from a passer-by is not an answer to the finding — it is a third party clearing a
  // gate. Unread leaves every thread owed, which is the safe direction.
  me: null,
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
// What the caller named wins, and it is the answer for a token that cannot read its own
// user at all: a repository's `GITHUB_TOKEN` and an App installation token both get 403
// from `/user`, and without this every thread stays owed for the life of the run.
if (opts.me !== null) answer.me = opts.me;
else {
  const whoami = gh(['api', ...hostArgs, 'user', '-q', '.login']);
  answer.me = whoami.ok && whoami.out ? text(whoami.out.split('\n')[0]) : null;
}
if (answer.me === null) {
  answer.notes.push('who this run is authenticated as could not be read and none was'
    + ' named, so no comment in any thread counts as an answer of ours — pass --me <login>'
    + ' where the token cannot read its own user');
}
const owner = where.split('/').slice(0, 2);
answer.repo = owner.length === 2 && owner.every(Boolean) ? owner.join('/') : null;

// --- reading one: the threads, and who last spoke in each
if (!answer.repo) {
  answer.threads.reason = 'which repository this request is in could not be read, and the'
    + ' thread query is asked of a repository by name';
} else {
  // Paginated rather than capped. A request past the first page used to be truncated
  // silently by hand; refusing instead is honest but leaves a request with that many
  // threads unable to pass this step on any attempt, so the pages are walked. The ceiling
  // is a run that will not terminate, not a number of findings.
  const QUERY = `
    query($owner:String!,$repo:String!,$pr:Int!,$after:String){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$pr){
          reviewThreads(first:100, after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ id isResolved isOutdated resolvedBy{ login }
                   comments(first:100){
                     pageInfo{ hasNextPage }
                     nodes{ databaseId author{login __typename} body path line } } }
          }
        }
      }
    }`;
  const nodes = [];
  let after = null;
  let pages = 0;
  for (;;) {
    pages += 1;
    const q = gh(['api', ...hostArgs, 'graphql', '-f', `query=${QUERY}`,
      // `-f` for the strings and `-F` only for the number: the typed flag infers, so a
      // repository named `2048` travels as an integer and the query's `String!` refuses it.
      '-f', `owner=${owner[0]}`, '-f', `repo=${owner[1]}`, '-F', `pr=${opts.pr}`,
      ...(after === null ? [] : ['-f', `after=${after}`])]);
    if (!q.ok) { answer.threads.reason = `the review threads could not be read (${q.line()})`; break; }
    let got = null;
    try { got = JSON.parse(q.out).data.repository.pullRequest.reviewThreads; } catch { got = null; }
    if (!got || !Array.isArray(got.nodes)) {
      answer.threads.reason = 'the review threads came back in a shape this cannot read';
      break;
    }
    nodes.push(...got.nodes);
    if (got.pageInfo?.hasNextPage !== true) break;
    const cursor = got.pageInfo?.endCursor;
    // A forge saying there is more and not saying where is a listing this cannot finish,
    // and walking it again from the start would never end.
    if (typeof cursor !== 'string' || cursor === '' || cursor === after) {
      answer.threads.more = true;
      answer.threads.reason = 'the forge reports more threads and named no cursor to reach them';
      break;
    }
    after = cursor;
    if (pages >= 50) {
      answer.threads.more = true;
      answer.threads.reason = 'the thread listing did not end within fifty pages';
      break;
    }
  }
  if (answer.threads.reason === null) {
    {
      for (const t of nodes) {
        const comments = Array.isArray(t?.comments?.nodes) ? t.comments.nodes : [];
        const rows = comments.map((c) => ({
          id: typeof c?.databaseId === 'number' ? c.databaseId : null,
          author: text(c?.author?.login),
          reviewer: isCopilot({ login: c?.author?.login, type: c?.author?.__typename }),
          // Ours by identity, never by "not the reviewer": anyone at all can reply in a
          // review thread on a public repository, and a passer-by writing "not a real
          // key, ignore" is not an answer to the finding — it is a third party clearing
          // the only gate standing between it and a merge.
          ours: answer.me !== null && text(c?.author?.login) === answer.me,
          path: whole(c?.path), line: typeof c?.line === 'number' ? c.line : null,
          body: whole(c?.body), truncated: clipped(c?.body),
        }));
        // The LAST thing the reviewer said, not the first. It answers our reply and closes
        // the thread often enough — "the fix is incomplete" — and anchoring to the first
        // leaves that follow-up answered by the reply it was written about.
        const lastSaid = rows.reduce((at, r, i) => (r.reviewer ? i : at), -1);
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
          answered: lastSaid !== -1 && rows.slice(lastSaid + 1).some((r) => r.ours),
          // Somebody else did speak, which is neither an answer nor nothing: it is why a
          // thread that looks attended to is still owed one.
          othersSpoke: lastSaid !== -1
            && rows.slice(lastSaid + 1).some((r) => !r.reviewer && !r.ours),
          fromReviewer: lastSaid !== -1,
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
//
// A TAG, and one that cannot cross a line. `<[^>]*>` is not "a tag" but "from any `<` to
// the next `>`", so a `<` in ordinary prose — `stops when \`i < len\`` — deletes everything
// up to the next `>` anywhere below, the block this is looking for included. Measured: the
// count then comes back `null` with nothing marking it unknown.
const plain = (s) => String(s ?? '')
  .replace(/<\/?[A-Za-z][^>\n]{0,200}>/g, ' ').replace(/[*_#]/g, ' ');
// Every match, not the first. A review body carries the paths of the files it reviewed
// above the block this is looking for, and a path is a name somebody chose: one shaped
// `docs/deprecations suppressed (0).md` sits above the real block and answers for it.
//
// `null` and not `0` where there is no match at all: a body carrying no such block and a
// block reporting none are different readings, taking different next steps. `null` again
// where there are SEVERAL — which of them is the block cannot be told from here, and the
// unknown resolves toward reading the body rather than toward skipping it.
const countIn = (body, re) => {
  const all = [...plain(body).matchAll(re)];
  if (all.length === 0) return { n: null, ambiguous: false };
  if (all.length > 1) return { n: null, ambiguous: true };
  return { n: Number.parseInt(all[0][1], 10), ambiguous: false };
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
        const sup = countIn(body, /[Ss]uppressed[^(]{0,40}\((\d+)\)/g);
        const opened = countIn(body, /[Cc]omments generated[^0-9]{0,20}(\d+)/g);
        answer.bodies.items.push({
          at: text(r?.submitted_at), commit, state: text(r?.state),
          // Every review that posted is read, whichever commit it covers: the head handed
          // in may never earn one of its own, and a later review carries findings an
          // earlier one did not.
          head: commit !== null && answer.head !== null ? commit === answer.head : null,
          // The body's first line and nothing more — where the assessment sits when the
          // review carries one, and a pointer to the body rather than a substitute for it.
          opening: text((body.split('\n')[0] || '').replace(/^#+ */, '').replace(/\s+$/, '')),
          // The body itself, because the decision below is to READ one: telling a caller
          // to open something and handing it a first line is telling it to classify a
          // finding by the heading above it.
          body: whole(body), truncated: clipped(body),
          suppressed: sup.n,
          // What the review OPENED, which is a count of threads and never of findings: a
          // review whose findings all went to the suppressed block opened none, so zero
          // here is that class's signature rather than evidence against it.
          opened: opened.n,
          ambiguous: sup.ambiguous || opened.ambiguous,
          // The decision, made here rather than left as an inference a reader re-derives:
          // a block with findings in it, or a count that could not be pinned at all — the
          // label standing in the body with no number reachable being one such, since a
          // block that is there and unreadable is not a body with nothing in it.
          readBody: sup.ambiguous || opened.ambiguous || (sup.n !== null && sup.n > 0)
            || (sup.n === null && /suppressed/i.test(body)),
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
      if (t.resolved && t.byReviewer) {
        why = 'this reviewer closed it with no answer of ours in it — an open finding'
          + ' wearing the resolved badge, and the gate satisfied the whole time it stands';
      } else if (t.resolved) {
        // Said as what it is. Reading a person's resolve as the bot's self-closing sends
        // the caller looking at the reviewer's habits instead of at who actually closed it.
        why = `${t.resolvedBy ?? 'someone'} closed it with no answer of ours in it`;
      } else {
        why = t.othersSpoke
          ? 'somebody else replied and we did not — a third party in the thread is not an'
            + ' answer to the finding'
          : 'nothing has answered it';
      }
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
  // Its own words, not a summary of them: the walk now stops for several different
  // reasons and a caller told the wrong one looks for the wrong thing.
  answer.reason = answer.threads.reason || answer.bodies.reason
    || (answer.threads.more ? 'the thread listing did not finish' : null);
}
finish();
