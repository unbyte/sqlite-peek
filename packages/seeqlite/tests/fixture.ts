import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function snapshot(populate: (db: DatabaseSync) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'seeqlite-'))
  const file = join(dir, 'fixture.db')
  try {
    const db = new DatabaseSync(file)
    try {
      populate(db)
    } finally {
      db.close()
    }
    return readFileSync(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
