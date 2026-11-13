import { describe, expect, it, vi } from 'vitest'
import {
  APPROVAL_BLOCKER_MESSAGE,
  APPROVAL_CTA,
  APPROVAL_STATUS_LABEL,
  APPROVAL_TIMING_LABEL,
  approvalBlockers,
  approvalContentKey,
  approvalStatusOf,
  buildApprovalReview,
  costView,
  createApprovalRequester,
  isExplicitApprovalPhrase,
  knownCostKrw,
  type ApprovalBlocker,
  type ApprovalReviewInput,
  type ApprovalTarget,
} from './approval-review'
import { APPROVAL_PHRASE } from './approval-gate'
import type { PreviewAction } from './preview-set'

const CAPTION = '오늘의 시술 후기 ✨\n줄바꿈과  공백을 그대로 둡니다.  '

const TARGET: ApprovalTarget = {
  channel: 'instagram',
  handle: '@byreum',
  connection: 'CONNECTED',
  publishPermission: 'GRANTED',
}

function baseInput(overrides: Partial<ApprovalReviewInput> = {}): ApprovalReviewInput {
  return {
    workspaceName: '바이름',
    targets: [TARGET],
    copies: [{ channel: 'instagram', text: CAPTION, cta: '프로필 링크에서 예약' }],
    imageIds: ['asset_02', 'asset_01'],
    rights: 'CONFIRMED',
    saved: true,
    cost: { amountKrw: 1200, source: 'SERVER_QUOTE' },
    executionSurface: 'MOBILE_OK',
    serverFingerprint: 'server-fp-1',
    approved: null,
    ...overrides,
  }
}

function has(blockers: readonly ApprovalBlocker[], blocker: ApprovalBlocker): boolean {
  return blockers.includes(blocker)
}

describe('M07 승인 화면 — 한 화면에 어디에·무엇을·비용', () => {
  it('정상 입력이면 CTA 1개가 열리고 승인 상태는 승인 전', () => {
    const review = buildApprovalReview(baseInput())
    expect(review.blockers).toEqual([])
    expect(review.canApprove).toBe(true)
    expect(review.ctaLabel).toBe(APPROVAL_CTA)
    expect(review.ctaEnabled).toBe(true)
    expect(review.timingLabel).toBe(APPROVAL_TIMING_LABEL)
    expect(review.approvalStatus).toBe('BEFORE_APPROVAL')
    expect(review.statusLabel).toBe(APPROVAL_STATUS_LABEL.BEFORE_APPROVAL)
    expect(review.manualFallback).toEqual([])
  })

  it('연결·게시 권한이 모두 확인된 대상만 초록 체크', () => {
    const review = buildApprovalReview(
      baseInput({
        targets: [
          TARGET,
          { channel: 'threads', handle: '@byreum', connection: 'CONNECTED', publishPermission: 'UNKNOWN' },
        ],
        copies: [
          { channel: 'instagram', text: CAPTION, cta: '예약' },
          { channel: 'threads', text: '스레드 원고', cta: '예약' },
        ],
      }),
    )
    expect(review.targets[0].verified).toBe(true)
    expect(review.targets[0].channelName).toBe('인스타그램')
    expect(review.targets[1].verified).toBe(false)
    expect(has(review.blockers, 'CHANNEL_NOT_PUBLISHABLE')).toBe(true)
    expect(review.ctaEnabled).toBe(false)
  })

  it('전문을 자르지 않고 그대로 내려준다', () => {
    const review = buildApprovalReview(baseInput())
    expect(review.copies[0].text).toBe(CAPTION)
    expect(review.copies[0].channelName).toBe('인스타그램')
    expect(review.imageIds).toEqual(['asset_02', 'asset_01'])
  })
})

