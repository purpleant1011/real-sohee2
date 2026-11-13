// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { LongTermMemoryService } from '@/lib/memory/long-term-memory-service'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => state.client,
}))

// Explicitly opt in against a disposable local database; never use production credentials.
const enabled = process.env.SOHEE_MEMORY_DB_TEST === '1'
const wsA = '10000000-0000-4000-8000-000000000001'
const wsB = '10000000-0000-4000-8000-000000000002'
const userA = '20000000-0000-4000-8000-000000000001'
const userB = '20000000-0000-4000-8000-000000000002'
const secret = 'local-memory-test-only-not-a-production-secret-20261028'
const port = Number(process.env.SOHEE_MEMORY_API_PORT || 55440)
const url = `http://127.0.0.1:${port}`
const token = (sub: string) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })}`
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
// Supabase's gateway normally removes this prefix before forwarding to PostgREST.
const localFetch: typeof fetch = (input, init) => fetch(String(input).replace('/rest/v1', ''), init)
const client = (sub: string) => createClient(url, 'local-test-key', {
  global: { fetch: localFetch, headers: { Authorization: `Bearer ${token(sub)}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const memory = { memoryClass: 'semantic' as const, subject: '예약금 정책', factContent: '예약금은 2만원입니다' }

// This is a minimal fixture of the production table and membership policies, not a full Supabase stack.
describe.skipIf(!enabled)('CAR memory: service → Supabase JS → PostgREST → PostgreSQL RLS', () => {
  let server: ChildProcess | undefined
  let alice: SupabaseClient
  let bob: SupabaseClient
  let candidateId: string
  let serverOutput = ''
  const oldMode = process.env.NEXT_PUBLIC_DATASET_MODE

  beforeAll(async () => {
    const socket = process.env.SOHEE_MEMORY_DB_SOCKET
    if (!socket || !socket.startsWith(`${tmpdir()}/`) || !basename(socket).startsWith('sohee-memory-db-') || process.env.PGHOST !== socket || process.env.PGDATABASE !== 'sohee_car_memory_test') {
      throw new Error('Use node scripts/test-memory-db.mjs to create an owned disposable database')
    }
    const migration = readFileSync('supabase/migrations/20260904190000_v089_6th_revision_conversation_agent_os.sql', 'utf8')
    const table = migration.match(/CREATE TABLE IF NOT EXISTS public\.agent_memories \([\s\S]*?\n\);/)?.[0]
    if (!table) throw new Error('Canonical agent_memories table DDL not found')
    const sql = `
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE memory_authenticator LOGIN NOINHERIT;
      GRANT authenticated, anon TO memory_authenticator;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
      CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
      CREATE TABLE public.workspace_members (workspace_id uuid REFERENCES public.workspaces(id), user_id uuid);
      INSERT INTO public.workspaces VALUES ('${wsA}'), ('${wsB}');
      INSERT INTO public.workspace_members VALUES ('${wsA}', '${userA}'), ('${wsB}', '${userB}');
      ${table}
      ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;
      CREATE POLICY agent_memories_select ON public.agent_memories FOR SELECT TO authenticated
        USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id=(SELECT auth.uid())));
      CREATE POLICY agent_memories_insert ON public.agent_memories FOR INSERT TO authenticated
        WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id=(SELECT auth.uid())));
      CREATE POLICY agent_memories_update ON public.agent_memories FOR UPDATE TO authenticated
        USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id=(SELECT auth.uid())))
        WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id=(SELECT auth.uid())));
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT SELECT ON public.workspace_members TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memories TO authenticated, anon;
    `
    execFileSync(join(process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin', 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' })
    server = spawn('postgrest', [], { env: {
      ...process.env,
      PGRST_DB_URI: `postgresql:///sohee_car_memory_test?host=${encodeURIComponent(socket)}&port=${process.env.PGPORT}&user=memory_authenticator`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port),
    }, stdio: ['ignore', 'pipe', 'pipe'] })
    server.on('error', error => { serverOutput += error.message })
    server.stdout?.on('data', data => { serverOutput += String(data) })
    server.stderr?.on('data', data => { serverOutput += String(data) })
    const deadline = Date.now() + 15000
    let ready = false
    while (Date.now() < deadline && server.exitCode === null) {
      try { ready = (await fetch(url)).ok; if (ready) break } catch { /* wait for local listener */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error(`Local PostgREST failed to start: ${serverOutput}`)
    alice = client(userA)
    bob = client(userB)
    state.client = alice
    process.env.NEXT_PUBLIC_DATASET_MODE = 'ACTUAL'
  }, 20000)

  afterAll(async () => {
    if (oldMode === undefined) delete process.env.NEXT_PUBLIC_DATASET_MODE
    else process.env.NEXT_PUBLIC_DATASET_MODE = oldMode
    if (server && server.exitCode === null && server.pid) {
      await new Promise<void>(resolve => { server!.once('exit', () => resolve()); server!.kill('SIGTERM') })
    }
  })

  it('stores a real UUID, defaults to candidate despite the DB approved default, and preserves zero', async () => {
    candidateId = await LongTermMemoryService.storeMemory(wsA, { ...memory, confidenceScore: 0 })
    expect(candidateId).toMatch(/^[0-9a-f-]{36}$/)
    const { data, error } = await alice.from('agent_memories').select('id,status,confidence_score').eq('id', candidateId).single()
    expect(error).toBeNull()
    expect(data).toEqual({ id: candidateId, status: 'candidate', confidence_score: 0 })
    expect(await LongTermMemoryService.retrieveRelevantMemories(wsA, ['예약금'])).toEqual([])
    expect((await LongTermMemoryService.listCandidates(wsA))[0].confidenceScore).toBe(0)
  })

  it('confirms promotion using the returned row and independently reads it back', async () => {
    expect(await LongTermMemoryService.promoteMemoryStatus(wsA, candidateId, 'approved')).toMatchObject({ success: true, memoryId: candidateId, status: 'approved' })
    const { data, error } = await alice.from('agent_memories').select('status').eq('id', candidateId).single()
    expect(error).toBeNull()
    expect(data?.status).toBe('approved')
    expect((await LongTermMemoryService.retrieveRelevantMemories(wsA, ['예약금은 얼마인가요?']))[0]).toMatchObject({ id: candidateId, confidenceScore: 0 })
  })

  it('ranks relevant memory over unrelated high confidence and excludes candidates', async () => {
    await LongTermMemoryService.storeMemory(wsA, { ...memory, subject: '영업시간', factContent: '오전 9시 오픈', status: 'approved' })
    await LongTermMemoryService.proposeCandidate(wsA, { ...memory, provenanceType: 'user_dialogue' })
    expect((await LongTermMemoryService.retrieveRelevantMemories(wsA, ['예약금'], 1)).map(row => row.id)).toEqual([candidateId])
    expect(await LongTermMemoryService.retrieveRelevantMemories(wsA, ['무관한질문'])).toEqual([])
  })

  it('does not report success for a missing row or wrong workspace', async () => {
    expect(await LongTermMemoryService.promoteMemoryStatus(wsA, '30000000-0000-4000-8000-000000000001', 'canonical')).toMatchObject({ success: false })
    expect(await LongTermMemoryService.promoteMemoryStatus(wsB, candidateId, 'canonical')).toMatchObject({ success: false })
  })

  it('denies cross-tenant insert through RLS', async () => {
    await expect(LongTermMemoryService.storeMemory(wsB, memory)).rejects.toThrow()
    const { data, error } = await bob.from('agent_memories').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('denies cross-tenant reads and promotions for a second authenticated identity', async () => {
    state.client = bob
    try {
      expect(await LongTermMemoryService.retrieveRelevantMemories(wsA, ['예약금'])).toEqual([])
      expect(await LongTermMemoryService.listCandidates(wsA)).toEqual([])
      expect(await LongTermMemoryService.promoteMemoryStatus(wsA, candidateId, 'canonical')).toMatchObject({ success: false })
      const ownId = await LongTermMemoryService.storeMemory(wsB, memory)
      expect(ownId).not.toBe(candidateId)
    } finally { state.client = alice }
    const { data, error } = await alice.from('agent_memories').select('status').eq('id', candidateId).single()
    expect(error).toBeNull()
    expect(data?.status).toBe('approved')
  })

  it('denies moving a row into another tenant with UPDATE WITH CHECK', async () => {
    const { error } = await alice.from('agent_memories').update({ workspace_id: wsB }).eq('id', candidateId).select('id')
    expect(error?.code).toBe('42501')
  })

  it('fails closed on invalid UUIDs and DB CHECK violations', async () => {
    await expect(LongTermMemoryService.storeMemory('invalid-uuid', memory)).rejects.toThrow()
    const result = await LongTermMemoryService.promoteMemoryStatus(wsA, candidateId, 'invalid' as never)
    expect(result.success).toBe(false)
    expect(result.message).not.toContain('constraint')
    expect(await LongTermMemoryService.retrieveRelevantMemories('invalid-uuid', ['예약금'])).toEqual([])
  })

  it('does not allow anonymous reads or inserts despite table grants', async () => {
    const anonymous = createClient(url, 'local-test-key', {
      global: { fetch: (input, init) => {
        const headers = new Headers(init?.headers)
        headers.delete('authorization')
        return localFetch(input, { ...init, headers })
      } },
      auth: { persistSession: false },
    })
    const read = await anonymous.from('agent_memories').select('id')
    expect(read.error).toBeNull()
    expect(read.data).toEqual([])
    const write = await anonymous.from('agent_memories').insert({ workspace_id: wsA, memory_class: 'semantic', subject: 'test', fact_content: 'test' })
    expect(write.error?.code).toBe('42501')
  })
})
