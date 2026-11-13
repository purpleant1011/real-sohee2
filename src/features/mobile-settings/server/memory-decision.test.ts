import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { decideMemoryProposal } from './memory-decision'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspaceId = '11111111-1111-4111-8111-111111111112'
const proposalId = '22222222-2222-4222-8222-222222222222'
const factId = '44444444-4444-4444-8444-444444444444'
const userId = '33333333-3333-4333-8333-333333333333'

const proposalRow = (overrides: Record<string, unknown> = {}) => ({
  id: proposalId,
  workspace_id: workspaceId,
  kind: 'fact',
  status: 'proposed',
  content: '커트 35,000원',
  ...overrides,
})

const rpcPayload = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  id: proposalId,
  status: 'confirmed',
  confirmed_target_id: factId,
  kind: 'fact',
  idempotent: false,
  ...overrides,
})

function admin(options: {
  proposal?: Record<string, unknown> | null
  lookupError?: { message: string } | null
  rpc?: { data?: unknown; error?: { message: string; code?: string } | null }
}) {
  const eqs: [string, unknown][] = []
  const selects: string[] = []
  const rpc = vi.fn(async () => options.rpc ?? { data: rpcPayload(), error: null })
  const builder: Record<string, any> = {}
  builder.select = (columns: string) => { selects.push(columns); return builder }
  builder.eq = (column: string, value: unknown) => {
    eqs.push([column, value])
    return builder
  }
  builder.maybeSingle = async () => {
    if (options.lookupError) return { data: null, error: options.lookupError }
    return { data: options.proposal === undefined ? proposalRow() : options.proposal, error: null }
  }
  return { admin: { from: () => builder, rpc }, rpc, eqs, selects }
}

const input = (over: Partial<{ workspaceId: string; proposalId: string; decision: 'confirm' | 'reject' }> = {}) => ({
  workspaceId,
  proposalId,
  userId,
  decision: 'confirm' as const,
  ...over,
})

