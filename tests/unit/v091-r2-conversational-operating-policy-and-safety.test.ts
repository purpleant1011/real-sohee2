import { describe, it, expect } from 'vitest'
import {
  extractConversationalOperatingPolicyDraft,
  engageEmergencyKillSwitch,
  disengageEmergencyKillSwitch,
  evaluatePublishSafetyUnderKillSwitch,
  sanitizeAndTranslateError,
  confirmConversationalPolicyWithExplicitGate,
} from '@/features/operating-policy/conversational-operating-policy'
import { DEFAULT_OPERATING_POLICY_RULES } from '@/features/operating-policy/operating-policy-manager'

describe('ANI-1432: Conversational Operating Policy · Error Translation · Kill Switch', () => {
  describe('1. Scenario-Based Conversational Policy Extraction', () => {
    it('extracts safe operating policy rules from natural conversational answers', () => {
      const utterance = `
        발행 전에 내가 무조건 확인하고 승인할게. 하루에 글은 2개까지만 올려주고,
        손님이 컴플레인하거나 가격 물어보면 내가 직접 답할 테니까 즉시 나한테 넘겨줘.
        하루 광고비는 최대 1만원 넘지 않게 해줘.
      `

      const rules = extractConversationalOperatingPolicyDraft(utterance)

      expect(rules.publishApprovalLevel).toBe('always_require')
      expect(rules.requireApprovalBeforePublish).toBe(true)
      expect(rules.maxDailyPublishCount).toBe(2)
      expect(rules.handoffOnComplaint).toBe(true)
      expect(rules.handoffOnPriceInquiry).toBe(true)
      expect(rules.dailySpendLimitKrw).toBe(10000)
    })

    it('extracts conditional auto-publish when owner explicitly requests fast automation', () => {
      const utterance = '신뢰도 높은 글은 사장님 승인 없이 조건부로 바로 자동 발행해줘. 하루에 1건만 부탁해.'
      const rules = extractConversationalOperatingPolicyDraft(utterance)

      expect(rules.publishApprovalLevel).toBe('conditional_auto')
      expect(rules.requireApprovalBeforePublish).toBe(false)
      expect(rules.maxDailyPublishCount).toBe(1)
    })
  })

  describe('2. Emergency Kill Switch Engine', () => {
    it('engages emergency kill switch and immediately blocks publishing in fail-closed mode', () => {
      const killSwitch = engageEmergencyKillSwitch({
        workspaceId: 'ws-test-1',
        userId: 'user-owner-1',
        reason: '가격 오류 발견으로 인한 긴급 전체 정지',
      })

      expect(killSwitch.isEngaged).toBe(true)
      expect(killSwitch.engagedByUserId).toBe('user-owner-1')
      expect(killSwitch.reason).toContain('가격 오류')

      const safety = evaluatePublishSafetyUnderKillSwitch(DEFAULT_OPERATING_POLICY_RULES, killSwitch)
      expect(safety.allowed).toBe(false)
      expect(safety.blockedReason).toContain('킬스위치(Kill Switch)가 작동 중')
    })

    it('disengages emergency kill switch only when explicit human confirmation is provided', () => {
      const engaged = engageEmergencyKillSwitch({
        workspaceId: 'ws-test-1',
        userId: 'user-owner-1',
        reason: '테스트 정지',
      })
      expect(engaged.isEngaged).toBe(true)

      const disengaged = disengageEmergencyKillSwitch({
        workspaceId: 'ws-test-1',
        userId: 'user-owner-1',
      })

      expect(disengaged.isEngaged).toBe(false)
      expect(disengaged.disengagedAt).toBeDefined()

      const safety = evaluatePublishSafetyUnderKillSwitch(DEFAULT_OPERATING_POLICY_RULES, disengaged)
      expect(safety.allowed).toBe(true)
    })
  })

  describe('3. Safe 3-Part Error Translation & Zero Secret/Leakage Invariant', () => {
    it('sanitizes CROSS_TENANT_ACCESS_DENIED without leaking foreign tenant IDs', () => {
      const foreignError = new Error(
        'CROSS_TENANT_ACCESS_DENIED: User attempted to access tenant 99999-bad-actor from workspace 11111-owner'
      )

      const translated = sanitizeAndTranslateError(foreignError)

      expect(translated.whatHappened).toBe('매장 계정의 접근 권한을 확인하지 못했습니다.')
      expect(translated.whatSoheeDid).toContain('다른 매장의 정보가 섞이지 않도록 차단')
      expect(translated.ownerAction).toContain('현재 로그인한 계정으로 다시 접속')

      // Must never leak technical IDs
      expect(translated.whatHappened).not.toContain('99999-bad-actor')
      expect(translated.whatSoheeDid).not.toContain('99999-bad-actor')
      expect(translated.ownerAction).not.toContain('99999-bad-actor')
    })

    it('sanitizes SQL/Postgres technical errors into owner-friendly Korean', () => {
      const sqlError = new Error(
        'PostgresError: relation "harness_rules" does not exist at character 45, SQLSTATE 42P01'
      )

      const translated = sanitizeAndTranslateError(sqlError)

      expect(translated.whatHappened).toBe('일시적인 저장 충돌이 발생했습니다.')
      expect(translated.whatSoheeDid).toContain('데이터 무결성을 보호')
      expect(translated.ownerAction).toContain('잠시 후 다시 저장')

      expect(translated.whatHappened).not.toContain('PostgresError')
      expect(translated.whatHappened).not.toContain('42P01')
    })

    it('sanitizes raw OAuth token/scope leaks', () => {
      const tokenError = new Error(
        'Meta OAuth Error: invalid_grant - token EAABw... failed with scope instagram_content_publish'
      )

      const translated = sanitizeAndTranslateError(tokenError)

      expect(translated.whatHappened).toContain('SNS 로그인 인증 세션이 만료')
      expect(translated.whatHappened).not.toContain('EAABw')
      expect(translated.whatHappened).not.toContain('instagram_content_publish')
    })
  })

  describe('4. Explicit Confirm Boundary & Tenant Isolation Guards', () => {
    it('strictly blocks policy confirmation without explicit "이 기준으로 사용" phrase', () => {
      expect(() =>
        confirmConversationalPolicyWithExplicitGate({
          workspaceId: 'ws-test-1',
          userId: 'user-1',
          rules: DEFAULT_OPERATING_POLICY_RULES,
          explicitApprovalPhrase: '좋아보이네요',
          isExplicitlyApproved: false,
        })
      ).toThrowError(/EXPLICIT_CONFIRMATION_REQUIRED.*이 기준으로 사용/)
    })

    it('strictly blocks policy confirmation if user ID is missing (no bot-only confirm)', () => {
      expect(() =>
        confirmConversationalPolicyWithExplicitGate({
          workspaceId: 'ws-test-1',
          userId: '',
          rules: DEFAULT_OPERATING_POLICY_RULES,
          explicitApprovalPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/AUTHZ_CONFIRM_USER_REQUIRED/)
    })

    it('strictly rejects cross-tenant policy confirmation attempt (negative test)', () => {
      expect(() =>
        confirmConversationalPolicyWithExplicitGate({
          workspaceId: 'ws-tenant-A',
          callerTenantId: 'ws-tenant-B', // Malicious cross-tenant attempt
          userId: 'user-attacker',
          rules: DEFAULT_OPERATING_POLICY_RULES,
          explicitApprovalPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/CROSS_TENANT_POLICY_DENIED/)
    })

    it('successfully confirms policy into deep-frozen immutable snapshot when valid', () => {
      const snapshot = confirmConversationalPolicyWithExplicitGate({
        workspaceId: 'ws-tenant-A',
        callerTenantId: 'ws-tenant-A',
        userId: 'user-owner-1',
        rules: {
          ...DEFAULT_OPERATING_POLICY_RULES,
          maxDailyPublishCount: 1,
        },
        explicitApprovalPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(snapshot.status).toBe('active')
      expect(snapshot.isImmutable).toBe(true)
      expect(snapshot.confirmedByUserId).toBe('user-owner-1')
      expect(snapshot.rules.maxDailyPublishCount).toBe(1)
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.rules)).toBe(true)
      expect(snapshot.immutableHash).toMatch(/^[a-f0-9]{32,64}$/)
    })
  })
})
