# Upstream test fixtures

Run `pnpm test` at the repository root. The compatibility tests open the checked-in databases read-only with `node:sqlite` and compare every stored user table in its expected scan order. All inputs are local.

## sql.js

`sql.js/test.sqlite` is the unchanged input to the sql.js Node file-loading test. Its five rows mix text and blobs in the same declared column. The accompanying `LICENSE` is from the same revision. [Upstream test and revision](https://github.com/sql-js/sql.js/blob/848ebd0a420191143abb45feba5cae2f8043d96a/test/test_node_file.js)

## SQLittle

The following databases and `sqlittle/LICENSE` are unchanged copies from the SQLittle read-only Go reader. Each database has a corresponding generation script in the upstream directory. [Pinned testdata directory](https://github.com/alicebob/sqlittle/tree/4edd2560b8519f0afe0a702c690a5dc2452af2d5/testdata)

| Database          | Case                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `values.sqlite`   | Signed integer storage widths, floats, NULL and empty text                                                        |
| `overflow.sqlite` | A text value spanning multiple pages                                                                              |
| `funkykey.sqlite` | A composite primary key changes physical column order in a `WITHOUT ROWID` table                                  |
| `music.sqlite`    | Three related tables, including autoincrement keys and a `WITHOUT ROWID` table                                    |
| `alter.sqlite`    | SQLite supplies 42 for 1,000 rows written before the column existed. The test checks the reader's explicit error. |

## SQLite

`sqlite/boundary1-1.1.sql` contains the setup SQL from SQLite's public-domain `boundary1-1.1` test. The only schema change declares `oid INTEGER PRIMARY KEY` so the reader exposes the rowid. All 64 decimal rowids and their paired hexadecimal representations come from upstream. [SQLite boundary1.test](https://github.com/sqlite/sqlite/blob/ccd445d76a9362c63add000354fac84ba9022176/test/boundary1.test#L24-L94)

The repeated-key test in `../upstream.test.ts` uses the schema and insert from `without_rowid7-2.0` and `2.1`. SQLite stores the same primary key column twice with different collations. This case checks the reader's documented rejection. [SQLite without_rowid7.test](https://github.com/sqlite/sqlite/blob/ccd445d76a9362c63add000354fac84ba9022176/test/without_rowid7.test#L31-L52)
