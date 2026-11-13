import { describe, expect, it } from 'vitest'
import { deriveFirstPostOutcome, type FirstPostOutcome, type OutcomeChannel, type OutcomeInput } from './publish-outcome'
import {
  buildResultScreen,
  evidencePermalink,
  postedAtLabel,
  RESULT_ACTION_LABEL,
  type ResultChannelCard,
  type ResultEvidence,
  type ResultScreen,
  type ResultScreenInput,
} from './result-screen'

const RECEIPT_BASE = {
  approvalFingerprint: 'fp-1',
  requestId: 'req-1',
  receiptId: 'rcpt-1',
  attemptCount: 1,
  lastAttemptAt: '2026-10-22T01:00:00Z',
}

const VERIFIED_AT = '2026-10-22T01:00:05Z'

function verifiedReceipt(channel: OutcomeChannel, verifiedAt = VERIFIED_AT) {
  return {
    ...RECEIPT_BASE,
    channel,
    stage: 'EXTERNALLY_VERIFIED' as const,
    providerPostId: `p-${channel}`,
    permalink: `https://example.test/${channel}/p`,
    verifiedAt,
  }
}

function outcome(
  receipts: OutcomeInput['receipts'],
  overallStatus: OutcomeInput['overallStatus'] = 'ALL_VERIFIED',
): FirstPostOutcome {
  return deriveFirstPostOutcome({ receipts, overallStatus })
}

function evidence(handle = '@byreum'): Record<OutcomeChannel, ResultEvidence> {
  return {
    instagram: { approvedHandle: handle },
    threads: { approvedHandle: handle },
  }
}

function screen(input: Partial<ResultScreenInput> & { outcome: FirstPostOutcome }): ResultScreen {
  return buildResultScreen({ evidence: evidence(), ...input })
}

function card(result: ResultScreen, channel: OutcomeChannel): ResultChannelCard {
  const found = result.cards.find((item) => item.channel === channel)
  if (!found) throw new Error(`missing ${channel} card`)
  return found
}

/** 사용자에게 보이는 문자열만 모은다. 상태 코드·내부 용어 노출 검사용. */
function visibleText(result: ResultScreen): string {
  return [
    result.title,
    result.completionToast ?? '',
    result.pendingNote ?? '',
    result.manualNotice ?? '',
    ...result.cards.flatMap((item) => [item.name, item.label, item.detail, item.nextCheck ?? '', item.manualNotice ?? '']),
  ].join(' | ')
}

