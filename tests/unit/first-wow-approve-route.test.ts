import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * ANI-1753 후속 — 스키마 드리프트 폐쇄(B그룹) 회귀 테스트.
 *
 * 감사(docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md, C1)에서 확인된 결함:
 * first-wow-approve 가 external_action_requests 에 action_type/target_channel 을 넣어 insert 하는데
 * 마이그레이션에 그 컬럼이 없어 PostgREST 400 → 라우트가 에러를 검사해 500 을 반환했다.
 * 즉 온보딩 첫 발행 승인이 항상 실패했다.
 *
 * 이 테스트는 라우트의 정상 경로가 200 으로 끝나고, 요청 원장 insert payload 에
 * 두 컬럼이 실제로 담기는지 고정한다(마이그레이션이 빠지면 스키마에서 400 이 나 다시 깨진다).
 */

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CONTENT_ITEM_ID = '44444444-4444-4444-8444-444444444444'
const CONTENT_VERSION_ID = '55555555-5555-4555-8555-555555555555'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  actionRequestInserts: [] as Array<Record<string, unknown>>,
  receiptInserts: [] as Array<Record<string, unknown>>,
  channelConnection: null as null | { external_account_id: string; account_label: string },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from(table: string) {
      if (table === 'workspace_members') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          limit: async () => ({ data: [{ workspace_id: WORKSPACE_ID }], error: null }),
        }
        return chain
      }
      if (table === 'content_items') {
        const chain: any = {
          insert: () => chain,
          update: () => chain,
          select: () => chain,
          eq: () => chain,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
          single: async () => ({ data: { id: CONTENT_ITEM_ID }, error: null }),
        }
        return chain
      }
      if (table === 'content_versions') {
        const chain: any = {
          insert: () => chain,
          select: () => chain,
          single: async () => ({ data: { id: CONTENT_VERSION_ID }, error: null }),
        }
        return chain
      }
      if (table === 'channel_connections') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          or: () => chain,
          maybeSingle: async () => ({ data: mocks.channelConnection, error: null }),
        }
        return chain
      }
      if (table === 'external_action_requests') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            mocks.actionRequestInserts.push(payload)
            return { error: null }
          },
        }
      }
      if (table === 'external_action_receipts') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            mocks.receiptInserts.push(payload)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table in first-wow-approve test: ${table}`)
    },
  })),
}))

describe('B. first-wow-approve 는 500 없이 발행 요청 원장을 만든다 (ANI-1753 후속)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actionRequestInserts.length = 0
    mocks.receiptInserts.length = 0
    mocks.channelConnection = null
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  })

  it('채널이 연결된 정상 경로: 200 success 를 반환하고 정본 NOT NULL 컬럼을 모두 채운다', async () => {
    mocks.channelConnection = {
      external_account_id: '17841400000000000',
      account_label: 'momo_cafe',
    }
    const { POST } = await import('@/app/api/onboarding/first-wow-approve/route')

    const request = new NextRequest('http://localhost/api/onboarding/first-wow-approve', {
      method: 'POST',
      body: JSON.stringify({ title: '첫 시안', content: '본문입니다.', tags: ['#테스트'] }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    // 외부 실행 전 상태. 정본 status 허용 목록에 QUEUED 는 없다.
    expect(body.executionState).toBe('prepared')

    // ANI-1762 후속: 정본 NOT NULL 컬럼(channel/action_kind/target_external_id/target_label/
    // exact_payload/idempotency_key)을 모두 채워야 실 DB 제약을 통과한다.
    // 이 단언은 tests/integration/first-wow-approve-contract.test.ts 의 실 DB 계약과 짝을 이룬다.
    expect(mocks.actionRequestInserts).toHaveLength(1)
    expect(mocks.actionRequestInserts[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      channel: 'instagram',
      action_kind: 'feed_publish',
      target_external_id: '17841400000000000',
      target_label: 'momo_cafe',
      status: 'prepared',
      created_by: USER_ID,
    })
    expect(mocks.actionRequestInserts[0].exact_payload).toMatchObject({
      source: 'first_wow_approval',
      content_item_id: CONTENT_ITEM_ID,
    })
    expect(String(mocks.actionRequestInserts[0].idempotency_key)).toContain(CONTENT_ITEM_ID)

    expect(mocks.receiptInserts).toHaveLength(1)
    expect(mocks.receiptInserts[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      receipt_kind: 'submission',
      recorded_by: USER_ID,
    })
    expect(body.receipt).toMatchObject({
      channel: 'instagram',
      status: 'prepared',
      contentItemId: CONTENT_ITEM_ID,
    })
  })

  it('채널도 핸들도 없으면 외부 요청 원장을 만들지 않고 connection_required 로 정직하게 알린다', async () => {
    const { POST } = await import('@/app/api/onboarding/first-wow-approve/route')

    const request = new NextRequest('http://localhost/api/onboarding/first-wow-approve', {
      method: 'POST',
      body: JSON.stringify({ title: '첫 시안', content: '본문입니다.' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.executionState).toBe('connection_required')
    expect(body.receipt).toBeNull()
    // 대상이 없는데 요청 원장을 지어내지 않는다.
    expect(mocks.actionRequestInserts).toHaveLength(0)
    expect(mocks.receiptInserts).toHaveLength(0)
  })

  it('인증 세션이 없으면 401 로 끝나고 원장을 쓰지 않는다', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('@/app/api/onboarding/first-wow-approve/route')

    const request = new NextRequest('http://localhost/api/onboarding/first-wow-approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(mocks.actionRequestInserts).toHaveLength(0)
  })
})
