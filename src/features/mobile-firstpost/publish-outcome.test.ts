import { describe, expect, it } from 'vitest'
import { deriveFirstPostOutcome, type FirstPostOutcome, type OutcomeChannel, type OutcomeInput } from './publish-outcome'

const base = { approvalFingerprint: 'fp', requestId: 'r', receiptId: 'x', attemptCount: 1, lastAttemptAt: '2026-10-22T01:00:00Z' }

// channels는 Partial이므로, 영수증이 있는 채널만 조회한다는 전제를 타입으로 고정한다.
function channel(o: FirstPostOutcome, key: OutcomeChannel) {
  const found = o.channels[key]
  if (!found) throw new Error(`missing ${key} outcome`)
  return found
}
const verified = (channel: 'instagram' | 'threads') => ({
  ...base, channel, stage: 'EXTERNALLY_VERIFIED' as const,
  providerPostId: 'p', permalink: `https://example.test/${channel}/p`, verifiedAt: '2026-10-22T01:00:05Z',
})
const input = (receipts: OutcomeInput['receipts'], overallStatus: OutcomeInput['overallStatus']): OutcomeInput => ({ overallStatus, receipts })

describe('deriveFirstPostOutcome — 거짓 "게시됨" 금지', () => {
  it('두 채널 모두 permalink+verifiedAt이 있을 때만 VERIFIED이며 축하 허용', () => {
    const o = deriveFirstPostOutcome(input({ instagram: verified('instagram'), threads: verified('threads') }, 'ALL_VERIFIED'))
    expect(o.overall).toBe('VERIFIED')
    expect(o.celebrate).toBe(true)
  })

  it('서버가 ALL_VERIFIED라 해도 permalink가 없으면 VERIFIED로 올리지 않는다 (fail-closed)', () => {
    const noLink = { ...verified('instagram'), permalink: undefined }
    const o = deriveFirstPostOutcome(input({ instagram: noLink, threads: verified('threads') }, 'ALL_VERIFIED'))
    expect(o.overall).not.toBe('VERIFIED')
    expect(o.celebrate).toBe(false)
    expect(channel(o, 'instagram').state).toBe('CHECKING')
  })

  it('PROVIDER_ACCEPTED는 "외부 확인 중"이지 게시 확인이 아니다', () => {
    const o = deriveFirstPostOutcome(input({ instagram: { ...base, channel: 'instagram', stage: 'PROVIDER_ACCEPTED', providerPostId: 'p' } }, 'PARTIAL_SUCCESS'))
    expect(channel(o, 'instagram').state).toBe('CHECKING')
    expect(o.celebrate).toBe(false)
    expect(channel(o, 'instagram').label).not.toMatch(/게시됨|완료/)
  })

  it('RESULT_UNKNOWN은 실패로도 성공으로도 단정하지 않고 UNKNOWN + 재전송 금지', () => {
    const o = deriveFirstPostOutcome(input({ threads: { ...base, channel: 'threads', stage: 'RESULT_UNKNOWN' } }, 'FAILED'))
    expect(channel(o, 'threads').state).toBe('UNKNOWN')
    expect(channel(o, 'threads').canRetry).toBe(false)
    expect(o.overall).toBe('UNKNOWN')
  })

  it('한 채널만 검증되면 PARTIAL이며 축하하지 않고 검증된 채널 링크만 노출', () => {
    const o = deriveFirstPostOutcome(input({
      instagram: verified('instagram'),
      threads: { ...base, channel: 'threads', stage: 'FAILED', errorMessage: 'token expired' },
    }, 'PARTIAL_SUCCESS'))
    expect(o.overall).toBe('PARTIAL')
    expect(o.celebrate).toBe(false)
    expect(channel(o, 'instagram').permalink).toBeTruthy()
    expect(channel(o, 'threads').permalink).toBeUndefined()
    expect(channel(o, 'threads').canRetry).toBe(true)
  })

  it('영문 에러 원문을 사용자 문구에 노출하지 않는다', () => {
    const o = deriveFirstPostOutcome(input({ threads: { ...base, channel: 'threads', stage: 'FAILED', errorMessage: 'OAuthException code 190' } }, 'FAILED'))
    expect(JSON.stringify(o)).not.toMatch(/OAuthException|190/)
    expect(o.overall).toBe('FAILED')
  })

  it('receipts가 비어 있으면 NOT_STARTED — 빈 결과를 성공으로 보지 않는다', () => {
    expect(deriveFirstPostOutcome(input({}, 'ALL_VERIFIED')).overall).toBe('NOT_STARTED')
  })
})
