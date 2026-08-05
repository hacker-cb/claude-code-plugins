# hcb-taobao

Shopping and sourcing on Taobao and Tmall from inside Claude Code: keyword
research and supplier shortlists, a listing's real price, SKUs, specs and
reviews, resolving a variant into the cart, your orders, and talking to sellers.
It stops at the cart — the client exposes no checkout, and paying stays with
you. Part of the
[`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins)
marketplace.

Nothing here talks to Taobao over the web. Every call goes to the **Taobao
desktop client** running on your machine, through a bundled companion that paces
requests around the anti-bot throttle, tells a genuinely empty result from a
silent block, and recognises the failures the vendor CLI reports as success.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-taobao@hacker-cb-plugins
```

## Requirements

- **淘宝桌面版** — the Taobao desktop client — installed and **signed in**. Your
  account, your session, your cart; the plugin drives the client you already use.
- **启用 AI 代理** (*enable AI agent*) switched on in the client's own settings.
  It is off by default, and no call works until you flip it — which only you can
  do, in the client's own UI. All the plugin can do is notice it is off and say
  so.
- **Node.js** on `PATH`. The companion is a plain `.mjs` script with no
  dependencies to install.

## Skills

- **`product-search`** — `/hcb-taobao:product-search`
  Find things. Searches in Chinese, sweeps a category across several keywords
  instead of asking one for more pages, merges the runs into one deduplicated
  set, groups it by seller, and hands back a shortlist with a working link per
  listing.
- **`item-details`** — `/hcb-taobao:item-details`
  Read one listing properly — the price that actually applies against the
  crossed-out one, which SKU combinations exist and which are sold out, the spec
  table, the seller, the reviews and the Q&A.
- **`cart-and-orders`** — `/hcb-taobao:cart-and-orders`
  Everything after the choice: resolve a variant into a concrete SKU and add it
  to the cart, look through the cart, find an order, check what you browsed
  recently, leave a review. Placing and paying for the order stays with you.
- **`seller-chat`** — `/hcb-taobao:seller-chat`
  Ask a seller what the listing does not say — stock, lead time, bulk price,
  whether a part is the revision you need — in Chinese, with the replies
  translated back.

## Shared references

The map of what the skills read, for people; the skills link these themselves.

- [`references/taobao-companion.md`](references/taobao-companion.md) — the
  companion's contract: subcommands, flags, the single-line JSON answer, and what
  each class of failure means.
- [`references/taobao-presentation.md`](references/taobao-presentation.md) — how
  a result reaches you: building a shareable item URL, images, the card and table
  shapes, and which language goes in which direction.

## The client is single-seat: `lock_mode`

The desktop client takes one driver at a time, so the companion holds a lock
while it works and hooks release it as soon as the session goes idle or ends.
`lock_mode` decides what happens when a *different* session already holds it:

| Value | Behaviour |
| --- | --- |
| `off` | ignore the lock entirely |
| `warn` | say who holds it and proceed (default) |
| `ask` | stop and ask you |
| `deny` | refuse the call |

It is a plugin
[user config](https://code.claude.com/docs/en/plugins-reference#user-configuration),
so Claude Code prompts for it when you enable the plugin and writes your answer
into your **user** `settings.json` under
[`pluginConfigs`](https://code.claude.com/docs/en/settings#pluginconfigs). Change
it later from `/plugin`, or by editing that file.

Where it is read from matters: Claude Code takes `pluginConfigs` from your user
settings, the `--settings` flag, and managed (organization) settings — and
**ignores** a project's `.claude/settings.json` or `.claude/settings.local.json`.
A repository you clone therefore cannot lower the setting on you.

For one session, override it from the environment instead:

```bash
HCB_TAOBAO_LOCK_MODE=deny claude
```

## Verified on / not verified

**Verified**: macOS, Taobao desktop client **2.5.1**. Everything the skills
describe was run against that client.

**Not verified**: Windows. The Windows paths are written from the client's own
sources and documentation but have never been executed there. Three things in
particular are unproven — the named pipe's name, taking the lock on it, and
bringing the application up. Treat Windows as untested rather than unsupported,
and expect the first run to need fixing.

## Privacy

**Every call is reported to Alibaba's telemetry.** The client sends the tool
name, the request text (up to 500 characters), and a label identifying the
calling application. That is the client's behaviour, not something this plugin
adds or can switch off — searching for a part number here is as public as
searching for it in the app.

The same calling-app label is also appended to the query string of any URL the
client opens, so it travels to the page you land on.

Locally, a normal run does **not** write call contents to disk: the client's file
log runs at `warn`, and the lines carrying the calls are `info`. Raising the log
level changes that.

## Origin

Based on the vendor's own `taobao-native` skill, **v1.0.43**, reworked for this
marketplace and verified against desktop client 2.5.1.
