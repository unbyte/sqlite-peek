export type SQLiteValue = null | number | bigint | string | Uint8Array

export function integer(value: bigint) {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
}

export class Cursor {
  constructor(
    readonly view: DataView,
    public offset = 0,
  ) {}

  varint() {
    // Seven groups of seven bits always fit in a JavaScript number.
    let value = 0
    for (let i = 0; i < 7; i++) {
      const byte = this.view.getUint8(this.offset++)
      value = value * 128 + (byte & 0x7f)
      if (byte < 0x80) return value
    }
    const eighth = this.view.getUint8(this.offset++)
    const wide = (BigInt(value) << 7n) | BigInt(eighth & 0x7f)
    if (eighth < 0x80) return wide
    // The ninth byte contributes all eight bits.
    return (wide << 8n) | BigInt(this.view.getUint8(this.offset++))
  }

  take(length: number) {
    if (length > this.view.byteLength - this.offset) {
      throw new Error('Truncated SQLite payload')
    }
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
    this.offset += length
    return bytes
  }
}

const integerWidths = [0, 1, 2, 3, 4, 6]

function readValue(serial: number, body: Cursor, decoder: TextDecoder): SQLiteValue {
  if (serial === 0) return null
  if (serial <= 5) {
    let value = body.view.getInt8(body.offset++)
    for (let i = 1; i < integerWidths[serial]; i++) {
      value = value * 256 + body.view.getUint8(body.offset++)
    }
    return value
  }
  if (serial === 6 || serial === 7) {
    const offset = body.offset
    body.offset += 8
    return serial === 6 ? integer(body.view.getBigInt64(offset)) : body.view.getFloat64(offset)
  }
  if (serial <= 9) return serial - 8
  if (serial <= 11) throw new Error('Reserved SQLite record type')
  const bytes = body.take(Math.floor((serial - 12) / 2))
  return serial % 2 === 0 ? bytes.slice() : decoder.decode(bytes)
}

export function decodeRecord(view: DataView, decoder: TextDecoder) {
  const header = new Cursor(view)
  const headerSize = Number(header.varint())
  if (headerSize < header.offset || headerSize > view.byteLength) {
    throw new Error('Invalid SQLite record header')
  }
  const body = new Cursor(view, headerSize)
  const values: SQLiteValue[] = []
  while (header.offset < headerSize) {
    values.push(readValue(Number(header.varint()), body, decoder))
  }
  if (header.offset !== headerSize || body.offset !== view.byteLength) {
    throw new Error('Invalid SQLite record length')
  }
  return values
}