describe('가게 기억 승인·거절 결정 (ANI-1709 M22)', () => {
  it('승인 성공은 decided/confirmed 로 돌려주고 RPC 에 확정 대상 가게·사용자를 넘긴다', async () => {
    const { admin: db, rpc, eqs } = admin({})

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({
      outcome: 'decided',
      proposalId,
      status: 'confirmed',
      factId,
    })

    // 조회는 인증이 확정한 가게와 제안 id 로만 좁힌다.
    expect(eqs).toEqual([['workspace_id', workspaceId], ['id', proposalId]])
    expect(rpc).toHaveBeenCalledWith('decide_studio_proposal', {
      p_workspace_id: workspaceId,
      p_proposal_id: proposalId,
      p_decision: 'confirm',
      p_user_id: userId,
      p_revised_content: null,
    })
  })

  it('거절 성공은 decided/rejected 로 돌려준다', async () => {
    const { admin: db } = admin({
      rpc: { data: rpcPayload({ status: 'rejected', confirmed_target_id: null }), error: null },
    })

    await expect(decideMemoryProposal({ ...input({ decision: 'reject' }), admin: db })).resolves.toEqual({
      outcome: 'decided',
      proposalId,
      status: 'rejected',
      factId: null,
    })
  })

  it('같은 결정을 다시 보내면 성공이 아니라 already_handled 로 표시한다', async () => {
    const { admin: db } = admin({ rpc: { data: rpcPayload({ idempotent: true }), error: null } })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({
      outcome: 'already_handled',
      proposalId,
      status: 'confirmed',
      factId,
    })
  })

  it('동시에 반대 결정이 먼저 처리되면 already_handled 로 표시한다 (승인 충돌)', async () => {
    const { admin: db } = admin({
      rpc: { data: null, error: { message: 'conflict: proposal is already confirmed', code: '23505' } },
    })

    await expect(decideMemoryProposal({ ...input({ decision: 'reject' }), admin: db })).resolves.toEqual({
      outcome: 'already_handled',
      proposalId,
      status: 'confirmed',
      factId: null,
    })
  })

  it('동시에 거절이 먼저 처리되면 already_handled/rejected 로 표시한다', async () => {
    const { admin: db } = admin({
      rpc: { data: null, error: { message: 'conflict: proposal is already rejected', code: '23505' } },
    })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({
      outcome: 'already_handled',
      proposalId,
      status: 'rejected',
      factId: null,
    })
  })

  it('다른 가게의 제안 id 는 존재 여부를 알리지 않고 not_found 로 닫는다', async () => {
    const { admin: db, rpc } = admin({ proposal: null })

    const result = await decideMemoryProposal({ ...input({ workspaceId: otherWorkspaceId }), admin: db })

    expect(result).toEqual({ outcome: 'not_found', proposalId })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('목표(goal) 제안은 이 화면에서 확정하지 않는다 — not_found, RPC 0건', async () => {
    const { admin: db, rpc } = admin({ proposal: proposalRow({ kind: 'goal' }) })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({ outcome: 'not_found', proposalId })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('제안 조회가 실패하면 통과가 아니라 unavailable 이다 — RPC 0건', async () => {
    const { admin: db, rpc } = admin({ lookupError: { message: 'timeout' } })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({ outcome: 'unavailable', proposalId })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('확인할 내용이 비어 있으면 승인해도 확정 기억을 만들지 않는다 — RPC 0건', async () => {
    const { admin: db, rpc } = admin({ proposal: proposalRow({ content: '   ' }) })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({
      outcome: 'invalid_proposal',
      proposalId,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('내용을 읽지 못한 제안도 승인은 막는다(빈 값을 확정으로 넘기지 않는다)', async () => {
    const { admin: db, rpc } = admin({ proposal: proposalRow({ content: undefined }) })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({
      outcome: 'invalid_proposal',
      proposalId,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('내용이 비어 있어도 거절은 할 수 있다(승인만 막는다)', async () => {
    const { admin: db, rpc } = admin({
      proposal: proposalRow({ content: '' }),
      rpc: { data: rpcPayload({ status: 'rejected', confirmed_target_id: null }), error: null },
    })

    await expect(decideMemoryProposal({ ...input({ decision: 'reject' }), admin: db })).resolves.toEqual({
      outcome: 'decided',
      proposalId,
      status: 'rejected',
      factId: null,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('승인 전에 제안 내용을 함께 읽는다', async () => {
    const { admin: db, selects } = admin({})

    await decideMemoryProposal({ ...input(), admin: db })

    expect(selects[0]).toContain('content')
  })

  it('RPC 가 없는 제안을 알리면 not_found 이다', async () => {
    const { admin: db } = admin({
      rpc: { data: null, error: { message: 'proposal_not_found: Proposal ... does not exist', code: 'P0002' } },
    })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({ outcome: 'not_found', proposalId })
  })

  it('대체 대상 사실이 사라진 경우는 성공이 아니라 unavailable 이다', async () => {
    const { admin: db } = admin({
      rpc: { data: null, error: { message: 'fact_not_found: Fact to replace ... not found', code: 'P0002' } },
    })

    await expect(decideMemoryProposal({ ...input(), admin: db })).resolves.toEqual({ outcome: 'unavailable', proposalId })
  })

  it('그 밖의 RPC 오류·해석 불가는 unavailable 로 닫는다 (가짜 성공 금지)', async () => {
    await expect(decideMemoryProposal({
      ...input(),
      admin: admin({ rpc: { data: null, error: { message: 'timeout' } } }).admin,
    })).resolves.toEqual({ outcome: 'unavailable', proposalId })

    await expect(decideMemoryProposal({
      ...input(),
      admin: admin({ rpc: { data: { success: false }, error: null } }).admin,
    })).resolves.toEqual({ outcome: 'unavailable', proposalId })

    await expect(decideMemoryProposal({
      ...input(),
      admin: admin({ rpc: { data: rpcPayload({ status: 'proposed' }), error: null } }).admin,
    })).resolves.toEqual({ outcome: 'unavailable', proposalId })
  })
})
