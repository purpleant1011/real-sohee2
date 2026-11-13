import { describe, expect, it, vi } from 'vitest'
import { createPublishCommand, parseExecutionResult } from './publish-client'
import { deriveFirstPostOutcome } from './publish-outcome'

const ok = {
  overallStatus: 'ALL_VERIFIED',
  receipts: { instagram: { channel: 'instagram', stage: 'OUTCOME_OBSERVED', permalink: 'https://www.instagram.com/p/x/', verifiedAt: '2026-10-23T09:00:00.000Z', receiptId: 'r' } },
}
const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('parseExecutionResult', () => {
  it('서버 결과를 OutcomeInput 으로 옮기고 확인됨은 readback 근거가 있을 때만 된다', () => {
    const input = parseExecutionResult(ok)!
    expect(deriveFirstPostOutcome(input).channels.instagram?.state).toBe('VERIFIED')
    const accepted = parseExecutionResult({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: { stage: 'PROVIDER_ACCEPTED' } } })!
    expect(deriveFirstPostOutcome(accepted).channels.instagram?.state).not.toBe('VERIFIED')
  })
  it('모양이 어긋나면 null', () => {
    expect(parseExecutionResult(null)).toBeNull()
    expect(parseExecutionResult({ overallStatus: 'OK', receipts: {} })).toBeNull()
    expect(parseExecutionResult({ overallStatus: 'FAILED', receipts: { instagram: { stage: 'DONE' } } })).toBeNull()
    expect(parseExecutionResult({ overallStatus: 'FAILED', receipts: { instagram: { stage: 'FAILED', permalink: 3 } } })).toBeNull()
  })
})

describe('createPublishCommand', () => {
  it('성공 응답은 RESULT', async () => {
    const r = await createPublishCommand({ missionId: 'm', fetchImpl: vi.fn().mockReturnValue(res({ success: true, executionResult: ok })) })()
    expect(r).toMatchObject({ kind: 'RESULT', reconciliationRequired: false })
  })
  it('저장 실패 응답도 결과를 보존하고 표시한다', async () => {
    const r = await createPublishCommand({ missionId: 'm', fetchImpl: vi.fn().mockReturnValue(res({ code: 'RECONCILIATION_REQUIRED', executionResult: ok }, 500)) })()
    expect(r).toMatchObject({ kind: 'RESULT', reconciliationRequired: true })
  })
  it('네트워크 오류·결과 없음은 UNKNOWN(게시 안 됨으로 단정 금지)', async () => {
    expect(await createPublishCommand({ missionId: 'm', fetchImpl: vi.fn().mockRejectedValue(new Error('x')) })()).toEqual({ kind: 'UNKNOWN', status: null })
    expect(await createPublishCommand({ missionId: 'm', fetchImpl: vi.fn().mockReturnValue(res({ error: 'e' }, 500)) })()).toEqual({ kind: 'UNKNOWN', status: 500 })
  })
})
