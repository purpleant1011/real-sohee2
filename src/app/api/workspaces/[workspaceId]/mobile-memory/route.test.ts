import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const authorize = vi.hoisted(() => vi.fn())
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))

import { GET, POST } from './route'

const params = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) })

function supabase(tables: Record<string, Array<Record<string, unknown>> | null>) {
  return {
    from(table: string) {
      let ws: string | null = null
      const qb: Record<string, any> = {}
      for (const m of ['select', 'in', 'order']) qb[m] = () => qb
      qb.eq = (column: string, value: string) => {
        if (column === 'workspace_id') ws = value
        return qb
      }
      qb.limit = async () => {
        const rows = tables[table]
        return rows ? { data: rows.filter(r => r.workspace_id === ws), error: null } : { data: null, error: { message: 'x' } }
      }
      return qb
    },
  }
}

const proposalRow = (workspace_id: string, content: string) => ({
  id: `p-${workspace_id}`,
  workspace_id,
  category: '가격',
  content,
  source_message_id: 'm-1',
  created_at: '2026-10-22T01:00:00.000Z',
})

const factRow = (workspace_id: string, content: string) => ({
  id: `f-${workspace_id}`,
  workspace_id,
  category: '가격',
  content,
  approved_at: '2026-09-01T00:00:00.000Z',
})

