import { describe, expect, it } from 'vitest'
import {
  EXECUTE_STAGE_MAP,
  EXECUTE_STATUSES,
  parseExecutionReceipt,
  toOutcomeReceipt,
  toOutcomeReceipts,
} from './execute-status-adapter'
import type { ExecuteStatus } from './execution-contract'
import { deriveFirstPostOutcome, type ChannelState, type OutcomeChannel } from './publish-outcome'

const receipt = (over: Record<string, unknown> = {}) => ({ channel: 'instagram', status: 'PROVIDER_ACCEPTED', ...over })

describe('EXECUTE_STAGE_MAP — W6 정본 표', () => {
  it('다섯 상태를 모두 덮고 표 밖의 값을 만들지 않는다', () => {
    expect(Object.keys(EXECUTE_STAGE_MAP).sort()).toEqual([...EXECUTE_STATUSES].sort())
    expect(EXECUTE_STAGE_MAP.VERIFIED).toBe('EXTERNALLY_VERIFIED')
    expect(EXECUTE_STAGE_MAP.MANUAL_REQUIRED).toBe('FAILED')
  })

  it('REQUESTED와 PROVIDER_ACCEPTED는 단계를 접지 않고 보존한다', () => {
    expect(EXECUTE_STAGE_MAP.REQUESTED).toBe('REQUESTED')
    expect(EXECUTE_STAGE_MAP.PROVIDER_ACCEPTED).toBe('PROVIDER_ACCEPTED')
  })
})

describe('parseExecutionReceipt — 모양이 어긋나면 성공을 만들지 않는다', () => {
  it('채널/상태가 유효하면 통과하고 없는 필드는 만들지 않는다', () => {
    const dto = parseExecutionReceipt(receipt())
    expect(dto).toEqual({ channel: 'instagram', status: 'PROVIDER_ACCEPTED' })
    expect(dto).not.toHaveProperty('permalink')
    expect(dto).not.toHaveProperty('verifiedAt')
  })

  it('알 수 없는 상태·채널·원인은 null (부분 해석 금지)', () => {
    expect(parseExecutionReceipt(receipt({ status: 'PUBLISHED' }))).toBeNull()
    expect(parseExecutionReceipt(receipt({ channel: 'facebook' }))).toBeNull()
    expect(parseExecutionReceipt(receipt({ status: 'MANUAL_REQUIRED', failureCause: 'TIMEOUT' }))).toBeNull()
    expect(parseExecutionReceipt(null)).toBeNull()
    expect(parseExecutionReceipt('{}')).toBeNull()
  })

  it('문자열이 아닌 근거 필드는 null', () => {
    expect(parseExecutionReceipt(receipt({ permalink: 42 }))).toBeNull()
    expect(parseExecutionReceipt(receipt({ verifiedAt: { at: 'x' } }))).toBeNull()
  })

  it('계약 밖 상태의 failureCause도 값이 유효하면 버리지 않고 보존한다', () => {
    const dto = parseExecutionReceipt(receipt({ status: 'VERIFIED', failureCause: 'READBACK_UNKNOWN' }))
    expect(dto?.failureCause).toBe('READBACK_UNKNOWN')
  })

  it('meta는 아는 필드만 옮기고 빈 객체는 만들지 않는다', () => {
    const dto = parseExecutionReceipt(receipt({
      meta: { transport: { attemptedAt: 't', responseStatus: 200, token: 'secret' }, readback: {} },
    }))
    expect(dto?.meta).toEqual({ transport: { attemptedAt: 't', responseStatus: 200 } })
    expect(JSON.stringify(dto)).not.toMatch(/secret/)
    expect(parseExecutionReceipt(receipt({ meta: { transport: {} } }))?.meta).toBeUndefined()
  })
})

describe('toOutcomeReceipt — 변환만 하고 근거를 만들지 않는다', () => {
  it('VERIFIED라도 permalink/verifiedAt이 없으면 표시는 CHECKING (fail-closed)', () => {
    const dto = parseExecutionReceipt(receipt({ status: 'VERIFIED' }))!
    const r = toOutcomeReceipt(dto)
    expect(r.stage).toBe('EXTERNALLY_VERIFIED')
    expect(r.permalink).toBeUndefined()
    const o = deriveFirstPostOutcome({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: r } })
    expect(o.overall).not.toBe('VERIFIED')
    expect(o.celebrate).toBe(false)
  })

  it('근거가 있으면 그대로 VERIFIED로 표시한다', () => {
    const dto = parseExecutionReceipt(receipt({
      status: 'VERIFIED',
      permalink: 'https://example.test/p/1',
      verifiedAt: '2026-10-22T01:00:05Z',
    }))!
    const o = deriveFirstPostOutcome({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: toOutcomeReceipt(dto) } })
    expect(o.overall).toBe('VERIFIED')
    expect(o.channels.instagram?.permalink).toBe('https://example.test/p/1')
  })

  it('실행 상태 원본과 실패 원인을 진단용으로 보존한다', () => {
    const r = toOutcomeReceipt(parseExecutionReceipt(receipt({ status: 'MANUAL_REQUIRED', failureCause: 'READBACK_UNKNOWN' }))!)
    expect(r.executeStatus).toBe('MANUAL_REQUIRED')
    expect(r.failureCause).toBe('READBACK_UNKNOWN')
    expect(r.stage).toBe('FAILED')
  })
})

