---
name: product-search
description: >-
  Use this skill whenever the user wants to find something on Taobao or Tmall
  through the desktop client — sourcing a part, comparing what sellers offer,
  "what does this cost in China", "найди мне", "search Taobao for", a picture to
  match, or any sweep across a category. It searches in Chinese, paces the runs
  around the anti-bot throttle, tells a silent block apart from a genuinely
  empty result, merges every run into one deduplicated set, groups it by seller,
  and reports a shortlist with a working link per listing. Reach for it even
  when the user names a single product: one keyword returns one page of at most
  fifty results, and the sweep is what makes the answer worth trusting. Not for
  reading one listing in depth — price, SKUs, specs, reviews and Q&A belong to
  hcb-taobao:item-details, which takes the shortlist from here. It adds nothing
  to a cart and messages no seller.
metadata:
  upstream-skill: taobao-native
  upstream-version: "1.0.43"
  verified-against: "淘宝桌面版 2.5.1 (macOS)"
---

# Product search

Sweeps a set of Chinese keywords through the client, merges the runs into one
set of listings, and hands a shortlist on.

Every call goes through the companion, which owns the invocation, the answer
format and the failure classes:
[`../../references/taobao-companion.md`](../../references/taobao-companion.md).
How the result reaches the user is
[`../../references/taobao-presentation.md`](../../references/taobao-presentation.md).

## 1. Build the keyword set

The request arrives as one keyword at best, and the number of keywords is what
decides the breadth of the answer. Derive them from what the thing *is*, in
Chinese:

- the category noun a Chinese seller would title the listing with (`机箱`,
  `保温杯`), alone and paired with the qualifier that matters (`4盘位 nas 机箱`);
- a model number, brand or part code exactly as printed — these survive
  translation and match listings whose titles are unreadable to you;
- the synonym pair Chinese draws where the user's language has one word
  (`电脑包` beside `笔记本内胆包`);
- the property the user is actually filtering on (`静音`, `全铝`, `便携`) added
  to the category noun, never searched on its own.

Five to ten keywords cover a category. When the request is ambiguous enough that
half of them would describe a different product, ask which one first — a sweep
costs minutes of the user's client.

## 2. Run the sweep

One keyword per call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" search --keyword "4盘位 nas 机箱"
```

`--type` narrows to one marketplace slice when the user asks for one. Take the
values it accepts off the live registry, whose schemas need `--raw`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" tools --raw
```

A picture is a search route of its own. Write the absolute path of a file the
user pointed at into the args file:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call image_search --args-file /tmp/tb-image.json
```

It answers with category groups, each carrying its own product list; merge those
lists exactly like keyword runs.

When a run comes back a pathology after the companion has already backed off,
stop the sweep instead of walking the remaining keywords: from that point every
keyword returns an empty page indistinguishable from a real answer. Report which
keywords ran and which never did.

## 3. Merge

**Dedup on `itemId`.** The same listing surfaces under several keywords. Keep one
record, and keep the set of keywords that found it — that overlap is the one
relevance signal this data supports.

**Group on `shopName`.** A seller holding three of the shortlist is a different
finding from three unrelated sellers: it is a candidate to ask directly, and it
is what tells a real manufacturer from a page of resellers.

**Rank on what is present.** A search record carries a title, a price string, a
shop, an image and the ids — nothing about sales volume, ratings, location or
delivery. When the user asks for the best-selling or best-reviewed option, say
the client does not return it and offer to read candidates instead of inventing
an order. Compare prices numerically, and keep the string that came back for
display.

## 4. Report

Render per the presentation reference. Two things a sweep owes on top of it:

- the keywords that ran, with how many results each returned — a thin category
  and a thin sweep look identical in the shortlist, and only this line tells
  them apart;
- the sellers that carry more than one of the shortlist, named.

## 5. Hand on

A shortlist is not an answer: a search record has no specs, and its price is the
display price rather than what a variant costs. Take the two or three listings
that survive to `hcb-taobao:item-details`. Where one seller carries most of the
shortlist, `hcb-taobao:seller-chat` asks them directly.
