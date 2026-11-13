import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const WORKSPACE = 'a7920000-0000-4000-8000-000000000001'
export const ACTOR = 'a7920000-0000-4000-8000-000000000002'
const socket = process.env.PGHOST || ''
if (!socket.startsWith('/') || !socket.includes('sohee-tenant-db-') || process.env.PGDATABASE !== 'tenant_security') throw new Error('Owned isolated PostgreSQL socket required')
const bin = `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`
export function sql(statement: string): any[] {
  const output = execFileSync(bin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const last = output.trim().split('\n').at(-1)
  return last?.startsWith('[') ? JSON.parse(last) : []
}
const identifier = (input: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(input)) throw new Error(`Unrecognized test query column: ${input}`); return `"${input}"` }
const value = (input: unknown) => input === null ? 'null' : `'${(typeof input === 'object' ? JSON.stringify(input) : String(input)).replaceAll("'", "''")}'`
const storageRoot = join(socket, 'firstpost-files')
mkdirSync(storageRoot, { recursive: true })
const objects = new Map<string, string>()
const uploads = new Map<string, string>()
export function receiveUpload(token: string, bytes: Uint8Array) {
  const path = uploads.get(token)
  if (!path) throw new Error('Unknown local upload token')
  if (objects.has(path)) throw new Error('Duplicate local upload')
  const file = join(storageRoot, token)
  writeFileSync(file, bytes, { flag: 'wx' })
  objects.set(path, file)
}
export function readObject(path: string) {
  const file = objects.get(path)
  if (!file || !existsSync(file)) throw new Error('Local object missing')
  return readFileSync(file)
}
export function seed() {
  sql(`alter role service_role bypassrls; insert into auth.users(id) values (${value(ACTOR)}); insert into public.workspaces(id,name,created_by) values (${value(WORKSPACE)},'격리 검증 매장',${value(ACTOR)}); insert into public.channel_connections(workspace_id,channel,status,account_label) values (${value(WORKSPACE)},'instagram','disconnected','@local_test'); insert into public.instagram_dm_threads(id,workspace_id,channel_connection_id,provider_thread_id,customer_id,customer_handle,customer_name,last_message_at,expires_at,last_message_text) select 'a7920000-0000-4000-8000-000000000004',workspace_id,id,'local-dm','local-customer','local-customer','격리 고객',now(),now()+interval '1 day','예약 시간과 서비스를 문의합니다.' from public.channel_connections where workspace_id='${WORKSPACE}' and channel='instagram'; insert into public.instagram_dm_messages(id,workspace_id,thread_id,provider_message_id,sender_type,sender_id,text,sent_at) values('a7920000-0000-4000-8000-000000000005','${WORKSPACE}','a7920000-0000-4000-8000-000000000004','local-inbound','customer','local-customer','예약 시간과 서비스를 문의합니다.',now());`)
}

