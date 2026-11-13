import { describe, it, expect, beforeEach } from 'vitest'
import {
  WorkspaceContextEnvelopeSchema,
  computeContextFingerprint,
  validateWorkspaceContextEnvelope,
  assertNoCrossTenantResourceAccess,
  createWorkspaceCacheKey,
  CrossTenantAccessError,
  type WorkspaceContextEnvelope,
} from '@/features/workspace/workspace-context-envelope'
import { WorkspaceSwitchGuard } from '@/features/workspace/workspace-switch-guard'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'
import type { VisualBriefBuilderInput } from '@/features/creative/visual-brief-types'

describe('ANI-1125: Workspace Context Envelope + Cache/Query Key Tenant Isolation', () => {
  const bakeryWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const beautyWorkspaceId = '22222222-2222-4222-8222-222222222222'
  const testUserId = 'user_test_999'

  function createValidBakeryEnvelope(overrides: Partial<WorkspaceContextEnvelope> = {}): WorkspaceContextEnvelope {
    const base = {
      workspaceId: bakeryWorkspaceId,
      userId: testUserId,
      membership: {
        role: 'owner' as const,
        status: 'active' as const,
      },
      businessProfileVersion: 3,
      brandVersion: 2,
      catalogSourceIds: ['catalog_tart_001', 'catalog_scone_002'],
      channelConnectionIds: ['conn_ig_bakery', 'conn_threads_bakery'],
      businessName: '소희네 베이커리',
      industry: 'bakery' as const,
      location: '서울 성수동 카페거리 12-3',
      summary: '천연 발효종과 유기농 제철 과일 타르트 전문 베이커리',
      brandVoice: '따뜻하고 정갈한 장인 정신의 어조',
      keywords: ['유기농 타르트', '천연 발효종', '성수동 디저트'],
      prohibitedTerms: ['인공 첨가물', '방부제', '눈썹', '바이름'],
      resolvedAt: new Date().toISOString(),
    }

    const fingerprint = computeContextFingerprint(base)
    return WorkspaceContextEnvelopeSchema.parse({
      ...base,
      contextFingerprint: fingerprint,
      ...overrides,
    })
  }

  describe('1. WorkspaceContextEnvelope Schema & Fingerprint Verification', () => {
    it('successfully parses and validates a canonical envelope', () => {
      const envelope = createValidBakeryEnvelope()
      expect(envelope.workspaceId).toBe(bakeryWorkspaceId)
      expect(envelope.businessName).toBe('소희네 베이커리')
      expect(envelope.contextFingerprint).toHaveLength(64)
      expect(() => validateWorkspaceContextEnvelope(envelope)).not.toThrow()
    })

    it('rejects envelope with tampered context fingerprint (Fail-Closed)', () => {
      const envelope = createValidBakeryEnvelope({
        contextFingerprint: '0000000000000000000000000000000000000000000000000000000000000000',
      })
      expect(() => validateWorkspaceContextEnvelope(envelope)).toThrow(/fingerprint mismatch/i)
    })

    it('rejects envelope with non-UUID workspace ID or inactive membership', () => {
      expect(() => {
        WorkspaceContextEnvelopeSchema.parse({
          ...createValidBakeryEnvelope(),
          workspaceId: 'not-a-uuid',
        })
      }).toThrow()

      expect(() => {
        WorkspaceContextEnvelopeSchema.parse({
          ...createValidBakeryEnvelope(),
          membership: { role: 'owner', status: 'disabled' },
        })
      }).toThrow()
    })
  })

  describe('2. Cross-Tenant Resource Injection Guard', () => {
    it('allows access when resource belongs to the current workspace envelope', () => {
      const envelope = createValidBakeryEnvelope()
      expect(() => {
        assertNoCrossTenantResourceAccess(envelope, 'asset_123', bakeryWorkspaceId)
      }).not.toThrow()
    })

    it('throws CrossTenantAccessError (403) when resource belongs to another workspace', () => {
      const envelope = createValidBakeryEnvelope()
      expect(() => {
        assertNoCrossTenantResourceAccess(envelope, 'asset_alien_999', beautyWorkspaceId)
      }).toThrow(CrossTenantAccessError)
    })

    it('ensures CrossTenantAccessError provides fail-closed error code and status 403', () => {
      const envelope = createValidBakeryEnvelope()
      try {
        assertNoCrossTenantResourceAccess(envelope, 'content_alien_888', beautyWorkspaceId)
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(CrossTenantAccessError)
        const error = err as CrossTenantAccessError
        expect(error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
        expect(error.statusCode).toBe(403)
      }
    })
  })

  describe('3. Cache & Query Key Tenant Isolation', () => {
    it('generates version-anchored cache keys that strictly include workspace and version numbers', () => {
      const envelope = createValidBakeryEnvelope()
      const cacheKey = createWorkspaceCacheKey(envelope, 'visual-brief', 'brief_001')

      expect(cacheKey).toBe(
        `workspace:${bakeryWorkspaceId}:bp:3:bv:2:visual-brief:brief_001`
      )
    })

    it('produces completely distinct cache keys when workspace or profile version changes', () => {
      const env1 = createValidBakeryEnvelope({ businessProfileVersion: 3 })
      const env2 = createValidBakeryEnvelope({ businessProfileVersion: 4 })
      const envBeauty = createValidBakeryEnvelope({ workspaceId: beautyWorkspaceId })

      const key1 = createWorkspaceCacheKey(env1, 'profile')
      const key2 = createWorkspaceCacheKey(env2, 'profile')
      const keyBeauty = createWorkspaceCacheKey(envBeauty, 'profile')

      expect(key1).not.toBe(key2)
      expect(key1).not.toBe(keyBeauty)
    })
  })

  describe('4. Workspace Switch Race Guard', () => {
    let switchGuard: WorkspaceSwitchGuard

    beforeEach(() => {
      switchGuard = new WorkspaceSwitchGuard(bakeryWorkspaceId)
    })

    it('allows in-flight promise resolution if active workspace remains unchanged', async () => {
      const result = await switchGuard.runWithGuard(bakeryWorkspaceId, async () => {
        return { data: 'bakery tart data' }
      })

      expect(result).toEqual({ data: 'bakery tart data' })
    })

    it('strictly discards / isolates in-flight result if user switched workspace during execution', async () => {
      let executed = false

      const inFlightPromise = switchGuard.runWithGuard(bakeryWorkspaceId, async () => {
        // Simulate async delay
        await new Promise((r) => setTimeout(r, 50))
        executed = true
        return { data: 'leaked bakery tart data' }
      })

      // User immediately switches to beauty workspace while bakery request is in flight
      switchGuard.switchWorkspace(beautyWorkspaceId)

      await expect(inFlightPromise).rejects.toThrow(/Workspace switch race detected/)
      expect(executed).toBe(true)
      expect(switchGuard.getActiveWorkspace()).toBe(beautyWorkspaceId)
    })
  })

  describe('5. Visual Brief Builder Envelope Integration & User-Supplied Override Rejection', () => {
    it('enforces envelope business facts over client-supplied facts and records context provenance', () => {
      const envelope = createValidBakeryEnvelope()

      const input: VisualBriefBuilderInput = {
        workspaceId: bakeryWorkspaceId,
        contentVersionId: '33333333-3333-4333-8333-333333333333',
        // Attacker client attempts to inject beauty business context into bakery workspace
        businessContext: {
          name: '가짜 바이름 뷰티샵',
          industry: 'beauty',
          keywords: ['뷰티'],
          targetAudience: '고객',
        },
        productContext: {
          name: '단호박 타르트',
          description: '달콤한 국산 단호박 무스와 바삭한 타르트지',
          ingredientsOrMaterials: ['단호박', '유기농 버터', '시나몬'],
          sellingPoints: ['국산 단호박', '바삭한 타르트'],
        },
        channel: 'instagram',
        caption: '오늘 구워낸 단호박 타르트가 완성되었습니다.',
        envelope,
      }

      const brief = buildVisualBrief(input)

      // Must strictly use envelope facts ('소희네 베이커리', 'bakery') instead of client input ('가짜 바이름 뷰티샵')
      expect(brief.businessContext.name).toBe('소희네 베이커리')
      expect(brief.businessContext.industry).toBe('bakery')
      expect(brief.promptText).toContain('소희네 베이커리')
      expect(brief.promptText).not.toContain('바이름')

      // Context provenance must be sealed in brief
      expect(brief.contextProvenance).toBeDefined()
      expect(brief.contextProvenance?.fingerprint).toBe(envelope.contextFingerprint)
      expect(brief.contextProvenance?.businessProfileVersion).toBe(3)
      expect(brief.contextProvenance?.brandVersion).toBe(2)
    })

    it('rejects brief generation if envelope workspaceId does not match input workspaceId', () => {
      const envelope = createValidBakeryEnvelope()

      const input: VisualBriefBuilderInput = {
        workspaceId: beautyWorkspaceId, // Mismatch!
        contentVersionId: '33333333-3333-4333-8333-333333333333',
        businessContext: { name: '뷰티샵', industry: 'beauty', keywords: ['뷰티'], targetAudience: '고객' },
        productContext: { name: '시술', sellingPoints: ['상담'] },
        channel: 'instagram',
        caption: '시술 예약',
        envelope,
      }

      expect(() => buildVisualBrief(input)).toThrow(/Envelope workspace ID mismatch/i)
    })
  })
})
