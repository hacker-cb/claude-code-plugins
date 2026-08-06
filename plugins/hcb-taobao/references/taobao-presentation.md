# Presenting what the client returns

## Every product is a link

Build the URL from the item id and nothing else:

```text
https://item.taobao.com/item.htm?id=<itemId>
```

The `productUrl` field that comes back with a search result is not a product
link. It arrives in three shapes, and two of them are unusable: a tracking URL
carrying `spm`, `utparam` and friends, and an ad-slot redirect through
`click.simba.taobao.com` that contains no item id at all. Rebuilding from
`itemId` gives one clean, shareable form for every listing.

A shop link is the `shopUrl` field with its tracking tail cut at `&spm`, leaving
`https://store.taobao.com/category.htm?appUid=<token>`. That opaque token is the
addressable key — there is no shop id to build from.

Which marketplace a listing sits on is readable off the page title: it ends in
`-淘宝网` for Taobao and `-tmall.com天猫` for Tmall.

## Images come free with the search

Search results carry an `image` URL that covers every listing, so a picture never
needs a second call. Some of these end in `_.webp`; strip that suffix or the
image will not render.

## The card

Name, price and link belong together, with the link text carrying the name — a
bare URL beside a name reads as a footnote and gets skipped:

```markdown
[EC-I3588J, ¥3 309](https://item.taobao.com/item.htm?id=673089864770) — Firefly, 4×SATA
```

Never show the raw title. It is either Chinese the user may not read, or
machine-translated English with the words glued together; write the name
yourself from what the listing actually is.

Prices come back as bare strings with no currency marker — render them as ¥.
Where a figure is genuinely unknown, say so in place of it rather than leaving a
blank, which reads as zero.

For anything beyond a handful of listings, a table beats prose: model, seller,
the two or three specs that decide the choice, and price. Put the answer to the
user's actual question above it in one line, and name what was **not** found —
an absent option is a finding, and silence about it reads as an oversight.

## Language

Address the user in the language of the conversation, following whatever
preference they have shown. Everything sent to Taobao goes in Chinese —
search keywords, and messages to sellers.

Text coming back is Chinese on one page and machine-translated English on the
next, so translate it into the user's language rather than passing it through. A
seller's reply always reaches the user translated, with the original available if
they ask for it.
