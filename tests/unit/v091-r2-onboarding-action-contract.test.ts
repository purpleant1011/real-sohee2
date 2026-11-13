import { describe, it, expect } from 'vitest'
import {
  parseOnboardingUtterance,
  isForbiddenEducationAction,
} from '@/features/onboarding/conversation/action-parser'
import {
  admitOnboardingAction,
  OnboardingActionAdmissionError,
} from '@/features/onboarding/conversation/action-admission-guard'
import {
  translateInternalErrorToHuman,
} from '@/features/onboarding/conversation/human-error-translator'
import type {
  ActionAdmissionContext,
  ParsedOnboardingAction,
} from '@/features/onboarding/conversation/types'
import type { SoheeReadinessSnapshot, SoheeReadinessFactKey } from '@/features/sohee-ready/types'

function createMockReadiness(completedKeys: SoheeReadinessFactKey[] = []): SoheeReadinessSnapshot {
  const allKeys: SoheeReadinessFactKey[] = [
    'BUSINESS_VERIFIED',
    'INSTAGRAM_VERIFIED',
    'THREADS_VERIFIED',
    'BUSINESS_KNOWLEDGE_CONFIRMED',
    'TEXT_HARNESS_CONFIRMED',
    'IMAGE_HARNESS_CONFIRMED',
    'OPERATING_POLICY_CONFIRMED',
  ]

  const facts: any = {}
  allKeys.forEach((k) => {
    const isDone = completedKeys.includes(k)
    facts[k] = {
      key: k,
      verified: isDone,
      status: isDone ? 'VERIFIED' : 'MISSING',
      source: 'test',
      evidenceId: isDone ? 'ev-1' : null,
      version: isDone ? '1' : null,
      verifiedAt: isDone ? new Date().toISOString() : null,
      freshness: isDone ? 'FRESH' : 'UNKNOWN',
    }
  })

  return {
    workspaceId: 'ws-tenant-1',
    ready: completedKeys.length === 7,
    evaluatedAt: new Date().toISOString(),
    facts,
    blockers: [],
  }
}

