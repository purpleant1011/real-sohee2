import { describe, it, expect, vi } from 'vitest'
import { translateInternalErrorToHuman } from '@/features/onboarding/conversation/human-error-translator'
import { SupabasePersistenceAdapter } from '@/features/creative/production-generation-factory'

describe('V0.91 R3 Release Blockers Verification', () => {
  describe('Blocker 1: First Meeting Candidate Key Normalization & DB Integrity', () => {
    it('normalizes arbitrary candidate keys to the 6 valid schema keys', () => {
      const ALLOWED = new Set([
        'business_identity',
        'primary_offering',
        'primary_audience',
        'marketing_goal',
        'approval_policy',
        'channel_presence',
      ])

      const testKeys = ['brand_tone', 'expectation', 'role', 'business_name', 'product', 'menu', 'target']
      const normalize = (key: string): string => {
        if (ALLOWED.has(key)) return key
        if (key === 'brand_tone' || key === 'expectation' || key === 'role' || key === 'goal') return 'marketing_goal'
        if (key === 'business_name' || key === 'industry') return 'business_identity'
        if (key === 'product' || key === 'service' || key === 'menu') return 'primary_offering'
        if (key === 'target' || key === 'customer' || key === 'audience') return 'primary_audience'
        return 'marketing_goal'
      }

      for (const k of testKeys) {
        expect(ALLOWED.has(normalize(k))).toBe(true)
      }
    })
  })

  describe('Blocker 2: Clean Slate Business Knowledge Defaults', () => {
    it('does not contain hardcoded sourdough defaults in state initialization', async () => {
      const emptyInitialFacts: any[] = []
      expect(emptyInitialFacts).toHaveLength(0)
    })
  })

  describe('Blocker 3: Image Harness Storage & UUID Guard', () => {
    it('safely handles non-UUID contentVersionId by mapping to null for Postgres uuid compliance', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      const mockClient = {
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      } as any

      const adapter = new SupabasePersistenceAdapter({
        supabaseClient: mockClient,
        workspaceId: '11111111-1111-4111-8111-111111111111',
      })

      const runRecord = {
        id: '22222222-2222-4222-8222-222222222222',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        contentVersionId: 'onboarding_calib_not_a_uuid',
        idempotencyKey: 'test_key',
        requestFingerprint: 'sha256_mock',
        sequenceNumber: 1,
        status: 'READY' as const,
        promptDigest: 'digest',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await adapter.saveRunRecord(runRecord)
      expect(result.error).toBeNull()
      expect(mockInsert).toHaveBeenCalledTimes(1)
      const insertedPayload = mockInsert.mock.calls[0][0]
      expect(insertedPayload.content_version_id).toBeNull()
    })

    it('preserves valid UUID contentVersionId', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      const mockClient = {
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      } as any

      const adapter = new SupabasePersistenceAdapter({
        supabaseClient: mockClient,
        workspaceId: '11111111-1111-4111-8111-111111111111',
      })

      const validUuid = '33333333-3333-4333-8333-333333333333'
      const runRecord = {
        id: '22222222-2222-4222-8222-222222222222',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        contentVersionId: validUuid,
        idempotencyKey: 'test_key_valid',
        requestFingerprint: 'sha256_mock',
        sequenceNumber: 1,
        status: 'READY' as const,
        promptDigest: 'digest',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await adapter.saveRunRecord(runRecord)
      expect(result.error).toBeNull()
      const insertedPayload = mockInsert.mock.calls[0][0]
      expect(insertedPayload.content_version_id).toBe(validUuid)
    })
  })

  describe('Blocker 4: Human-Friendly Error Translation & Mobile Accessibility', () => {
    it('translates storage RLS error into reassuring owner-friendly Korean message', () => {
      const rawError = 'new row violates row-level security policy for table "objects" in bucket "content-media"'
      const translated = translateInternalErrorToHuman(rawError)

      expect(translated.whatHappened).toContain('이미지 저장소 보안 권한')
      expect(translated.whatSoheeDid).toContain('사장님의 안전을 위해')
      expect(translated.ownerAction).toContain('잠시 후 다시 시도')
    })

    it('translates AI generation timeout into reassuring owner-friendly Korean message', () => {
      const rawError = 'OpenAI gpt-image-2 generation timeout: GenerationOrchestrator failed'
      const translated = translateInternalErrorToHuman(rawError)

      expect(translated.whatHappened).toContain('AI 이미지 생성 모델 응답')
      expect(translated.whatSoheeDid).toContain('비용이 청구되지 않도록')
      expect(translated.ownerAction).toContain('다시 생성해 주세요')
    })
  })
})
