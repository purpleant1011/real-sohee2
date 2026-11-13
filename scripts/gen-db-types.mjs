#!/usr/bin/env node
/**
 * database.types.ts 재생성기 (ANI-1758).
 *
 * 왜 필요한가:
 *   src/lib/supabase/database.types.ts 가 마이그레이션보다 오래되어, 스키마에 실제로 있는
 *   컬럼이 타입에 없었다. 그래서 코드가 그 컬럼을 쓸 때 `as any` 로 가려야 했고,
 *   스키마 드리프트가 컴파일 단계에서 잡히지 않았다(감사: docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md).
 *
 * 어떻게 동작하나(네트워크·운영 DB 접속 없음):
 *   1) 임시 PG16 클러스터를 만든다(initdb, unix socket only, -h '').
 *   2) scripts/verify-fresh-db-replay.mjs 의 preambleSql 과 supabase/migrations/*.sql 을
 *      파일명 순으로 전부 재생한다.
 *   3) information_schema / pg_catalog 에서 public 스키마의 테이블·컬럼·타입·nullability·
 *      기본값·FK 관계·enum·함수를 읽어 Supabase CLI 와 같은 모양의 TypeScript 를 만든다.
 *   4) 끝나면 클러스터를 종료하고 임시 디렉터리를 삭제한다.
 *
 * 사용:
 *   node scripts/gen-db-types.mjs                  # src/lib/supabase/database.types.ts 덮어쓰기
 *   node scripts/gen-db-types.mjs --out <path>      # 다른 경로로 출력
 *   node scripts/gen-db-types.mjs --check           # 생성 결과와 현재 파일 비교만(다르면 exit 1)
 *
 * 한계:
 *   - 재생 preamble 이 만드는 스텁(auth.users 등)에 의존한다. 운영 DB 실물과 100% 같지는 않다.
 *   - 함수 반환 타입은 scalar/record 수준으로만 표현한다(복합 반환은 Json).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_OUT = path.join(ROOT, 'src', 'lib', 'supabase', 'database.types.ts')
const PG_BIN = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const OUT = outArg >= 0 ? path.resolve(args[outArg + 1]) : DEFAULT_OUT
const checkOnly = args.includes('--check')

if (process.getuid?.() === 0) {
  throw new Error('root 로는 실행하지 않는다(initdb 제약).')
}

const temp = mkdtempSync(path.join(tmpdir(), 'sohee-gen-types-'))
const cluster = path.join(temp, 'cluster')
const db = 'sohee_gen_types'
const port = 57800 + Math.floor(Math.random() * 1500)
const env = {
  ...process.env,
  LC_ALL: 'C',
  PGHOST: temp,
  PGPORT: String(port),
  PGDATABASE: db,
  PGUSER: process.env.USER,
}

function cleanup() {
  if (existsSync(path.join(cluster, 'postmaster.pid'))) {
    spawnSync(path.join(PG_BIN, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], {
      stdio: 'ignore',
    })
  }
  rmSync(temp, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup()
    process.exit(130)
  })
}

function call(name, argv) {
  const result = spawnSync(path.join(PG_BIN, name), argv, { encoding: 'utf8', env })
  if (result.status !== 0) {
    throw new Error(`${name}: ${(result.stderr || result.error?.message || '').slice(-3000)}`)
  }
  return result.stdout
}

/** TSV 로 받아 행 배열로 만든다. */
function query(sql) {
  const out = call('psql', ['-X', '-A', '-F', '\t', '-t', '-d', db, '-c', sql])
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'))
}

// --- 타입 매핑 -------------------------------------------------------------

function tsType(dataType, udtName) {
  switch (dataType) {
    case 'uuid':
    case 'text':
    case 'character varying':
    case 'character':
    case 'citext':
      return 'string'
    case 'integer':
    case 'smallint':
    case 'bigint':
    case 'numeric':
    case 'real':
    case 'double precision':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
    case 'jsonb':
      return 'Json'
    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'date':
      return 'string'
    case 'time with time zone':
    case 'time without time zone':
      return 'string'
    case 'ARRAY': {
      // udt_name 은 배열 원소 타입에 밑줄을 붙인 형태다(_text, _uuid, _int4 ...).
      const element = udtName.startsWith('_') ? udtName.slice(1) : udtName
      const elementType =
        element === 'int2' || element === 'int4' || element === 'int8' ||
        element === 'numeric' || element === 'float4' || element === 'float8'
          ? 'number'
          : element === 'bool'
            ? 'boolean'
            : element === 'json' || element === 'jsonb'
              ? 'Json'
              : element === 'text' || element === 'varchar' || element === 'bpchar' ||
                  element === 'uuid' || element === 'timestamptz' || element === 'date'
                ? 'string'
                : 'Json'
      return `${elementType}[]`
    }
    case 'USER-DEFINED':
      return udtName
    default:
      return 'Json'
  }
}

