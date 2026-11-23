import { DatabaseFile } from './database-file'
import type { SQLiteValue } from './record'
import { TableLayout } from './schema'

export type { SQLiteValue } from './record'
export type SQLiteRow = Record<string, SQLiteValue>

type Table = { root: number; sql: string; layout?: TableLayout }

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

  *rows(name: string): Generator<SQLiteRow> {
    const table = this.tables.get(name)
    if (!table) throw new Error(`Unknown SQLite table "${name}"`)
    table.layout ??= new TableLayout(table.sql)
    const layout = table.layout
    for (const { values, rowid } of this.file.records(table.root, layout.withoutRowid)) {
      yield layout.row(values, rowid)
    }
  }
}