describe('M07 승인 차단 — fail-closed', () => {
  it('채널·계정이 없으면 열지 않는다', () => {
    const noChannel = approvalBlockers(baseInput({ targets: [], copies: [] }))
    expect(has(noChannel, 'NO_CHANNEL')).toBe(true)

    const noHandle = approvalBlockers(baseInput({ targets: [{ ...TARGET, handle: '   ' }] }))
    expect(has(noHandle, 'MISSING_ACCOUNT')).toBe(true)
  })

  it('원고·안내 문구가 비면 열지 않는다', () => {
    const blockers = approvalBlockers(
      baseInput({ copies: [{ channel: 'instagram', text: '   ', cta: '' }] }),
    )
    expect(has(blockers, 'NO_COPY')).toBe(true)
    expect(has(blockers, 'NO_CTA')).toBe(true)
  })

  it('사진이 없거나 빈 id 면 열지 않는다', () => {
    expect(has(approvalBlockers(baseInput({ imageIds: [] })), 'NO_IMAGE')).toBe(true)
    expect(has(approvalBlockers(baseInput({ imageIds: ['asset_01', ' '] })), 'NO_IMAGE')).toBe(true)
  })

  it('사진 사용 확인 전에는 열지 않는다', () => {
    const review = buildApprovalReview(baseInput({ rights: 'UNCONFIRMED' }))
    expect(review.blockers).toContain('RIGHTS_UNCONFIRMED')
    expect(review.ctaEnabled).toBe(false)
    expect(review.blockerMessages).toContain(APPROVAL_BLOCKER_MESSAGE.RIGHTS_UNCONFIRMED)
  })

  it('저장이 끝나기 전에는 승인할 수 없다', () => {
    expect(has(approvalBlockers(baseInput({ saved: false })), 'COPY_NOT_SAVED')).toBe(true)
  })

  it('서버 승인 지문이 없으면 승인 요청을 만들 수 없다', () => {
    expect(has(approvalBlockers(baseInput({ serverFingerprint: null })), 'FINGERPRINT_MISSING')).toBe(true)
    expect(has(approvalBlockers(baseInput({ serverFingerprint: '  ' })), 'FINGERPRINT_MISSING')).toBe(true)
  })

  it('실행 표면이 PC 전용/미확인이면 열지 않고 수동 경로를 안내한다', () => {
    const desktop = buildApprovalReview(baseInput({ executionSurface: 'DESKTOP_ONLY' }))
    expect(desktop.blockers).toContain('EXECUTION_DESKTOP_ONLY')
    expect(desktop.ctaEnabled).toBe(false)
    expect(desktop.manualFallback).toEqual<readonly PreviewAction[]>(['SAVE', 'COPY', 'DOWNLOAD'])

    const unknown = buildApprovalReview(baseInput({ executionSurface: 'UNKNOWN' }))
    expect(unknown.blockers).toContain('EXECUTION_UNKNOWN')
    expect(unknown.ctaEnabled).toBe(false)
    expect(unknown.manualFallback.length).toBeGreaterThan(0)
  })

  it('대상 없이 채널을 지우면 대상 확인으로 초록 체크를 만들지 않는다', () => {
    const review = buildApprovalReview(baseInput({ targets: [], copies: [] }))
    expect(review.targets).toEqual([])
    expect(review.canApprove).toBe(false)
  })
})

describe('M07 예상 비용 — 확정 금액만 인정', () => {
  it('확정 정수 금액은 표시하고 출처를 밝힌다', () => {
    expect(knownCostKrw({ amountKrw: 12500, source: 'SERVER_QUOTE' })).toBe(12500)
    const view = costView({ amountKrw: 12500, source: 'POLICY' })
    expect(view).toEqual({
      known: true,
      amountKrw: 12500,
      label: '기본 플랜 포함',
      detail: '요금 정책 기준',
    })
    expect(view.label).not.toMatch(/\d+원/)
  })

  it('출처가 UNKNOWN 이거나 값이 비정상이면 확인 중으로 두고 승인을 막는다', () => {
    for (const cost of [
      { amountKrw: 1200, source: 'UNKNOWN' as const },
      { amountKrw: null, source: 'SERVER_QUOTE' as const },
      { amountKrw: 0.5, source: 'SERVER_QUOTE' as const },
      { amountKrw: -1, source: 'SERVER_QUOTE' as const },
      { amountKrw: Number.NaN, source: 'SERVER_QUOTE' as const },
    ]) {
      expect(knownCostKrw(cost)).toBeNull()
      const view = costView(cost)
      expect(view.known).toBe(false)
      expect(view.label).toBe('예상 비용 확인 중')
      expect(view.amountKrw).toBeNull()
      expect(has(approvalBlockers(baseInput({ cost })), 'COST_UNKNOWN')).toBe(true)
    }
  })

  it('0원도 확정 금액이면 승인 가능하다', () => {
    expect(knownCostKrw({ amountKrw: 0, source: 'POLICY' })).toBe(0)
    expect(approvalBlockers(baseInput({ cost: { amountKrw: 0, source: 'POLICY' } }))).toEqual([])
  })
})

