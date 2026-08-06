---
name: cart-and-orders
description: >-
  Use this skill when the user wants a chosen variant put into their Taobao
  cart, wants a line taken back out, wants to see what is in the cart, find one
  of their orders, check what they browsed recently, or leave a review on
  something they bought. Trigger on "добавь в корзину", "закажи это", "add the
  black one", "what's in my cart", "убери из корзины", "where is my order", "что
  я вчера смотрел", "оставь отзыв". It resolves the variant against the page's
  own option texts, adds through the page itself where the client's add tool
  will not act on a translated page, removes a cart line only against an
  explicit yes for that line, and posts a review only through the client's own
  rating tool, with the text and the star scores shown for approval before
  anything is published. It stops at the cart: the client exposes no checkout,
  so paying stays with the user. Read the listing with hcb-taobao:item-details;
  ask the seller through hcb-taobao:seller-chat.
metadata:
  upstream-skill: taobao-native
  upstream-version: "1.0.43"
  verified-against: "淘宝桌面版 2.5.1 (macOS)"
---

# Cart and orders

Resolves a variant into the user's cart, takes a line back out, looks up what is
already in the cart or in an order, and posts a review of something bought.

Every call goes through the companion, which owns the invocation, the answer
format and the failure classes:
[`../../references/taobao-companion.md`](../../references/taobao-companion.md).
How the result reaches the user is
[`../../references/taobao-presentation.md`](../../references/taobao-presentation.md).

## Where this stops

The cart is the last step available: the client exposes no checkout, so placing
and paying for the order stays with the user, in the client, by hand. Say that
when the user asks you to buy, rather than hunting the page for a button that
would do it. The live registry is what settles the question:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" tools
```

## 1. Resolve the variant

Reached from `hcb-taobao:item-details`, the listing is open already, and the call
is made against the page in front of the client:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_product_skus --args '{}'
```

The id goes in only where nothing has opened the listing yet, since passing it is
what opens it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_product_skus --args '{"itemId":"673089864770"}'
```

Either way it gives which dimensions the listing has and how they combine. Its
option texts are cut short, so nothing is added or matched by them. The full
texts, and the indices that click them, come from one whole-page scan:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call scan_page_elements --args '{}'
```

Two of the SKU call's answers make the value array unnecessary: every dimension
already resolved on the page, and a listing with no dimensions at all. The second
is also what that call answers for a page that is not the listing, so confirm
what the client is standing on before adding against it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_current_tab --args '{}'
```

An add takes one value per dimension, spelled as the page spells it. Where the
user named a colour or a size in their own language, map it to a value off the
scan and show the mapping before adding: "black" and `黑色` are one choice,
`深空灰` and `黑色` are two.

## 2. Add

Ask the client's own tool first, with the full value array and no id — the
listing is the page step 1 left the client standing on:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call add_to_cart --args-file /tmp/tb-add.json
```

It locates the add button by its Chinese label, so it declines to act on a page
the translator has rewritten. That is the ordinary second step rather than a
failure: add through the page instead, working off the scan of step 1 — click
the option element of each dimension by its index, then click the add control,
which carries either rendering of its label, `加入购物车` or "Add to cart", so
look for both.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call click_element --args '{"index":142}'
```

What the page did with a click comes back in `pageChanges` of that same answer;
that is where the add is confirmed, not in a later read.

A `needsSkuSelection` answer means the spec is out of stock or does not exist,
and it carries the dimension and the options still open. Show those and ask.

Where an add is refused without naming a dimension, the page state is the answer
the user gets:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call inspect_page --args '{}'
```

Report its `actionButtons`, `overlays` and SKU state — which control the page
has, what is covering it, which dimension is unresolved — instead of "the add did
not work".

A refused add is a stop rather than a retry with a neighbouring spec: which
variant to buy is the user's call, and a cart quietly filled with the wrong one
is worse than an unanswered question.

## 3. See the cart

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate --args '{"page":"cart","searchKey":"机箱"}'
```

`searchKey` filters the page once it opens, in Chinese, and only the cart and the
order list act on it — elsewhere it is ignored silently. Then read the page
scoped for what is actually on it.

## 4. Take a line out of the cart

Filter the cart down to the line with `searchKey`, then scan the page whole.
Every row carries a delete control of its own and they all share one label, so a
row is addressed by the index the scan gave it and never by text. That control is
the whole of the removal — the row's checkbox plays no part in it, and ticking
one selects a line for an order instead.

Show the user the item and the price of that row, and take an explicit yes for
that row before any click:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call click_element --args '{"index":88}'
```

The confirmation dialog arrives inside `pageChanges.added` of that same answer:
take the confirming control from there, matching its label under both renderings,
and click it. Nothing leaves the cart until that second click — a dialog you
cannot resolve is a stop, and the row is still in the cart when you report.

## 5. Find an order

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate --args '{"page":"order","searchKey":"机箱"}'
```

Status, logistics and the entry point for a review are page text; read them
scoped. Order ids, addresses and phone numbers belong in the answer to the user
and nowhere else — never in a keyword, a message to a seller, or a review.

## 6. What the user was looking at

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_browse_history --args '{"type":"product"}'
```

`product`, `search` and `shop` are the three histories. They come out of the
client's own store rather than off a page, so the titles are the Chinese
originals whatever language the pages were showing — the shortest route from "the
thing I saw yesterday" to an item id, which goes straight to
`hcb-taobao:item-details`.

## 7. Review something bought

Navigate to the rating entry from the order, then drive the form with one tool
only. Do not scan, click or type on that page: the form is not what those tools
reach, and a half-filled rating is visible to the seller.

The first call reports the items on the order. It carries no text and turns the
tool's own submission off, so nothing is posted by it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call submit_product_rating --args '{"submit":false}'
```

Write one review per item, in Chinese, each one different and each built from
that item's own name and spec — an order of three gets three texts, not one
repeated. Write from what the user told you about the purchase; never invent an
experience they have not described.

Then show them, before anything is sent: the Chinese text, a translation into
their language, the three star scores, and whether it goes out anonymously. Pair
each text with the item it belongs to, by name. The call publishes — the review is
public, under their account, and there is no unsend. Send only on an explicit yes.

The texts are matched to items by position alone, and the yes arrives a turn
later, with the client left unattended in between. So re-establish the page
before publishing, with no other call in between: navigate to that same order's
rating entry again, and run the reporting call above a second time. Compare the
item list it returns against the one the user approved — same items, same count,
same order.

Publish only on a full match:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call submit_product_rating --args-file /tmp/tb-rating.json
```

with one text per item in page order and the three scores on a first review; a
follow-up review sets the append flag instead, since the scores are already
recorded.

Any difference is a stop, an empty or unreadable list included: publish nothing,
show the user the list that came back, and take the approval again against it —
re-pairing the texts to the items, and writing a new one for any item that was
not in the draft.

## 8. Report

Render per the presentation reference. State what actually landed in the cart or
left it — item, variant, price — rather than that the call succeeded, and close
with the step that remains the user's: opening the cart in the client and paying.

## 9. Hand on

- unsure which variant, or the listing needs reading — `hcb-taobao:item-details`;
- a question for the shop about a cart item or an order —
  `hcb-taobao:seller-chat`;
- the item is not chosen yet — `hcb-taobao:product-search`.
