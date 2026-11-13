// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { ConversationRepository, ConversationTurnConflict } from '@/lib/conversation/conversation-repository'
import { ActionGraphResumeEngine } from '@/features/tool-runtime/action-graph-resume-engine'
import type { ActionGraph } from '@/features/tool-runtime/agent-loop-engine'

const state = vi.hoisted(() => ({ admin: null as SupabaseClient | null, reader: null as SupabaseClient | null }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => state.reader }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => state.admin }))

const enabled = process.env.SOHEE_MEMORY_DB_TEST === '1'
const wsA = '10000000-0000-4000-8000-000000000001'
const wsB = '10000000-0000-4000-8000-000000000002'
const userA = '20000000-0000-4000-8000-000000000001'
const userB = '20000000-0000-4000-8000-000000000002'
const threadA = '30000000-0000-4000-8000-000000000001'
const threadOther = '30000000-0000-4000-8000-000000000002'
const secret = 'local-car-test-only-not-a-production-secret-20261028'
const port = Number(process.env.SOHEE_MEMORY_API_PORT || 55440)
const url = `http://127.0.0.1:${port}`
const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
function ddl(source: string, name: string) {
  const table = source.match(new RegExp(`create table (?:if not exists )?public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'))?.[0]
  if (!table) throw new Error(`Canonical DDL missing: ${name}`)
  return table
}
function policy(source: string, name: string) {
  const sql = source.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`, 'i'))?.[0]
  if (!sql) throw new Error(`Canonical policy missing: ${name}`)
  return sql
}
const approvalDefaults = {
  session_id: 'local-fixture', proposal_type: 'ACTION_GRAPH_NODE_APPROVAL',
  title: '승인', description: '격리 DB 승인',
}
function client(role: string, sub = userA) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, role, exp: Math.floor(Date.now() / 1000) + 600 })}`
  const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
  return createClient(url, 'local-test-key', {
    global: { fetch: (input, init) => fetch(String(input).replace('/rest/v1', ''), init), headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

interface WorkerResult {
  type: 'ready' | 'result'
  pid: number
  dispatches: number
  status?: string
  nodes?: string[]
  error?: string
  signal: NodeJS.Signals | null
}
function runWorker(mode: string, runId: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'node_modules/vite-node/vite-node.mjs', '-c',
      'tests/integration/conversation/fixtures/restart.vite.config.ts',
      'tests/integration/conversation/fixtures/restart-worker.ts', mode, runId, wsA,
    ], { env: { PATH: process.env.PATH, NODE_ENV: 'test', SOHEE_MEMORY_DB_TEST: '1', SOHEE_MEMORY_API_PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let stderr = ''
    let event: Omit<WorkerResult, 'signal'> | undefined
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Owned restart worker timeout')) }, 15000)
    child.stderr.on('data', data => { stderr += String(data) })
    child.stdout.on('data', data => {
      output += String(data)
      const lines = output.split('\n')
      output = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('CAR_WORKER:')) continue
        event = JSON.parse(line.slice('CAR_WORKER:'.length))
        if (event?.type === 'ready') child.kill('SIGKILL')
      }
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (!event || (event.type === 'result' && code !== 0) || (event.type === 'ready' && signal !== 'SIGKILL')) {
        reject(new Error(`Owned restart worker failed: ${stderr}`))
      } else resolve({ ...event, signal })
    })
  })
}

// Real repository + PostgREST + canonical migration DDL. Dependency tables and
// membership functions are minimal fixtures, not a full Supabase deployment.
describe.skipIf(!enabled)('CAR-04/05/06 isolated canonical ledger', () => {
  let server: ChildProcess | undefined
  let alice: SupabaseClient
  let bob: SupabaseClient
  let output = ''
  let messageId: string
  let runId: string
  beforeAll(async () => {
    const socket = process.env.SOHEE_MEMORY_DB_SOCKET
    if (!socket || !socket.startsWith(`${tmpdir()}/`) || !basename(socket).startsWith('sohee-memory-db-') || process.env.PGHOST !== socket || process.env.PGDATABASE !== 'sohee_car_memory_test') {
      throw new Error('Use node scripts/test-memory-db.mjs --conversation for an owned disposable database')
    }
    const foundation = migration('20260810090000_v07_conversation_work_foundation.sql')
    const background = migration('20260822142032_v08_background_jobs_token_credits.sql')
    const approvals = migration('20260906230000_v09_agent_sessions.sql')
    const extensions = migration('20260907030000_v089_canonical_agent_run_ledger.sql')
    const cancellationFix = 'supabase/migrations/20261028100000_car_canonical_cancel_state.sql'
    const sql = `
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE car_authenticator LOGIN NOINHERIT;
      GRANT authenticated, anon, service_role TO car_authenticator;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
      CREATE SCHEMA private;
      CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
      CREATE TABLE public.workspace_members (workspace_id uuid, user_id uuid);
      CREATE TABLE public.credit_reservations (id uuid PRIMARY KEY);
      CREATE FUNCTION private.is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
      INSERT INTO auth.users VALUES ('${userA}'), ('${userB}');
      INSERT INTO public.workspaces VALUES ('${wsA}'), ('${wsB}');
      INSERT INTO public.workspace_members VALUES ('${wsA}', '${userA}'), ('${wsB}', '${userB}');
      ${ddl(foundation, 'conversation_threads')}
      ${ddl(foundation, 'messages')}
      ALTER TABLE public.messages ADD COLUMN content_parts jsonb DEFAULT '[]', ADD COLUMN tool_calls jsonb DEFAULT '[]', ADD COLUMN evidence_refs jsonb DEFAULT '[]', ADD COLUMN run_id uuid;
      ${ddl(background, 'conversation_jobs')}
      ${ddl(background, 'conversation_job_steps')}
      -- The ledger migration drops this predecessor with CASCADE, including the
      -- approval FK, before creating its compatibility view. Preserve that order.
      CREATE TABLE public.agent_runs (id uuid PRIMARY KEY);
      ${ddl(approvals, 'agent_approvals')}
      ${extensions}
      ALTER VIEW public.agent_runs SET (security_invoker = true);
      ALTER VIEW public.agent_run_steps SET (security_invoker = true);
      ${existsSync(cancellationFix) ? readFileSync(cancellationFix, 'utf8') : ''}
      CREATE FUNCTION public.fixture_approval_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'APPROVED' AND NEW.proposed_value->>'writeMode' = 'error' THEN
          RAISE EXCEPTION 'FIXTURE_APPROVAL_WRITE_FAILED';
        ELSIF NEW.status = 'APPROVED' AND NEW.proposed_value->>'writeMode' = 'zero' THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fixture_approval_write_failure BEFORE UPDATE ON public.agent_approvals
        FOR EACH ROW EXECUTE FUNCTION public.fixture_approval_write_failure();
      ${existsSync('supabase/migrations/20261028110000_car_graph_execution_fences.sql') ? migration('20261028110000_car_graph_execution_fences.sql') : ''}
      INSERT INTO public.conversation_threads (id,workspace_id,kind,title) VALUES ('${threadA}','${wsA}','operations','대화'), ('${threadOther}','${wsA}','operations','다른 대화');
      GRANT USAGE ON SCHEMA public, private, auth TO authenticated, service_role;
      GRANT SELECT ON public.workspace_members TO authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT SELECT ON public.conversation_jobs, public.conversation_job_steps, public.messages, public.conversation_threads TO authenticated;
      GRANT SELECT, INSERT, UPDATE ON public.agent_approvals TO authenticated;
      ${['conversation_jobs', 'conversation_job_steps', 'messages', 'conversation_threads', 'agent_approvals'].map(table => `
        ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      `).join('\n')}
      ${policy(background, 'workspace members can read conversation jobs')}
      ${policy(background, 'workspace members can read conversation job steps')}
      ${policy(foundation, 'workspace members can read messages')}
      ${policy(foundation, 'workspace members can read conversation threads')}
      ${['select', 'insert', 'update'].map(operation => policy(approvals, `agent_approvals_${operation}`)).join('\n')}
    `
    execFileSync(join(process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin', 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' })
    server = spawn('postgrest', [], { env: { ...process.env,
      PGRST_DB_URI: `postgresql:///sohee_car_memory_test?host=${encodeURIComponent(socket)}&port=${process.env.PGPORT}&user=car_authenticator`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port),
    }, stdio: ['ignore', 'pipe', 'pipe'] })
    // Wait for the owned process' schema-cache event, not repeated HTTP polling.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Local PostgREST readiness timeout: ${output}`)), 15000)
      const finish = (error?: Error) => {
        clearTimeout(timer)
        server!.removeListener('error', onError)
        server!.removeListener('exit', onExit)
        server!.stdout?.removeListener('data', onData)
        server!.stderr?.removeListener('data', onData)
        if (error) reject(error); else resolve()
      }
      const onError = (error: Error) => finish(error)
      const onExit = () => finish(new Error(`Local PostgREST exited: ${output}`))
      const onData = (data: Buffer) => {
        output += String(data)
        if (/Schema cache loaded/i.test(output)) finish()
      }
      server!.once('error', onError)
      server!.once('exit', onExit)
      server!.stdout?.on('data', onData)
      server!.stderr?.on('data', onData)
    })
    if (!(await fetch(url)).ok) throw new Error(`Local PostgREST failed: ${output}`)
    alice = client('authenticated')
    bob = client('authenticated', userB)
    state.admin = client('service_role')
    state.reader = alice
  }, 20000)
  afterEach(() => { state.reader = alice; vi.restoreAllMocks() })
  afterAll(async () => {
    if (server?.pid && server.exitCode === null) {
      await new Promise<void>(resolve => { server!.once('exit', () => resolve()); server!.kill('SIGTERM') })
    }
  })

  it('concurrent retries save one user message and elect exactly one canonical executor', async () => {
    vi.spyOn(alice.auth, 'getUser').mockResolvedValue({ data: { user: { id: userA } }, error: null } as never)
    const key = randomUUID()
    const messages = await Promise.all(Array.from({ length: 12 }, () => ConversationRepository.saveMessage(wsA, threadA, 'user', '검색해줘', { clientMessageId: key })))
    expect(new Set(messages).size).toBe(1)
    messageId = messages[0]
    const claims = await Promise.allSettled(Array.from({ length: 12 }, () => ConversationRepository.createAgentRun(wsA, threadA, '검색해줘', {}, 'local-trace', messageId)))
    const winner = claims.filter(result => result.status === 'fulfilled')
    expect(winner).toHaveLength(1)
    runId = (winner[0] as PromiseFulfilledResult<string>).value
    for (const loser of claims.filter(result => result.status === 'rejected')) {
      expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConversationTurnConflict)
      expect((loser as PromiseRejectedResult).reason).toMatchObject({ code: 'TURN_ALREADY_EXISTS', runId, threadId: threadA })
    }
    const rows = await state.admin!.from('conversation_jobs').select('id').eq('user_message_id', messageId)
    expect(rows.error).toBeNull()
    expect(rows.data).toEqual([{ id: runId }])
  })

  it('same idempotency key cannot move between threads or change payload', async () => {
    vi.spyOn(alice.auth, 'getUser').mockResolvedValue({ data: { user: { id: userA } }, error: null } as never)
    await expect(ConversationRepository.saveMessage(wsA, threadOther, 'user', '검색해줘', { clientMessageId: messageId })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(ConversationRepository.saveMessage(wsA, threadA, 'user', '다른 요청', { clientMessageId: messageId })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('recovers a lost response through a fresh RLS client without crossing tenant or thread boundaries', async () => {
    vi.spyOn(alice.auth, 'getUser').mockResolvedValue({ data: { user: { id: userA } }, error: null } as never)
    const key = randomUUID()
    const message = await ConversationRepository.saveMessage(wsA, threadA, 'user', '접수 확인', { clientMessageId: key })
    expect(await ConversationRepository.getTurnRecoveryResult(wsA, threadA, key)).toMatchObject({ state: 'EMPTY', data: null })
    const run = await ConversationRepository.createAgentRun(wsA, threadA, '접수 확인', { privateContext: 'not-public' }, 'local-recovery', message)
    state.reader = client('authenticated')
    const recovery = await ConversationRepository.getTurnRecoveryResult(wsA, threadA, key)
    expect(recovery).toMatchObject({ state: 'DATA', data: { runId: run, threadId: threadA, status: 'running', assistantMessageId: null } })
    expect(JSON.stringify(recovery)).not.toContain('not-public')
    expect(await ConversationRepository.getTurnRecoveryResult(wsA, null, key)).toMatchObject({ state: 'DATA', data: { runId: run, threadId: threadA } })
    expect(await ConversationRepository.getTurnRecoveryResult(wsA, threadOther, key)).toMatchObject({ state: 'EMPTY', data: null })
    expect(await ConversationRepository.getTurnRecoveryResult(wsB, threadA, key)).toMatchObject({ state: 'EMPTY', data: null })
    expect(await ConversationRepository.getTurnRecoveryResult(wsB, null, key)).toMatchObject({ state: 'EMPTY', data: null })
    state.reader = bob
    expect(await ConversationRepository.getTurnRecoveryResult(wsA, threadA, key)).toMatchObject({ state: 'EMPTY', data: null })
    expect(await ConversationRepository.getTurnRecoveryResult(wsA, null, key)).toMatchObject({ state: 'EMPTY', data: null })
    const rows = await state.admin!.from('conversation_jobs').select('id,status').eq('user_message_id', message)
    expect(rows.error).toBeNull()
    expect(rows.data).toEqual([{ id: run, status: 'running' }])
  })

  it('insert-only intent survives a fresh client and completed intent cannot be re-opened', async () => {
    const step = { workspaceId: wsA, runId, stepIndex: 1, capabilityId: 'knowledge.search', inputPayload: { query: 'test' } }
    await ConversationRepository.beginAgentRunStep(step)
    await ConversationRepository.recordAgentRunStep({ ...step, status: 'completed', completed: true, outputPayload: { result: 'durable' } })
    state.admin = client('service_role')
    await expect(ConversationRepository.beginAgentRunStep(step)).rejects.toThrow()
    const row = await state.admin.from('conversation_job_steps').select('status,output_payload').eq('job_id', runId).single()
    expect(row.error).toBeNull()
    expect(row.data).toEqual({ status: 'completed', output_payload: { result: 'durable' } })
  })

  it('cancel_requested is persistable and stops dispatch without deleting recovery state', async () => {
    const result = await state.admin!.from('conversation_jobs').update({ status: 'cancel_requested' }).eq('id', runId)
    expect(result.error).toBeNull()
    expect(await ConversationRepository.isAgentRunExecutable(wsA, runId)).toBe(false)
    const recovered = await alice.from('conversation_jobs').select('id,status').eq('id', runId).single()
    expect(recovered.error).toBeNull()
    expect(recovered.data).toEqual({ id: runId, status: 'cancel_requested' })
  })

  it('guarded finalization rejects a different workspace and keeps approval waiting nonterminal', async () => {
    vi.spyOn(alice.auth, 'getUser').mockResolvedValue({ data: { user: { id: userA } }, error: null } as never)
    const freshMessage = await ConversationRepository.saveMessage(wsA, threadA, 'user', '승인 대기 회귀')
    const freshRun = await ConversationRepository.createAgentRun(wsA, threadA, '승인 대기 회귀', {}, 'local-approval-trace', freshMessage)
    await ConversationRepository.updateAgentRunStatus(freshRun, 'failed', true, undefined, { workspaceId: wsB, onlyRunning: true })
    const untouched = await state.admin!.from('conversation_jobs').select('status').eq('id', freshRun).single()
    expect(untouched.error).toBeNull()
    expect(untouched.data?.status).toBe('running')

    vi.spyOn(alice.auth, 'getUser').mockResolvedValue({ data: { user: { id: userA } }, error: null } as never)
    const assistantId = await ConversationRepository.saveMessage(wsA, threadA, 'sohee', '승인을 기다리고 있어요', { runId: freshRun })
    await ConversationRepository.updateAgentRunStatus(freshRun, 'awaiting_approval', false, assistantId, { workspaceId: wsA, onlyRunning: true })
    const waiting = await state.admin!.from('conversation_jobs').select('status,completed_at,assistant_message_id').eq('id', freshRun).single()
    expect(waiting.error).toBeNull()
    expect(waiting.data).toEqual({ status: 'awaiting_approval', completed_at: null, assistant_message_id: assistantId })
    for (const staleStatus of ['executing', 'completed', 'failed']) {
      await ConversationRepository.updateAgentRunStatus(freshRun, staleStatus, staleStatus !== 'executing', undefined, { workspaceId: wsA, onlyRunning: true })
      const preserved = await state.admin!.from('conversation_jobs').select('status,completed_at,assistant_message_id').eq('id', freshRun).single()
      expect(preserved.error).toBeNull()
      expect(preserved.data).toEqual(waiting.data)
    }
    expect(await ConversationRepository.isAgentRunExecutable(wsA, freshRun)).toBe(false)
  })

  it('a second authenticated tenant cannot read the run, steps or thread history', async () => {
    for (const table of ['conversation_jobs', 'conversation_job_steps']) {
      const result = await bob.from(table).select('id').eq('workspace_id', wsA)
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    }
    state.reader = bob
    expect(await ConversationRepository.getThreadMessagesResult(wsA, threadA)).toMatchObject({ state: 'EMPTY', data: [] })
    await expect(ActionGraphResumeEngine.resumeGraph(runId, wsA)).rejects.toThrow()
  })

  it('migration approval policies isolate tenant reads, inserts and updates', async () => {
    const approval = await alice.from('agent_approvals').insert({
      ...approvalDefaults, workspace_id: wsA, proposal_id: randomUUID(),
      proposed_value: {}, status: 'PENDING',
    }).select('id').single()
    expect(approval.error).toBeNull()
    const foreignRead = await bob.from('agent_approvals').select('id').eq('id', approval.data!.id)
    expect(foreignRead.error).toBeNull()
    expect(foreignRead.data).toEqual([])
    const foreignUpdate = await bob.from('agent_approvals').update({ status: 'APPROVED' }).eq('id', approval.data!.id).select('id')
    expect(foreignUpdate.error).toBeNull()
    expect(foreignUpdate.data).toEqual([])
    const foreignInsert = await bob.from('agent_approvals').insert({
      ...approvalDefaults, workspace_id: wsA, proposal_id: randomUUID(), proposed_value: {},
    })
    expect(foreignInsert.error?.code).toBe('42501')
    const moveTenant = await alice.from('agent_approvals').update({ workspace_id: wsB }).eq('id', approval.data!.id)
    expect(moveTenant.error?.code).toBe('42501')
    const stored = await state.admin!.from('agent_approvals').select('workspace_id,status').eq('id', approval.data!.id).single()
    expect(stored.error).toBeNull()
    expect(stored.data).toEqual({ workspace_id: wsA, status: 'PENDING' })
  })

  it('migration approval constraints reject missing metadata and duplicate proposals', async () => {
    const missing = await state.admin!.from('agent_approvals').insert({ workspace_id: wsA, proposal_id: randomUUID(), proposed_value: {} })
    expect(missing.error?.code).toBe('23502')
    const row = { ...approvalDefaults, workspace_id: wsA, proposal_id: randomUUID(), proposed_value: {} }
    expect((await state.admin!.from('agent_approvals').insert(row)).error).toBeNull()
    expect((await state.admin!.from('agent_approvals').insert(row)).error?.code).toBe('23505')
    expect((await state.admin!.from('agent_approvals').insert({ ...row, proposal_id: randomUUID(), status: 'VERIFIED' })).error?.code).toBe('23514')
  })

  async function freshGraph() {
    const message = await state.admin!.from('messages').insert({ workspace_id: wsA, thread_id: threadA, role: 'user', content: '격리 복구', status: 'completed' }).select('id').single()
    expect(message.error).toBeNull()
    const id = await ConversationRepository.createAgentRun(wsA, threadA, '격리 복구', { missionId: 'fixture', planVersion: 1 }, 'local-trace', message.data!.id)
    return { runId: id, workspaceId: wsA, status: 'RUNNING', iterations: 1, totalSteps: 1, steps: [], nodes: [
      { nodeId: 'read', title: '조회', status: 'PENDING' },
    ] } as ActionGraph
  }

  it.each(['rejected', 'version', 'expired', 'error', 'zero'])('CAR-06: approval %s between read and write cannot authorize successor dispatch', async mode => {
    const graph = await freshGraph()
    graph.nodes![0] = { nodeId: 'approval', title: '승인', status: 'AWAITING_APPROVAL' }
    graph.nodes!.push({ nodeId: 'successor', title: '후속', status: 'PENDING' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const proposalId = randomUUID()
    const approval = await state.admin!.from('agent_approvals').insert({
      ...approvalDefaults,
      workspace_id: wsA, action_run_id: graph.runId, proposal_id: proposalId,
      status: 'PENDING', version: 1, expires_at: '2099-01-01T00:00:00Z',
      proposed_value: { nodeId: 'approval', writeMode: mode },
    }).select('id').single()
    expect(approval.error).toBeNull()
    const resume = ActionGraphResumeEngine.resumeGraph.bind(ActionGraphResumeEngine)
    vi.spyOn(ActionGraphResumeEngine, 'resumeGraph').mockImplementationOnce(async (...args) => {
      const snapshot = await resume(...args)
      const changes = mode === 'rejected' ? { status: 'REJECTED' }
        : mode === 'version' ? { version: 2 }
          : mode === 'expired' ? { expires_at: '2000-01-01T00:00:00Z' } : null
      if (changes) {
        const changed = await state.admin!.from('agent_approvals').update(changes).eq('id', approval.data!.id)
        expect(changed.error).toBeNull()
      }
      return snapshot
    })
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
    const result = await ActionGraphResumeEngine.resumeFromApproval({
      workspaceId: wsA, runId: graph.runId, approvalId: proposalId, executor,
    }).then(() => null, error => error)
    expect(executor).not.toHaveBeenCalled()
    expect(result).toBeInstanceOf(Error)
    const stored = await state.admin!.from('agent_approvals').select('status,version').eq('id', approval.data!.id).single()
    expect(stored.data).toEqual({ status: mode === 'rejected' ? 'REJECTED' : 'PENDING', version: mode === 'version' ? 2 : 1 })
    const durable = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
    expect(durable.data?.plan_data.actionGraph.nodes[0].status).toBe('AWAITING_APPROVAL')
    expect(durable.data?.plan_data.actionGraph.nodes[1].status).toBe('PENDING')
  })

  it('CAR-06: a confirmed approval CAS resumes its successor once', async () => {
    const graph = await freshGraph()
    graph.nodes![0] = { nodeId: 'approval', title: '승인', status: 'AWAITING_APPROVAL' }
    graph.nodes!.push({ nodeId: 'successor', title: '후속', status: 'PENDING' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const proposalId = randomUUID()
    const approval = await state.admin!.from('agent_approvals').insert({
      ...approvalDefaults,
      workspace_id: wsA, action_run_id: graph.runId, proposal_id: proposalId,
      status: 'PENDING', version: 1, proposed_value: { nodeId: 'approval' },
    }).select('id').single()
    expect(approval.error).toBeNull()
    const executor = vi.fn(async (node: { nodeId: string }) => ({ status: 'COMPLETED', output: { nodeId: node.nodeId } }))
    const result = await ActionGraphResumeEngine.resumeFromApproval({
      workspaceId: wsA, runId: graph.runId, approvalId: proposalId, executor,
    })
    expect(result.status).toBe('COMPLETED')
    expect(executor).toHaveBeenCalledTimes(1)
    expect(executor.mock.calls[0]?.[0]?.nodeId).toBe('successor')
    const stored = await state.admin!.from('agent_approvals').select('status,version').eq('id', approval.data!.id).single()
    expect(stored.data).toEqual({ status: 'APPROVED', version: 2 })
  })

  it.each(['nodeId', 'target_field'])('CAR-06: a missing explicit approval %s cannot approve an unrelated node', async target => {
    const graph = await freshGraph()
    graph.nodes![0] = { nodeId: 'unrelated', title: '다른 승인', status: 'AWAITING_APPROVAL' }
    graph.nodes!.push({ nodeId: 'successor', title: '후속', status: 'PENDING' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const proposalId = randomUUID()
    const approval = await state.admin!.from('agent_approvals').insert({
      ...approvalDefaults,
      workspace_id: wsA, action_run_id: graph.runId, proposal_id: proposalId,
      status: 'PENDING', version: 1,
      proposed_value: target === 'nodeId' ? { nodeId: 'removed-node' } : {},
      ...(target === 'target_field' ? { target_field: 'removed-node' } : {}),
    }).select('id').single()
    expect(approval.error).toBeNull()
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
    await expect(ActionGraphResumeEngine.resumeFromApproval({
      workspaceId: wsA, runId: graph.runId, approvalId: proposalId, executor,
    })).rejects.toThrow('STALE_APPROVAL_REJECTED')
    expect(executor).not.toHaveBeenCalled()
    const stored = await state.admin!.from('agent_approvals').select('status,version').eq('id', approval.data!.id).single()
    expect(stored.data).toEqual({ status: 'PENDING', version: 1 })
    const durable = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
    expect(durable.data?.plan_data.actionGraph.nodes.map((node: { status: string }) => node.status))
      .toEqual(['AWAITING_APPROVAL', 'PENDING'])
  })

  it.each(['PENDING', 'APPROVED'])('CAR-06: concurrent %s approval resumes dispatch the successor once', async status => {
    const graph = await freshGraph()
    graph.nodes![0] = { nodeId: 'prior', title: '완료된 업무', status: 'COMPLETED' }
    graph.nodes!.push({ nodeId: 'approval', title: '승인', status: 'AWAITING_APPROVAL' })
    graph.nodes!.push({ nodeId: 'successor', title: '후속', status: 'PENDING' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const proposalId = randomUUID()
    const approval = await state.admin!.from('agent_approvals').insert({
      ...approvalDefaults,
      workspace_id: wsA, action_run_id: graph.runId, proposal_id: proposalId,
      status, version: 1, proposed_value: { nodeId: 'approval' },
    }).select('id').single()
    expect(approval.error).toBeNull()
    const resume = ActionGraphResumeEngine.resumeGraph.bind(ActionGraphResumeEngine)
    let arrivals = 0
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(ActionGraphResumeEngine, 'resumeGraph').mockImplementation(async (...args) => {
      const snapshot = await resume(...args)
      if (++arrivals === 2) release()
      await ready
      return snapshot
    })
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
    const results = await Promise.allSettled([1, 2].map(() => ActionGraphResumeEngine.resumeFromApproval({
      workspaceId: wsA, runId: graph.runId, approvalId: proposalId, executor,
    })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(executor).toHaveBeenCalledTimes(1)
    const stored = await state.admin!.from('agent_approvals').select('status,version').eq('id', approval.data!.id).single()
    expect(stored.data).toEqual({ status: 'APPROVED', version: status === 'PENDING' ? 2 : 1 })
    const durable = await state.admin!.from('conversation_jobs').select('worker_id,plan_data').eq('id', graph.runId).single()
    expect(durable.data?.worker_id).toBeNull()
    expect(durable.data?.plan_data.actionGraph.nodes.map((node: { status: string }) => node.status))
      .toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED'])
  })

  it('CAR-04: concurrent recovery workers dispatch a pending node only once', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const snapshots = await Promise.all([1, 2].map(() => ActionGraphResumeEngine.resumeGraph(graph.runId, wsA)))
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let dispatched!: () => void
    const started = new Promise<void>(resolve => { dispatched = resolve })
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
      .mockImplementationOnce(async () => { dispatched(); await held; return { status: 'COMPLETED' } })
    const first = ActionGraphResumeEngine.executeGraph(snapshots[0], { workspaceId: wsA, executor })
    await started
    try {
      await expect(ActionGraphResumeEngine.executeGraph(snapshots[1], { workspaceId: wsA, executor })).rejects.toThrow('LEASE')
    } finally { release(); await first }
    expect(executor).toHaveBeenCalledTimes(1)
    const stored = await state.admin!.from('conversation_jobs').select('worker_id').eq('id', graph.runId).single()
    expect(stored.data?.worker_id).toBeNull()
  })

  it.each(['in-flight', 'checkpointed'])('CAR-04: after SIGKILL at %s a new process cannot redispatch an owned graph', async mode => {
    const graph = await freshGraph()
    graph.nodes![0].isExternalMutation = mode === 'in-flight'
    graph.nodes!.push({ nodeId: 'successor', title: '후속', status: 'PENDING' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const crashed = await runWorker(mode, graph.runId)
    expect(crashed).toMatchObject({ type: 'ready', dispatches: 1, signal: 'SIGKILL' })
    const before = await state.admin!.from('conversation_jobs').select('worker_id,plan_data').eq('id', graph.runId).single()
    expect(before.error).toBeNull()
    expect(before.data?.worker_id).toEqual(expect.any(String))
    expect(before.data?.plan_data.actionGraph.nodes[0].status).toBe(mode === 'in-flight' ? 'RUNNING' : 'COMPLETED')
    const aged = await state.admin!.from('conversation_jobs').update({ heartbeat_at: '2000-01-01T00:00:00Z' }).eq('id', graph.runId)
    expect(aged.error).toBeNull()
    const recovered = await runWorker('recover', graph.runId)
    expect(recovered.pid).not.toBe(crashed.pid)
    expect(recovered).toMatchObject({ type: 'result', dispatches: 0, status: 'BLOCKED', signal: null })
    const stored = await state.admin!.from('conversation_jobs').select('status,safe_error_code,plan_data').eq('id', graph.runId).single()
    expect(stored.error).toBeNull()
    expect(stored.data?.plan_data.actionGraph.nodes[1].status).toBe('PENDING')
    if (mode === 'checkpointed') {
      expect(recovered.error).toContain('GRAPH_LEASE_UNAVAILABLE')
      expect(stored.data).toMatchObject({ status: 'needs_attention', safe_error_code: 'PROVIDER_RESULT_UNKNOWN' })
    } else {
      expect(recovered.nodes?.[0]).toBe('RESULT_UNKNOWN')
    }
  }, 30000)

  it('CAR-04: a new process rehydrates a terminal graph without repeating completed work', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const completed = await runWorker('complete', graph.runId)
    expect(completed).toMatchObject({ status: 'COMPLETED', dispatches: 1 })
    const recovered = await runWorker('recover', graph.runId)
    expect(recovered.pid).not.toBe(completed.pid)
    expect(recovered).toMatchObject({ status: 'COMPLETED', dispatches: 0, nodes: ['COMPLETED'] })
    const stored = await state.admin!.from('conversation_jobs').select('worker_id').eq('id', graph.runId).single()
    expect(stored.data?.worker_id).toBeNull()
  }, 30000)

  it('CAR-05: durable cancellation between nodes fences checkpoints and later dispatch', async () => {
    const graph = await freshGraph()
    graph.nodes!.push({ nodeId: 'next', title: '후속', status: 'PENDING' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const executor = vi.fn(async () => {
      const cancelled = await state.admin!.from('conversation_jobs').update({ status: 'cancel_requested' }).eq('id', graph.runId)
      expect(cancelled.error).toBeNull()
      return { status: 'COMPLETED' }
    })
    await expect(ActionGraphResumeEngine.executeGraph(graph, { workspaceId: wsA, executor })).rejects.toThrow('LEASE')
    expect(executor).toHaveBeenCalledTimes(1)
    const stored = await state.admin!.from('conversation_jobs').select('status,plan_data').eq('id', graph.runId).single()
    expect(stored.data?.status).toBe('cancel_requested')
    expect(stored.data?.plan_data.missionId).toBe('fixture')
    expect(stored.data?.plan_data.actionGraph.nodes[1].status).toBe('PENDING')
  })

  it('CAR-04: expired workers cannot commit or hand an uncertain dispatch to a replacement', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const args = { p_workspace_id: wsA, p_run_id: graph.runId, p_checkpoint_at: graph.checkpointAt, p_expected_plan: graph.checkpointPlan }
    const oldWorker = randomUUID()
    const claim = await state.admin!.rpc('car_claim_graph_execution', { ...args, p_worker_id: oldWorker })
    expect(claim.error).toBeNull()
    expect(claim.data).toHaveProperty('planFence')
    const expired = await state.admin!.from('conversation_jobs').update({ heartbeat_at: '2000-01-01T00:00:00Z' }).eq('id', graph.runId)
    expect(expired.error).toBeNull()
    const next = await state.admin!.rpc('car_claim_graph_execution', { ...args, p_worker_id: randomUUID() })
    expect(next.error).toBeNull()
    expect(next.data).toBeNull()
    const terminal = await state.admin!.from('conversation_jobs').select('status,safe_error_code').eq('id', graph.runId).single()
    expect(terminal.data).toEqual({ status: 'needs_attention', safe_error_code: 'PROVIDER_RESULT_UNKNOWN' })
    const stale = await state.admin!.rpc('car_checkpoint_graph_execution', {
      p_workspace_id: wsA, p_run_id: graph.runId, p_worker_id: oldWorker, p_plan_fence: claim.data.planFence, p_graph: graph,
    })
    expect(stale.error).toBeNull()
    expect(stale.data).toBeNull()
  })

  it('CAR-06: a changed plan fence prevents a stale checkpoint from overwriting the revision', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const executor = vi.fn(async () => {
      const row = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
      const changed = await state.admin!.from('conversation_jobs').update({ plan_data: { ...row.data!.plan_data, planVersion: 2 } }).eq('id', graph.runId)
      expect(changed.error).toBeNull()
      return { status: 'COMPLETED' }
    })
    await expect(ActionGraphResumeEngine.executeGraph(graph, { workspaceId: wsA, executor })).rejects.toThrow('LEASE')
    const stored = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
    expect(stored.data?.plan_data.planVersion).toBe(2)
    expect(stored.data?.plan_data.actionGraph.nodes[0].status).toBe('RUNNING')
  })

  it('CAR-06: a revision changed after rehydration cannot be adopted by a stale worker', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const resumed = await ActionGraphResumeEngine.resumeGraph(graph.runId, wsA)
    const row = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
    const changed = await state.admin!.from('conversation_jobs').update({ plan_data: { ...row.data!.plan_data, planVersion: 2 } }).eq('id', graph.runId)
    expect(changed.error).toBeNull()
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
    await expect(ActionGraphResumeEngine.executeGraph(resumed, { workspaceId: wsA, executor })).rejects.toThrow('LEASE')
    expect(executor).not.toHaveBeenCalled()
  })

  it('CAR-06: approval withdrawal fences the running worker before later dispatch', async () => {
    const graph = await freshGraph()
    graph.nodes!.push({ nodeId: 'next', title: '후속', status: 'PENDING' })
    const approval = await state.admin!.from('agent_approvals').insert({ ...approvalDefaults, proposal_id: randomUUID(), workspace_id: wsA, proposed_value: { action_run_id: graph.runId }, status: 'APPROVED' }).select('id').single()
    expect(approval.error).toBeNull()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const executor = vi.fn(async () => {
      const revoked = await state.admin!.from('agent_approvals').update({ status: 'REJECTED', version: 2 }).eq('id', approval.data!.id)
      expect(revoked.error).toBeNull()
      return { status: 'COMPLETED' }
    })
    await expect(ActionGraphResumeEngine.executeGraph(graph, { workspaceId: wsA, executor })).rejects.toThrow('LEASE')
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it.each(['REJECTED', 'EXPIRED'])('CAR-06: already %s approval cannot authorize a fresh recovery', async (status) => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const approval = await state.admin!.from('agent_approvals').insert({ ...approvalDefaults, proposal_id: randomUUID(), workspace_id: wsA, proposed_value: { action_run_id: graph.runId }, status })
    expect(approval.error).toBeNull()
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
    await expect(ActionGraphResumeEngine.executeGraph(graph, { workspaceId: wsA, executor })).rejects.toThrow('LEASE')
    expect(executor).not.toHaveBeenCalled()
  })

  it.each(['BLOCKED', 'FAILED'])('CAR-04: a returned %s result persists once and releases ownership without dispatching successors', async status => {
    const graph = await freshGraph()
    graph.nodes!.push({ nodeId: 'next', title: '후속', status: 'PENDING' })
    // A member-scoped server reader must prove visibility before the admin RPC.
    state.reader = alice
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const executor = vi.fn(async () => ({ status }))
    const result = await ActionGraphResumeEngine.executeGraph(graph, { workspaceId: wsA, executor })
    expect(result.status).toBe('BLOCKED')
    expect(executor).toHaveBeenCalledTimes(1)
    const row = await state.admin!.from('conversation_jobs').select('worker_id,plan_data').eq('id', graph.runId).single()
    expect(row.error).toBeNull()
    expect(row.data?.worker_id).toBeNull()
    expect(row.data?.plan_data.actionGraph.status).toBe('BLOCKED')
    expect(row.data?.plan_data.actionGraph.nodes.map((node: { status: string }) => node.status)).toEqual([status, 'PENDING'])
  })

  it('CAR-04: reaching an unresolved successor persists the stop and releases ownership', async () => {
    const graph = await freshGraph()
    graph.nodes!.push({ nodeId: 'approval', title: '승인 대기', status: 'AWAITING_APPROVAL' })
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const executor = vi.fn(async () => ({ status: 'COMPLETED' }))
    const result = await ActionGraphResumeEngine.executeGraph(graph, { workspaceId: wsA, executor })
    expect(result.status).toBe('BLOCKED')
    expect(executor).toHaveBeenCalledTimes(1)
    const row = await state.admin!.from('conversation_jobs').select('worker_id,plan_data').eq('id', graph.runId).single()
    expect(row.data?.worker_id).toBeNull()
    expect(row.data?.plan_data.actionGraph.status).toBe('BLOCKED')
    expect(row.data?.plan_data.actionGraph).not.toHaveProperty('checkpointPlan')
  })

  it('CAR-04: rejected node ledger writes roll back the graph checkpoint atomically', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const before = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
    const failed = await state.admin!.rpc('car_checkpoint_graph_execution', {
      p_workspace_id: wsA, p_run_id: graph.runId, p_worker_id: null, p_plan_fence: { planData: graph.checkpointPlan },
      p_checkpoint_at: graph.checkpointAt, p_graph: { ...graph, status: 'COMPLETED' },
      p_steps: [{ workspace_id: wsB, job_id: graph.runId }],
    })
    expect(failed.error).not.toBeNull()
    const after = await state.admin!.from('conversation_jobs').select('plan_data').eq('id', graph.runId).single()
    expect(after.data).toEqual(before.data)
  })

  it('CAR-04: authenticated clients cannot invoke privileged execution RPCs directly', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    for (const caller of [alice, bob]) {
      const claim = await caller.rpc('car_claim_graph_execution', {
        p_workspace_id: wsA, p_run_id: graph.runId, p_worker_id: randomUUID(),
        p_checkpoint_at: graph.checkpointAt, p_expected_plan: graph.checkpointPlan,
      })
      expect(claim.error?.code).toBe('42501')
      const checkpoint = await caller.rpc('car_checkpoint_graph_execution', {
        p_workspace_id: wsA, p_run_id: graph.runId, p_worker_id: null,
        p_plan_fence: { planData: graph.checkpointPlan }, p_graph: graph,
      })
      expect(checkpoint.error?.code).toBe('42501')
    }
  })

  it('CAR-04: stale initial checkpoints cannot overwrite newer durable state', async () => {
    const graph = await freshGraph()
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    const stale = structuredClone(graph)
    // Use a distinct timestamp deterministically rather than relying on millisecond timing.
    stale.checkpointAt = '2000-01-01T00:00:00.000Z'
    await expect(ActionGraphResumeEngine.saveCheckpoint(stale, wsA)).rejects.toThrow('LEASE')
    state.reader = bob
    await expect(ActionGraphResumeEngine.saveCheckpoint(graph, wsA)).rejects.toThrow('SCOPE')
  })

  it('rehydrates completed and uncertain nodes from canonical rows without re-dispatch', async () => {
    const fresh = await freshGraph()
    const graph: ActionGraph = { runId: fresh.runId, workspaceId: wsA, status: 'BLOCKED', iterations: 1, totalSteps: 2, steps: [], nodes: [
      { nodeId: 'read', title: '조회', status: 'COMPLETED', output: { result: 'durable' } },
      { nodeId: 'write', title: '외부 응답 유실', status: 'RESULT_UNKNOWN', isExternalMutation: true, idempotencyKey: 'stable-key' },
    ] }
    state.reader = state.admin
    await ActionGraphResumeEngine.saveCheckpoint(graph, wsA)
    state.reader = client('service_role')
    const resumed = await ActionGraphResumeEngine.resumeGraph(graph.runId, wsA)
    expect(resumed.nodes?.map(node => node.status)).toEqual(['COMPLETED', 'RESULT_UNKNOWN'])
    const executor = vi.fn()
    expect((await ActionGraphResumeEngine.executeGraph(resumed, { workspaceId: wsA, executor })).status).toBe('BLOCKED')
    expect(executor).not.toHaveBeenCalled()
  })
})