// 준비/스타일 데이터와 AI는 명시적 fixture 경계다. 미션/권리/업로드/CAS는 아래 실제 SQL을 사용한다.
const fixtures: Record<string, any[]> = {
  workspace_knowledge_harnesses: [{ workspace_id: WORKSPACE, harness_version_id: 'a7920000-0000-4000-8000-000000000003', version_no: 1, is_active: true, offerings: [{ value: '격리 서비스' }], policies: [] }],
  harness_rules: [
    { workspace_id: WORKSPACE, id: 'local-text', rule_type: 'text_generation', version: 1, status: 'active', structured_rule: { brandVoice: '정확한 안내', rules: ['사실만'] } },
    { workspace_id: WORKSPACE, id: 'local-image', rule_type: 'image_generation', version: 1, status: 'active', structured_rule: { goldenImageIds: ['style-1', 'style-2', 'style-3'], rules: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' } } },
    { workspace_id: WORKSPACE, id: 'local-policy', rule_type: 'approval_policy', version: 1, status: 'active', structured_rule: { publishApprovalLevel: 'EXACT_APPROVAL_REQUIRED' } },
  ],
}
export function database(userSession = false): any {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (!['save_mobile_reply_draft'].includes(name)) return { data: null, error: { message: 'RPC disabled in local transport' } }
      try {
        const params = Object.entries(args).map(([key, v]) => `${identifier(key)} => ${value(v)}`).join(',')
        const rows = sql(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true); set local role service_role; select coalesce(json_agg(r),'[]') from (select public.${identifier(name)}(${params}) as result) r; commit;`)
        return { data: rows[0]?.result, error: null }
      } catch { return { data: null, error: { message: 'Local RPC failed' } } }
    },
    auth: { getUser: async () => ({ data: { user: { id: ACTOR, email: 'isolated-owner@example.invalid' } }, error: null }) },
    storage: { from: () => ({
      createSignedUploadUrl: async (path: string) => { const token = randomUUID(); uploads.set(token, path); return { data: { token, signedUrl: `http://127.0.0.1:3102/__storage/${token}` }, error: null } },
      download: async (path: string) => { try { return { data: new Blob([readObject(path)]), error: null } } catch { return { data: null, error: { message: 'Missing local object' } } } },
    }) },
    from(table: string) {
      identifier(table)
      const filters: Array<[string, unknown]> = []
      const clauses: string[] = []
      let operation = 'read'
      let payload: Record<string, unknown> = {}
      let limit = 1000
      let order = ''
      const run = async (single: boolean) => {
        try {
          if (fixtures[table]) {
            if (operation !== 'read') throw new Error('Fixture source is read-only')
            const rows = fixtures[table].filter(row => filters.every(([key, v]) => row[key] === v)).slice(0, limit)
            return { data: single ? rows[0] ?? null : rows, error: null }
          }
          const where = clauses.length ? ` where ${clauses.join(' and ')}` : ''
          const fields = Object.keys(payload)
          let query = `select * from public.${identifier(table)}${where}${order} limit ${limit}`
          if (operation === 'insert') query = `insert into public.${identifier(table)} (${fields.map(identifier).join(',')}) values (${fields.map(k => value(payload[k])).join(',')}) returning *`
          if (operation === 'update') query = `update public.${identifier(table)} set ${fields.map(k => `${identifier(k)}=${value(payload[k])}`).join(',')}${where} returning *`
          const wrapped = operation === 'read' ? `select coalesce(json_agg(r),'[]') from (${query}) r` : `with r as (${query}) select coalesce(json_agg(r),'[]') from r`
          const prefix = userSession ? `select set_config('request.jwt.claim.sub',${value(ACTOR)},true); select set_config('request.jwt.claims',${value(JSON.stringify({ sub: ACTOR, role: 'authenticated' }))},true); set local role authenticated;` : 'set local role service_role;'
          const rows = sql(`begin; ${prefix} ${wrapped}; commit;`)
          return { data: single ? rows[0] ?? null : rows, error: null }
        } catch (error) { console.error('ISOLATED_SQL_ERROR', table, operation, error instanceof Error ? error.message : 'query failed'); return { data: null, error: { message: 'Isolated SQL failed' } } }
      }
      const chain: any = {
        select: () => chain,
        eq: (key: string, v: unknown) => { filters.push([key, v]); clauses.push(`${identifier(key)}=${value(v)}`); return chain },
        in: (key: string, values: unknown[]) => { clauses.push(`${identifier(key)} in (${values.map(value).join(',')})`); return chain },
        order: (key: string, options?: { ascending?: boolean }) => { order = ` order by ${identifier(key)} ${options?.ascending === false ? 'desc' : 'asc'}`; return chain },
        limit: (n: number) => { if (!Number.isInteger(n) || n < 1) throw new Error('Invalid limit'); limit = n; return chain },
        insert: (v: Record<string, unknown>) => { operation = 'insert'; payload = v; return chain },
        update: (v: Record<string, unknown>) => { operation = 'update'; payload = v; return chain },
        maybeSingle: () => run(true), single: () => run(true),
        then: (resolve: (result: unknown) => unknown) => run(false).then(resolve),
      }
      return chain
    },
  }
}
export function storageProof() { return [...objects].map(([path]) => ({ path, sha256: createHash('sha256').update(readObject(path)).digest('hex') })) }