/** pg_get_function_result() 문자열을 TS 타입으로 대략 매핑한다. */
function resultTypeToTs(result) {
  const r = (result || '').trim().toLowerCase()
  if (r === '' || r === 'void') return 'undefined'
  if (r.startsWith('setof ')) return resultTypeToTs(r.slice('setof '.length)) + '[]'
  if (r.endsWith('[]')) return resultTypeToTs(r.slice(0, -2)) + '[]'
  if (r === 'boolean') return 'boolean'
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(r)) return 'number'
  if (['uuid', 'text', 'character varying', 'date', 'timestamp with time zone', 'timestamp without time zone', 'time with time zone', 'interval'].includes(r)) return 'string'
  if (r === 'json' || r === 'jsonb') return 'Json'
  if (r === 'record' || r === 'table' || r.startsWith('table')) return 'Json'
  return 'Json'
}

function collect() {
  const tables = query(`
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`).map((r) => r[0])

  const columns = new Map() // table -> [{name, ts, nullable, hasDefault, identity}]
  for (const [table, name, dataType, udtName, nullable, hasDefault, identity] of query(`
    select table_name, column_name, data_type, udt_name,
           is_nullable,
           (column_default is not null)::text,
           is_identity
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position`)) {
    if (!columns.has(table)) columns.set(table, [])
    columns.get(table).push({
      name,
      ts: tsType(dataType, udtName),
      nullable: nullable === 'YES',
      hasDefault: hasDefault === 'true',
      identity: identity === 'YES',
    })
  }

  const relationships = new Map() // table -> [{foreignTableName, columns, isOneToOne}]
  for (const [table, column, foreignTable, constraintName] of query(`
    select tc.table_name, kcu.column_name, ccu.table_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    order by tc.table_name, tc.constraint_name, kcu.ordinal_position`)) {
    if (!relationships.has(table)) relationships.set(table, [])
    const list = relationships.get(table)
    const existing = list.find((r) => r.constraintName === constraintName)
    if (existing) existing.columns.push(column)
    else list.push({ constraintName, foreignTableName: foreignTable, columns: [column] })
  }

  const enums = query(`
    select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname`).map(([name, labels]) => ({ name, labels: labels.split(',') }))

  // 오버로드(같은 이름, 다른 인자)는 PostgREST/TS 쪽에서 이름 하나로만 노출되므로
  // 이름 기준으로 중복을 제거한다(중복 identifier 컴파일 오류 방지).
  const functions = []
  const seenFunctions = new Set()
  for (const [name, fnArgs, returns] of query(`
    select p.proname,
           coalesce(pg_get_function_arguments(p.oid), ''),
           coalesce(pg_get_function_result(p.oid), 'void')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, p.oid`)) {
    if (seenFunctions.has(name)) continue
    seenFunctions.add(name)
    functions.push([name, fnArgs, returns])
  }

  return { tables, columns, relationships, enums, functions }
}

// --- 렌더링 ---------------------------------------------------------------

const IND = '  '

function renderTable(name, cols, rels) {
  const lines = []
  lines.push(`${IND.repeat(3)}${name}: {`)
  lines.push(`${IND.repeat(4)}Row: {`)
  for (const c of cols) {
    lines.push(`${IND.repeat(5)}${c.name}: ${c.ts}${c.nullable ? ' | null' : ''}`)
  }
  lines.push(`${IND.repeat(4)}}`)

  lines.push(`${IND.repeat(4)}Insert: {`)
  for (const c of cols) {
    const optional = c.nullable || c.hasDefault || c.identity
    lines.push(`${IND.repeat(5)}${c.name}${optional ? '?' : ''}: ${c.ts}${c.nullable ? ' | null' : ''}`)
  }
  lines.push(`${IND.repeat(4)}}`)

  lines.push(`${IND.repeat(4)}Update: {`)
  for (const c of cols) {
    lines.push(`${IND.repeat(5)}${c.name}?: ${c.ts}${c.nullable ? ' | null' : ''}`)
  }
  lines.push(`${IND.repeat(4)}}`)

  lines.push(`${IND.repeat(4)}Relationships: [`)
  for (const rel of rels ?? []) {
    lines.push(`${IND.repeat(5)}{`)
    lines.push(`${IND.repeat(6)}foreignKeyName: "${rel.constraintName}"`)
    lines.push(`${IND.repeat(6)}columns: [${rel.columns.map((c) => `"${c}"`).join(', ')}]`)
    lines.push(`${IND.repeat(6)}isOneToOne: ${rel.columns.length === 1 && rel.unique ? 'true' : 'false'}`)
    lines.push(`${IND.repeat(6)}referencedRelation: "${rel.foreignTableName}"`)
    lines.push(`${IND.repeat(6)}referencedColumns: ["id"]`)
    lines.push(`${IND.repeat(5)}},`)
  }
  lines.push(`${IND.repeat(4)}]`)
  lines.push(`${IND.repeat(3)}}`)
  return lines.join('\n')
}

