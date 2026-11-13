import { spawnSync, spawn } from 'node:child_process'

/** A test-only Data API surface backed by raw psql. No network, mocked rows or production credentials. */
const ident = (name: string): string => {
  if (!/^[a-z][a-z_0-9]*$/i.test(name)) throw new Error('Invalid SQL identifier')
  return `"${name}"`
}
const value = (input: unknown): string => input == null ? 'null' : `'${(typeof input === 'object' ? JSON.stringify(input) : String(input)).replaceAll("'", "''")}'`

export function explain(statement: string): any {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Isolated DB required')
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input: `explain (analyze, buffers, format json) ${statement};`, encoding: 'utf8' })
  if (run.status) throw new Error(`EXPLAIN failed: ${run.stderr}`)
  return JSON.parse(run.stdout.trim())[0]
}

export function query<T = Record<string, unknown>>(statement: string, userId?: string): T[] {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Vault tests require isolated PostgreSQL cluster')
  const trimmed = statement.trim()
  const write = /^(with\s+[a-z_]+\s+as\s*\(|insert\s+|update\s+|delete\s+)/i.test(trimmed)
  const sql = write ? `${statement}` : `select coalesce(json_agg(result), '[]'::json) from (${statement}) result`
  const input = userId
    ? `begin; set local role authenticated; select set_config('request.jwt.claim.sub', ${value(userId)}, true); ${sql}; commit;`
    : `${sql};`
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input, encoding: 'utf8' })
  if (run.status) throw new Error(`psql: ${run.stderr?.slice(-1500)}`)
  const lines = run.stdout.trim().split('\n').filter(Boolean)
  if (write) {
    const encoded = lines.find(line => line.startsWith('{"data":'))
    return encoded ? JSON.parse(encoded).data as T[] : []
  }
  const encoded = lines.filter(line => line.startsWith('[') || line.startsWith(' ') || line === '[]').join('')
  return JSON.parse(encoded) as T[]
}

export function asyncQuery<T = Record<string, unknown>>(statement: string, userId?: string): Promise<T[]> {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Vault tests require isolated PostgreSQL cluster')
  const trimmed = statement.trim()
  const write = /^(with\s+[a-z_]+\s+as\s*\(|insert\s+|update\s+|delete\s+)/i.test(trimmed)
  const sql = write ? `${statement}` : `select coalesce(json_agg(result), '[]'::json) from (${statement}) result`
  const input = userId
    ? `begin; set local role authenticated; select set_config('request.jwt.claim.sub', ${value(userId)}, true); ${sql}; commit;`
    : `${sql};`

  return new Promise((resolve, reject) => {
    const child = spawn(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, [
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`psql: ${stderr.slice(-1500)}`))
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        if (write) {
          const encoded = lines.find(line => line.startsWith('{"data":'))
          return resolve(encoded ? JSON.parse(encoded).data as T[] : [])
        }
        const encoded = lines.filter(line => line.startsWith('[') || line.startsWith(' ') || line === '[]').join('')
        return resolve(JSON.parse(encoded) as T[])
      } catch (err) {
        reject(err)
      }
    })
    child.stdin.end(input, 'utf8')
  })
}

function rawWrite(statement: string): any[] {
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input: `${statement};`, encoding: 'utf8' })
  if (run.status) throw new Error(`psql write: ${run.stderr?.slice(-1500)}`)
  return run.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

