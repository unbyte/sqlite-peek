import { expect, test } from 'vitest'
import { SQLiteReader } from '../src'
import { snapshot } from './fixture'

test('lists stored user tables and reads exact column names from a byte range', () => {
  const bytes = snapshot((db) =>
    db.exec(`
    CREATE TABLE "__proto__"(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      [constructor] TEXT CHECK(length([constructor]) > 0),
      "a,""b)" BLOB DEFAULT x'00',
      -- A comment with a comma, and closing paren )
      "PRIMARY" TEXT DEFAULT 'it''s a (comma,)',
      FOREIGN KEY (id) REFERENCES "__proto__"(id)
    );
    CREATE INDEX by_name ON "__proto__"([constructor]);
    CREATE VIEW names AS SELECT [constructor] FROM "__proto__";
    CREATE TABLE empty (id INTEGER) STRICT;
    INSERT INTO "__proto__"([constructor]) VALUES ('hello');
  `),
  )
  const padded = new Uint8Array(bytes.length + 17)
  padded.set(bytes, 7)
  const reader = new SQLiteReader(padded.subarray(7, 7 + bytes.length))
  expect(reader.listTables()).toEqual(['__proto__', 'empty'])
  const [row] = reader.rows('__proto__')
  expect(row).toEqual({
    id: 1,
    constructor: 'hello',
    'a,"b)': new Uint8Array([0]),
    PRIMARY: "it's a (comma,)",
  })
  expect([...reader.rows('empty')]).toEqual([])
  expect(() => reader.rows('missing').next()).toThrow(/unknown.*table/i)
})

test('preserves signed rowids, integer widths, reals and empty values', () => {
  const integers = [
    -9223372036854775808n,
    -9007199254740992n,
    -140737488355329,
    -2147483649,
    -8388609,
    -32769,
    -129,
    -1,
    0,
    1,
    127,
    128,
    32768,
    8388608,
    2147483648,
    140737488355328,
    Number.MAX_SAFE_INTEGER,
    9223372036854775807n,
  ]
  const reader = new SQLiteReader(
    snapshot((db) => {
      db.exec('CREATE TABLE samples (v INTEGER, id INTEGER PRIMARY KEY, f REAL, t TEXT, b BLOB, n)')
      const insert = db.prepare("INSERT INTO samples VALUES (?, ?, -123.125, '', x'', NULL)")
      insert.setReadBigInts(true)
      for (const value of integers) insert.run(value, value)
    }),
  )
  expect([...reader.rows('samples')]).toEqual(
    integers.map((value) => ({
      v: value,
      id: value,
      f: -123.125,
      t: '',
      b: new Uint8Array(),
      n: null,
    })),
  )
})

test.each(['UTF-8', 'UTF-16le', 'UTF-16be'])(
  'decodes %s schema and overflow payloads',
  (encoding) => {
    const text = '\ufeff🪨界'.repeat(3000)
    const blob = Uint8Array.from({ length: 8192 }, (_, i) => i % 251)
    const reader = new SQLiteReader(
      snapshot((db) => {
        db.exec(
          `PRAGMA page_size=512; PRAGMA encoding='${encoding}'; CREATE TABLE "数据"("名前", b, tiny)`,
        )
        db.prepare('INSERT INTO 数据 VALUES (?, ?, ?)').run(text, blob, new Uint8Array([1, 2]))
      }),
    )
    const [row] = reader.rows('数据')
    expect(row).toEqual({ 名前: text, b: blob, tiny: new Uint8Array([1, 2]) })
    ;(row.tiny as Uint8Array).fill(0)
    expect(reader.rows('数据').next().value?.tiny).toEqual(new Uint8Array([1, 2]))
  },
)

