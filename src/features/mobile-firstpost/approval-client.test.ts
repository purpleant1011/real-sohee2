import { describe, expect, it, vi } from 'vitest'
import { ApprovalRequestError, createApprovalCommand } from './approval-client'
import type { ApprovalSubmission } from './approval-review'

const req: ApprovalSubmission = { serverFingerprint: 'fp', contentKey: 'ck', imageIds: ['i'], costKrw: 0, explicitPhrase: '이 버전 승인하고 발행' }
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('createApprovalCommand', () => {
  it('서버 지문과 명시 승인 문구를 그대로 보낸다', async () => {
    const f = vi.fn().mockReturnValue(json({ success: true }))
    await createApprovalCommand({ missionId: 'm', workspaceId: 'w', fetchImpl: f })(req)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/missions/first-post/approve')
    expect(init.headers['x-workspace-id']).toBe('w')
    expect(JSON.parse(init.body)).toEqual({ missionId: 'm', fingerprint: 'fp', isExplicitlyApproved: true, explicitPhrase: '이 버전 승인하고 발행' })
  })
  it('지문 불일치 등 거절은 코드와 문구를 담아 던진다', async () => {
    const f = vi.fn().mockReturnValue(json({ error: '내용이 바뀌었어요', code: 'FINGERPRINT_MISMATCH_REJECTED' }, 422))
    await expect(createApprovalCommand({ missionId: 'm', fetchImpl: f })(req)).rejects.toMatchObject({ status: 422, code: 'FINGERPRINT_MISMATCH_REJECTED', userMessage: '내용이 바뀌었어요' })
  })
  it('200 이어도 success 가 true 가 아니면 승인으로 보지 않는다', async () => {
    const f = vi.fn().mockReturnValue(json({ ok: 1 }))
    await expect(createApprovalCommand({ missionId: 'm', fetchImpl: f })(req)).rejects.toBeInstanceOf(ApprovalRequestError)
  })
  it('네트워크 오류는 그대로 던진다', async () => {
    await expect(createApprovalCommand({ missionId: 'm', fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) })(req)).rejects.toThrow('offline')
  })
})
