#!/usr/bin/env node
/**
 * 스키마–코드 드리프트 게이트 (ANI-1753 후속).
 *
 * 왜 필요한가:
 *   `approved_reply_snapshot` 처럼 마이그레이션에는 없는데 코드가 쓰는 컬럼이 생기면
 *   PostgREST 가 400 을 돌려주고, 코드가 그 에러를 삼키면 기능이 조용히 실패한다.
 *   이런 드리프트는 타입 검사에서도 잡히지 않는다(database.types.ts 가 낡아 `as any` 를 쓰게 된다).
 *
 * 어떻게 동작하나(네트워크·외부 DB 없이):
 *   1) supabase/migrations/*.sql 을 파일명 순으로 "정적 파싱" 해 스키마를 재구성한다.
 *      - create table [if not exists] [public.]X ( col type, ... )
 *      - alter table [public.]X add column [if not exists] col ...
 *      - drop table [if exists] [public.]X / alter table ... drop column col
 *   2) src/·scripts/·connector/ 의 supabase-js 체인에서 테이블/컬럼/RPC 문자열 리터럴을
 *      TypeScript AST 로 추출한다(.from/.select/.insert/.update/.upsert/.eq/.../.rpc).
 *   3) 1)에 없는 참조를 찾아 보고한다. baseline 에 등재된 "이미 알려진 드리프트"는 통과시키고,
 *      새로 생긴 드리프트만 실패로 만든다(그래야 게이트를 켤 수 있다).
 *
 * 한계(정직하게):
 *   - 실제 PostgreSQL 재생이 아니라 SQL 텍스트 파싱이다. DO 블록·동적 SQL·`create table ... (like x)`
 *     로 만든 컬럼은 못 본다. 그래서 "여기서 통과 = 스키마에 반드시 있음"은 아니고,
 *     "여기서 실패 = 확실히 없음"에 가깝다. 정밀 감사는 격리 PG16 재생으로 한다
 *     (docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md).
 *   - 변수/템플릿으로 조립한 테이블명은 판정하지 않는다(집계만 보고).
 *
 * 사용:
 *   node scripts/verify-schema-code-drift.mjs            # 게이트 모드(새 드리프트면 exit 1)
 *   node scripts/verify-schema-code-drift.mjs --report    # 전체 목록 출력, 항상 exit 0
 *   node scripts/verify-schema-code-drift.mjs --baseline <path>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
const DEFAULT_BASELINE = path.join(ROOT, 'scripts', 'schema-code-drift-baseline.json')
const SCAN_DIRS = ['src', 'scripts', 'connector']
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage'])

const args = process.argv.slice(2)
const reportMode = args.includes('--report')
const baselineArg = args.indexOf('--baseline')
const baselinePath = baselineArg >= 0 ? path.resolve(args[baselineArg + 1]) : DEFAULT_BASELINE

// ---------------------------------------------------------------------------
// 1. 마이그레이션 정적 파싱 → 스키마 재구성
// ---------------------------------------------------------------------------

/** 문자열에서 주석을 제거한다(문자열 리터럴 안의 -- 는 보존). */
function stripSqlComments(sql) {
  let out = ''
  let i = 0
  let inSingle = false
  let inDollar = false
  let dollarTag = ''
  while (i < sql.length) {
    const ch = sql[i]
    if (inSingle) {
      out += ch
      if (ch === "'" && sql[i + 1] === "'") {
        out += "'"
        i += 2
        continue
      }
      if (ch === "'") inSingle = false
      i += 1
      continue
    }
    if (inDollar) {
      if (sql.startsWith(dollarTag, i)) {
        out += dollarTag
        i += dollarTag.length
        inDollar = false
        continue
      }
      out += ch
      i += 1
      continue
    }
    if (ch === "'") {
      inSingle = true
      out += ch
      i += 1
      continue
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i))
      if (m) {
        dollarTag = m[0]
        inDollar = true
        out += dollarTag
        i += dollarTag.length
        continue
      }
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2)
      i = close === -1 ? sql.length : close + 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 괄호 깊이 0 에서 쉼표로 나눈다. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let buf = ''
  for (const ch of text) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf)
  return parts
}

