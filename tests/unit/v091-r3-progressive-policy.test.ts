import { describe, it, expect } from 'vitest'
import {
  extractPolicyRestrictions,
  DEFAULT_PROGRESSIVE_RESTRICTIONS,
  extractConversationalOperatingPolicyDraft,
  confirmConversationalPolicyWithExplicitGate,
  evaluatePublishSafetyUnderKillSwitch,
} from '@/features/operating-policy/conversational-operating-policy'
import { DEFAULT_OPERATING_POLICY_RULES } from '@/features/operating-policy/operating-policy-manager'

describe('ANI-1449: Progressive Operating Policy with Safe Defaults and Conversational Restrictions', () => {
  describe('1. Conversational Restrictions Extraction', () => {
    it('extracts structured restrictions from natural language', () => {
      const utterance = '가격은 절대 공개하지 말고 DM 문의로만 유도해줘. 과장된 표현이나 최고라는 말은 쓰지 마.'
      const result = extractPolicyRestrictions(utterance)

      expect(result.priceInquiryDmOnly).toBe(true)
      expect(result.noExaggeration).toBe(true)
      expect(result.appliedSummary).toContain('가격 비공개 (DM 문의 유도)')
      expect(result.appliedSummary).toContain('과장 광고 및 허위 표현 금지')
    })

    it('extracts staff face protection and prohibited words', () => {
      const utterance = '직원 얼굴은 절대 사진에 나오지 않게 해주고, 최저가, 1등 이런 단어는 절대 쓰지 마.'
      const result = extractPolicyRestrictions(utterance)

      expect(result.noStaffFace).toBe(true)
      expect(result.prohibitedWords).toContain('최저가')
      expect(result.prohibitedWords).toContain('1등')
      expect(result.appliedSummary).toContain('직원/인물 얼굴 노출 보호')
    })

    it('merges with existing restrictions without erasing previous rules', () => {
      const initial = {
        ...DEFAULT_PROGRESSIVE_RESTRICTIONS,
        priceInquiryDmOnly: true,
        appliedSummary: ['가격 비공개 (DM 문의 유도)'],
      }

      const updated = extractPolicyRestrictions('과장 광고는 절대 피하고 사실만 적어줘', initial)
      expect(updated.priceInquiryDmOnly).toBe(true)
      expect(updated.noExaggeration).toBe(true)
      expect(updated.appliedSummary).toContain('가격 비공개 (DM 문의 유도)')
      expect(updated.appliedSummary).toContain('과장 광고 및 허위 표현 금지')
    })
  })

  describe('2. Progressive Safe Default Invariant', () => {
    it('enforces safe default where requireApprovalBeforePublish is strictly true', () => {
      const rules = extractConversationalOperatingPolicyDraft('')
      expect(rules.requireApprovalBeforePublish).toBe(true)
      expect(rules.publishApprovalLevel).toBe('always_require')
      expect(rules.handoffOnComplaint).toBe(true)
      expect(rules.handoffOnPriceInquiry).toBe(true)
    })

    it('blocks arbitrary external publish under safe default before explicit approval', () => {
      const safety = evaluatePublishSafetyUnderKillSwitch(DEFAULT_OPERATING_POLICY_RULES)
      expect(safety.allowed).toBe(true) // Emergency stop is not active, but publish requires explicit approval
      expect(DEFAULT_OPERATING_POLICY_RULES.requireApprovalBeforePublish).toBe(true)
    })
  })

  describe('3. Explicit Confirm Boundary & Lineage Retention', () => {
    it('creates immutable policy snapshot only on explicit user approval phrase', () => {
      const snapshot = confirmConversationalPolicyWithExplicitGate({
        workspaceId: 'ws-policy-test',
        callerTenantId: 'ws-policy-test',
        userId: 'user-owner-test',
        rules: {
          ...DEFAULT_OPERATING_POLICY_RULES,
          maxDailyPublishCount: 1,
        },
        explicitApprovalPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(snapshot.status).toBe('active')
      expect(snapshot.isImmutable).toBe(true)
      expect(snapshot.immutableHash).toBeDefined()
      expect(snapshot.rules.maxDailyPublishCount).toBe(1)
      expect(snapshot.rules.requireApprovalBeforePublish).toBe(true)
    })

    it('rejects confirmation without explicit approval phrase', () => {
      expect(() => {
        confirmConversationalPolicyWithExplicitGate({
          workspaceId: 'ws-policy-test',
          callerTenantId: 'ws-policy-test',
          userId: 'user-owner-test',
          rules: DEFAULT_OPERATING_POLICY_RULES,
          explicitApprovalPhrase: '대충 저장해줘',
          isExplicitlyApproved: false,
        })
      }).toThrow('EXPLICIT_CONFIRMATION_REQUIRED')
    })
  })
})
