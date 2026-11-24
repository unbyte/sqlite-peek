import type { SQLiteValue } from './record'

type Token = string | Token[]

function uppercase(text: string) {
  return text.replace(/[a-z]/g, (char) => char.toUpperCase())
}

function keyword(token: Token | undefined) {
  return typeof token === 'string' ? uppercase(token) : ''
}

function identifier(token: Token | undefined) {
  if (typeof token !== 'string' || !token) throw new Error('Expected a SQLite identifier')
  const quote = token[0]
  if (quote === '[') return token.slice(1, -1)
  if (quote === '"' || quote === "'" || quote === '`') {
    return token.slice(1, -1).replaceAll(quote + quote, quote)
  }
  return token
}

// Parenthesized expressions are opaque to the table layout parser.
function tokenize(sql: string) {
  const pattern =
    /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"]|"")*"|'(?:[^']|'')*'|`(?:[^`]|``)*`|\[[^\]]*\]|[\w$\u0080-\u{10ffff}]+|[^ \t\r\n\f]/gu
  const root: Token[] = []
  const parents: Token[][] = []
  let tokens = root
  for (const [token] of sql.matchAll(pattern)) {
    if (token.startsWith('--') || token.startsWith('/*')) continue
    if (token === '(') {
      parents.push(tokens)
      const group: Token[] = []
      tokens.push(group)
      tokens = group
    } else if (token === ')') {
      const parent = parents.pop()
      if (!parent) throw new Error('Unexpected closing parenthesis in SQLite schema')
      tokens = parent
    } else {
      tokens.push(token)
    }
  }
  if (parents.length) throw new Error('Unclosed parenthesis in SQLite schema')
  return root
}

function* commaSeparated(tokens: Token[]) {
  let start = 0
  for (let i = 0; i <= tokens.length; i++) {
    if (i === tokens.length || tokens[i] === ',') {
      yield tokens.slice(start, i)
      start = i + 1
    }
  }
}

type Column = {
  name: string
  rowidEligible: boolean
  inlinePrimaryKey: boolean
  needsDefault: boolean
  position: number
}

const constraints = new Set([
  'CONSTRAINT',
  'PRIMARY',
  'NOT',
  'NULL',
  'UNIQUE',
  'CHECK',
  'DEFAULT',
  'COLLATE',
  'REFERENCES',
  'GENERATED',
  'AS',
])

function parseColumn([nameToken, ...declaration]: Token[], position: number): Column {
  const name = identifier(nameToken)
  const keys = declaration.map(keyword)
  const generated = keys.indexOf('AS')
  if (generated !== -1 && keys[generated + 2] !== 'STORED') {
    throw new Error(`Reading virtual generated column "${name}" requires SQL evaluation`)
  }
  const constraint = keys.findIndex((key) => constraints.has(key))
  const type = constraint === -1 ? declaration : declaration.slice(0, constraint)
  const primary = keys.indexOf('PRIMARY')
  const inlinePrimaryKey = primary !== -1 && keys[primary + 1] === 'KEY'
  const defaultAt = keys.findIndex((key, i) => key === 'DEFAULT' && keys[i - 1] !== 'SET')
  return {
    name,
    inlinePrimaryKey,
    // SQLite preserves a historical exception for inline INTEGER PRIMARY KEY DESC.
    rowidEligible:
      type.length === 1 &&
      uppercase(identifier(type[0])) === 'INTEGER' &&
      !(inlinePrimaryKey && keys[primary + 2] === 'DESC'),
    needsDefault: defaultAt !== -1 && keys[defaultAt + 1] !== 'NULL',
    position,
  }
}

function primaryKeyName(term: Token[]) {
  let token = term[0]
  while (Array.isArray(token)) token = token[0]
  return identifier(token)
}

export class TableLayout {
  private readonly columns: Column[] = []
  private rowidAlias?: Column
  readonly withoutRowid: boolean

  constructor(sql: string) {
    const tokens = tokenize(sql)
    const group = tokens.findIndex(Array.isArray)
    const definitions = tokens[group]
    if (!Array.isArray(definitions)) throw new Error('Missing SQLite column definitions')
    this.withoutRowid = tokens
      .slice(group + 1)
      .some(
        (token, i, options) => keyword(token) === 'WITHOUT' && keyword(options[i + 1]) === 'ROWID',
      )
    let primaryKey: string[] = []

    for (const definition of commaSeparated(definitions)) {
      const start = keyword(definition[0]) === 'CONSTRAINT' ? 2 : 0
      switch (keyword(definition[start])) {
        case 'PRIMARY': {
          const key = definition[start + 2]
          if (!Array.isArray(key)) throw new Error('Invalid SQLite primary key')
          primaryKey = Array.from(commaSeparated(key), primaryKeyName)
          continue
        }
        case 'UNIQUE':
        case 'CHECK':
        case 'FOREIGN':
          continue
      }

      const column = parseColumn(definition, this.columns.length)
      if (column.inlinePrimaryKey) primaryKey = [column.name]
      this.columns.push(column)
    }

    const keyColumns = primaryKey.map((name) => {
      const column = this.columns.find((column) => uppercase(column.name) === uppercase(name))
      if (!column) throw new Error(`Unknown SQLite primary key column "${name}"`)
      return column
    })
    if (this.withoutRowid) {
      if (new Set(keyColumns).size !== keyColumns.length) {
        throw new Error('Repeated columns in a WITHOUT ROWID primary key are unsupported')
      }
      const storageOrder = new Set([...keyColumns, ...this.columns])
      let position = 0
      for (const column of storageOrder) column.position = position++
    } else if (keyColumns.length === 1 && keyColumns[0].rowidEligible) {
      this.rowidAlias = keyColumns[0]
    }
  }

  row(values: SQLiteValue[], rowid?: number | bigint): Record<string, SQLiteValue> {
    if (values.length > this.columns.length) throw new Error('Too many fields in SQLite record')
    const row = Object.create(null)
    for (const column of this.columns) {
      if (column === this.rowidAlias && rowid !== undefined) {
        row[column.name] = rowid
      } else if (column.position < values.length) {
        row[column.name] = values[column.position]
      } else if (column.needsDefault) {
        throw new Error(
          `Reading the missing value for "${column.name}" requires its schema default`,
        )
      } else {
        row[column.name] = null
      }
    }
    return row
  }
}
