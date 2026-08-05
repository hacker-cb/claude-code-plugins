---
name: item-details
description: >-
  Use this skill when the user asks what one specific Taobao or Tmall listing
  actually is — the current price against the crossed-out one, which SKU
  combinations exist and which are sold out, the spec table, who the seller is,
  what buyers wrote in the reviews, what the Q&A answers. Trigger it on a pasted
  item link or item id, on "открой карточку", "what are the specs", "is the
  black one in stock", "какие отзывы", and whenever a comparison needs figures a
  search result never carries. It opens the listing in the client, lets the page
  render, reads it section by section, and refuses to report a number off a
  block page or a shell that never loaded. Use hcb-taobao:product-search first
  where there is no candidate yet — this skill reads listings, it does not find
  them — and hcb-taobao:cart-and-orders once a variant is chosen. It puts
  nothing in a cart.
metadata:
  upstream-skill: taobao-native
  upstream-version: "1.0.43"
  verified-against: "淘宝桌面版 2.5.1 (macOS)"
---

# Item details

Opens one listing at a time and reports what the page actually says.

Every call goes through the companion, which owns the invocation, the answer
format and the failure classes:
[`../../references/taobao-companion.md`](../../references/taobao-companion.md).
How the result reaches the user is
[`../../references/taobao-presentation.md`](../../references/taobao-presentation.md).

## 1. Open the listing

Build the item URL as the presentation reference specifies, put it in an args
file, and open it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate_to_url --args-file /tmp/tb-item.json
```

## 2. Read it in sections

A listing page does not fit one read. Narrow to the section you want:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=price]"
```

When a scoped read still comes back `truncated`, continue from where it stopped
rather than re-reading. Carry the same scope: without it the offset counts into
the whole page instead of the section, and the continuation is a different text.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=detail]" --offset 5000
```

A pathology verdict means what you read is not the listing — a block page, or a
shell that rendered nothing. Nothing on it is data: quote no price, no stock
state, no spec from it. Follow the hint, and when it keeps coming back, tell the
user the listing is behind the block and give them the link so they can open it
themselves.

## 3. What to pull

**Price.** Two figures sit together: what it costs now, and a struck-through
figure that is the price before the discount. Report the first as the price and
the second only as a marked "before". Where a figure appears only after a variant
is picked, there is no single price — give the range and resolve it in the next
step.

**Variants.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_product_skus --args '{"itemId":"673089864770"}'
```

Dimension names arrive in whatever language the page is rendered in — `颜色分类`
and "Color classification" are one dimension under two renderings — so key on
the dimension's position and on its values, never on its name. Carry the value
strings through unchanged; they are what a later add matches against. Report
which combinations come back unavailable: a sold-out colour answers half the
questions asked here before any spec does.

**Specs.** The parameter table (`参数`, `规格`) is a scoped read. Report the
parameters the user's question turns on, and say which of them the page does not
list at all — an absent parameter and one you never looked for read identically
to the user.

**Seller.** The shop name and its link, plus which marketplace the listing sits
on, per the presentation reference.

**Reviews and Q&A.** Both load on demand: find the tab, click it by index, then
read.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call scan_page_elements --args '{"filter":"评价"}'
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call click_element --args '{"index":142}'
```

The filter drops lines from the listing, not numbers from the numbering — pass
the index as printed rather than counting the lines you got back. A click that
answers `disabled` is not one to repeat: the control is not ready, and what makes
it ready is elsewhere on the page.

Summarize reviews by what recurs — the complaint appearing in three of them
carries more than any average — and translate the lines you quote.

## 4. Several listings

Pull the same sections in the same order for each, so the comparison has no holes
that are really gaps in your reading.

## 5. Report

Render per the presentation reference, and name the fields you could not get —
the parameter the page omits, the review tab that stayed empty. A silent gap
reads as a finding of "nothing there".

## 6. Hand on

- no candidate yet, or the shortlist is too thin to compare —
  `hcb-taobao:product-search`;
- a variant chosen and the user wants it — `hcb-taobao:cart-and-orders`;
- the page does not answer the question — `hcb-taobao:seller-chat`.