interface Answer { data: any; error: { code: string; message: string } | null; count?: number }
type Filter = { name: string; sql: string }
class Builder implements PromiseLike<Answer> {
  private filters: Filter[] = []
  private columns = '*'
  private isSingle = false
  private countOnly = false
  private selectedCount = false
  private sortColumn: string | null = null
  private write: { type: 'insert' | 'upsert' | 'update'; row: Record<string, unknown>; conflict?: string } | null = null
  constructor(private readonly table: string, private readonly userId?: string) { ident(table) }
  select(columns = '*', options?: { count?: 'exact'; head?: boolean }): this {
    this.columns = columns
    this.selectedCount = options?.count === 'exact'
    this.countOnly = options?.head === true
    return this
  }
  eq(column: string, field: unknown): this { this.filters.push({ name: column, sql: `${ident(column)} = ${value(field)}` }); return this }
  gte(column: string, field: unknown): this { this.filters.push({ name: column, sql: `${ident(column)} >= ${value(field)}` }); return this }
  lte(column: string, field: unknown): this { this.filters.push({ name: column, sql: `${ident(column)} <= ${value(field)}` }); return this }
  is(column: string, field: unknown): this { this.filters.push({ name: column, sql: field === null ? `${ident(column)} is null` : `${ident(column)} is ${field}` }); return this }
  in(column: string, fields: unknown[]): this { this.filters.push({ name: column, sql: `${ident(column)} in (${fields.map(value).join(',')})` }); return this }
  order(column: string, { ascending = true }: { ascending?: boolean } = {}): this { this.sortColumn = `${ident(column)} ${ascending ? 'asc' : 'desc'}`; return this }
  limit(): this { return this }
  insert(row: Record<string, unknown>): this { this.write = { type: 'insert', row }; return this }
  upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }): this {
    if (!options.ignoreDuplicates) throw new Error('Vault tests require conflict-safe inserts')
    this.write = { type: 'upsert', row, conflict: options.onConflict }; return this
  }
  update(row: Record<string, unknown>): this { this.write = { type: 'update', row }; return this }
  maybeSingle(): Promise<Answer> { this.isSingle = true; return this.run() }
  single(): Promise<Answer> { this.isSingle = true; return this.run() }
  then<TResult1 = Answer, TResult2 = never>(onfulfilled?: ((value: Answer) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }
  private async run(): Promise<Answer> {
    try {
      const table = `public.${ident(this.table)}`
      const where = this.filters.length ? ` where ${this.filters.map(f => f.sql).join(' and ')}` : ''
      let sql: string
      if (this.write) {
        const { row, type, conflict } = this.write
        if (type === 'update') {
          if (!where) throw new Error('Unsafe update without filter')
          sql = `update ${table} set ${Object.entries(row).map(([key, data]) => `${ident(key)} = ${value(data)}`).join(',')} ${where} returning *`
        } else {
          sql = `insert into ${table} (${Object.keys(row).map(ident).join(',')}) values (${Object.values(row).map(value).join(',')}) ${type === 'upsert' ? `on conflict (${conflict!.split(',').map(ident).join(',')}) do nothing` : ''} returning *`
        }
        // WITH write supports JSON envelope even on zero-row conflict.
        sql = `with written as (${sql}) select row_to_json(written) from written`
      } else if (this.countOnly) {
        const rows = query<{ n: string }>(`select count(*)::text as n from ${table}${where}`, this.userId)
        return { data: null, count: Number(rows[0].n), error: null }
      } else {
        // Only the vault adapter's select syntax is required. Embedded relationship
        // resolved through an actual LATERAL join, not a fabricated fixture.
        const embedded = this.columns.includes('channel_connections(')
        const fields = embedded ? this.columns.replace(/\s*,\s*channel_connections\([^)]*\)/, '') : this.columns
        const columns = fields === '*' ? 't.*' : fields.split(',').map(column => `t.${ident(column.trim())}`).join(',')
        const connectionFields = this.columns.match(/channel_connections\(([^)]*)\)/)?.[1]
        const joinedColumns = connectionFields ? connectionFields.split(',').map(column => ident(column.trim())).join(',') : 'external_account_id'
        sql = embedded
          ? `select ${columns}, row_to_json(c) as channel_connections from ${table} t left join lateral (select ${joinedColumns} from public.channel_connections where id = t.channel_connection_id and workspace_id = t.workspace_id) c on true${where}${this.sortColumn ? ` order by ${this.sortColumn}` : ''}`
          : `select ${columns} from ${table} t${where}${this.sortColumn ? ` order by ${this.sortColumn}` : ''}`
      }
      const data = this.write ? rawWrite(sql) : query(sql, this.userId)
      return { data: this.isSingle ? data[0] ?? null : data, error: null, ...(this.selectedCount ? { count: data.length } : {}) }
    } catch (error) {
      return { data: null, error: { code: 'DB_ERROR', message: (error as Error).message } }
    }
  }
}
export function pgClient(userId?: string) { return { from(table: string) { return new Builder(table, userId) } } }
export const literal = value
