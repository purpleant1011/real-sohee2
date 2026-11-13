import { describe, expect, it } from 'vitest'

import { decisionStateFromResponse } from './r2-memory-decisions'

const proposalId = 'p-1'

describe('가게 기억 결정 응답 → 화면 상태', () => {
  it('승인 성공 응답은 decided/confirmed 다', () => {
    expect(decisionStateFromResponse(200, {
      outcome: 'decided', proposalId, status: 'confirmed', factId: 'f-1',
    }, proposalId)).toEqual({ kind: 'decided', status: 'confirmed' })
  })

  it('거절 성공 응답은 decided/rejected 다', () => {
    expect(decisionStateFromResponse(200, {
      outcome: 'decided', proposalId, status: 'rejected', factId: null,
    }, proposalId)).toEqual({ kind: 'decided', status: 'rejected' })
  })

  it('이미 처리된 응답은 decided 와 구분해 already_handled 로 둔다', () => {
    expect(decisionStateFromResponse(200, {
      outcome: 'already_handled', proposalId, status: 'confirmed', factId: null,
    }, proposalId)).toEqual({ kind: 'already_handled', status: 'confirmed' })
  })

  it('없는 항목(404)은 실패가 아니라 not_found 사유로 남긴다', () => {
    expect(decisionStateFromResponse(404, { outcome: 'not_found', proposalId }, proposalId))
      .toEqual({ kind: 'failed', reason: 'not_found' })
  })

  it('확인할 수 없는 내용(422)은 저장 실패와 다른 사유로 남긴다', () => {
    expect(decisionStateFromResponse(422, { outcome: 'invalid_proposal', proposalId }, proposalId))
      .toEqual({ kind: 'failed', reason: 'invalid' })
  })

  it('저장 실패(503)는 unavailable 이다', () => {
    expect(decisionStateFromResponse(503, { outcome: 'unavailable', proposalId }, proposalId))
      .toEqual({ kind: 'failed', reason: 'unavailable' })
  })

  it('다른 제안의 응답·깨진 응답·성공이 아닌 200 은 실패로 닫는다', () => {
    expect(decisionStateFromResponse(200, {
      outcome: 'decided', proposalId: 'p-2', status: 'confirmed', factId: null,
    }, proposalId)).toEqual({ kind: 'failed', reason: 'unavailable' })

    expect(decisionStateFromResponse(200, null, proposalId)).toEqual({ kind: 'failed', reason: 'unavailable' })
    expect(decisionStateFromResponse(200, '<html>', proposalId)).toEqual({ kind: 'failed', reason: 'unavailable' })
    expect(decisionStateFromResponse(200, { outcome: 'decided', proposalId, status: 'proposed' }, proposalId))
      .toEqual({ kind: 'failed', reason: 'unavailable' })
  })
})
