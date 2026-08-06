---
name: item-details
description: >-
  Use this skill when the user asks what one specific Taobao or Tmall listing
  actually is — the price that applies against the crossed-out one, which
  variants exist and which are sold out, who the seller is and what their rating
  and delivery terms say. Trigger it on a pasted item link or item id, on
  "открой карточку", "сколько это стоит", "is the black one in stock", "какие
  есть цвета", and whenever a comparison needs figures a search result never
  carries. It opens the listing in the client, addresses sections by CSS so the
  translator cannot move them, resolves what a chosen variant costs rather than
  the figure the listing starts at, opens the reviews behind their own tab, and
  reports no number off a block page or a shell that never loaded. What the page
  answers nowhere goes to hcb-taobao:seller-chat. Use hcb-taobao:product-search
  first where there is no candidate yet — this skill reads listings, it does not
  find them — and hcb-taobao:cart-and-orders once a variant is chosen. It puts
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

## 2. Read by scope, never by wording

Every read carries a scope: a section is addressed by CSS, never by the words
rendered in it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=price]"
```

When a scoped read comes back `truncated`, continue from where it stopped rather
than re-reading. Carry the same scope: without it the offset counts into the
whole page instead of the section, and the continuation is a different text.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=detail]" --offset 5000
```

Identify the listing by the anchors translation leaves alone, which
`taobao-companion.md` names; the tab title is one of them:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_current_tab --args '{}'
```

A pathology verdict means what you read is not the listing — a block page, or a
shell that rendered nothing. Nothing on it is data: quote no price and no stock
state from it. Follow the hint, and when it keeps coming back, tell the user the
listing is behind the block and give them the link so they can open it
themselves.

## 3. What the listing carries

**Price.** Two figures sit together: what it costs now, and a struck-through
figure that is the price before the discount. Report the first as the price and
the second only as a marked "before".

Until a variant is picked, that figure is where the listing starts — an
accessory, or its smallest size — and not what the thing the user asked about
costs. A variant's own price appears only once its option has been clicked, so
click the option by the index the whole-page scan below gives it, then take the
figure back off the page, filtering the scan on the currency mark, which is the
one label the translator leaves alone:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call scan_page_elements --args '{"filter":"￥"}'
```

Where no variant has been chosen, give the range and say the low end is where the
listing starts rather than reporting it as the price.

**Variants.** Two calls, each for the part only it has. Both work against the
listing step 1 opened, so neither carries its id:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_product_skus --args '{}'
```

Take from it which dimensions the listing has and which combinations come back
unavailable — a sold-out colour answers half the questions asked here before any
figure does. Its option texts are cut short and repeated, so they identify
nothing: never match, add or report a variant off them.

An answer that the listing has no dimensions at all is the answer this call also
gives for a page that is not the listing. Confirm the tab is that listing before
reporting it, and never report it off a page that has not been confirmed.

The full text of every option is on the page, and one scan carries all of it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call scan_page_elements --args '{}'
```

Dimension names arrive in whatever language the page is rendered in — `颜色分类`
and "Color classification" are one dimension under two renderings — so key on the
dimension's position and on its values, never on its name. Carry the value
strings through unchanged; they are what a later add matches against.

**Reviews.** The listing shows none until the tab holding them is opened, and the
click that opens it brings them back in `pageChanges.added` of that same answer.
Take the tab off the whole-page scan and click it by index — its label is
rewritten with the rest of the page:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call click_element --args '{"index":64}'
```

Only a couple of them sit on the listing itself. The control beside them opens
the rest in a drawer — a panel on the page rather than another page, so it is
read by scope:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=Drawer]"
```

The drawer loads a page of the most recent as it goes, so scrolling inside it is
what fetches the next one:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call scroll_page --args '{"direction":"down"}'
```

Report what buyers wrote as their claims, and say how many were read — never as
the listing's record entire.

**Seller.** The shop name and its link, the rating and the delivery terms the
page states, plus which marketplace the listing sits on, per the presentation
reference.

**What no listing page carries.** There is no parameter table and no Q&A on it —
those are not sections you failed to find. Where the user's question turns on
one of them, a material or a measurement, say the page does not carry it and take
the question to `hcb-taobao:seller-chat`, rather than reporting an absent section
as a finding of "none".

## 4. Several listings

Pull the same sections in the same order for each, so the comparison has no holes
that are really gaps in your reading.

## 5. Report

Render per the presentation reference, and name the fields you could not get. A
figure the page never prints and one you did not look for read identically to the
user.

## 6. Hand on

- no candidate yet, or the shortlist is too thin to compare —
  `hcb-taobao:product-search`;
- a variant chosen and the user wants it — `hcb-taobao:cart-and-orders`;
- the page does not answer the question — `hcb-taobao:seller-chat`.