describe('M08 결과 화면 — 첫 게시 확인의 유일한 근거는 독립 readback', () => {
  it('두 채널 모두 permalink·게시 시각·대상 계정 근거가 있으면 축하와 첫 가치 이벤트를 만든다', () => {
    const result = screen({ outcome: outcome({ instagram: verifiedReceipt('instagram'), threads: verifiedReceipt('threads') }) })

    expect(result.celebrate).toBe(true)
    expect(result.completionToast).toBe('첫 게시를 확인했어요')
    expect(result.cards.map((item) => item.state)).toEqual(['VERIFIED', 'VERIFIED'])
    expect(result.customerLink).toEqual({
      label: RESULT_ACTION_LABEL.VIEW_CUSTOMER_LINK,
      href: 'https://example.test/instagram/p',
    })
    expect(result.firstValueEvent).not.toBeNull()
    expect(result.firstValueEvent?.source).toBe('PROVIDER_READBACK')
    expect(result.firstValueEvent?.channels).toEqual(['instagram', 'threads'])
    expect(result.pendingNote).toBeNull()
  })

  it('축하 상태에서만 완료 토스트와 고객용 링크가 생긴다', () => {
    const result = screen({
      outcome: outcome({
        instagram: verifiedReceipt('instagram'),
        threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'PROVIDER_ACCEPTED' },
      }),
    })

    expect(result.celebrate).toBe(false)
    expect(result.completionToast).toBeNull()
    expect(result.customerLink).toBeNull()
    expect(result.firstValueEvent).toBeNull()
  })

  it('Permalink가 없으면 서버가 검증 단계라 해도 VERIFIED가 되지 않는다', () => {
    const result = screen({
      outcome: outcome({ instagram: { ...verifiedReceipt('instagram'), permalink: undefined } }),
    })

    // outcome 단계에서 이미 '확인 중'으로 내려온다. 화면은 그 판정을 올리지 않는다.
    expect(card(result, 'instagram').state).toBe('CHECKING')
    expect(card(result, 'instagram').state).not.toBe('VERIFIED')
    expect(result.celebrate).toBe(false)
    expect(result.completionToast).toBeNull()
    expect(result.firstValueEvent).toBeNull()
  })

  it('화면에 잘못된 VERIFIED 판정이 들어와도 링크·시각 근거가 없으면 UNKNOWN으로 낮춘다', () => {
    // 상류가 stage 대신 상태를 잘못 넘긴 경우를 가정한 방어선. 화면이 성공을 만들 수는 없다.
    const forged: FirstPostOutcome = {
      overall: 'VERIFIED',
      headline: '게시를 확인했어요',
      celebrate: true,
      channels: {
        instagram: {
          state: 'VERIFIED',
          label: '인스타그램 게시 확인',
          detail: '',
          permalink: 'javascript:alert(1)',
          verifiedAt: VERIFIED_AT,
          canRetry: false,
        },
      },
    }
    const result = screen({ outcome: forged })

    expect(card(result, 'instagram').state).toBe('UNKNOWN')
    expect(card(result, 'instagram').permalink).toBeUndefined()
    expect(result.celebrate).toBe(false)
    expect(result.completionToast).toBeNull()
    expect(result.firstValueEvent).toBeNull()
  })

  it('게시 시각을 읽을 수 없으면 VERIFIED를 낮춘다', () => {
    const result = screen({
      outcome: outcome({ instagram: verifiedReceipt('instagram', '어제쯤') }),
    })

    expect(card(result, 'instagram').state).toBe('UNKNOWN')
    expect(result.celebrate).toBe(false)
  })

  it('승인 계정 근거가 없으면 성공으로 표시하지 않는다', () => {
    const result = buildResultScreen({ outcome: outcome({ instagram: verifiedReceipt('instagram') }) })

    expect(card(result, 'instagram').state).toBe('UNKNOWN')
    expect(result.celebrate).toBe(false)
    expect(result.firstValueEvent).toBeNull()
    expect(visibleText(result)).toContain('대상 계정')
  })

  it('readback 계정이 승인 계정과 다르면 다른 계정의 게시물이므로 성공 표시를 낮춘다', () => {
    const result = buildResultScreen({
      outcome: outcome({ instagram: verifiedReceipt('instagram') }),
      evidence: { instagram: { approvedHandle: '@byreum', readbackAccount: '@someone-else' } },
    })

    expect(card(result, 'instagram').state).toBe('UNKNOWN')
    expect(result.celebrate).toBe(false)
    expect(card(result, 'instagram').permalink).toBeUndefined()
  })

  it('readback 계정이 없어도 승인 계정과 대조할 근거가 없을 뿐이므로 승인 계정을 표시한다', () => {
    const result = buildResultScreen({
      outcome: outcome({ instagram: verifiedReceipt('instagram') }),
      evidence: { instagram: { approvedHandle: '@byreum' } },
    })

    expect(card(result, 'instagram').state).toBe('VERIFIED')
    expect(card(result, 'instagram').accountLabel).toBe('byreum')
  })

  it('@ 접두어와 공백만 다른 계정은 같은 계정으로 본다', () => {
    const result = buildResultScreen({
      outcome: outcome({ instagram: verifiedReceipt('instagram') }),
      evidence: { instagram: { approvedHandle: ' @byreum ', readbackAccount: '@byreum' } },
    })

    expect(card(result, 'instagram').state).toBe('VERIFIED')
  })

  it('VERIFIED 카드는 게시물 열기 행동과 게시 시각(서울) 증거를 함께 그린다', () => {
    const result = screen({ outcome: outcome({ instagram: verifiedReceipt('instagram') }) })
    const verified = card(result, 'instagram')

    expect(verified.evidenceShown).toBe(true)
    expect(verified.permalink).toBe('https://example.test/instagram/p')
    expect(verified.postedAtLabel).toBeTruthy()
    expect(verified.postedAtLabel).toContain('10:00')
    expect(verified.actions).toEqual([
      { action: 'OPEN_POST', label: RESULT_ACTION_LABEL.OPEN_POST, href: 'https://example.test/instagram/p', channel: 'instagram' },
    ])
  })

  it('첫 가치 이벤트 시각은 가장 이른 readback 시각을 쓴다', () => {
    const result = screen({
      outcome: outcome({
        instagram: verifiedReceipt('instagram', '2026-10-22T01:00:05Z'),
        threads: verifiedReceipt('threads', '2026-10-22T03:00:05Z'),
      }),
    })

    expect(result.firstValueEvent?.at).toBe('2026-10-22T01:00:05Z')
  })
})

