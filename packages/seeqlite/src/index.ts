import { DatabaseFile } from './database-file'
import type { SQLiteValue } from './record'
import { TableLayout } from './schema'

export type { SQLiteValue } from './record'
export type SQLiteRow = Record<string, SQLiteValue>
export type JSONRow = Record<string, null | number | string | number[]>

type Table = { root: number; sql: string; layout?: TableLayout }

function jsonRow(row: SQLiteRow): JSONRow {
  const result: JSONRow = Object.create(null)
  for (const name of Object.keys(row)) {
    const value = row[name]
    if (value instanceof Uint8Array) {
      const bytes = new Array<number>(value.length)
      for (let i = 0; i < bytes.length; i++) bytes[i] = value[i]
      result[name] = bytes
    } else if (
      typeof value === 'bigint' ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      result[name] = String(value)
    } else {
      result[name] = value
    }
  }
  return result
}

export class SQLiteReader {
  private readonly file: DatabaseFile
  private readonly tables = new Map<string, Table>()

  constructor(bytes: Uint8Array) {
    this.file = new DatabaseFile(bytes)
    for (const {
      values: [type, name, , root, sql],
    } of this.file.records(1)) {
      if (type !== 'table' || typeof name !== 'string' || /^sqlite_/i.test(name)) continue
      if (typeof root !== 'number' || typeof sql !== 'string')
        throw new Error('Invalid SQLite table entry')
      if (root !== 0) this.tables.set(name, { root, sql })
    }
  }

  listTables() {
    return [...this.tables.keys()]
  }

  *rows(name: string): Generator<SQLiteRow, void> {
    const table = this.tables.get(name)
    if (!table) throw new Error(`Unknown SQLite table "${name}"`)
    table.layout ??= new TableLayout(table.sql)
    const layout = table.layout
    for (const { values, rowid } of this.file.records(table.root, layout.withoutRowid)) {
      yield layout.row(values, rowid)
    }
  }

  toJSON() {
    const tables: Record<string, JSONRow[]> = Object.create(null)
    for (const name of this.tables.keys()) {
      tables[name] = Array.from(this.rows(name), jsonRow)
    }
    return tables
  }
}
