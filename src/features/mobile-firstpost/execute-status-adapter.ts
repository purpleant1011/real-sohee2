/**
 * W6 실행 상태 → W4 표현 계층 매핑 (ANI-1704 정본 표).
 *
 * 정본: `docs/mobile-r2/w6-approval-api-and-cta-contract.md` 의
 * "W4 표현 계층 매핑" 표 (W6 브랜치 `claude/mobile-r2-w6-inbox-0cbfed`).
 *
 * 규칙:
 * - W4는 W6의 실행 상태를 다시 판정하지 않는다. 표에 적힌 변환만 수행한다.
 * - 원래 `ExecuteStatus`와 provider 원인/transport·readback 메타데이터는 DTO에 보존한다.
 * - permalink·verifiedAt 같은 readback 근거를 만들어내지 않는다. 없으면 없는 채로 넘긴다.
 *   (VERIFIED 표시는 실행별 독립 readback 증거가 있을 때만 `publish-outcome.ts`가 허용한다.)
 * - MANUAL_REQUIRED는 화면에서 FAILED로 표현되지만, 원인(provider 거절/transport 실패/readback 불명)은
 *   서로 다른 값으로 유지한다.
 */
import {
  EXECUTE_STATUSES,
  isExecuteStatus,
  isFailureCause,
  type ExecuteStatus,
  type ExecutionFailureCause,
  type ExecutionMeta,
  type ExecutionReceiptDto,
} from './execution-contract'
import type { OutcomeChannel, OutcomeReceipt, OutcomeStage } from './publish-outcome'

export type { ExecuteStatus, ExecutionFailureCause, ExecutionMeta, ExecutionReceiptDto }
export { EXECUTE_STATUSES }

/**
 * 정본 매핑 표. 키가 늘어나면 타입 검사가 실패하므로 표에서 빠진 상태가 생기지 않는다.
 *
 * W6 표의 표시 의미(CHECKING/VERIFIED/UNKNOWN/FAILED)는 W4의 `ChannelState`이고,
 * `OutcomeStage`는 그 표시 상태를 만들어내는 입력 단계다. REQUESTED와 PROVIDER_ACCEPTED는
 * 둘 다 "확인 중"으로 접히지만, 단계 자체는 접지 않고 보존한다(접수와 처리 중은 다른 사실이다).
 */
export const EXECUTE_STAGE_MAP: Readonly<Record<ExecuteStatus, OutcomeStage>> = Object.freeze({
  REQUESTED: 'REQUESTED',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  VERIFIED: 'EXTERNALLY_VERIFIED',
  RESULT_UNKNOWN: 'RESULT_UNKNOWN',
  MANUAL_REQUIRED: 'FAILED',
})

function isChannel(v: unknown): v is OutcomeChannel {
  return v === 'instagram' || v === 'threads'
}

function optString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string'
}

function metaOf(raw: Record<string, unknown>): ExecutionMeta | undefined {
  const src = raw.meta
  if (typeof src !== 'object' || src === null) return undefined
  const m = src as Record<string, unknown>
  const out: ExecutionMeta = {}
  const t = m.transport
  if (typeof t === 'object' && t !== null) {
    const tr = t as Record<string, unknown>
    const transport: ExecutionMeta['transport'] = {}
    if (typeof tr.attemptedAt === 'string') transport.attemptedAt = tr.attemptedAt
    if (typeof tr.responseStatus === 'number') transport.responseStatus = tr.responseStatus
    if (Object.keys(transport).length > 0) out.transport = transport
  }
  const r = m.readback
  if (typeof r === 'object' && r !== null) {
    const rb = r as Record<string, unknown>
    const readback: ExecutionMeta['readback'] = {}
    if (typeof rb.attemptedAt === 'string') readback.attemptedAt = rb.attemptedAt
    if (typeof rb.observedAt === 'string') readback.observedAt = rb.observedAt
    if (Object.keys(readback).length > 0) out.readback = readback
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 서버 DTO를 strict하게 읽는다. 하나라도 어긋나면 `null` — 부분 해석으로 성공을 만들지 않는다.
 * DTO 검증은 실행 허가가 아니며, 호출측은 이 값을 승인/실행 근거로 쓰지 않는다.
 *
 * 값의 종류만 검사하고 상태와 원인의 조합은 재판정하지 않는다. 계약상 `failureCause`는
 * MANUAL_REQUIRED에서만 의미가 있지만, 다른 상태에 실려 와도 값을 버리지 않고 보존하며
 * 표시 단계에서 무시한다(원본을 지우면 사후 진단이 불가능해진다).
 */
export function parseExecutionReceipt(raw: unknown): ExecutionReceiptDto | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!isChannel(r.channel) || !isExecuteStatus(r.status)) return null
  if (!optString(r.providerPostId) || !optString(r.permalink) || !optString(r.verifiedAt)) return null
  if (r.failureCause !== undefined && !isFailureCause(r.failureCause)) return null
  const dto: ExecutionReceiptDto = { channel: r.channel, status: r.status }
  if (r.providerPostId !== undefined) dto.providerPostId = r.providerPostId
  if (r.permalink !== undefined) dto.permalink = r.permalink
  if (r.verifiedAt !== undefined) dto.verifiedAt = r.verifiedAt
  if (r.failureCause !== undefined) dto.failureCause = r.failureCause
  const meta = metaOf(r)
  if (meta) dto.meta = meta
  return dto
}

/**
 * 실행 DTO → W4 영수증. 표에 있는 변환만 하고 근거는 만들지 않는다.
 * VERIFIED인데 permalink/verifiedAt이 없으면 단계는 EXTERNALLY_VERIFIED로 남지만,
 * `deriveFirstPostOutcome`이 CHECKING으로 내려 fail-closed 된다.
 */
export function toOutcomeReceipt(dto: ExecutionReceiptDto): OutcomeReceipt {
  const receipt: OutcomeReceipt = {
    channel: dto.channel,
    stage: EXECUTE_STAGE_MAP[dto.status],
    executeStatus: dto.status,
  }
  if (dto.providerPostId !== undefined) receipt.providerPostId = dto.providerPostId
  if (dto.permalink !== undefined) receipt.permalink = dto.permalink
  if (dto.verifiedAt !== undefined) receipt.verifiedAt = dto.verifiedAt
  if (dto.failureCause !== undefined) receipt.failureCause = dto.failureCause
  if (dto.meta !== undefined) receipt.meta = dto.meta
  return receipt
}

/** 배열 DTO를 채널 키 영수증 맵으로. 해석 실패한 항목은 조용히 버리지 않고 `invalid`에 남긴다. */
export function toOutcomeReceipts(raw: unknown): {
  receipts: Partial<Record<OutcomeChannel, OutcomeReceipt>>
  invalid: number
} {
  const receipts: Partial<Record<OutcomeChannel, OutcomeReceipt>> = {}
  if (!Array.isArray(raw)) return { receipts, invalid: raw === undefined || raw === null ? 0 : 1 }
  let invalid = 0
  for (const item of raw) {
    const dto = parseExecutionReceipt(item)
    if (!dto) {
      invalid += 1
      continue
    }
    receipts[dto.channel] = toOutcomeReceipt(dto)
  }
  return { receipts, invalid }
}
