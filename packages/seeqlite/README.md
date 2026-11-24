# seeqlite

A pure JS library to read SQLite database from a `Uint8Array`.

```js
import { SQLiteReader } from 'seeqlite'

const db = new SQLiteReader(bytes)
const tables = db.listTables()
const firstTen = Array.from(db.rows('events').take(10))
const json = JSON.stringify(db)
```

## Reading tables

`db.listTables()` returns the names of stored user tables. Pass an exact name from that list to `db.rows(name)`. Views, virtual tables, and SQLite's internal `sqlite_*` tables are omitted. An extension's shadow tables can appear if they store rows of their own.

The reader decodes rows as you iterate. Keep the input bytes intact for the lifetime of the reader. Each call to `db.rows(name)` starts a fresh iterator. Use `Array.from(db.rows(name))` to collect the whole table.

Each row is an object with a null prototype and a property for each declared column. Rowid tables iterate in rowid order. An `INTEGER PRIMARY KEY` alias contains its rowid. `WITHOUT ROWID` tables iterate in primary key order.

## Converting to JSON

`db.toJSON()` returns an object keyed by table name. Each value is an array of rows, or `[]` for an empty table. `JSON.stringify(db)` calls this method automatically.

| SQLite value                            | `db.rows(name)` value     | JSON                          |
| --------------------------------------- | ------------------------- | ----------------------------- |
| NULL                                    | `null`                    | `null`                        |
| Text                                    | String                    | String                        |
| Safe integer or finite real             | Number                    | Number                        |
| Integer outside JavaScript's safe range | `bigint`                  | Exact decimal string          |
| Positive or negative infinity           | `Infinity` or `-Infinity` | `"Infinity"` or `"-Infinity"` |
| Blob                                    | Independent `Uint8Array`  | Array of bytes from 0 to 255  |

## Preparing a snapshot

Finish the write transaction and close the producer's SQLite connections before copying the database. If the producer keeps a WAL-mode database open, checkpoint its committed transactions and take the snapshot while writes are paused. The reader sees only the bytes in the supplied main database file. [SQLite file format](https://sqlite.org/fileformat2.html)

Use tables with stored columns. The reader reports an error when a table requires computing a virtual generated column, when an older record needs an explicit default other than bare NULL after `ALTER TABLE ... ADD COLUMN`, or when a `WITHOUT ROWID` primary key repeats a column. Stored generated columns and defaults already present in records are readable.
