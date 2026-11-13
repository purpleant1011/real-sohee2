import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { readOperatorWorkspaceDetails, getOperatorWorkspaceKnowledge } from './detail-read-orchestrator'
import type { BillingOverview } from '@/features/operator-billing/billing-read-schemas'
import type { OperatorAuditReadEvent } from '@/features/operator-audit/audit-read-repository'
import type { SupportSession } from '@/features/operator-support/support-session-schemas'
import type { OperatorWorkspaceKnowledge } from './schemas'

const workspaceId = '11111111-1111-4111-8111-111111111111'

const knowledge: OperatorWorkspaceKnowledge = {
  placeUrl: 'https://naver.me/5xgJJEBa',
  placeStatus: 'connected',
  businessName: '바이름 청라점',
  industry: '미용·네일·뷰티',
  location: '인천광역시 서구 청라라임로',
  summary: '바이름 청라점은 1:1 맞춤 예약제 뷰티 매장입니다.',
  updatedAt: '2026-08-23T00:00:00.000Z',
}

const lifecycle = {
  workspaceId,
  workspaceName: 'Workspace A',
  lifecycle: { state: 'fresh' as const, data: { status: 'active' as const, version: 2, changedAt: '2026-08-23T00:00:00.000Z' } },
  agreements: { state: 'empty' as const, data: [] },
  delegations: { state: 'fresh' as const, data: [] },
  activation: { ready: true, missing: [] },
}

const channel = {
  workspaceId,
  workspaceName: 'Workspace A',
  channel: 'instagram' as const,
  accountLabel: 'Sohee',
  connectionStatus: 'connected' as const,
  delegationStatus: 'accepted' as const,
  technicalPermissionStatus: 'ready' as const,
  tokenExpiresAt: null,
  webhookStatus: 'healthy' as const,
  lastWebhookAt: null,
  lastProviderEventAt: null,
  lastErrorCode: null,
  updatedAt: '2026-08-23T00:00:00.000Z',
  freshness: 'fresh' as const,
}

const publish = {
  workspaceId,
  workspaceName: 'Workspace A',
  contentId: '22222222-2222-4222-8222-222222222222',
  contentTitle: '게시물 A',
  channel: 'instagram',
  currentVersionId: null,
  currentVersionNumber: null,
  currentFingerprint: null,
  approvalId: null,
  approvedVersionId: null,
  approvedVersionNumber: null,
  approvalStatus: null,
  approvalDecidedAt: null,
  approvalFingerprint: null,
  fingerprintMatch: true,
  scheduleId: null,
  publishAt: null,
  timezone: 'Asia/Seoul',
  scheduleStatus: null,
  displayState: 'unknown' as const,
  attemptNumber: null,
  attemptStatus: null,
  providerReferencePresent: false,
  providerRequestIdPresent: false,
  failureCode: null,
  recoveryStatus: null,
  idempotencyResult: 'not_recorded' as const,
  destinationUrlPresent: false,
  publishedAt: null,
  freshness: 'unknown' as const,
}

const billing = {
  items: [],
  summary: { state: 'empty' as const, workspaceCount: null, sourceTimestamp: null },
} as BillingOverview

const auditEvent = {
  id: '33333333-3333-4333-8333-333333333333',
  workspaceId,
  workspaceName: 'Workspace A',
  action: 'credit.adjust.requested',
  targetType: 'credit_account',
  targetLabel: null,
  result: 'succeeded' as const,
  factKind: 'observed' as const,
  reason: '검증',
  approvalRequestId: null,
  approvalStatus: 'none' as const,
  before: {},
  after: {},
  createdAt: '2026-08-23T00:00:00.000Z',
  freshness: 'fresh' as const,
  linkedEventCount: 0,
} as OperatorAuditReadEvent

const supportSession = {
  sessionId: '44444444-4444-4444-8444-444444444444', workspaceId, operatorUserId: '55555555-5555-4555-8555-555555555555', mode: 'view_only' as const, status: 'active' as const, reason: '운영 확인', closeReason: null, startedAt: '2026-08-23T00:00:00.000Z', expiresAt: '2026-08-23T00:30:00.000Z', closedAt: null,
} as SupportSession

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requireOperator: vi.fn(async (permission: string) => {
      if (permission === 'channel.read') throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
      return {}
    }),
    getOperatorOnboardingOverview: vi.fn(async () => ({ data: [lifecycle], error: null })),
    listOperatorChannelConnections: vi.fn(async () => ({ data: [channel], error: null })),
    listOperatorPublishOperations: vi.fn(async () => ({ data: { items: [publish], nextCursor: null }, error: null })),
    listOperatorBillingOverview: vi.fn(async () => ({ data: billing, error: null })),
    listOperatorAuditEvents: vi.fn(async () => ({ data: { items: [auditEvent], nextCursor: null }, error: null })),
    listOperatorSupportSessions: vi.fn(async () => ({ data: [supportSession], error: null })),
    listWorkspaceCreditConsumptions: vi.fn(async () => ({
      data: [
        {
          id: 'cons-1',
          referenceId: 'cons1000',
          occurredAt: '2026. 10. 10. 15:00',
          action: '인스타그램 글 생성',
          amount: -100,
          amountLabel: '-100 크레딧',
          idempotencyKey: 'idem-cons-1',
          idempotencyReference: 'idem1000',
        },
      ],
      error: null,
    })),
    getOperatorWorkspaceKnowledge: vi.fn(async () => ({ data: knowledge, error: null, sourceState: 'ready' as const })),
    ...overrides,
  }
}