function render(schema) {
  const out = []
  out.push('export type Json =')
  out.push('  | string')
  out.push('  | number')
  out.push('  | boolean')
  out.push('  | null')
  out.push('  | { [key: string]: Json | undefined }')
  out.push('  | Json[]')
  out.push('')
  out.push('// 이 파일은 scripts/gen-db-types.mjs 가 마이그레이션 재생 결과로 생성한다. 직접 수정하지 않는다.')
  out.push('export type Database = {')
  out.push(`${IND}public: {`)
  out.push(`${IND.repeat(2)}Tables: {`)

  for (const table of schema.tables) {
    out.push(renderTable(table, schema.columns.get(table) ?? [], schema.relationships.get(table)))
  }
  out.push(`${IND.repeat(2)}}`)

  out.push(`${IND.repeat(2)}Views: {`)
  out.push(`${IND.repeat(3)}[_ in never]: never`)
  out.push(`${IND.repeat(2)}}`)

  out.push(`${IND.repeat(2)}Functions: {`)
  for (const [name, fnArgs, returns] of schema.functions) {
    out.push(`${IND.repeat(3)}${name}: {`)
    // 인자 타입을 정밀하게 만들려면 시그니처 파싱이 필요하다. 호출부가
    // Record<string, unknown> 을 넘길 수 있는 넓은 형태로 둔다.
    out.push(`${IND.repeat(4)}Args: Record<string, unknown>`)
    out.push(`${IND.repeat(4)}Returns: ${resultTypeToTs(returns)}`)
    out.push(`${IND.repeat(3)}}`)
  }
  out.push(`${IND.repeat(2)}}`)

  out.push(`${IND.repeat(2)}Enums: {`)
  if (schema.enums.length === 0) out.push(`${IND.repeat(3)}[_ in never]: never`)
  for (const e of schema.enums) {
    out.push(`${IND.repeat(3)}${e.name}: ${e.labels.map((l) => `"${l}"`).join(' | ')}`)
  }
  out.push(`${IND.repeat(2)}}`)

  out.push(`${IND.repeat(2)}CompositeTypes: {`)
  out.push(`${IND.repeat(3)}[_ in never]: never`)
  out.push(`${IND.repeat(2)}}`)
  out.push(`${IND}}`)
  out.push('}')
  out.push('')
  out.push('export type PublicSchema = Database[Extract<keyof Database, "public">]')
  out.push('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]')
  out.push('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]')
  out.push('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]')
  out.push('')
  return out.join('\n')
}

// --- main -----------------------------------------------------------------

try {
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', [
    '-D', cluster,
    '-o', `-p ${port} -k ${temp} -h '' -c fsync=off -c synchronous_commit=off`,
    '-l', path.join(temp, 'postgres.log'),
    '-w', 'start',
  ])
  call('createdb', [db])

  const replay = readFileSync(path.join(ROOT, 'scripts', 'verify-fresh-db-replay.mjs'), 'utf8')
  const start = replay.indexOf('const preambleSql = `') + 'const preambleSql = `'.length
  const end = replay.indexOf('`;\n  runPsql(preambleSql)', start)
  if (start < 25 || end < 0) throw new Error('replay preamble marker changed')
  const preamblePath = path.join(temp, 'preamble.sql')
  writeFileSync(preamblePath, replay.slice(start, end).replaceAll('${DB_NAME}', db))
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', preamblePath])

  const migrationsDir = path.join(ROOT, 'supabase', 'migrations')
  const files = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()
  for (const file of files) {
    call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', path.join(migrationsDir, file)])
  }

  const schema = collect()
  const content = render(schema)

  if (checkOnly) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (current !== content) {
      console.error(`[gen-db-types] ${OUT} 가 재생 스키마와 다릅니다. npm run gen:db-types 로 갱신하세요.`)
      process.exit(1)
    }
    console.log('[gen-db-types] OK — types 가 재생 스키마와 일치합니다.')
  } else {
    writeFileSync(OUT, content)
    console.log(
      `[gen-db-types] 마이그레이션 ${files.length}개 재생 → ${schema.tables.length}개 테이블, ` +
        `${[...schema.columns.values()].reduce((n, c) => n + c.length, 0)}개 컬럼 → ${path.relative(ROOT, OUT)}`,
    )
  }
} finally {
  cleanup()
}
