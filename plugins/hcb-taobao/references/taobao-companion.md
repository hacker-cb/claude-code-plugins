# Calling the Taobao desktop client

Every call to the client goes through the bundled companion, `scripts/tb.mjs`
under `node`; nothing else touches the client. Each skill carries that invocation
in full — below, a call is named by its subcommand and flags alone.

Run `up` before the first call of a task: it resolves the runtime, starts the
client if it is not running, checks the gates, and reports what it found. When it
reports a gate, show the user its `hint` and stop — a gate is a switch only they
can flip.

## Subcommands

| Command | What it does |
|---|---|
| `up` | preflight: client running, gates open, protocol as expected |
| `doctor` | protocol fingerprint against the recorded baseline; also prints the client version |
| `tools` | the live tool registry — the only trustworthy list of what exists |
| `call <tool> --args '<json>'` | any tool, arguments inline |
| `call <tool> --args-file <path>` | same, arguments read from a file — use it whenever a value contains quotes, newlines or a URL |
| `search --keyword <words>` | `search_products` with pacing, throttle detection and retry |
| `read [--scope <css>]` | `read_page_content` with pathology classification |
| `lock status` / `lock release` | inspect or drop the cross-session lock |

Useful flags: `--timeout <ms>`, `--out <path>` to force the spill file,
`--max-inline <bytes>` to change when a result spills, `--no-lock` for read-only
probing, `--source-app <name>`, `--raw` for the unabridged answer — the wire
envelope, and the argument schemas `tools` drops by default.

## Reading the answer

One line of JSON on stdout. `ok` is the only success signal — **the exit code of
the vendor CLI is not**, and neither is the absence of an error field, because
the client reports most real tool failures inside a successful envelope.

```json
{"ok":true,"tool":"get_current_tab","ms":6,"result":{"url":"…","title":"…"}}
```

A large result goes to a file instead, with a summary that answers the question
you actually have — whether anything was found:

```json
{"ok":true,"tool":"search_products","ms":4120,
 "resultFile":"/…/search_products-….json","bytes":214880,
 "summary":{"count":44,"keyword":"…","shops":9,"priceRange":["12.9","389"]}}
```

Read a `resultFile` with the `Read` tool, not by printing it — these files run to
hundreds of kilobytes.

A failure names its class:

```json
{"ok":false,"kind":"gate","code":"AI_AGENT_DISABLED","message":"…","hint":"…","retriable":false}
```

| `kind` | What it means | What to do |
|---|---|---|
| `gate` | a switch in the client is off, or a consent expired | show `hint` to the user verbatim and stop |
| `tool` | the tool ran and refused | read `message`; usually the arguments are wrong |
| `pathology` | the call "succeeded" but the page is a block, a stub, or a silent throttle | follow `hint`; `retryAfterMs` says how long to wait |
| `transport` | the client is not running or not answering | `up` first |
| `lock` | another session is driving the client | `hint` names the holder |
| `protocol` | the client no longer matches the recorded baseline | report it; the companion has already fallen back |
| `unknown` | the answer could not be classified | **not a success** — say so, and pass `evidence` on to the user |

`unknown` exists because a wrong guess is worse than an admission. Treat it as a
failure with an open cause, never as a result.

A gate can arrive at any point, not only at preflight: a signed-in client can
sign itself out midway through a run. When one interrupts work already under
way, report what actually landed before it — the keywords that ran, the listings
read, whether the cart line went in — and stop there. Half a sweep reported as a
whole one is worse than the interruption. The sign-out gate in particular makes
the client raise its login window on every call it refuses, so a chain that keeps
going raises that window once per step; the companion answers the rest from
memory for a short while, and `up` is what asks the client again once the user
says they are back in.

## The language of what comes back

Titles, shop names and page text arrive in whatever language the Taobao page was
rendered in — Chinese normally, machine-translated English when the page-level
translator is on. The client mounts no switch for it, and the state is per page
rather than per session: two reads in one task come back in different languages.
So decide it on every read, by measuring the share of CJK characters in the text
you got, and never carry a verdict from one page to the next.

Four things stay Chinese whatever the translator does, and they are what to key
on:

- the bracketed service markers the client writes into page content (`[商品id]`,
  `[商品主图]`);
- the `title` attribute in the DOM, which holds the original of a link whose
  visible text has been translated;
- the tab title;
- browse history, which comes out of the client's own storage rather than off
  the page.

Translated titles arrive fragment-glued (`nasChassis12 hard drives4U`), so they
are unusable for matching. Match on item ids, model numbers and figures; never on
words. What reaches the user is your own rendering either way — see
[`taobao-presentation.md`](taobao-presentation.md).

## Reading a page

`read` returns the text of the whole DOM, not the part on screen, so a page is
read where it stands and scrolling it first adds nothing.

`--scope` is real CSS targeting: it narrows the read to the matching subtree, and
a selector matching nothing comes back as an error rather than as an empty page —
so an error there means the selector is wrong, not that the section is empty. It
is also the language-independent way in, since a class or an attribute survives
the translator and a caption does not.

`scan_page_elements` has no scope. The argument is accepted and changes nothing,
so every scan returns the whole page — take it whole and pick out what you need.
Its `filter` matches the rendered label, which is the one thing the translator
rewrites: on an English page a Chinese filter matches nothing that is there. It
drops output lines and nothing else — an index counts from the whole scan, so it
addresses the same element filtered or not.

## Pages of the client

The page keys `navigate` takes are the client's own, and `list_available_pages`
is where they come from — a key written from memory is a guess.

`close_page` closes the page the client is holding. Close it once the task that
opened it is finished; leave it open where the answer sends the user back to it —
a cart to check out in, a conversation to carry on — and never close one between
two steps of your own, or one that was already open when the task began.

## Search that means something

Search Chinese. Chinese keywords return whole pages of results where the English
equivalent returns a handful, and the client echoes the keyword back untranslated
so it stays comparable across calls.

`search --keyword` already handles the part that costs a session: a throttled
search returns a well-formed answer with zero products and no error at all, so
the companion re-runs a control keyword to tell a genuinely empty query from a
block, and backs off when it is a block. A page caps at 50 results and there is
no paging — breadth comes from more keywords, not from asking for more.

Never narrow a search to shops: it comes back empty for every keyword, the
control keyword runs under the same narrowing and comes back empty with it, and
the emptiness is then reported as a throttle that holds down the product searches
after it. Enumerate sellers by grouping product results on their shop name.

## Timing

Reading a page right after navigating to it returns a page that has not rendered.
The companion waits, but the first call after the client has idled still takes
several seconds. Let it.

One call at a time, always — the client drives a single background tab with
shared buffers, so overlapping calls read each other's page. That holds across
skills and across whatever is being driven: two searches, two listings, a read
issued while a navigation is still in flight.
