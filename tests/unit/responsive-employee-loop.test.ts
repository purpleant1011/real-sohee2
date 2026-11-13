import { describe, expect, it, vi } from 'vitest'
import {
  evaluateRiskPolicy,
  executeResponseJobDelivery,
  type RiskEvaluationInput,
} from '@/features/channels/responsive-employee-loop'

describe('Responsive Employee Loop & Risk Guardrails (ANI-1012, ANI-999)', () => {
  it('escalates refund and dispute complaints to human (HIGH_RISK) and blocks autonomous action', () => {
    const input: RiskEvaluationInput = {
      channel: 'instagram',
      category: 'comment',
      text: '결제한 지 일주일이 지났는데 환불해주세요. 사기 아닌가요?',
    }

    const decision = evaluateRiskPolicy(input)

    expect(decision.riskTier).toBe('HIGH')
    expect(decision.isAutonomousAllowed).toBe(false)
    expect(decision.policyAction).toBe('ESCALATE_TO_HUMAN')
    expect(decision.reason).toContain('환불/분쟁/불만 키워드가 감지되었습니다')
  })

  it('escalates harassment and abusive language to human (HIGH_RISK)', () => {
    const input: RiskEvaluationInput = {
      channel: 'instagram',
      category: 'dm',
      text: '야 이 사기꾼들아 서비스 개판이네 고소할거다',
    }

    const decision = evaluateRiskPolicy(input)

    expect(decision.riskTier).toBe('HIGH')
    expect(decision.isAutonomousAllowed).toBe(false)
    expect(decision.policyAction).toBe('ESCALATE_TO_HUMAN')
  })

  it('classifies complex inquiries as MEDIUM_RISK requiring approval', () => {
    const input: RiskEvaluationInput = {
      channel: 'threads',
      category: 'reply',
      text: '저희 회사 50명 단체 워크샵 패키지 맞춤 견적과 일정 예약 가능한가요?',
    }

    const decision = evaluateRiskPolicy(input)

    expect(decision.riskTier).toBe('MEDIUM')
    expect(decision.isAutonomousAllowed).toBe(false)
    expect(decision.policyAction).toBe('REQUIRE_APPROVAL')
  })

  it('permits autonomous reply for low-risk compliments and greetings (LOW_RISK)', () => {
    const input: RiskEvaluationInput = {
      channel: 'instagram',
      category: 'comment',
      text: '소희 오늘 피드 너무 예뻐요! 항상 응원합니다 ㅎㅎ',
    }

    const decision = evaluateRiskPolicy(input)

    expect(decision.riskTier).toBe('LOW')
    expect(decision.isAutonomousAllowed).toBe(true)
    expect(decision.policyAction).toBe('AUTONOMOUS_ALLOWED')
  })

  it('blocks external delivery when response job has no active consent (Fail-Closed)', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'channel_response_jobs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'job-1',
                    workspace_id: 'ws-1',
                    channel_connection_id: 'conn-1',
                    response_kind: 'instagram_comment_reply',
                    external_target_id: 'comment-123',
                    draft_text: '감사합니다!',
                    status: 'draft',
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
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'conn-1', channel: 'instagram', workspace_id: 'ws-1' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'customer_opt_outs') {
          // 수신거부 조회는 "확인됨 + 미등록"이어야 동의 검사 단계로 진행한다.
          // (조회 실패는 fail-closed 로 차단되므로 이 테스트의 의도와 다르다.)
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
        if (table === 'channel_consents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { status: 'REVOKED' }, // Revoked consent
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      }),
    }

    const mockProvider = {
      sendCommentReply: vi.fn(),
    }

    const result = await executeResponseJobDelivery({
      jobId: 'job-1',
      actorUserId: 'user-1',
      client: mockClient as any,
      metaProvider: mockProvider as any,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CONSENT_BLOCKED')
    expect(mockProvider.sendCommentReply).not.toHaveBeenCalled()
  })
})