const NOT_A_COLUMN = new Set([
  'constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like', 'inherits',
])

function normalizeTable(name) {
  const trimmed = name.trim().replace(/"/g, '')
  const parts = trimmed.split('.')
  if (parts.length === 1) return { schema: 'public', table: parts[0] }
  return { schema: parts[0], table: parts[1] }
}

function parseMigrations() {
  const tables = new Map() // key `${schema}.${table}` → Set(column)
  const rpcs = new Set()
  const files = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()
    : []

  const ensure = (schema, table) => {
    const key = `${schema}.${table}`
    if (!tables.has(key)) tables.set(key, new Set())
    return tables.get(key)
  }

  for (const file of files) {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const sql = stripSqlComments(raw)

    // create table
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][\w."]*)\s*\(/gi
    let m
    while ((m = createRe.exec(sql))) {
      const { schema, table } = normalizeTable(m[1])
      const open = createRe.lastIndex - 1
      let depth = 0
      let end = open
      for (let i = open; i < sql.length; i += 1) {
        if (sql[i] === '(') depth += 1
        else if (sql[i] === ')') {
          depth -= 1
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      const body = sql.slice(open + 1, end)
      const cols = ensure(schema, table)
      for (const part of splitTopLevel(body)) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const first = trimmed.split(/\s+/)[0].replace(/"/g, '')
        if (NOT_A_COLUMN.has(first.toLowerCase())) continue
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(first)) continue
        cols.add(first)
      }
    }

    // alter table ... add column
    const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?([A-Za-z_][\w."]*)\s+([^;]*);/gi
    while ((m = alterRe.exec(sql))) {
      const { schema, table } = normalizeTable(m[1])
      const body = m[2]
      const addRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][\w"]*)/gi
      let a
      while ((a = addRe.exec(body))) {
        ensure(schema, table).add(a[1].replace(/"/g, ''))
      }
      const dropColRe = /drop\s+column\s+(?:if\s+exists\s+)?([A-Za-z_][\w"]*)/gi
      let d
      while ((d = dropColRe.exec(body))) {
        ensure(schema, table).delete(d[1].replace(/"/g, ''))
      }
    }

    // drop table
    const dropRe = /drop\s+table\s+(?:if\s+exists\s+)?([A-Za-z_][\w."]*)/gi
    while ((m = dropRe.exec(sql))) {
      const { schema, table } = normalizeTable(m[1])
      tables.delete(`${schema}.${table}`)
    }

    // create [or replace] function
    const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*\(/gi
    while ((m = fnRe.exec(sql))) rpcs.add(m[2])
  }

  return { tables, rpcs, fileCount: files.length }
}

// ---------------------------------------------------------------------------
// 2. 코드 AST 스캔
// ---------------------------------------------------------------------------

const CHAIN_METHODS = new Set([
  'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'overlaps', 'textSearch', 'match',
  'not', 'or', 'filter', 'order', 'limit', 'range', 'returns', 'schema', 'rpc', 'from',
])
const FILTER_METHODS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
  'overlaps', 'textSearch', 'filter', 'not',
])

function walkFiles(dir, acc) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(full, acc)
    } else if (/\.(ts|tsx|mts|cts|mjs|js)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

function propName(node) {
  if (!node) return null
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isIdentifier(node)) return node.text
  return null
}

function stringValue(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

/** select('a, b, rel(c)') → ['a','b'] (관계/수식어 제외) */
function parseSelectList(text) {
  const out = []
  let depth = 0
  let buf = ''
  let sawParen = false
  const push = (raw) => {
    const trimmed = raw.trim()
    const isRelation = sawParen
    sawParen = false
    if (!trimmed) return
    if (isRelation || trimmed.includes('(')) return
    let s = trimmed
    const aliasMatch = /^([A-Za-z_]\w*):(.+)$/.exec(s)
    if (aliasMatch) s = aliasMatch[2]
    s = s.split('::')[0].split('->')[0].split('!')[0].trim()
    if (!s || s === '*') return
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return
    out.push(s)
  }
  for (const ch of text) {
    if (ch === '(') {
      depth += 1
      sawParen = true
      continue
    }
    if (ch === ')') {
      depth -= 1
      continue
    }
    if (ch === ',' && depth === 0) {
      push(buf)
      buf = ''
      continue
    }
    if (depth === 0) buf += ch
  }
  push(buf)
  return out
}

function objectLiteralKeys(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return []
  const keys = []
  for (const prop of node.properties) {
    if (
      ts.isPropertyAssignment(prop) ||
      ts.isShorthandPropertyAssignment(prop) ||
      ts.isMethodDeclaration(prop)
    ) {
      const name = prop.name
      if (!name) continue
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) keys.push(name.text)
    }
  }
  return keys
}

function scanCode() {
  const files = []
  for (const dir of SCAN_DIRS) walkFiles(path.join(ROOT, dir), files)

  const refs = [] // {file,line,schema,table,column,method,kind}
  const rpcRefs = [] // {file,line,name}
  let dynamicTables = 0

  for (const file of files) {
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!src.includes('.from(') && !src.includes('.rpc(')) continue
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind)
    const rel = path.relative(ROOT, file)

    const record = (line, schema, table, method, column, refKind) => {
      refs.push({ file: rel, line, schema, table, column, method, kind: refKind })
    }

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const name = propName(node.expression)
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

        if (name === 'rpc') {
          const fn = stringValue(node.arguments[0])
          if (fn) rpcRefs.push({ file: rel, line, name: fn })
        }

        if (name === 'from') {
          const table = stringValue(node.arguments[0])
          if (!table) {
            dynamicTables += 1
          } else {
            let schema = 'public'
            // supabase.schema('storage').from('objects') 처럼 from 앞에 schema() 가 붙는다.
            let cursor = node.expression
            while (cursor) {
              if (ts.isPropertyAccessExpression(cursor)) {
                if (
                  cursor.name.text === 'schema' &&
                  cursor.parent &&
                  ts.isCallExpression(cursor.parent)
                ) {
                  const s = stringValue(cursor.parent.arguments[0])
                  if (s) schema = s
                }
                cursor = cursor.expression
                continue
              }
              if (ts.isCallExpression(cursor)) {
                const callee = cursor.expression
                if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'schema') {
                  const s = stringValue(cursor.arguments[0])
                  if (s) schema = s
                }
                cursor = ts.isPropertyAccessExpression(callee) ? callee.expression : null
                continue
              }
              break
            }

            let chainNode = node
            while (
              chainNode.parent &&
              ts.isPropertyAccessExpression(chainNode.parent) &&
              chainNode.parent.parent &&
              ts.isCallExpression(chainNode.parent.parent) &&
              chainNode.parent.expression === chainNode
            ) {
              const call = chainNode.parent.parent
              const method = chainNode.parent.name.text
              if (!CHAIN_METHODS.has(method)) break
              const chainLine = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1
              const arg0 = call.arguments[0]

              if (method === 'select' || method === 'returns') {
                const text = stringValue(arg0)
                if (text) {
                  for (const col of parseSelectList(text)) {
                    record(chainLine, schema, table, method, col, 'select')
                  }
                }
              } else if (method === 'insert' || method === 'update' || method === 'upsert') {
                if (arg0) {
                  if (ts.isArrayLiteralExpression(arg0)) {
                    for (const el of arg0.elements) {
                      for (const key of objectLiteralKeys(el)) {
                        record(chainLine, schema, table, method, key, 'write')
                      }
                    }
                  } else {
                    for (const key of objectLiteralKeys(arg0)) {
                      record(chainLine, schema, table, method, key, 'write')
                    }
                  }
                }
              } else if (FILTER_METHODS.has(method)) {
                const col = stringValue(arg0)
                if (col && !col.includes('.')) {
                  record(
                    chainLine, schema, table, method,
                    col.split('->')[0].split('::')[0], 'filter',
                  )
                }
              } else if (method === 'order') {
                const col = stringValue(arg0)
                if (col) {
                  const base = col.split('.')[0]
                  if (!base.includes('(')) record(chainLine, schema, table, method, base, 'order')
                }
              } else if (method === 'match') {
                for (const key of objectLiteralKeys(arg0)) {
                  record(chainLine, schema, table, method, key, 'filter')
                }
              } else if (method === 'or') {
                const text = stringValue(arg0)
                if (text) {
                  for (const part of text.split(',')) {
                    const mm = /^\s*([A-Za-z_]\w*)\./.exec(part)
                    if (mm) record(chainLine, schema, table, method, mm[1], 'filter')
                  }
                }
              }
              chainNode = call
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return { refs, rpcRefs, dynamicTables, fileCount: files.length }
}

// ---------------------------------------------------------------------------
// 3. 비교
// ---------------------------------------------------------------------------

function buildFindings(schema, code) {
  const findings = []
  for (const ref of code.refs) {
    // 마이그레이션이 관리하지 않는 스키마(storage/auth 등 Supabase 내장)는 판정 대상이 아니다.
    if (ref.schema !== 'public') continue
    const key = `${ref.schema}.${ref.table}`
    const cols = schema.tables.get(key)
    if (!cols) {
      findings.push({
        type: 'MISSING_TABLE',
        key: `${key}`,
        site: `${ref.file}:${ref.line}`,
        method: ref.method,
      })
      continue
    }
    if (!cols.has(ref.column)) {
      findings.push({
        type: 'MISSING_COLUMN',
        key: `${key}.${ref.column}`,
        site: `${ref.file}:${ref.line}`,
        method: ref.method,
      })
    }
  }
  for (const rpc of code.rpcRefs) {
    if (!schema.rpcs.has(rpc.name)) {
      findings.push({ type: 'MISSING_RPC', key: rpc.name, site: `${rpc.file}:${rpc.line}`, method: 'rpc' })
    }
  }
  return findings
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return { known: new Set(), path: baselinePath, exists: false }
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const entries = Array.isArray(parsed.known) ? parsed.known : []
  return { known: new Set(entries), path: baselinePath, exists: true }
}

function main() {
  const startedAt = Date.now()
  const schema = parseMigrations()
  const code = scanCode()
  const findings = buildFindings(schema, code)
  const baseline = loadBaseline()

  const grouped = new Map()
  for (const f of findings) {
    const id = `${f.type} ${f.key}`
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id).push(f.site)
  }

  const known = []
  const fresh = []
  for (const [id, sites] of [...grouped.entries()].sort()) {
    const entry = { id, sites: [...new Set(sites)].sort() }
    if (baseline.known.has(id)) known.push(entry)
    else fresh.push(entry)
  }

  const elapsed = Date.now() - startedAt
  console.log(
    `[schema-code-drift] 마이그레이션 ${schema.fileCount}개 · 코드 ${code.fileCount}파일 · ` +
      `동적 테이블명 ${code.dynamicTables}곳 (${(elapsed / 1000).toFixed(1)}s)`,
  )
  console.log(`[schema-code-drift] 알려진 드리프트(baseline) ${known.length}건 · 새 드리프트 ${fresh.length}건`)

  if (reportMode) {
    for (const entry of known) console.log(`  [baseline] ${entry.id}  ← ${entry.sites.join(', ')}`)
    for (const entry of fresh) console.log(`  [new]      ${entry.id}  ← ${entry.sites.join(', ')}`)
    return 0
  }

  if (!baseline.exists) {
    console.error(`[schema-code-drift] baseline 파일이 없습니다: ${baseline.path}`)
    console.error('[schema-code-drift] --report 로 전체 목록을 확인한 뒤 baseline 을 만드세요.')
    return 1
  }

  if (fresh.length > 0) {
    console.error('\n[schema-code-drift] 새 스키마–코드 드리프트가 발견되었습니다:')
    for (const entry of fresh) {
      console.error(`  ✗ ${entry.id}`)
      for (const site of entry.sites.slice(0, 5)) console.error(`      ${site}`)
    }
    console.error('\n해결 방법: (1) 누락된 스키마를 추가형 마이그레이션으로 만든다,')
    console.error('          (2) 코드를 기존 스키마에 맞춘다,')
    console.error('          (3) 의도된 드리프트라면 scripts/schema-code-drift-baseline.json 에 등재한다.')
    return 1
  }

  console.log('[schema-code-drift] PASS — 새 드리프트 없음')
  return 0
}

process.exit(main())
