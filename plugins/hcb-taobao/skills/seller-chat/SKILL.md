---
name: seller-chat
description: >-
  Use this skill whenever the user wants to talk to a Taobao or Tmall seller —
  "спроси продавца", "ask the shop whether it ships", "message customer
  service", "напиши в чат", chasing an order, checking stock the listing never
  states, asking for a quantity discount, or opening 旺旺 at all. It composes the
  question in Chinese and shows the user the exact text, a translation and the
  shop it goes to, sending only on an explicit yes — opening the conversation is
  itself the send, it reaches a live person under their account, and nothing can
  be recalled. Reading a seller's answer back, translated, is the other half and
  sends nothing at all. Ask the listing first: anything printed on the page comes
  back in the same turn from hcb-taobao:item-details, while a seller takes
  minutes to hours. Cart and order context comes from
  hcb-taobao:cart-and-orders. It never adds to a cart and never pays.
metadata:
  upstream-skill: taobao-native
  upstream-version: "1.0.43"
  verified-against: "淘宝桌面版 2.5.1 (macOS)"
---

# Seller chat

Composes a question for a seller, sends it once the user has approved it, and
brings the answer back translated.

Opening a conversation is the send: the chat tool takes a message or an image and
refuses to open one empty, so the first chat call already reaches a person, under
the user's account, with no way to unsend. Everything that decides what goes out,
and to whom, happens before that call.

Every call goes through the companion, which owns the invocation, the answer
format and the failure classes:
[`../../references/taobao-companion.md`](../../references/taobao-companion.md).
How the result reaches the user is
[`../../references/taobao-presentation.md`](../../references/taobao-presentation.md).

## 1. Ask the page before asking the seller

Anything printed on the listing comes back in the same turn from
`hcb-taobao:item-details`; a seller answers in minutes to hours, and a question
the page already answers spends the user's standing with that shop. Chat is for
stock the page does not state, quantities beyond the listed ones, shipping
arrangements, customization, and the state of a placed order.

## 2. Name the shop the question goes to

Settle which shop before anything is composed, from the record the request came
with — the shop field of a search result, the cart entry, the order — or by
reading it off the listing page. Take the name as the client renders it: it goes
into the approval, it decides which lookup selects the conversation, and it is
what the sent conversation is checked against afterwards. Never take it from
whatever conversation the client happens to have open.

## 3. Compose in Chinese

- one question per message; a seller answers the first and skips the rest;
- name the thing concretely — the item id, the spec as the page spells it, the
  quantity — so the answer is about the right listing;
- plain 简体中文, a `你好` and the question, no padding;
- nothing the question does not need. Addresses, phone numbers, payment details
  and account identifiers do not go into a chat with a shop, whatever the shop
  asks for.

## 4. Get approval before the first chat call

Show the user the exact Chinese text, a translation into their language, the shop
it goes to, and the lookup that will select the conversation — the source and the
product name. Say that the next call delivers it and that it cannot be taken
back. Send on an explicit yes. That yes covers that text: an edit needs a new one,
and so does every follow-up message.

## 5. Send

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call open_chat --args-file /tmp/tb-chat.json
```

The args file carries the approved message together with the lookup that finds
the seller: `source` says where to look them up from — the cart or the order list
with a product name, a search with a query — and with no source the current page
decides. Pass the source that names the shop of step 2; leave it out only when
the page the client is on is one you established yourself, in this same chain of
calls.

An image travels the same way, as an absolute path — only a file the user pointed
at, and under the same approval.

## 6. Check where it landed

The message is gone by now, so this decides what the user is told and whether
anything further may be sent:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read
```

Take the shop name off the chat page and compare it with the approved one.
Anything but a match — a different shop, a page that yields no shop name, a
pathology verdict — is reported at once, naming the conversation the message
actually reached, and nothing more is sent until the user has approved a message
against that shop.

## 7. A second message

`send_chat_message` takes no recipient: it goes to whichever conversation the
client has open when it runs.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call send_chat_message --args-file /tmp/tb-msg.json
```

Run it only on a conversation a read has just confirmed, with no call in between
and with a text approved in that same turn. Where anything else has run since, or
the approval arrived a turn later with the client left unattended, read the page
again first — and stop rather than send when that read is not the approved shop.

## 8. Read the reply

This branch sends nothing, and it is the whole task when the user asks whether
the seller has answered. The reply lands on the chat page, never in the answer of
the call that sent the question.

The messages section is reached by the key the client itself publishes, never by
one written from memory:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call list_available_pages --args '{}'
```

Navigate to the key it gives for messages, then read:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate --args-file /tmp/tb-messages.json
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read --scope "[class*=message]"
```

Where that lands on the list of conversations rather than inside one, scan the
page, click the entry carrying that shop's name, and read again.

Read once. When nothing new is there, say so and let the user decide whether to
wait — the conversation stays open in the client, so a later check picks up
whatever arrived, while reading it over and over holds the client and answers
nothing.
Distinguish an automated greeting from the seller's own answer: the first is
instant and generic, and reporting it as a reply tells the user the question was
answered when it was not.

## 9. Hand it over

Render per the presentation reference. Where the reply commits the shop to
something — a price, stock, a ship date — state it as their claim rather than as
fact, and name what they left unanswered so the user can decide whether to press.

## 10. Hand on

- what the listing says — `hcb-taobao:item-details`;
- the cart, the order, or a review of what arrived —
  `hcb-taobao:cart-and-orders`;
- another seller to compare against — `hcb-taobao:product-search`.
