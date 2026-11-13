import { describe, expect, it } from 'vitest'
import { projectPublicChatResult } from './public-chat-result'

describe('공개 대화 결과 최소 투영', () => {
  it('도구 인자·실행 로그·내부 필드를 저장하거나 노출하지 않는다', () => {
    const output = projectPublicChatResult({ content: '검토해 주세요.', raw_args: 'SECRET', liveExecutionCard: { logs: ['SECRET'] }, planCard: { title: '홍보 준비', steps: [{ name: '문안 준비', arguments: 'SECRET' }] }, approvalCard: { decisionId: 'not-an-approval', title: '검토' }, evidenceResultCard: { verifiedUrls: [{ channel: 'SNS', url: 'javascript:alert(1)', httpStatus: 200 }] } })
    expect(output?.plan?.steps).toEqual(['문안 준비'])
    expect(output?.reviewHref).toBe('/app/approvals')
    expect(output?.links).toEqual([])
    expect(JSON.stringify(output)).not.toMatch(/SECRET|javascript|not-an-approval/)
  })
  it('업무 상세를 통해 기존 최종 승인 계약으로 이동한다', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(projectPublicChatResult({ content: '검토', missionId: id, step: 'AWAITING_APPROVAL' })?.reviewHref).toBe(`/app/missions/${id}`)
  })
})
