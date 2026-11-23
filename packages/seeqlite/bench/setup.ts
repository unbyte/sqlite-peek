import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { TestProject } from 'vitest/node'
import { snapshot } from '../tests/fixture'

declare module 'vitest' {
  interface ProvidedContext {
    jsonDigest: number[]
    snapshotUrl: string
  }
}

export default function setup(project: TestProject) {
  const sql = readFileSync(new URL('./analysis.sql', import.meta.url), 'utf8')
  const bytes = snapshot((db) => {
    db.exec(sql)
    const expected = {
      events: db.prepare('SELECT * FROM events ORDER BY id').all(),
      samples: db.prepare('SELECT * FROM samples ORDER BY event_id').all(),
    }
    const json = JSON.stringify(expected, (_, value) =>
      value instanceof Uint8Array ? Array.from(value) : value,
    )
    project.provide('jsonDigest', Array.from(createHash('sha256').update(json).digest()))
  })
  project.provide('snapshotUrl', `data:application/octet-stream;base64,${bytes.toString('base64')}`)
}
