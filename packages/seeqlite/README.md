# seeqlite

Read SQLite snapshots in a browser from a `Uint8Array`. The package ships as JavaScript with TypeScript declarations and has zero runtime dependencies.

```js
import { SQLiteReader } from 'seeqlite'

const response = await fetch('./analysis.sqlite')
if (!response.ok) throw new Error(`Loading the analysis failed (${response.status})`)

const db = new SQLiteReader(new Uint8Array(await response.arrayBuffer()))
console.log(db.listTables())

for (const row of db.rows('events').take(10)) {
  console.log(row)
}
```

For a static page without a bundler, copy the package's `lib/index.mjs` beside the page and import `SQLiteReader` from `./index.mjs` inside a module script.

## Reading tables

`new SQLiteReader(bytes)` reads the database header and schema catalog. It retains the supplied byte range for the reader's lifetime. Keep that range intact while using the reader.

`db.listTables()` returns the names of stored tables, excluding SQLite's internal `sqlite_*` tables. Views and virtual tables have no table rows of their own in the file. Extension shadow tables with their own storage can appear in the list.

`db.rows(name)` returns a fresh synchronous iterator. Pass the exact name from `listTables()`. Each row is an object with the declared column names as its own properties and a null prototype. Iteration reads one record at a time, assembling overflow payloads as needed. For a complete table, use `Array.from(db.rows(name))`.

Rowid tables iterate in rowid order. An `INTEGER PRIMARY KEY` alias contains its rowid. `WITHOUT ROWID` tables iterate in primary key order. Both expose values under the original column names. Safe integers and reals are JavaScript numbers, larger integers are exact `bigint` values, blobs are independent `Uint8Array` instances, and SQL NULL is `null`.

## Preparing a snapshot

Finish the write transaction and close the producer's SQLite connections before copying the database. If the producer keeps a WAL-mode database open, checkpoint its committed transactions and take the snapshot while writes are paused. The reader sees only the bytes in the supplied main database file. [SQLite file format](https://sqlite.org/fileformat2.html)

Use tables with stored columns. The reader reports an error when a table requires computing a virtual generated column, when an older record needs an explicit default other than bare NULL after `ALTER TABLE ... ADD COLUMN`, or when a `WITHOUT ROWID` primary key repeats a column. Stored generated columns and defaults already present in records are readable.