describe('toOutcomeReceipts — 해석 실패를 조용히 성공으로 바꾸지 않는다', () => {
  it('유효한 항목은 채널 키로, 무효 항목은 invalid로 센다', () => {
    const out = toOutcomeReceipts([
      receipt({ channel: 'instagram', status: 'REQUESTED' }),
      receipt({ channel: 'threads', status: 'BROKEN' }),
    ])
    expect(Object.keys(out.receipts)).toEqual(['instagram'])
    expect(out.invalid).toBe(1)
  })

  it('배열이 아니면 빈 결과 + invalid 1 (undefined는 0)', () => {
    expect(toOutcomeReceipts({}).invalid).toBe(1)
    expect(toOutcomeReceipts(undefined)).toEqual({ receipts: {}, invalid: 0 })
  })

  it('같은 채널이 두 번 오면 마지막 값을 쓰되 invalid로 세지 않는다', () => {
    const out = toOutcomeReceipts([
      receipt({ status: 'REQUESTED' }),
      receipt({ status: 'VERIFIED', permalink: 'p', verifiedAt: 't' }),
    ])
    expect(out.invalid).toBe(0)
    expect(out.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
  })
})

/**
 * W6 정본 문서(`w6-approval-api-and-cta-contract.md`)의 "W4 표현 계층 매핑" 표를
 * 어댑터 → 표시 모델까지 한 행씩 고정한다. 표의 '표시 의미' 열(CHECKING/VERIFIED/UNKNOWN/FAILED)이
 * W4 `ChannelState`다. 서버 overallStatus가 ALL_VERIFIED여도 표시를 위로 올리지 않는다.
 */
describe('W6 정본 표 — 상태별 표시 의미 계약', () => {
  const evidence = { permalink: 'https://example.test/p/1', verifiedAt: '2026-10-22T01:00:05Z' }
  const table: Array<{ status: ExecuteStatus; state: ChannelState; verified: boolean }> = [
    { status: 'REQUESTED', state: 'CHECKING', verified: false },
    { status: 'PROVIDER_ACCEPTED', state: 'CHECKING', verified: false },
    { status: 'VERIFIED', state: 'VERIFIED', verified: true },
    { status: 'RESULT_UNKNOWN', state: 'UNKNOWN', verified: false },
    { status: 'MANUAL_REQUIRED', state: 'FAILED', verified: false },
  ]

  const outcomeOf = (raw: Record<string, unknown>) =>
    deriveFirstPostOutcome({
      // 서버가 성공을 주장해도 W4는 영수증 근거로만 표시한다.
      overallStatus: 'ALL_VERIFIED',
      receipts: { instagram: toOutcomeReceipt(parseExecutionReceipt({ channel: 'instagram', ...raw })!) },
    })

  it('표의 다섯 행을 모두 덮는다', () => {
    expect(table.map((row) => row.status).sort()).toEqual([...EXECUTE_STATUSES].sort())
  })

  it.each(table)('$status → $state', ({ status, state, verified }) => {
    const outcome = outcomeOf({ status, ...(verified ? evidence : {}) })
    expect(outcome.channels.instagram?.state).toBe(state)
    expect(outcome.celebrate).toBe(state === 'VERIFIED')
    if (!verified) expect(outcome.channels.instagram?.permalink).toBeUndefined()
  })

  it('확인이 끝나지 않은 상태는 재시도·재실행을 열지 않는다', () => {
    for (const status of ['REQUESTED', 'PROVIDER_ACCEPTED', 'VERIFIED', 'RESULT_UNKNOWN'] as const) {
      const channel = outcomeOf({ status, ...(status === 'VERIFIED' ? evidence : {}) }).channels.instagram!
      expect(channel.canRetry, status).toBe(false)
    }
  })

  it('상태가 FAILED·UNKNOWN이면 근거가 실려 와도 성공으로 뒤집지 않는다', () => {
    for (const status of ['MANUAL_REQUIRED', 'RESULT_UNKNOWN'] as const) {
      const channel = outcomeOf({ status, ...evidence }).channels.instagram!
      expect(channel.state, status).not.toBe('VERIFIED')
      expect(channel.permalink, status).toBeUndefined()
    }
  })
})

describe('실패 원인별 표시 — 원인 코드 비노출·중복 게시 방지', () => {
  const failed = (failureCause?: 'PROVIDER_REJECTED' | 'TRANSPORT_FAILED' | 'READBACK_UNKNOWN' | 'UNSPECIFIED') =>
    deriveFirstPostOutcome({
      overallStatus: 'FAILED',
      receipts: { instagram: { channel: 'instagram' as OutcomeChannel, stage: 'FAILED', failureCause } },
    }).channels.instagram!

  it('READBACK_UNKNOWN은 재시도를 열지 않는다 (이미 올라갔을 수 있음)', () => {
    const c = failed('READBACK_UNKNOWN')
    expect(c.state).toBe('FAILED')
    expect(c.canRetry).toBe(false)
    expect(c.detail).toMatch(/중복/)
  })

  it('provider 거절·transport 실패는 재시도 가능하고 서로 다른 문구다', () => {
    const rejected = failed('PROVIDER_REJECTED')
    const transport = failed('TRANSPORT_FAILED')
    expect(rejected.canRetry).toBe(true)
    expect(transport.canRetry).toBe(true)
    expect(rejected.detail).not.toBe(transport.detail)
  })

  it('원인이 없으면 재시도 가능한 기본 문구', () => {
    expect(failed().canRetry).toBe(true)
  })

  it('원인 코드·영문 원문을 화면 문구로 내보내지 않는다', () => {
    for (const cause of ['PROVIDER_REJECTED', 'TRANSPORT_FAILED', 'READBACK_UNKNOWN', 'UNSPECIFIED'] as const) {
      expect(JSON.stringify(failed(cause))).not.toContain(cause)
    }
  })
})
