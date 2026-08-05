---
name: cart-and-orders
description: >-
  Use this skill when the user wants a chosen variant put into their Taobao
  cart, or wants to see what is in the cart, find one of their orders, check
  what they browsed recently, or leave a review on something they bought.
  Trigger on "добавь в корзину", "закажи это", "add the black one", "what's in
  my cart", "where is my order", "что я вчера смотрел", "оставь отзыв". It
  resolves the SKU dimensions before adding so the variant is the one meant,
  filters the cart and the order list by keyword, and posts a review only
  through the client's own rating tool, with the Chinese text and the star
  scores shown for approval before anything is published. It stops at the cart:
  the client exposes no checkout, so placing and paying for the order stays with
  the user. To decide which variant to add, read the listing with
  hcb-taobao:item-details; to ask the seller anything, use
  hcb-taobao:seller-chat.
metadata:
  upstream-skill: taobao-native
  upstream-version: "1.0.43"
  verified-against: "淘宝桌面版 2.5.1 (macOS)"
---

# Cart and orders

Resolves a variant into the user's cart, looks up what is already in the cart or
in an order, and posts a review of something bought.

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

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_product_skus --args '{"itemId":"673089864770"}'
```

An add takes one value per dimension, spelled as the page spells it. Where the
user named a colour or a size in their own language, map it to the value that
came back and show the mapping before adding: "black" and `黑色` are one choice,
`深空灰` and `黑色` are two.

## 2. Add

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call add_to_cart --args-file /tmp/tb-add.json
```

with the item id and the full value array. This tool is the only route in — the
page's own buttons are not a fallback, and a refused add is a stop rather than a
retry with a neighbouring spec: which variant to buy is the user's call, and a
cart quietly filled with the wrong one is worse than an unanswered question.

A `needsSkuSelection` answer means the spec is out of stock or does not exist,
and it carries the dimension and the options still open. Show those and ask.

## 3. See the cart

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate --args '{"page":"cart","searchKey":"机箱"}'
```

`searchKey` filters the page once it opens, in Chinese, and only the cart and the
order list act on it — elsewhere it is ignored silently. Then read the page for
what is actually there.

## 4. Find an order

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate --args '{"page":"order","searchKey":"机箱"}'
```

Status, logistics and the entry point for a review are page text; read them
scoped. Order ids, addresses and phone numbers belong in the answer to the user
and nowhere else — never in a keyword, a message to a seller, or a review.

## 5. What the user was looking at

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_browse_history --args '{"type":"product"}'
```

`product`, `search` and `shop` are the three histories. This is the shortest
route from "the thing I saw yesterday" to an item id, which goes straight to
`hcb-taobao:item-details`.

## 6. Review something bought

Navigate to the rating entry from the order, then drive the form with one tool
only. Do not scan, click or type on that page: the form is not what those tools
reach, and a half-filled rating is visible to the seller.

The first call reports the items on the order without posting anything:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call submit_product_rating --args '{}'
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

## 7. Report

Render per the presentation reference. State what actually landed in the cart —
item, variant, price — rather than that the call succeeded, and close with the
step that remains the user's: opening the cart in the client and paying.

## 8. Hand on

- unsure which variant, or the listing needs reading — `hcb-taobao:item-details`;
- a question for the shop about a cart item or an order —
  `hcb-taobao:seller-chat`;
- the item is not chosen yet — `hcb-taobao:product-search`.