describe('GET mobile-memory', () => {
  beforeEach(() => { authorize.mockReset() })

  it('인증 실패 응답은 그대로 돌려주고 DB 를 조회하지 않는다', async () => {
    const from = vi.fn()
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))

    expect((await GET(new Request('http://x'), params('ws-a'))).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('정상이면 200 + no-store, 인증이 확정한 workspace 의 기억만 내려간다', async () => {
    const db = supabase({
      sohee_studio_proposals: [proposalRow('ws-a', '커트 35,000원'), proposalRow('ws-b', '커트 99,000원')],
      knowledge_facts: [factRow('ws-a', '커트 30,000원'), factRow('ws-b', '커트 88,000원')],
    })
    authorize.mockResolvedValue({ userId: 'u', workspaceId: 'ws-a', role: 'manager', supabase: db, admin: db })

    // 경로는 ws-b 여도 인증 결과(ws-a)만 쓴다.
    const res = await GET(new Request('http://x'), params('ws-b'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.workspaceId).toBe('ws-a')
    expect(body.complete).toBe(true)
    expect(body.candidates).toHaveLength(1)
    expect(body.candidates[0].proposedValue).toBe('커트 35,000원')
    expect(body.candidates[0].currentValue).toBe('커트 30,000원')
    expect(JSON.stringify(body)).not.toContain('99,000')
    expect(JSON.stringify(body)).not.toContain('88,000')
  })

  it('확정 지식 조회가 실패하면 빈 목록을 정상으로 주지 않는다 — 200 + partial', async () => {
    const db = supabase({
      sohee_studio_proposals: [proposalRow('ws-a', '커트 35,000원')],
      knowledge_facts: null,
    })
    authorize.mockResolvedValue({ userId: 'u', workspaceId: 'ws-a', role: 'manager', supabase: db, admin: db })

    const res = await GET(new Request('http://x'), params('ws-a'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.loadState).toBe('ready')
    expect(body.complete).toBe(false)
    expect(body.candidates).toEqual([])
  })

  it('두 원천이 모두 실패하면 503 + error', async () => {
    const db = supabase({ sohee_studio_proposals: null, knowledge_facts: null })
    authorize.mockResolvedValue({ userId: 'u', workspaceId: 'ws-a', role: 'manager', supabase: db, admin: db })

    const res = await GET(new Request('http://x'), params('ws-a'))

    expect(res.status).toBe(503)
    expect((await res.json()).loadState).toBe('error')
  })
})

const PROPOSAL = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

function decisionSupabase(options: {
  proposal?: Record<string, unknown> | null
  lookupError?: { message: string } | null
  rpc?: { data?: unknown; error?: { message: string; code?: string } | null }
} = {}) {
  const rpc = vi.fn(async () => options.rpc ?? {
    data: {
      success: true,
      id: PROPOSAL,
      status: 'confirmed',
      confirmed_target_id: null,
      kind: 'fact',
      idempotent: false,
    },
    error: null,
  })
  const maybeSingle = vi.fn(async () => {
    if (options.lookupError) return { data: null, error: options.lookupError }
    if (options.proposal === null) return { data: null, error: null }
    return {
      data: options.proposal ?? { id: PROPOSAL, workspace_id: 'ws-a', kind: 'fact', status: 'proposed', content: '커트 35,000원' },
      error: null,
    }
  })
  const builder: Record<string, any> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = maybeSingle
  return { db: { from: () => builder, rpc }, rpc, maybeSingle }
}

const postRequest = (body: unknown) => new Request('http://x', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('POST mobile-memory — 승인·거절 쓰기 (ANI-1709 M22)', () => {
  beforeEach(() => { authorize.mockReset() })

  function authorizeWith(options: Parameters<typeof decisionSupabase>[0] = {}, workspaceId = 'ws-a') {
    const store = decisionSupabase(options)
    authorize.mockResolvedValue({
      userId: USER, workspaceId, role: 'manager', supabase: store.db, admin: store.db,
    })
    return store
  }

  it('사장님이 누른 확인(confirm:true) 없이는 아무것도 쓰지 않는다', async () => {
    const { rpc } = authorizeWith()

    const missing = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm' }), params('ws-a'))
    const falsey = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: false }), params('ws-a'))

    expect(missing.status).toBe(400)
    expect(falsey.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('허용되지 않은 결정·제안 id 형식은 400 이다', async () => {
    const { rpc } = authorizeWith()

    expect((await POST(postRequest({ proposalId: PROPOSAL, decision: 'approve', confirm: true }), params('ws-a'))).status).toBe(400)
    expect((await POST(postRequest({ proposalId: 'not-a-uuid', decision: 'confirm', confirm: true }), params('ws-a'))).status).toBe(400)
    expect((await POST(new Request('http://x', { method: 'POST', body: '{oops' }), params('ws-a'))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('승인 성공은 200 + no-store 이고 인증이 확정한 가게로만 쓴다', async () => {
    const store = authorizeWith()

    // 경로가 ws-b 여도 인증 결과(ws-a)만 쓴다.
    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-b'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({ outcome: 'decided', proposalId: PROPOSAL, status: 'confirmed', factId: null })
    expect(store.rpc).toHaveBeenCalledWith('decide_studio_proposal', {
      p_workspace_id: 'ws-a',
      p_proposal_id: PROPOSAL,
      p_decision: 'confirm',
      p_user_id: USER,
      p_revised_content: null,
    })
  })

  it('거절 성공은 decided/rejected 다', async () => {
    authorizeWith({
      rpc: {
        data: { success: true, id: PROPOSAL, status: 'rejected', confirmed_target_id: null, kind: 'fact', idempotent: false },
        error: null,
      },
    })

    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'reject', confirm: true }), params('ws-a'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: 'decided', proposalId: PROPOSAL, status: 'rejected', factId: null })
  })

  it('이미 처리된 제안은 성공과 섞지 않고 already_handled 로 알린다', async () => {
    authorizeWith({
      rpc: {
        data: { success: true, id: PROPOSAL, status: 'confirmed', confirmed_target_id: null, kind: 'fact', idempotent: true },
        error: null,
      },
    })

    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-a'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: 'already_handled', proposalId: PROPOSAL, status: 'confirmed', factId: null })
  })

  it('저장 실패는 200 성공이 아니라 503 unavailable 이고 DB 오류 문구를 노출하지 않는다', async () => {
    authorizeWith({ rpc: { data: null, error: { message: 'timeout', code: '57014' } } })

    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-a'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.outcome).toBe('unavailable')
    expect(JSON.stringify(body)).not.toContain('timeout')
  })

  it('다른 가게의 제안은 404 로 통일하고 내용을 누출하지 않는다', async () => {
    authorizeWith({ proposal: null })

    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-a'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.outcome).toBe('not_found')
    expect(JSON.stringify(body)).not.toContain('커트')
    expect(JSON.stringify(body)).not.toContain('ws-b')
  })

  it('클라이언트가 보낸 값은 신뢰하지 않는다 — content 를 실어 보내면 400', async () => {
    const { rpc } = authorizeWith()

    const res = await POST(postRequest({
      proposalId: PROPOSAL, decision: 'confirm', confirm: true, content: '커트 99,000원',
    }), params('ws-a'))

    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('승인은 서버가 보관한 원문을 쓰도록 revised content 를 넘기지 않는다', async () => {
    const store = authorizeWith()

    await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-a'))

    // p_revised_content 가 null 이어야 RPC 가 DB 원문(v_proposal.content)을 그대로 쓴다.
    expect(store.rpc).toHaveBeenCalledWith('decide_studio_proposal', expect.objectContaining({
      p_revised_content: null,
    }))
  })

  it('확인할 내용이 비어 있으면 422 로 닫고 RPC 를 부르지 않는다', async () => {
    const { rpc } = authorizeWith({
      proposal: { id: PROPOSAL, workspace_id: 'ws-a', kind: 'fact', status: 'proposed', content: '  ' },
    })

    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-a'))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.outcome).toBe('invalid_proposal')
    expect(typeof body.error).toBe('string')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('인증 실패 응답은 그대로 돌려주고 RPC 를 부르지 않는다', async () => {
    const { rpc } = authorizeWith()
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))

    const res = await POST(postRequest({ proposalId: PROPOSAL, decision: 'confirm', confirm: true }), params('ws-a'))

    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
})