describe('M08 결과 화면 — 확인 중·확인 불가에는 재게시를 열지 않는다', () => {
  it('PROVIDER_ACCEPTED는 확인 중이며 재시도가 아니라 새로고침을 연다', () => {
    const result = screen({
      outcome: outcome({ instagram: { ...RECEIPT_BASE, channel: 'instagram', stage: 'PROVIDER_ACCEPTED' } }),
    })

    expect(card(result, 'instagram').state).toBe('CHECKING')
    expect(card(result, 'instagram').retryAllowed).toBe(false)
    expect(card(result, 'instagram').actions).toEqual([])
    expect(card(result, 'instagram').nextCheck).toBeTruthy()
    expect(result.primaryAction?.action).toBe('REFRESH')
    expect(result.pendingNote).toBeTruthy()
    expect(result.celebrate).toBe(false)
  })

  it('RESULT_UNKNOWN은 확인 불가이며 재게시 버튼을 열지 않는다', () => {
    const result = screen({
      outcome: outcome({ threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'RESULT_UNKNOWN' } }),
    })

    expect(card(result, 'threads').state).toBe('UNKNOWN')
    expect(card(result, 'threads').retryAllowed).toBe(false)
    expect(card(result, 'threads').actions).toEqual([])
    expect(result.primaryAction?.action).toBe('REFRESH')
    expect(result.primaryAction?.action).not.toBe('RETRY')
  })

  it('재시도 불가 실패는 재게시를 열지 않는다', () => {
    const result = screen({
      outcome: outcome({
        threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'FAILED', failureCause: 'READBACK_UNKNOWN' },
      }),
    })

    expect(card(result, 'threads').state).toBe('FAILED')
    expect(card(result, 'threads').retryAllowed).toBe(false)
    expect(result.primaryAction?.action).toBe('REFRESH')
    expect(visibleText(result)).not.toContain('다시 시도')
  })

  it('재시도 가능한 실패만 기본 행동으로 다시 시도를 연다', () => {
    const result = screen({
      outcome: outcome({
        threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'FAILED', failureCause: 'TRANSPORT_FAILED' },
      }),
    })

    expect(card(result, 'threads').state).toBe('FAILED')
    expect(card(result, 'threads').retryAllowed).toBe(true)
    expect(result.primaryAction).toEqual({
      action: 'RETRY',
      label: RESULT_ACTION_LABEL.RETRY,
      channel: 'threads',
    })
    expect(result.celebrate).toBe(false)
  })

  it('일부 채널만 확인되면 완료라는 말을 쓰지 않고 재시도/새로고침만 연다', () => {
    const result = screen({
      outcome: outcome({
        instagram: verifiedReceipt('instagram'),
        threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'FAILED', failureCause: 'PROVIDER_REJECTED' },
      }, 'PARTIAL_SUCCESS'),
    })

    expect(result.celebrate).toBe(false)
    expect(result.title).toBe('일부 채널만 게시를 확인했어요')
    expect(visibleText(result)).not.toContain('완료')
    expect(result.firstValueEvent).toBeNull()
  })

  it('영수증이 하나도 없으면 성공 화면을 만들지 않는다', () => {
    const result = buildResultScreen({ outcome: outcome({}, 'ALL_VERIFIED') })

    expect(result.cards).toEqual([])
    expect(result.celebrate).toBe(false)
    expect(result.completionToast).toBeNull()
    expect(result.firstValueEvent).toBeNull()
    expect(result.title).toBe('아직 게시 결과가 없어요')
  })
})

