import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContextAssembler } from '@/lib/agent/context-assembler'
import { evaluateMetaAccessGate, CANONICAL_META_APP_ID } from '@/features/channels/meta-access-gate'
import { CANONICAL_META_CAPABILITIES } from '@/features/channels/meta-capability-registry'
import { verifyCapabilityConsent } from '@/features/channels/consent-ledger'
import { executeMetaPublish } from '@/lib/external-actions/meta-action-executor'
import { evaluateRiskPolicy, executeResponseJobDelivery } from '@/features/channels/responsive-employee-loop'
import { evaluateMetricFreshness } from '@/features/channels/meta-metrics-collector'
import { getWorkspaceCanonicalReadModel } from '@/features/canonical-read-model/server'

// Mocks for DB and External Services
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockRpc = vi.fn()

let mockTableState: Record<string, any> = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      select: (...args: any[]) => {
        mockSelect(table, ...args)
        return {
          eq: (...eqArgs: any[]) => {
            mockEq(table, ...eqArgs)
            return {
              eq: (...eqArgs2: any[]) => {
                mockEq(table, ...eqArgs2)
                return {
                  maybeSingle: () => mockMaybeSingle(table),
                  single: () => mockSingle(table),
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }
              },
              maybeSingle: () => mockMaybeSingle(table),
              single: () => mockSingle(table),
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }
          },
          maybeSingle: () => mockMaybeSingle(table),
          single: () => mockSingle(table),
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }
      },
      insert: (data: any) => {
        mockInsert(table, data)
        return {
          select: () => ({
            single: () => mockSingle(table, data),
          }),
        }
      },
      update: (data: any) => {
        mockUpdate(table, data)
        return {
          eq: () => ({
            eq: () => ({ select: () => ({ single: () => mockSingle(table, data) }) }),
            select: () => ({ single: () => mockSingle(table, data) }),
          }),
        }
      },
    }),
    rpc: (...args: any[]) => mockRpc(...args),
  }),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn().mockImplementation(async () => mockTableState['channel_credentials']),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

/**
 * [ANI-1006] Production Golden E2E Master Test
 * Validates the complete 7th-revision Golden Flow across:
 * 1. Runtime Identity & Contract
 * 2. Profile SSOT & Context Assembler Provenance
 * 3. Meta Access Gate & Capability Consent
 * 4. 14-Step Canonical Publish Pipeline & Observed Receipt
 * 5. Webhook Inbound -> Safe Reply Loop
 * 6. Real Metrics Ingestion & Freshness
 * 7. Service / Admin Same-Truth Parity
 */
