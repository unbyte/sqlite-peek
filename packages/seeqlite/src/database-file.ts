import { Cursor, decodeRecord, integer, type SQLiteValue } from './record'

type StoredRow = { values: SQLiteValue[]; rowid?: number | bigint }

const signature = new TextEncoder().encode('SQLite format 3\0')
const encodings = ['utf-8', 'utf-8', 'utf-16le', 'utf-16be']

export class DatabaseFile {
  private readonly pageSize: number
  private readonly usableSize: number
  private readonly pageCount: number
  private readonly decoder: TextDecoder

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.byteLength < 100 || !signature.every((byte, i) => bytes[i] === byte)) {
      throw new Error('Expected a SQLite 3 database header')
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, 100)
    const size = header.getUint16(16)
    this.pageSize = size === 1 ? 65536 : size
    this.usableSize = this.pageSize - bytes[20]
    if (
      this.pageSize < 512 ||
      (this.pageSize & (this.pageSize - 1)) !== 0 ||
      this.usableSize < 480
    ) {
      throw new Error('Invalid SQLite page size')
    }
    if (
      (bytes[19] !== 1 && bytes[19] !== 2) ||
      header.getUint32(44) > 4 ||
      bytes[21] !== 64 ||
      bytes[22] !== 32 ||
      bytes[23] !== 32
    ) {
      throw new Error('Unsupported SQLite file format')
    }
    const physicalPages = bytes.byteLength / this.pageSize
    const declaredPages = header.getUint32(28)
    this.pageCount =
      declaredPages && header.getUint32(24) === header.getUint32(92) ? declaredPages : physicalPages
    if (!Number.isInteger(physicalPages) || this.pageCount > physicalPages) {
      throw new Error('Truncated SQLite database')
    }
    const encoding = header.getUint32(56)
    if (encoding > 3 || (encoding === 0 && header.getUint32(44) !== 0)) {
      throw new Error('Unsupported SQLite text encoding')
    }
    this.decoder = new TextDecoder(encodings[encoding], { ignoreBOM: true })
  }

  private page(number: number, visited: Set<number>) {
    if (number < 1 || number > this.pageCount || visited.has(number)) {
      throw new Error(`Invalid or repeated SQLite page ${number}`)
    }
    visited.add(number)
    return new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + (number - 1) * this.pageSize,
      this.usableSize,
    )
  }

  private payload(cell: Cursor, size: number, index: boolean, visited: Set<number>) {
    const usable = this.usableSize
    const maxLocal = index ? Math.floor(((usable - 12) * 64) / 255) - 23 : usable - 35
    if (size <= maxLocal) return cell.take(size)
    if (size > this.bytes.byteLength) throw new Error('Invalid SQLite payload size')

    // SQLite distributes overflow so the last page is full when the local cell permits it.
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23
    const candidate = minLocal + ((size - minLocal) % (usable - 4))
    const local = cell.take(candidate <= maxLocal ? candidate : minLocal)
    let next = cell.view.getUint32(cell.offset)
    const bytes = new Uint8Array(size)
    bytes.set(local)
    for (let offset = local.length; offset < size; ) {
      const overflow = this.page(next, visited)
      next = overflow.getUint32(0)
      const length = Math.min(usable - 4, size - offset)
      bytes.set(new Uint8Array(overflow.buffer, overflow.byteOffset + 4, length), offset)
      offset += length
    }
    if (next !== 0) throw new Error('Invalid SQLite overflow chain length')
    return bytes
  }

  records(root: number, index = false) {
    return this.walk(root, index, new Set())
  }

  private *walk(number: number, index: boolean, visited: Set<number>): Generator<StoredRow> {
    const page = this.page(number, visited)
    const header = number === 1 ? 100 : 0
    const type = page.getUint8(header)
    const interior = type === (index ? 2 : 5)
    if (!interior && type !== (index ? 10 : 13))
      throw new Error('Unexpected SQLite b-tree page type')
    const count = page.getUint16(header + 3)
    const pointers = header + (interior ? 12 : 8)
    if (pointers + count * 2 > this.usableSize) throw new Error('Invalid SQLite cell pointer array')

    for (let i = 0; i < count; i++) {
      const offset = page.getUint16(pointers + i * 2)
      if (offset < pointers + count * 2) throw new Error('Invalid SQLite cell offset')
      const cell = new Cursor(page, offset)
      if (interior) {
        yield* this.walk(page.getUint32(offset), index, visited)
        if (!index) continue
        cell.offset += 4
      }
      const size = Number(cell.varint())
      const rowid = index ? undefined : integer(BigInt.asIntN(64, cell.varint()))
      const values = decodeRecord(this.payload(cell, size, index, visited), this.decoder)
      yield { rowid, values }
    }
    if (interior) yield* this.walk(page.getUint32(header + 8), index, visited)
  }
}
