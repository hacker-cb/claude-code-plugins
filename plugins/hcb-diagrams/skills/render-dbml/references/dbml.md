# DBML essentials for rendering

A compact reference for writing or fixing DBML that
[dbml-renderer](https://github.com/softwaretechnik-berlin/dbml-renderer) will
accept. Full language spec: <https://dbml.dbdiagram.io/docs/>.

## Tables

```dbml
Table "shop"."order" {            // schema-qualified; quotes optional for plain names
  "id" uuid [pk, not null]
  "created_at" timestamptz [not null, default: `now()`]
  "status" text [not null, default: 'new']    // string default: single quotes
  "customer_id" uuid [not null]
  "total" numeric(12,2)
  "note" text [note: 'free-form comment']

  Indexes {
    id [pk]
    (customer_id, created_at) [name: "order_customer_created_idx"]
    customer_id [unique, name: "one_order_per_customer"]
    `LOWER("email")` [unique]     // expression index goes in backticks
  }
}
```

Column settings (square brackets, comma-separated): `pk`, `primary key`,
`not null`, `null`, `unique`, `increment`, `default: <value>`,
`note: '<text>'`, `ref: > other.id` (inline ref).

Default values: number → bare (`default: 1`), string → single quotes
(`default: 'local'`), expression/function → backticks (`` default: `now()` ``),
boolean → bare (`default: true`).

Column types are free-form: anything without spaces parses (`uuid`,
`timestamptz`, `numeric(4,2)`, `varchar(255)`, `jsonb`, `daterange`). Types
with spaces (`double precision`, `timestamp with time zone`) do NOT parse —
quote-free DBML has no spaces in types; use `float8` / `timestamptz` style
aliases instead.

## Relationships

Standalone form (preferred — keeps tables clean), with optional name and
actions:

```dbml
Ref "order_customer_fk": "crm"."customer"."id" < "shop"."order"."customer_id" [update: cascade, delete: restrict]
```

Direction operators: `<` one-to-many (PK side on the left), `>` many-to-one,
`-` one-to-one, `<>` many-to-many. Composite refs use parentheses:
`"a"."t".(col1, col2) < "b"."u".(col1, col2)`.

## Enums and grouping

```dbml
Enum "order_status" {
  new
  paid
  shipped [note: 'left the warehouse']
}

Table "shop"."order" {
  "status" order_status [not null]
}

TableGroup billing {              // visual grouping in the diagram
  "shop"."order"
  "shop"."invoice"
}
```

## Translating SQL DDL → DBML

- One `Table` block per `CREATE TABLE`; keep the schema prefix
  (`Table "shop"."order"`).
- `PRIMARY KEY (a, b)` → `Indexes { (a, b) [pk] }`; single-column PK can stay
  a `[pk]` column setting.
- Each `FOREIGN KEY` / `REFERENCES` → a standalone `Ref` with the referenced
  (PK) side on the left of `<`; carry over `ON UPDATE` / `ON DELETE` as
  `[update: ..., delete: ...]`.
- `CREATE UNIQUE INDEX` → entry in `Indexes` with `[unique, name: "..."]`;
  partial-index `WHERE` clauses have no DBML equivalent — drop the predicate,
  keep the name.
- `CHECK` constraints, triggers, and sequences have no DBML equivalent — omit
  them (optionally keep as a `note`).
- Don't invent relationships: only emit a `Ref` for an actual FK (or when the
  user asks to infer them from `*_id` naming — then say you inferred them).

## Troubleshooting parser errors

dbml-renderer reports `line X column Y: expected ...` — read the exact
location, the cause is almost always one of:

- **Type with a space** (`double precision`) → use a no-space alias
  (`float8`).
- **Wrong default quoting** — functions/expressions must be in backticks:
  `` default: `now()` ``, not `default: now()`.
- **Reserved/special characters in names** without double quotes → quote the
  name (`"order"`, `"user"`).
- **Inline `ref:` with actions** — actions (`update:`/`delete:`) only work on
  standalone `Ref` lines, not inline column refs.
- **Expression index not in backticks** → `` `LOWER("email")` ``.
- **Comments**: only `//` line comments and `/* */` block comments exist;
  `#` is not a comment in DBML.