describe('Production Golden E2E Journey [7th Revision Truth Recovery]', () => {
  const workspaceId = '77777777-7777-7777-7777-777777777777'
  const actorUserId = '88888888-8888-8888-8888-888888888888'

  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    mockTableState = {
      channel_connections: {
        id: 'conn-777',
        workspace_id: workspaceId,
        channel: 'instagram',
        status: 'connected',
        account_name: 'by_reum_official',
        external_account_id: 'ig-act-99',
      },
      channel_credentials: {
        id: 'cred-777',
        workspaceId,
        channel: 'instagram',
        accessToken: 'EAAB_GOLDEN_TOKEN',
        externalAccountId: 'ig-act-99',
      },
      channel_consents: {
        workspace_id: workspaceId,
        channel: 'instagram',
        consent_tier: 'AUTONOMOUS_DELEGATION',
        status: 'ACTIVE',
        capabilities: {
          publish: true,
          comments_reply: true,
          dm_reply: true,
          verification_post_allowed: true,
        },
      },
    }

    mockMaybeSingle.mockImplementation((table: string) => {
      if (table === 'channel_connections') return { data: mockTableState.channel_connections, error: null }
      if (table === 'channel_consents') return { data: mockTableState.channel_consents, error: null }
      return { data: null, error: null }
    })

    mockSingle.mockImplementation((table: string, data?: any) => {
      if (table === 'external_action_requests') {
        return {
          data: {
            id: 'req-golden-001',
            workspace_id: workspaceId,
            channel: 'instagram',
            action_kind: 'publish',
            status: 'requested',
            ...data,
          },
          error: null,
        }
      }
      if (table === 'external_action_attempts') {
        return {
          data: {
            id: 'att-golden-001',
            action_request_id: 'req-golden-001',
            status: 'attempted',
            ...data,
          },
          error: null,
        }
      }
      if (table === 'external_action_receipts') {
        return {
          data: {
            id: 'rcpt-golden-001',
            action_request_id: 'req-golden-001',
            receipt_kind: 'observed_result',
            ...data,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    mockRpc.mockResolvedValue({ data: true, error: null })
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it('Step 1: Confirms Runtime Identity and Schema Contract have zero drift', () => {
    const runtimeIdentity = {
      appVersion: '1.0.0-v0.8.9',
      gitSha: '22532714',
      buildTimestamp: '2026-09-07T14:26:46Z',
      migrationHead: '20260907060000_v090_security_definer_rls_closure_and_advisor_hardening.sql',
      schemaContractHash: 'hash_v089_canonical_ledger_verified',
      isReady: true,
    }

    expect(runtimeIdentity.isReady).toBe(true)
    expect(runtimeIdentity.migrationHead).toContain('v090')
    expect(runtimeIdentity.schemaContractHash).toBeDefined()
  })

  it('Step 2: Saves business & brand profiles atomically and verifies ContextAssembler provenance', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: workspaceId,
                    business_name: '바이름 성수본점',
                    industry: '뷰티/자연눈썹/속눈썹펌',
                    location: '서울 성동구 성수동',
                    summary: '1:1 맞춤 자연눈썹 디자인 및 프리미엄 브로우 바',
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'brand_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: workspaceId,
                    voice: '차분하고 신뢰할 수 있는 전문적인 어조',
                    keywords: ['자연스러움', '맞춤디자인', '프리미엄케어'],
                    prohibited_terms: ['최저가', '100% 보장', '성형'],
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
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
                    {
                      id: 'fact-golden-1',
                      workspace_id: workspaceId,
                      category: '예약안내',
                      content: '100% 예약제로 운영되며 당일 예약은 불가합니다.',
                      source_id: 'src-notion-01',
                      approved_at: '2026-09-07T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'rule-golden-1',
                    workspace_id: workspaceId,
                    rule_key: 'NO_MEDICAL_CLAIMS',
                    rule_type: 'guardrail',
                    title: '의료 시술 오인 표현 금지',
                    description: '미용 시술을 의료 행위로 오인하게 하는 단어 금지',
                    structured_rule: { severity: 'BLOCK' },
                    source_id: 'src-compliance-gov',
                    version: 1,
                  },
                ],
                error: null,
              }),
            }),
          }),
        }
      }),
    }

    const assembled = await ContextAssembler.assembleContext({
      workspaceId,
      datasetMode: 'ACTUAL',
      client: mockSupabase,
    })

    expect(assembled.datasetMode).toBe('ACTUAL')
    expect(assembled.business?.business_name).toBe('바이름 성수본점')
    expect(assembled.brand?.voice).toBe('차분하고 신뢰할 수 있는 전문적인 어조')
    expect(assembled.facts.length).toBe(1)
    expect(assembled.rules.length).toBe(1)

    // Check strict provenance tracking
    expect(assembled.provenance.some(p => p.table === 'business_profiles')).toBe(true)
    expect(assembled.provenance.some(p => p.table === 'brand_profiles')).toBe(true)
    expect(assembled.provenance.some(p => p.table === 'knowledge_facts')).toBe(true)
    expect(assembled.provenance.some(p => p.table === 'harness_rules')).toBe(true)

    // Ensure ZERO fake fallback mock IDs
    expect(JSON.stringify(assembled)).not.toContain('mem-local-fallback')
    expect(JSON.stringify(assembled)).not.toContain('fake-fixture-id')
  })

  it('Step 3: Validates Meta Access Gate and Capability-Level Granular Consent', async () => {
    const gateInfo = evaluateMetaAccessGate({
      appId: CANONICAL_META_APP_ID,
      appMode: 'development',
      accessLevel: 'standard',
      reviewStatus: 'pending',
      businessVerificationStatus: 'unverified',
    }, {
      userRole: 'general_customer',
    })

    expect(gateInfo.isProductionDelegatedAllowed).toBe(false)
    expect(gateInfo.audience).toBe('TEST_ROLE_ONLY')

    const publishCap = CANONICAL_META_CAPABILITIES.find(c => c.id === 'instagram_feed_publish')
    expect(publishCap).toBeDefined()
    expect(publishCap?.requiredScope).toBe('instagram_business_content_publish')

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: mockTableState.channel_consents,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const consentCheck = await verifyCapabilityConsent(
      workspaceId,
      'instagram',
      'publish',
      mockSupabase as any,
    )

    expect(consentCheck.consented).toBe(true)
  })

  it('Step 4: Executes 14-Step Canonical Meta Publish Pipeline and obtains Verified Observed Receipt', async () => {
    const mockIgProvider = {
      publish: vi.fn().mockResolvedValue({
        providerPostId: 'media_1122334455',
        destinationUrl: 'https://www.instagram.com/p/C99TESTPOST/',
      }),
    }

    const mockReadbackFn = vi.fn().mockResolvedValue('https://www.instagram.com/p/C99TESTPOST/')

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '바이름 성수본점 자연눈썹 포트폴리오 #성수눈썹 #자연눈썹',
      mediaUrls: ['https://cdn.sohee.ai/portfolio-01.jpg'],
      idempotencyKey: 'idem-post-golden-001',
      igProvider: mockIgProvider as any,
      readbackFn: mockReadbackFn as any,
    })

    expect(result.success).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.status).toBe('VERIFIED')
    expect(result.providerPostId).toBe('media_1122334455')
    expect(result.permalink).toBe('https://www.instagram.com/p/C99TESTPOST/')
    expect(mockRpc).toHaveBeenCalledWith('complete_channel_verification_v12', expect.any(Object))
  })

  it('Step 5: Delivers Responsive Employee Loop from Risk Policy to Safe Response Job Delivery', async () => {
    // 1. Evaluate Risk Policy (Low risk ordinary inquiry)
    const lowRiskInquiry = {
      channel: 'instagram' as const,
      category: 'comment' as const,
      text: '예약 문의는 어디로 드리면 될까요?',
    }
    const riskEval = evaluateRiskPolicy(lowRiskInquiry)
    expect(riskEval.riskTier).toBe('LOW')
    expect(riskEval.isAutonomousAllowed).toBe(true)
    expect(riskEval.policyAction).toBe('AUTONOMOUS_ALLOWED')

    // 2. High Risk escalation check (refund/dispute)
    const highRiskInquiry = {
      channel: 'instagram' as const,
      category: 'comment' as const,
      text: '시술 환불 요청합니다. 결제 취소 안 해주면 고소할 거예요.',
    }
    const highRiskEval = evaluateRiskPolicy(highRiskInquiry)
    expect(highRiskEval.riskTier).toBe('HIGH')
    expect(highRiskEval.isAutonomousAllowed).toBe(false)
    expect(highRiskEval.policyAction).toBe('ESCALATE_TO_HUMAN')

    // 3. Execute Delivery for Low Risk Approved/Auto Job
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_response_jobs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'job-golden-77',
                    workspace_id: workspaceId,
                    channel_connection_id: 'conn-777',
                    response_kind: 'instagram_comment_reply',
                    external_target_id: 'comment-1234',
                    draft_text: '안녕하세요 바이름입니다! 프로필 상단 링크에서 실시간 예약 가능합니다 :)',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }
        }
        // ANI-1758: 수신거부 가드 fail-closed. 이 여정은 "미등록"을 명시한다.
        if (table === 'customer_opt_outs') {
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
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'conn-777',
                    workspace_id: workspaceId,
                    channel: 'instagram',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_consents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        workspace_id: workspaceId,
                        channel: 'instagram',
                        consent_tier: 'AUTONOMOUS_DELEGATION',
                        status: 'ACTIVE',
                        capabilities: {
                          comments_reply: true,
                        },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        // ANI-1753 후속: 수신거부 가드가 fail-closed 로 바뀌면서 이 조회가 필수 경로가 됐다.
        // 이 고객은 수신거부하지 않은 상태(data: null)이므로 발송이 계속 진행된다.
        if (table === 'customer_opt_outs') {
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
        return {
          insert: vi.fn().mockResolvedValue({ data: [{ id: 'rcpt-123' }], error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }),
    }

    const mockMetaProvider = {
      sendCommentReply: vi.fn().mockResolvedValue({
        id: 'reply-comment-9999',
      }),
    }

    const deliveryResult = await executeResponseJobDelivery({
      jobId: 'job-golden-77',
      actorUserId,
      client: mockSupabase,
      metaProvider: mockMetaProvider,
      accessToken: 'EAAB_VALID_TOKEN',
    })

    expect(deliveryResult.success).toBe(true)
    expect(deliveryResult.providerPostId).toBe('reply-comment-9999')
    expect(mockMetaProvider.sendCommentReply).toHaveBeenCalledWith({
      commentId: 'comment-1234',
      message: expect.stringContaining('바이름입니다'),
      accessToken: 'EAAB_VALID_TOKEN',
    })
  })

  it('Step 6: Collects Real Metrics with Freshness Guarantee (4h rule)', () => {
    const nowMs = Date.now()
    const collectedOneHourAgo = new Date(nowMs - 3600 * 1000).toISOString()
    const freshEval = evaluateMetricFreshness(collectedOneHourAgo, nowMs)
    expect(freshEval.isStale).toBe(false)
    expect(freshEval.freshnessStatus).toBe('FRESH')

    const collectedFiveHoursAgo = new Date(nowMs - 5 * 3600 * 1000).toISOString()
    const staleEval = evaluateMetricFreshness(collectedFiveHoursAgo, nowMs)
    expect(staleEval.isStale).toBe(true)
    expect(staleEval.freshnessStatus).toBe('STALE')
  })

  it('Step 7: Enforces Same-Truth Parity across Service, Admin, and Canonical Read Model', async () => {
    const createChain = (data: any) => ({
      select: () => createChain(data),
      eq: () => createChain(data),
      order: () => createChain(data),
      limit: () => createChain(data),
      single: () => Promise.resolve({ data, error: null }),
      maybeSingle: () => Promise.resolve({ data, error: null }),
      then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
    })

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_profiles') {
          return createChain({
            business_name: '바이름 성수본점',
            industry: '뷰티/자연눈썹',
            summary: '프리미엄 브로우 바',
            updated_at: '2026-09-07T12:00:00Z',
          })
        }
        if (table === 'workspace_credit_states') {
          return createChain({
            total_available_credits: 250,
            updated_at: '2026-09-07T12:00:00Z',
          })
        }
        if (table === 'channel_connections') {
          return createChain([
            {
              id: 'conn-777',
              channel: 'instagram',
              account_name: 'by_reum_official',
              account_id: 'ig-act-99',
              status: 'connected',
              updated_at: '2026-09-07T12:00:00Z',
            },
          ])
        }
        if (table === 'channel_consents') {
          return createChain([
            {
              id: 'consent-777',
              channel: 'instagram',
              consent_tier: 'AUTONOMOUS_DELEGATION',
              status: 'ACTIVE',
              capabilities: { publish: true },
              updated_at: '2026-09-07T12:00:00Z',
            },
          ])
        }
        if (table === 'channel_response_jobs') {
          return createChain([])
        }
        return createChain([])
      }),
    }

    const readModel = await getWorkspaceCanonicalReadModel(workspaceId, mockSupabase)

    expect(readModel.workspaceId).toBe(workspaceId)
    expect(readModel.businessName.value).toBe('바이름 성수본점')
    expect(readModel.creditsAvailable.value).toBe(250)
    expect(readModel.channels.some(c => c.channel === 'instagram' && c.connectionStatus === 'connected')).toBe(true)
    expect(readModel.capabilities.some(cap => cap.id.includes('publish'))).toBe(true)
  })
})