describe('readOperatorWorkspaceDetails', () => {
  it('loads lifecycle and publishing through their workspace-scoped repositories while preserving denied channel state', async () => {
    const deps = dependencies()
    const result = await readOperatorWorkspaceDetails(workspaceId, deps)

    expect(deps.requireOperator).toHaveBeenCalledWith('agreement.read', workspaceId)
    expect(deps.requireOperator).toHaveBeenCalledWith('channel.read', workspaceId)
    expect(deps.requireOperator).toHaveBeenCalledWith('publish.read', workspaceId)
    expect(deps.requireOperator).toHaveBeenCalledWith('workspace.read', workspaceId)
    expect(deps.getOperatorOnboardingOverview).toHaveBeenCalledWith(workspaceId)
    expect(deps.listOperatorChannelConnections).not.toHaveBeenCalled()
    expect(deps.listOperatorPublishOperations).toHaveBeenCalledWith({ workspaceId, limit: 50 })
    expect(deps.getOperatorWorkspaceKnowledge).toHaveBeenCalledWith(workspaceId)
    expect(result.lifecycle.kind).toBe('ready')
    expect(result.channels.kind).toBe('forbidden')
    expect(result.publishing.kind).toBe('ready')
    expect(result.knowledge.kind).toBe('ready')
    expect(result.knowledge.data).toEqual(knowledge)
  })

  it('loads workspace-scoped billing and audit reads while keeping support disconnected', async () => {
    const deps = dependencies()
    const result = await readOperatorWorkspaceDetails(workspaceId, deps)

    expect(deps.requireOperator).toHaveBeenCalledWith('billing.read', workspaceId)
    expect(deps.requireOperator).toHaveBeenCalledWith('audit.read', workspaceId)
    expect(deps.listOperatorBillingOverview).toHaveBeenCalledWith({ workspaceId, limit: 1 })
    expect(deps.listOperatorAuditEvents).toHaveBeenCalledWith({ workspaceId, limit: 20 })
    expect(deps.listWorkspaceCreditConsumptions).toHaveBeenCalledWith(workspaceId, 50)
    expect(result.billing.kind).toBe('empty')
    expect(result.creditConsumptions.kind).toBe('ready')
    expect(result.creditConsumptions.data).toHaveLength(1)
    expect(result.audit.kind).toBe('ready')
    expect(result.support.kind).toBe('ready')
    expect(deps.listOperatorSupportSessions).toHaveBeenCalledWith(workspaceId)
  })

  it('fails closed for billing and audit permission denial without calling their repositories', async () => {
    const deps = dependencies({
      requireOperator: vi.fn(async (permission: string) => {
        if (permission === 'billing.read' || permission === 'audit.read' || permission === 'workspace.read') {
          throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
        }
        return {}
      }),
    })

    const result = await readOperatorWorkspaceDetails(workspaceId, deps)

    expect(result.billing.kind).toBe('forbidden')
    expect(result.creditConsumptions.kind).toBe('forbidden')
    expect(result.audit.kind).toBe('forbidden')
    expect(result.knowledge.kind).toBe('forbidden')
    expect(deps.listOperatorBillingOverview).not.toHaveBeenCalled()
    expect(deps.listWorkspaceCreditConsumptions).not.toHaveBeenCalled()
    expect(deps.listOperatorAuditEvents).not.toHaveBeenCalled()
    expect(deps.getOperatorWorkspaceKnowledge).not.toHaveBeenCalled()
  })

  it('does not turn an empty successful read into a fake zero or unavailable error', async () => {
    const deps = dependencies({
      getOperatorOnboardingOverview: vi.fn(async () => ({ data: [{ ...lifecycle, agreements: { state: 'empty' as const, data: [] } }], error: null })),
      listOperatorPublishOperations: vi.fn(async () => ({ data: { items: [], nextCursor: null }, error: null })),
      getOperatorWorkspaceKnowledge: vi.fn(async () => ({
        data: {
          placeUrl: null,
          placeStatus: null,
          businessName: null,
          industry: null,
          location: null,
          summary: null,
          updatedAt: null,
        },
        error: null,
        sourceState: 'empty' as const,
      })),
    })

    const result = await readOperatorWorkspaceDetails(workspaceId, deps)

    expect(result.lifecycle.kind).toBe('ready')
    expect(result.publishing.kind).toBe('empty')
    expect(result.knowledge.kind).toBe('empty')
    expect(JSON.stringify(result)).not.toContain('0건')
  })
})

