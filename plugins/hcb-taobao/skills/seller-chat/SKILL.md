---
name: seller-chat
description: >-
  Use this skill whenever the user wants to talk to a Taobao or Tmall seller —
  "спроси продавца", "ask the shop whether it ships", "message customer
  service", "напиши в чат", chasing an order, checking stock the listing never
  states, asking for a quantity discount, or opening 旺旺 at all. It finds the
  right conversation from a cart item, an order, a search or the open listing,
  composes the question in Chinese, and sends it only after showing the user the
  exact text with a translation and getting an explicit yes — the message
  reaches a live person and cannot be recalled. It then reads the seller's reply
  off the chat page and hands it over translated. Ask the listing first:
  anything printed on the page comes back instantly from
  hcb-taobao:item-details, while a seller takes minutes to hours. Cart and order
  context comes from hcb-taobao:cart-and-orders. It never adds to a cart and
  never pays.
metadata:
  upstream-skill: taobao-native
  upstream-version: "1.0.43"
  verified-against: "淘宝桌面版 2.5.1 (macOS)"
---

# Seller chat

Opens the seller's chat, sends a question the user approved, and brings the
answer back translated.

What is sent here reaches a person, under the user's account, with no way to
unsend. Most of what follows exists so that the user approved what they said.

Every call goes through the companion, which owns the invocation, the answer
format and the failure classes:
[`../../references/taobao-companion.md`](../../references/taobao-companion.md).
How the result reaches the user is
[`../../references/taobao-presentation.md`](../../references/taobao-presentation.md).

## 1. Ask the page before asking the seller

Anything printed on the listing comes back in seconds from
`hcb-taobao:item-details`; a seller answers in minutes to hours, and a question
the page already answers spends the user's standing with that shop. Chat is for
stock the page does not state, quantities beyond the listed ones, shipping
arrangements, customization, and the state of a placed order.

## 2. Open the conversation

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call open_chat --args '{"source":"cart","productName":"机箱"}'
```

`source` says where to look the seller up from — the cart or the order list with
a product name, a search with a query — and with no source the current page
decides. Open it without a message: the same tool sends whatever text it is
handed, so a message passed here goes out before the user has seen it.

## 3. Compose in Chinese

- one question per message; a seller answers the first and skips the rest;
- name the thing concretely — the item id, the spec as the page spells it, the
  quantity — so the answer is about the right listing;
- plain 简体中文, a `你好` and the question, no padding;
- nothing the question does not need. Addresses, phone numbers, payment details
  and account identifiers do not go into a chat with a shop, whatever the shop
  asks for.

## 4. Get approval

Show the user the exact Chinese text, a translation into their language, and the
shop it goes to, named as the client names it — that name is what the next step
checks against. Send on an explicit yes. That yes covers that text: an edit needs
a new one, and so does every follow-up message.

## 5. Re-open the conversation, then send

`send_chat_message` takes no recipient: it goes to whichever conversation the
client has open when it runs, and the approval arrives a turn later, after the
client has been left unattended. So re-establish the conversation immediately
before sending, with no other call in between.

Re-run the `open_chat` of step 2 with the same `source` and product name, then
read the chat page and take the shop name off it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read
```

Compare that name against the one in the approval, and send only when the two are
the same shop:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call send_chat_message --args-file /tmp/tb-msg.json
```

Every other outcome is a stop, the undecidable ones included — a different shop,
a page that yields no shop name, a pathology verdict. Send nothing, tell the user
which conversation the client is on instead, and take the approval again against
that.

An image travels the same way, as an absolute path — only a file the user
pointed at, and only after the same approval and the same check.

## 6. Read the reply

The reply lands on the chat page, not in the tool's answer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=message]"
```

Read once after sending. When nothing new is there, say so and let the user
decide whether to wait — the conversation stays open in the client, so checking
again later costs nothing, while polling for minutes holds the client and
answers nothing. Distinguish an automated greeting from the seller's own answer:
the first is instant and generic, and reporting it as a reply tells the user the
question was answered when it was not.

## 7. Hand it over

Render per the presentation reference. Where the reply commits the shop to
something — a price, stock, a ship date — state it as their claim rather than as
fact, and name what they left unanswered so the user can decide whether to
press.

## 8. Hand on

- what the listing says — `hcb-taobao:item-details`;
- the cart, the order, or a review of what arrived —
  `hcb-taobao:cart-and-orders`;
- another seller to compare against — `hcb-taobao:product-search`.
