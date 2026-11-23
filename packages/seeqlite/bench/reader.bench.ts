import { beforeAll, expect, inject, test } from 'vitest'
import { SQLiteReader } from '../src'

let bytes: Uint8Array
let reader: SQLiteReader

beforeAll(async () => {
  const response = await fetch(inject('snapshotUrl'))
  bytes = new Uint8Array(await response.arrayBuffer())
  reader = new SQLiteReader(bytes)
  const json = new TextEncoder().encode(JSON.stringify(reader))
  const digest = await crypto.subtle.digest('SHA-256', json)
  expect(Array.from(new Uint8Array(digest))).toEqual(inject('jsonDigest'))
})

const workloads = {
  'open and list tables × 500'() {
    let count = 0
    for (let i = 0; i < 500; i++) count += new SQLiteReader(bytes).listTables().length
    return count
  },
  'open and read 10 events × 100'() {
    let sum = 0
    for (let i = 0; i < 100; i++) {
      const preview = Array.from(new SQLiteReader(bytes).rows('events').take(10))
      sum += preview[9].id as number
    }
    return sum
  },
  'scan 40,000 events'() {
    let sum = 0
    for (const row of reader.rows('events')) sum += row.id as number
    return sum
  },
  'whole database toJSON': () => reader.toJSON().events.length,
  'whole database JSON.stringify': () => JSON.stringify(reader).length,
}

for (const [name, run] of Object.entries(workloads)) {
  test(name, async ({ bench }) => {
    await bench(name, { perProject: true }, run).run({
      time: 750,
      iterations: 12,
      warmupTime: 250,
      warmupIterations: 4,
    })
  })
}