describe('M08 결과 화면 — 수동 전달은 게시가 아니다', () => {
  it('확인되지 않은 채널의 복사 기록은 MANUAL 카드로만 표시한다', () => {
    const result = screen({
      outcome: outcome({ threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'RESULT_UNKNOWN' } }),
      manual: { threads: { method: 'COPY', sentAt: '2026-10-22T02:00:00Z' } },
    })

    expect(card(result, 'threads').state).toBe('MANUAL')
    expect(card(result, 'threads').manualNotice).toBeTruthy()
    expect(card(result, 'threads').actions).toEqual([
      { action: 'COPY_TEXT', label: RESULT_ACTION_LABEL.COPY_TEXT, channel: 'threads' },
    ])
    expect(result.manualNotice).toBeTruthy()
    expect(result.celebrate).toBe(false)
    expect(result.completionToast).toBeNull()
    expect(result.firstValueEvent).toBeNull()
  })

  it('다운로드 기록은 다운로드 행동과 직접 확인 안내를 붙인다', () => {
    const result = screen({
      outcome: outcome({ threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'FAILED', failureCause: 'PROVIDER_REJECTED' } }),
      manual: { threads: { method: 'DOWNLOAD' } },
    })

    expect(card(result, 'threads').state).toBe('MANUAL')
    expect(card(result, 'threads').retryAllowed).toBe(false)
    expect(card(result, 'threads').actions).toEqual([
      { action: 'DOWNLOAD_IMAGE', label: RESULT_ACTION_LABEL.DOWNLOAD_IMAGE, channel: 'threads' },
    ])
    expect(card(result, 'threads').manualNotice).toContain('직접 확인')
  })

  it('수동 전달은 축하와 첫 가치 이벤트로 승격되지 않는다', () => {
    const result = screen({
      outcome: outcome({ instagram: verifiedReceipt('instagram'), threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'RESULT_UNKNOWN' } }),
      manual: { threads: { method: 'COPY' } },
    })

    expect(result.celebrate).toBe(false)
    expect(result.completionToast).toBeNull()
    expect(result.firstValueEvent).toBeNull()
    expect(result.customerLink).toBeNull()
    expect(result.title).toBe('일부 채널만 게시를 확인했어요')
  })

  it('독립 readback이 확인된 채널은 수동 전달 기록보다 우선한다', () => {
    const result = screen({
      outcome: outcome({ instagram: verifiedReceipt('instagram') }),
      manual: { instagram: { method: 'COPY' } },
    })

    expect(card(result, 'instagram').state).toBe('VERIFIED')
    expect(result.celebrate).toBe(true)
  })
})

describe('근거 필터 — 게시물 링크와 시각', () => {
  it('http(s) 실주소만 통과한다', () => {
    expect(evidencePermalink('https://example.test/p/1')).toBe('https://example.test/p/1')
    expect(evidencePermalink('http://example.test/p/1')).toBe('http://example.test/p/1')
  })

  it('javascript:, data:, 상대 경로, 공백 문자열은 통과하지 못한다', () => {
    expect(evidencePermalink('javascript:alert(1)')).toBeNull()
    expect(evidencePermalink('data:text/html,<b>x</b>')).toBeNull()
    expect(evidencePermalink('/posts/1')).toBeNull()
    expect(evidencePermalink('   ')).toBeNull()
    expect(evidencePermalink(undefined)).toBeNull()
  })

  it('읽을 수 없는 시각은 임의 현재 시각으로 채우지 않는다', () => {
    expect(postedAtLabel('2026-10-22T01:00:05Z')).toBeTruthy()
    expect(postedAtLabel('not-a-date')).toBeNull()
    expect(postedAtLabel('')).toBeNull()
    expect(postedAtLabel(undefined)).toBeNull()
  })
})

describe('M08 결과 화면 — 사용자 문구에 내부 상태가 새지 않는다', () => {
  it('실패·확인 중 화면에 상태 코드가 노출되지 않는다', () => {
    const result = screen({
      outcome: outcome({
        instagram: { ...RECEIPT_BASE, channel: 'instagram', stage: 'PROVIDER_ACCEPTED' },
        threads: { ...RECEIPT_BASE, channel: 'threads', stage: 'RESULT_UNKNOWN' },
      }),
    })

    const text = visibleText(result)
    expect(text).not.toMatch(/PROVIDER_ACCEPTED|RESULT_UNKNOWN|CHECKING|ALL_VERIFIED|PARTIAL_SUCCESS/)
    expect(text).not.toMatch(/OAuthException|error|failed/i)
  })

  it('overall 은 서버 판정이 아니라 outcome 값을 그대로 옮긴다', () => {
    const result = screen({
      outcome: deriveFirstPostOutcome({
        overallStatus: 'ALL_VERIFIED',
        receipts: { instagram: { ...RECEIPT_BASE, channel: 'instagram', stage: 'PROVIDER_ACCEPTED' } },
      }),
    })

    expect(result.overall).toBe('CHECKING')
    expect(result.celebrate).toBe(false)
  })
})
