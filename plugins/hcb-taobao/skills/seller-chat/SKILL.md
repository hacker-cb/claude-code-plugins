---
name: seller-chat
description: >-
  Use this skill whenever the user wants to talk to a Taobao or Tmall seller —
  "спроси продавца", "ask the shop whether it ships", "message customer
  service", "напиши в чат", chasing an order, checking stock the listing never
  states, asking for a quantity discount, or opening 旺旺 at all. It fixes the
  recipient first, by opening that seller's own listing or shop page and
  confirming it, composes the question in Chinese, and shows the exact text, a
  translation and the shop it reaches, sending only on an explicit yes — opening
  the conversation is itself the send, it reaches a live person under their
  account, and nothing can be recalled. Where no single seller is pinned down it
  stops and asks. Reading a seller's answer back, translated, is the other half
  and sends nothing at all. Ask the listing first: what the page prints comes
  back in the same turn from hcb-taobao:item-details, while a seller takes
  hours. Cart and order context comes from hcb-taobao:cart-and-orders. It never
  adds to a cart and never pays.
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
the user's account, with no way to unsend. Which person it reaches is decided by
the page the client stands on when that call runs — so the page is established
and confirmed first, and everything that decides what goes out happens before the
call.

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

## 2. Pin the question to one listing or one shop

The recipient is a page, never a name: a name is matched by a lookup inside the
client, and where it matches more than one seller the choice is made for you.
Settle which listing — or which shop, where the question is about the shop rather
than one item — the question is about, and carry its addressable key:

- a search record — its `itemId`, or its shop link;
- a cart line or an order line — filter the page down to that line, then take the
  item id or the shop link off it;
- what the user was looking at — the product or shop entry of the browse history;
- a listing you opened earlier in this same chain of calls — the id it was opened
  with.

Where the request does not resolve to exactly one of them — several cart lines
answer to the words the user used, the same product came back from several shops,
the order holds items from more than one seller — stop and ask which one. An
ambiguity settled by guessing is a message delivered to a stranger.

## 3. Establish the page and confirm it

Build the item or shop URL as the presentation reference specifies and open it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call navigate_to_url --args-file /tmp/tb-seller.json
```

Confirm what the client is standing on, keying on the id and the anchors the
translator leaves alone rather than on rendered wording:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call get_current_tab --args '{}'
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read
```

It has to be the listing or the shop pinned in step 2, and it has to name a shop.
Take that name as the client renders it — that is the recipient, and it is what
goes into the approval. A page carrying a different id, a page that yields no shop
name, or a pathology verdict is a stop: report what came back and send nothing.

The cart, the order list and a page of search results do not establish a
recipient. Standing on one of them, the chat tool selects a conversation by
product name instead of by the page, which is the ambiguity step 2 exists to
remove. Only a listing page or a shop page fixes who receives the message.

## 4. Compose in Chinese

- one question per message; a seller answers the first and skips the rest;
- name the thing concretely — the item id, the spec as the page spells it, the
  quantity — so the answer is about the right listing;
- plain 简体中文, a `你好` and the question, no padding;
- nothing the question does not need. Addresses, phone numbers, payment details
  and account identifiers do not go into a chat with a shop, whatever the shop
  asks for.

## 5. Get approval before the first chat call

Show the user the exact Chinese text, a translation into their language, and the
shop it goes to as read off the established page, with the link to that page. Say
that the next call delivers it and that it cannot be taken back. Send on an
explicit yes. That yes covers that text: an edit needs a new one, and so does
every follow-up message.

## 6. Send from the established page

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call open_chat --args-file /tmp/tb-chat.json
```

The args file carries the approved message and nothing that names a recipient:
with no `source`, the chat opens off the page the client is standing on. Never
pass `source`, `productName` or `query` — each of them hands the choice of
recipient back to a lookup by name.

Run it straight after the confirming read of step 3, with no call in between: a
call that moves the client moves the recipient with it. Where the yes arrived a
turn later, or anything else has run since, walk step 3 again first and send only
on the same page confirming again.

An image travels the same way, as an absolute path — only a file the user pointed
at, and under the same approval.

## 7. Report where it landed

The message is gone by now; this is what the user is told, and what decides
whether anything further may be sent:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" read
```

Take the shop name off the chat page and compare it with the approved one.
Anything but a match — a different shop, a page that yields no shop name, a
pathology verdict — is reported at once, naming the conversation the message
actually reached, and nothing more is sent until the user has approved a message
against that shop.

## 8. A second message

`send_chat_message` takes no recipient: it goes to whichever conversation the
client has open when it runs.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tb.mjs" call send_chat_message --args-file /tmp/tb-msg.json
```

Run it only on a conversation a read has just confirmed, with no call in between
and with a text approved in that same turn. Where anything else has run since, or
the approval arrived a turn later with the client left unattended, read the page
again first — and stop rather than send when that read is not the approved shop.

## 9. Read the reply

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

## 10. Hand it over

Render per the presentation reference. Where the reply commits the shop to
something — a price, stock, a ship date — state it as their claim rather than as
fact, and name what they left unanswered so the user can decide whether to press.

## 11. Hand on

- what the listing says — `hcb-taobao:item-details`;
- the cart, the order, or a review of what arrived —
  `hcb-taobao:cart-and-orders`;
- another seller to compare against — `hcb-taobao:product-search`.