describe('ANI-1427: Onboarding Conversation Action Contract & Human Translation', () => {
  describe('1. Action Parser: 9 Allowed Actions & Structured Extraction', () => {
    it('parses business location & reservation into save_business_fact_draft with lineage', () => {
      const utterance = '청라에 있고 100% 예약제 헤어샵이야'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('save_business_fact_draft')
      expect(parsed.isForbidden).toBe(false)
      expect(parsed.extractedCandidate).toMatchObject({
        location: '청라',
        reservationPolicy: '예약제',
        category: '헤어샵',
      })
      expect(parsed.humanTranslation.humanSummaryPreview).toContain('제가 이렇게 이해했어요')
      expect(parsed.humanTranslation.humanSummaryPreview).toContain('청라')
      expect(parsed.humanTranslation.editPath).toBe('/start')
      expect(parsed.lineage.sourceUtterance).toBe(utterance)
      expect(parsed.lineage.confidence).toBeGreaterThan(0.8)
      expect(parsed.lineage.validationResult).toBe('VALID')
    })

    it('parses operating hours and pricing into save_business_fact_draft', () => {
      const utterance = '영업시간은 오전 10시부터 밤 8시까지이고 기본 컷은 25000원이야'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('save_business_fact_draft')
      expect(parsed.extractedCandidate.operatingHours).toBe('10:00 - 20:00')
      expect(parsed.extractedCandidate.priceInfo).toBe('25000원')
    })

    it('parses channel intent into save_channel_intent', () => {
      const utterance = '인스타그램 아이디는 @sohee.hair 이고 스레드도 같이 쓰고 싶어'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('save_channel_intent')
      expect(parsed.extractedCandidate).toMatchObject({
        instagramHandle: 'sohee.hair',
        wantsThreads: true,
      })
      expect(parsed.humanTranslation.editPath).toBe('/start?step=channels')
    })

    it('parses start_provider_oauth intent', () => {
      const utterance = '인스타그램 공식 로그인 연결할게'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('start_provider_oauth')
      expect(parsed.humanTranslation.editPath).toBe('/start?step=channels')
    })

    it('parses tone and voice into save_text_harness_draft', () => {
      const utterance = '친절하고 다정한 말투로 쓰고 가격과 위치는 본문에 꼭 포함해줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('save_text_harness_draft')
      expect(parsed.extractedCandidate).toMatchObject({
        tone: '친절하고 다정한',
        requirePrice: true,
        requireLocation: true,
      })
      expect(parsed.humanTranslation.editPath).toBe('/app/sohee?tab=training')
    })

    it('parses request for test text generation into generate_text_harness_test', () => {
      const utterance = '인스타 피드용 예시 문구 하나 써봐줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('generate_text_harness_test')
      expect(parsed.humanTranslation.editPath).toBe('/app/sohee?tab=training')
    })

    it('parses visual aesthetics into save_image_rule_draft', () => {
      const utterance = '자연광 느낌의 따뜻한 감성 사진으로 찍어주고 사람 얼굴은 가려줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('save_image_rule_draft')
      expect(parsed.extractedCandidate).toMatchObject({
        lighting: '자연광',
        mood: '따뜻한 감성',
        facePrivacy: true,
      })
      expect(parsed.humanTranslation.editPath).toBe('/app/sohee?tab=training')
    })

    it('parses image test generation into generate_image_harness_test', () => {
      const utterance = '사진 스타일 테스트 이미지 한 장 만들어줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('generate_image_harness_test')
      expect(parsed.humanTranslation.editPath).toBe('/app/sohee?tab=training')
    })

    it('parses operating safety rule into save_operating_policy_draft', () => {
      const utterance = '게시하기 전에 반드시 내 승인을 받아야 하고 하루에 1개만 올려'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('save_operating_policy_draft')
      expect(parsed.extractedCandidate).toMatchObject({
        requireOwnerApproval: true,
        maxDailyPosts: 1,
      })
      expect(parsed.humanTranslation.editPath).toBe('/app/sohee?tab=command')
    })

    it('parses direct navigation intent into navigate_to_required_step', () => {
      const utterance = '채널 연동하는 페이지로 데려가줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('navigate_to_required_step')
      expect(parsed.extractedCandidate.targetHref).toBe('/start?step=channels')
    })

    it('redacts password or sensitive tokens in lineage to protect secrets', () => {
      const utterance = '비밀번호는 mySecret123! 이고 청라에 있어'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.lineage.sourceUtterance).not.toContain('mySecret123!')
      expect(parsed.lineage.sourceUtterance).toContain('[REDACTED_SECRET]')
      expect(parsed.lineage.validationResult).toBe('WARNING')
    })
  })

  describe('2. Confirm Boundary: Strict Rejection of Irreversible Actions in Education Mode', () => {
    it('detects publish_post as forbidden in Education Mode', () => {
      const utterance = '오늘 인스타 올려줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.actionType).toBe('publish_post')
      expect(parsed.isForbidden).toBe(true)
      expect(parsed.forbiddenReason).toContain('발행')
      expect(isForbiddenEducationAction(parsed.actionType)).toBe(true)
    })

    it('detects confirm_readiness_fact as forbidden in conversation autofill', () => {
      const utterance = '그냥 바로 확정해줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.isForbidden).toBe(true)
      expect(isForbiddenEducationAction(parsed.actionType)).toBe(true)
    })

    it('detects execute_paid_cost as forbidden in conversation', () => {
      const utterance = '유료 광고 5만원 결제 집행해줘'
      const parsed = parseOnboardingUtterance(utterance)

      expect(parsed.isForbidden).toBe(true)
      expect(isForbiddenEducationAction(parsed.actionType)).toBe(true)
    })
  })

  describe('3. Action Admission Guard & Tenant Protection', () => {
    const validContext: ActionAdmissionContext = {
      workspaceId: 'ws-tenant-1',
      callerTenantId: 'ws-tenant-1',
      mode: 'EDUCATION',
      readinessSnapshot: createMockReadiness(['BUSINESS_VERIFIED']),
    }

    it('admits valid allowed action when tenant matches and mode is EDUCATION', () => {
      const action: ParsedOnboardingAction = {
        actionType: 'save_business_fact_draft',
        isForbidden: false,
        extractedCandidate: { location: '청라' },
        humanTranslation: {
          humanSummaryPreview: '제가 이렇게 이해했어요: 청라',
          editPath: '/start',
          reassurance: '안전하게 초안으로 저장됩니다.',
        },
        lineage: {
          sourceUtterance: '청라에 있어',
          extractedCandidate: { location: '청라' },
          confidence: 0.9,
          validationResult: 'VALID',
        },
      }

      const admission = admitOnboardingAction(action, validContext)
      expect(admission.admitted).toBe(true)
      expect(admission.actionType).toBe('save_business_fact_draft')
    })

    it('strictly rejects cross-tenant mismatch without leaking tenant ID', () => {
      const crossTenantContext: ActionAdmissionContext = {
        workspaceId: 'ws-tenant-1',
        callerTenantId: 'ws-tenant-ATTACKER',
        mode: 'EDUCATION',
      }

      const action: ParsedOnboardingAction = {
        actionType: 'save_business_fact_draft',
        isForbidden: false,
        extractedCandidate: { location: '청라' },
        humanTranslation: {
          humanSummaryPreview: '청라',
          editPath: '/start',
          reassurance: '안전',
        },
        lineage: {
          sourceUtterance: '청라에 있어',
          extractedCandidate: { location: '청라' },
          confidence: 0.9,
          validationResult: 'VALID',
        },
      }

      expect(() => admitOnboardingAction(action, crossTenantContext)).toThrow(
        OnboardingActionAdmissionError
      )

      try {
        admitOnboardingAction(action, crossTenantContext)
      } catch (err: any) {
        expect(err.code).toBe('CROSS_TENANT_ACCESS_DENIED')
        expect(err.message).not.toContain('ws-tenant-ATTACKER')
        expect(err.message).toContain('접근 권한이 확인되지 않았습니다')
      }
    })

    it('strictly rejects forbidden publish action and routes to Next Best Action', () => {
      const publishAction: ParsedOnboardingAction = {
        actionType: 'publish_post' as any,
        isForbidden: true,
        forbiddenReason: '사전 승인 없는 외부 발행은 금지되어 있습니다.',
        extractedCandidate: {},
        humanTranslation: {
          humanSummaryPreview: '인스타그램 발행 요청',
          editPath: '/start',
          reassurance: '소희는 준비 완료 전에 임의로 발행하지 않습니다.',
        },
        lineage: {
          sourceUtterance: '오늘 인스타 올려줘',
          extractedCandidate: {},
          confidence: 1.0,
          validationResult: 'INVALID',
        },
      }

      expect(() => admitOnboardingAction(publishAction, validContext)).toThrow(
        OnboardingActionAdmissionError
      )

      try {
        admitOnboardingAction(publishAction, validContext)
      } catch (err: any) {
        expect(err.code).toBe('CONFIRM_BOUNDARY_BLOCKED')
        expect(err.remediationHref).toBe('/start?step=channels')
        expect(err.message).toContain('사전 승인 없이 마음대로 게시물을 발행하지 않아요')
      }
    })
  })

  describe('4. Human Error Translator: 3-Part Structure & Safety', () => {
    it('translates CROSS_TENANT_ACCESS_DENIED to polite 3-part Korean explanation', () => {
      const translated = translateInternalErrorToHuman('CROSS_TENANT_ACCESS_DENIED')
      expect(translated.whatHappened).toBe('매장 계정의 접근 권한을 확인하지 못했습니다.')
      expect(translated.whatSoheeDid).toBe('안전을 위해 다른 매장의 정보가 섞이지 않도록 차단했습니다.')
      expect(translated.ownerAction).toBe('현재 로그인한 계정으로 다시 접속해 주세요.')
    })

    it('translates raw SQL and database error to friendly retry guide', () => {
      const translated = translateInternalErrorToHuman('PostgresError: duplicate key value violates unique constraint')
      expect(translated.whatHappened).not.toContain('PostgresError')
      expect(translated.whatHappened).not.toContain('unique constraint')
      expect(translated.whatHappened).toBe('일시적인 저장 충돌이 발생했습니다.')
      expect(translated.ownerAction).toBe('잠시 후 다시 저장해 주세요.')
    })

    it('translates OAuth cancellation and token errors politely', () => {
      const translated = translateInternalErrorToHuman('OAUTH_ACCESS_DENIED_BY_USER')
      expect(translated.whatHappened).toBe('SNS 채널 연동 승인이 취소되었습니다.')
      expect(translated.ownerAction).toBe('채널 연동 화면에서 다시 공식 로그인을 진행해 주세요.')
    })
  })
})
