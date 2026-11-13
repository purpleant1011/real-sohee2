/**
 * TEST 전용 `SqlRpc` 구현: 로컬 PostgreSQL 클러스터에 psql로 RPC를 호출한다.
 *
 * - 네트워크 없음: unix socket 디렉터리(절대 경로)로만 붙는다. TCP host는 거부한다.
 * - production에서는 생성 자체를 거부한다.
 * - 인자는 uuid / text / timestamptz / integer 리터럴만 허용하고, 임의 SQL 문자열은 넣을 수 없다.
 *   함수 이름도 식별자 정규식으로 제한한다.
 */

import { spawn } from 'node:child_process'
import type { SqlRpc } from '../ledger-port'

export type PsqlRpcOptions = Readonly<{
  psqlBin: string
  /** unix socket 디렉터리 절대 경로 (예: 임시 클러스터 dir). */
  host: string
  port: string | number
  database: string
  user?: string
}>

const FUNCTION_NAME = /^[a-z][a-z0-9_]{0,62}$/
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 작은따옴표만 두 번 써서 표준 문자열 리터럴로 만든다. 제어문자·NUL은 거부한다. */
function quoteText(value: string): string {
  if (value.includes('\u0000')) throw new Error('psql-rpc: NUL is not allowed in a text literal')
  return `'${value.replaceAll("'", "''")}'`
}

/** 허용 타입(uuid/text/timestamptz/integer) 중 하나의 SQL 리터럴로만 변환한다. */
export function toSqlLiteral(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`psql-rpc: ${field} must be a safe integer`)
    return String(value)
  }
  if (typeof value !== 'string') {
    throw new Error(`psql-rpc: ${field} must be a string or integer, got ${typeof value}`)
  }
  if (UUID.test(value)) return `${quoteText(value)}::uuid`
  if (OFFSET_ISO.test(value)) return `${quoteText(value)}::timestamptz`
  return quoteText(value)
}

export function buildRpcStatement(
  fn: string,
  args: Readonly<Record<string, unknown>>
): string {
  if (!FUNCTION_NAME.test(fn)) throw new Error(`psql-rpc: invalid function name ${fn}`)
  const named = Object.entries(args)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (!/^p_[a-z][a-z0-9_]*$/.test(key)) throw new Error(`psql-rpc: invalid argument name ${key}`)
      return `${key} => ${toSqlLiteral(value, key)}`
    })
  if (named.length === 0) throw new Error('psql-rpc: at least one named argument is required')
  return `select public.${fn}(${named.join(', ')})::text`
}

export function createPsqlRpc(options: PsqlRpcOptions): SqlRpc {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('psql-rpc: TEST-only helper must not be created in production')
  }
  const { psqlBin, host, port, database, user } = options
  if (!psqlBin) throw new Error('psql-rpc: psqlBin is required')
  if (typeof host !== 'string' || !host.startsWith('/')) {
    throw new Error('psql-rpc: host must be a unix socket directory (no TCP)')
  }
  if (!database) throw new Error('psql-rpc: database is required')

  return async (fn, args) => {
    const statement = buildRpcStatement(fn, args)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: host,
      PGPORT: String(port),
      PGDATABASE: database,
      PGCONNECT_TIMEOUT: '10',
    }
    if (user) env.PGUSER = user

    return await new Promise((resolve) => {
      const child = spawn(psqlBin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      child.on('error', (error) => {
        resolve({ data: null, error: { message: `psql spawn failed: ${error.message}` } })
      })
      child.on('close', (code) => {
        if (code !== 0) {
          resolve({ data: null, error: { message: (stderr.trim() || `psql exited with ${code}`).slice(-2000) } })
          return
        }
        const text = stdout.trim()
        try {
          resolve({ data: JSON.parse(text), error: null })
        } catch {
          // 파싱 실패는 성공으로 승격하지 않는다. 어댑터가 계약 위반으로 판정한다.
          resolve({ data: text, error: null })
        }
      })
    })
  }
}