describe('M07 승인 스냅샷 — 원문 그대로, 사진 순서 무관', () => {
  it('공백·줄바꿈을 정규화하지 않는다', () => {
    const a = approvalContentKey(baseInput())
    const b = approvalContentKey(
      baseInput({ copies: [{ channel: 'instagram', text: '오늘의 시술 후기 ✨\n줄바꿈과 공백을 그대로 둡니다.  ', cta: '예약' }] }),
    )
    expect(a).not.toBe(b)
  })

  it('사진 id 순서만 바뀐 것은 승인 변경이 아니다', () => {
    const a = approvalContentKey(baseInput({ imageIds: ['asset_01', 'asset_02'] }))
    const b = approvalContentKey(baseInput({ imageIds: ['asset_02', 'asset_01'] }))
    expect(a).toBe(b)
  })

  it('사진 구성이나 권리 근거가 바뀌면 다른 스냅샷', () => {
    const base = approvalContentKey(baseInput())
    expect(approvalContentKey(baseInput({ imageIds: ['asset_01'] }))).not.toBe(base)
    expect(approvalContentKey(baseInput({ rights: 'UNCONFIRMED' }))).not.toBe(base)
  })
})

describe('M07 승인 후 변경 — 재승인', () => {
  it('승인한 원고와 지금 원고가 같으면 CURRENT', () => {
    const input = baseInput()
    const approved = { contentKey: approvalContentKey(input), fingerprint: 'server-fp-1' }
    const review = buildApprovalReview(baseInput({ approved }))
    expect(review.approvalStatus).toBe('CURRENT')
    expect(review.reapprovalRequired).toBe(false)
    expect(review.blockers).toEqual([])
  })

  it('승인 뒤 원고가 바뀌면 STALE 이고 재승인이 필요하다', () => {
    const approvedInput = baseInput()
    const approved = { contentKey: approvalContentKey(approvedInput), fingerprint: 'server-fp-1' }
    const review = buildApprovalReview(
      baseInput({
        approved,
        copies: [{ channel: 'instagram', text: '승인 후 다른 원고', cta: '프로필 링크에서 예약' }],
      }),
    )
    expect(review.approvalStatus).toBe('STALE')
    expect(review.reapprovalRequired).toBe(true)
    expect(review.statusLabel).toBe(APPROVAL_STATUS_LABEL.STALE)
    expect(approvalStatusOf(approved, review.contentKey)).toBe('STALE')
    // 원고 변경 자체는 차단 사유가 아니다 — 재승인하면 열린다.
    expect(review.canApprove).toBe(true)
  })

  it('승인 뒤 사진이 교체되면 STALE', () => {
    const approved = { contentKey: approvalContentKey(baseInput()), fingerprint: 'server-fp-1' }
    const review = buildApprovalReview(baseInput({ approved, imageIds: ['asset_09'] }))
    expect(review.approvalStatus).toBe('STALE')
  })

  it('승인 후 서버 초안이 재생성되면 지문만 바뀌어도 보내지 않는다', () => {
    const approved = { contentKey: approvalContentKey(baseInput()), fingerprint: 'server-fp-old' }
    const review = buildApprovalReview(baseInput({ approved, serverFingerprint: 'server-fp-new' }))
    expect(review.blockers).toContain('APPROVED_SNAPSHOT_MISMATCH')
    expect(review.ctaEnabled).toBe(false)
    expect(review.blockerMessages).toContain(APPROVAL_BLOCKER_MESSAGE.APPROVED_SNAPSHOT_MISMATCH)
  })

  it('승인 기록이 없으면 지문이 무엇이든 snapshot mismatch 가 아니다', () => {
    expect(approvalBlockers(baseInput({ serverFingerprint: 'server-fp-new' }))).toEqual([])
  })
})