test('scans interior and leaf records of WITHOUT ROWID tables in primary key order', () => {
  let expected: unknown[] = []
  const reader = new SQLiteReader(
    snapshot((db) => {
      db.exec(`
      PRAGMA page_size=512;
      CREATE TABLE pairs (
        payload TEXT, seq INTEGER, account TEXT, doubled INT AS (seq * 2) STORED,
        CONSTRAINT "pair key" PRIMARY KEY (ACCOUNT COLLATE NOCASE, seq DESC)
      ) WITHOUT ROWID, STRICT;
      BEGIN;
    `)
      const insert = db.prepare('INSERT INTO pairs (payload, seq, account) VALUES (?, ?, ?)')
      for (let i = 0; i < 1200; i++)
        insert.run('x'.repeat(i % 17 === 0 ? 1700 : 35), i, String(i % 13))
      db.exec('COMMIT')
      expected = db.prepare('SELECT * FROM pairs ORDER BY account COLLATE NOCASE, seq DESC').all()
    }),
  )
  expect([...reader.rows('pairs')]).toEqual(expected)
})

test('reads large schema trees and 64 KiB pages', () => {
  const tables = Array.from({ length: 400 }, (_, i) => `table_${i}`)
  for (const size of [512, 65536]) {
    const bytes = snapshot((db) => {
      db.exec(`PRAGMA page_size=${size}; BEGIN;`)
      for (const table of tables)
        db.exec(`CREATE TABLE ${table}(x); INSERT INTO ${table} VALUES (42)`)
      db.exec('COMMIT')
    })
    const reader = new SQLiteReader(bytes)
    expect(reader.listTables()).toEqual(tables)
    expect([...reader.rows('table_399')]).toEqual([{ x: 42 }])
  }
})

test('distinguishes rowid aliases from ordinary primary keys', () => {
  const reader = new SQLiteReader(
    snapshot((db) =>
      db.exec(`
    CREATE TABLE a(k "InTeGer", PRIMARY KEY (K DESC));
    CREATE TABLE b(k INTEGER PRIMARY KEY DESC);
    CREATE TABLE c(k INT PRIMARY KEY);
    CREATE TABLE d(k INTEGER, other TEXT, PRIMARY KEY(k, other));
    INSERT INTO a DEFAULT VALUES;
    INSERT INTO b DEFAULT VALUES;
    INSERT INTO c DEFAULT VALUES;
    INSERT INTO d DEFAULT VALUES;
  `),
    ),
  )
  expect([...reader.rows('a')]).toEqual([{ k: 1 }])
  for (const name of ['b', 'c', 'd']) expect(reader.rows(name).next().value?.k).toBeNull()
})

test('scans table pages on demand and detects a repeated child', () => {
  let root = 0
  const bytes = snapshot((db) => {
    db.exec(`PRAGMA page_size=512; CREATE TABLE t (n INTEGER PRIMARY KEY, label);
      WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n < 2500)
      INSERT INTO t SELECT n, printf('%040d', n) FROM seq;`)
    root = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='t'").get()?.rootpage)
  })
  const offset = (root - 1) * 512
  bytes.writeUInt32BE(root, offset + 8)
  const reader = new SQLiteReader(bytes)
  expect(reader.listTables()).toEqual(['t'])
  expect(reader.rows('t').next().value?.n).toBe(1)
  expect(() => Array.from(reader.rows('t'))).toThrow(/repeated SQLite page/)
})

test('handles old records with added nullable columns and reports values requiring SQL', () => {
  const reader = new SQLiteReader(
    snapshot((db) =>
      db.exec(`
    CREATE TABLE t(a);
    INSERT INTO t VALUES (1);
    ALTER TABLE t ADD COLUMN b;
    CREATE TABLE defaults(a);
    INSERT INTO defaults VALUES (1);
    ALTER TABLE defaults ADD COLUMN b TEXT DEFAULT 'new';
    CREATE TABLE computed(a, b AS (a + 1));
  `),
    ),
  )
  expect([...reader.rows('t')]).toEqual([{ a: 1, b: null }])
  expect(() => reader.rows('defaults').next()).toThrow(/schema default/)
  expect(() => reader.rows('computed').next()).toThrow(/virtual generated column/)
})

test('recognizes a header-only schema and rejects invalid or truncated input', () => {
  const empty = snapshot((db) => db.exec('VACUUM'))
  expect(new SQLiteReader(empty).listTables()).toEqual([])
  expect(() => new SQLiteReader(new Uint8Array(1536))).toThrow(/SQLite 3 database header/)
  expect(() => new SQLiteReader(empty.subarray(0, -1))).toThrow(/truncated/i)
})
