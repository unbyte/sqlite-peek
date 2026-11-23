import { expect, test } from 'vitest'
import { SQLiteReader } from '../src'
import { snapshot } from './fixture'

test('materializes JSON with exact integers, bytes, and arbitrary table and column names', () => {
  const db = new SQLiteReader(
    snapshot((db) => {
      db.exec(`
      CREATE TABLE "__proto__"("__proto__" INTEGER PRIMARY KEY, data, n, label, amount, score);
      CREATE TABLE "toJSON"(value);
      INSERT INTO "__proto__" VALUES (9223372036854775807, x'00ff', NULL, '分析', 1, 1.25);
      INSERT INTO "toJSON" VALUES (1e999), (-1e999);
      CREATE TABLE empty (id);
    `)
    }),
  )
  const expected = {
    ['__proto__']: [
      {
        ['__proto__']: '9223372036854775807',
        data: [0, 255],
        n: null,
        label: '分析',
        amount: 1,
        score: 1.25,
      },
    ],
    toJSON: [{ value: 'Infinity' }, { value: '-Infinity' }],
    empty: [],
  }
  expect(db.toJSON()).toEqual(expected)
  expect(JSON.parse(JSON.stringify(db))).toStrictEqual(expected)
  const [row] = db.rows('__proto__')
  expect(Object.getOwnPropertyDescriptor(row, '__proto__')?.value).toBe(9223372036854775807n)
})