describe('M07 승인 요청 — 재검증 + 단일 요청', () => {
  const submission = () =>
    vi.fn(async (request: { serverFingerprint: string; contentKey: string; costKrw: number }) => ({
      status: 'APPROVED_FOR_PUBLISH',
      fingerprint: request.serverFingerprint,
      costKrw: request.costKrw,
    }))

  it('승인 문구가 정확하지 않으면 서버를 부르지 않는다', async () => {
    const submit = submission()
    const requester = createApprovalRequester({ read: () => baseInput(), submit })
    expect(isExplicitApprovalPhrase(APPROVAL_PHRASE)).toBe(true)
    expect(isExplicitApprovalPhrase(` ${APPROVAL_PHRASE} `)).toBe(true)
    expect(isExplicitApprovalPhrase(`${APPROVAL_PHRASE}!`)).toBe(false)

    await expect(requester.run('발행해줘')).resolves.toEqual({ kind: 'PHRASE_REQUIRED' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('같은 CTA 연속 2회 = 실제 요청 1건', async () => {
    const submit = submission()
    const requester = createApprovalRequester({ read: () => baseInput(), submit })
    const [first, second] = await Promise.all([requester.run(), requester.run()])
    expect(submit).toHaveBeenCalledTimes(1)
    expect(first.kind).toBe('SUBMITTED')
    expect(second.kind).toBe('SUBMITTED')
    expect(requester.busy).toBe(false)
  })

  it('숫자 승인 요청에는 서버 지문·화면 스냅샷·비용만 담는다', async () => {
    const submit = submission()
    const requester = createApprovalRequester({ read: () => baseInput(), submit })
    const result = await requester.run()
    expect(result.kind).toBe('SUBMITTED')
    if (result.kind !== 'SUBMITTED') return
    expect(result.request).toEqual({
      serverFingerprint: 'server-fp-1',
      contentKey: approvalContentKey(baseInput()),
      imageIds: ['asset_02', 'asset_01'],
      costKrw: 1200,
      explicitPhrase: APPROVAL_PHRASE,
    })
  })

  it('클릭 시점에 화면이 바뀌었으면 차단하고 서버를 부르지 않는다', async () => {
    const submit = submission()
    let input = baseInput()
    const requester = createApprovalRequester({ read: () => input, submit })

    input = baseInput({ cost: { amountKrw: null, source: 'UNKNOWN' } })
    const blocked = await requester.run()
    expect(blocked.kind).toBe('BLOCKED')
    if (blocked.kind === 'BLOCKED') {
      expect(blocked.blockers).toContain('COST_UNKNOWN')
      expect(blocked.messages).toContain(APPROVAL_BLOCKER_MESSAGE.COST_UNKNOWN)
    }
    expect(submit).not.toHaveBeenCalled()

    input = baseInput({ rights: 'UNCONFIRMED' })
    const rightsBlocked = await requester.run()
    expect(rightsBlocked.kind).toBe('BLOCKED')
    expect(submit).not.toHaveBeenCalled()
  })

  it('승인 후 원고가 바뀐 채 다시 누르면 바뀐 스냅샷으로 재승인한다', async () => {
    const submit = submission()
    let input = baseInput()
    const requester = createApprovalRequester({ read: () => input, submit })

    await requester.run()
    input = baseInput({
      copies: [{ channel: 'instagram', text: '수정된 원고', cta: '프로필 링크에서 예약' }],
    })
    const second = await requester.run()
    expect(submit).toHaveBeenCalledTimes(2)
    if (second.kind === 'SUBMITTED') {
      expect(second.request.contentKey).toBe(approvalContentKey(input))
    }
  })

  it('실패 뒤 잠금이 풀려 다시 시도할 수 있다', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok')
    const requester = createApprovalRequester({ read: () => baseInput(), submit })
    await expect(requester.run()).rejects.toThrow('network')
    expect(requester.busy).toBe(false)
    const retry = await requester.run()
    expect(retry.kind).toBe('SUBMITTED')
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('승인 응답은 게시 결과가 아니다 — 성공 문구를 만들지 않는다', async () => {
    const requester = createApprovalRequester({
      read: () => baseInput(),
      submit: async () => ({ status: 'APPROVED_FOR_PUBLISH' }),
    })
    const result = await requester.run()
    expect(result.kind).toBe('SUBMITTED')
    expect(JSON.stringify(result)).not.toMatch(/게시(됐|되었|완료)/)
  })
})