describe('getOperatorWorkspaceKnowledge', () => {
  it('merges business_profiles and channel_connections when both exist', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    business_name: '바이름 청라점',
                    industry: '미용·네일·뷰티',
                    location: '인천광역시 서구 청라라임로',
                    summary: '매장 요약',
                    updated_at: '2026-08-23T01:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      channel: 'naver_place',
                      status: 'connected',
                      account_label: 'https://naver.me/5xgJJEBa',
                      external_account_id: '12345678',
                      updated_at: '2026-08-23T02:00:00.000Z',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await getOperatorWorkspaceKnowledge(workspaceId, mockClient as never)
    expect(res.error).toBeNull()
    expect(res.sourceState).toBe('ready')
    expect(res.data).toEqual({
      placeUrl: 'https://naver.me/5xgJJEBa',
      placeStatus: 'connected',
      businessName: '바이름 청라점',
      industry: '미용·네일·뷰티',
      location: '인천광역시 서구 청라라임로',
      summary: '매장 요약',
      updatedAt: '2026-08-23T02:00:00.000Z',
      readiness: null,
    })
  })

  it('aggregates knowledge readiness counts accurately from facts, materials, and products tables', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    business_name: '해드림물류',
                    industry: '물류·운송',
                    location: '서울',
                    summary: '물류 서비스',
                    updated_at: '2026-10-20T00:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'f-1', category: 'MENU', created_at: '2026-10-20T01:00:00.000Z' },
                    { id: 'f-2', category: 'GENERAL', created_at: '2026-10-20T02:00:00.000Z' },
                  ],
                  count: 2,
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_candidates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: 'c-1', status: 'review_required' }],
                  count: 1,
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { id: 's-1', status: 'approved', created_at: '2026-10-20T03:00:00.000Z' },
                  { id: 's-2', status: 'processing', created_at: '2026-10-20T04:00:00.000Z' },
                  { id: 's-3', status: 'failed', created_at: '2026-10-20T05:00:00.000Z' },
                ],
                error: null,
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await getOperatorWorkspaceKnowledge(workspaceId, mockClient as never)
    expect(res.error).toBeNull()
    expect(res.data?.readiness).toEqual({
      factsConfirmedCount: 2,
      factsPendingCount: 1,
      materialsExtractedCount: 1,
      materialsProcessingCount: 1,
      materialsFailedCount: 1,
      materialsTotalCount: 3,
      structuredFactsCount: 1,
      productsServicesStatus: 'not_supported',
      telemetry: 'not_collected',
      lastUpdatedAt: '2026-10-20T05:00:00.000Z',
    })
  })

  it('enforces ERROR != EMPTY: returns null for failed table reads instead of falsely reporting 0', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { business_name: '해드림물류', updated_at: '2026-10-20T00:00:00.000Z' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'permission denied for table knowledge_facts' },
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_candidates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
              }),
            }),
          }
        }
        if (table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'timeout on knowledge_sources' },
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await getOperatorWorkspaceKnowledge(workspaceId, mockClient as never)
    expect(res.error).toBeNull()
    expect(res.data?.readiness?.factsConfirmedCount).toBeNull()
    expect(res.data?.readiness?.structuredFactsCount).toBeNull()
    expect(res.data?.readiness?.materialsExtractedCount).toBeNull()
    expect(res.data?.readiness?.materialsTotalCount).toBeNull()
    expect(res.data?.readiness?.factsPendingCount).toBe(0)
    expect(res.data?.readiness?.errors).toHaveLength(2)
  })

  it('returns empty state when both tables have no records', async () => {
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      })),
    }

    const res = await getOperatorWorkspaceKnowledge(workspaceId, mockClient as never)
    expect(res.error).toBeNull()
    expect(res.sourceState).toBe('empty')
    expect(res.data?.placeUrl).toBeNull()
    expect(res.data?.businessName).toBeNull()
  })

  it('constructs placeUrl from external_account_id when account_label is not a URL', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    channel: 'naver_place',
                    status: 'connected',
                    account_label: '바이름 청라점',
                    external_account_id: '12345678',
                    updated_at: '2026-08-23T02:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }),
    }

    const res = await getOperatorWorkspaceKnowledge(workspaceId, mockClient as never)
    expect(res.data?.placeUrl).toBe('https://m.place.naver.com/place/12345678')
  })
})
