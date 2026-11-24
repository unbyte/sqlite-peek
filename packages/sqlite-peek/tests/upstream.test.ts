import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { SQLiteReader } from '../src'
import { snapshot } from './fixture'

function fixture(path: string) {
  return new URL(`./fixtures/${path}`, import.meta.url)
}

function sqliteRows(db: DatabaseSync, query: string) {
  const statement = db.prepare(query)
  statement.setReadBigInts(true)
  const rows = statement.all()
  for (const row of rows) {
    for (const [name, value] of Object.entries(row)) {
      if (
        typeof value === 'bigint' &&
        value >= Number.MIN_SAFE_INTEGER &&
        value <= Number.MAX_SAFE_INTEGER
      ) {
        row[name] = Number(value)
      }
    }
  }
  return rows
}

test.each([
  { file: 'sql.js/test.sqlite', tables: [['test', 'rowid']] },
  { file: 'sqlittle/values.sqlite', tables: [['things', 'rowid']] },
  { file: 'sqlittle/overflow.sqlite', tables: [['mytable', 'rowid']] },
  { file: 'sqlittle/funkykey.sqlite', tables: [['fuz', 'c, a']] },
  {
    file: 'sqlittle/music.sqlite',
    tables: [
      ['artists', 'id'],
      ['albums', 'id'],
      ['tracks', 'id'],
    ],
  },
])('$file matches SQLite for every table and row', ({ file, tables }) => {
  const path = fixture(file)
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const reader = new SQLiteReader(readFileSync(path))
    expect(reader.listTables()).toEqual(tables.map(([name]) => name))
    for (const [name, order] of tables) {
      expect([...reader.rows(name)]).toStrictEqual(
        sqliteRows(db, `SELECT * FROM "${name}" ORDER BY ${order}`),
      )
    }
  } finally {
    db.close()
  }
})

test('SQLite boundary1-1.1 preserves all 64 rowids through JSON', () => {
  const sql = readFileSync(fixture('sqlite/boundary1-1.1.sql'), 'utf8')
  const expected: unknown[] = []
  const bytes = snapshot((db) => {
    db.exec(sql)
    for (const { a, x } of db.prepare('SELECT a, x FROM t1 ORDER BY oid').all()) {
      // Upstream pairs each rowid with its 64-bit two's-complement hex representation.
      const id = BigInt.asIntN(64, BigInt(`0x${x}`))
      const oid = Number.isSafeInteger(Number(id)) ? Number(id) : String(id)
      expected.push({ oid, a, x })
    }
  })
  expect(expected).toHaveLength(64)
  expect(new SQLiteReader(bytes).toJSON().t1).toEqual(expected)
})

test('SQLittle alter.sqlite reports the missing schema default', () => {
  const path = fixture('sqlittle/alter.sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    expect(db.prepare('SELECT count(*) AS n FROM words WHERE something = 42').get()?.n).toBe(1000)
    const reader = new SQLiteReader(readFileSync(path))
    expect(() => reader.rows('words').next()).toThrow(/something.*schema default/)
  } finally {
    db.close()
  }
})

test('SQLite without_rowid7-2.1 reports the repeated key with different collations', () => {
  const bytes = snapshot((db) => {
    db.exec(`
      CREATE TABLE t2(a, b, PRIMARY KEY(a COLLATE nocase, a)) WITHOUT ROWID;
      INSERT INTO t2 VALUES(1, 'one');
    `)
    expect(db.prepare('SELECT b FROM t2').get()?.b).toBe('one')
  })
  expect(() => new SQLiteReader(bytes).rows('t2').next()).toThrow(/repeated columns/i)
})
