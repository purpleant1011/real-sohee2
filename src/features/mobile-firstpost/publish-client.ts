/**
 * M08 게시 응답 → 결과 화면 입력 (ANI-1765).
 *
 * `POST /api/missions/first-post/publish` 응답의 `executionResult` 를 strict 하게 읽어
 * `OutcomeInput` 으로 옮긴다. 상태를 새로 만들거나 올리지 않는다.
 * - 모양이 어긋나면 `null`. 호출 측은 이를 '알 수 없음'으로 보여야 하며 성공으로 보지 않는다.
 * - 저장 실패(`RECONCILIATION_REQUIRED`)는 결과는 보존하되 `reconciliationRequired` 로 알린다.
 * - HTTP 오류·네트워크 실패는 '게시되지 않음'이 아니다. 이미 올라갔을 수 있으므로 호출 측은
 *   재게시를 열지 않고 결과 새로고침으로 안내한다(중복 게시 방지).
 * - 이 모듈은 어떤 화면에서도 자동 호출하지 않는다. 실제 게시는 사용자 승인 경로에서만 호출한다.
 */
import type { OutcomeChannel, OutcomeInput, OutcomeReceipt, OutcomeStage } from './publish-outcome'

const STAGES: readonly OutcomeStage[] = [
  'REQUESTED', 'EXECUTING', 'PROVIDER_ACCEPTED', 'EXTERNALLY_VERIFIED', 'OUTCOME_OBSERVED', 'FAILED', 'RESULT_UNKNOWN',
]
const OVERALL: readonly OutcomeInput['overallStatus'][] = ['ALL_VERIFIED', 'PARTIAL_SUCCESS', 'FAILED']
const CHANNELS: readonly OutcomeChannel[] = ['instagram', 'threads']

function optString(v: unknown): string | undefined | null {
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : null
}

/** 서버 `executionResult` → `OutcomeInput`. 어긋나면 null. */
export function parseExecutionResult(raw: unknown): OutcomeInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!OVERALL.includes(r.overallStatus as OutcomeInput['overallStatus'])) return null
  if (typeof r.receipts !== 'object' || r.receipts === null) return null

  const receipts: OutcomeInput['receipts'] = {}
  for (const channel of CHANNELS) {
    const item = (r.receipts as Record<string, unknown>)[channel]
    if (item === undefined) continue
    if (typeof item !== 'object' || item === null) return null
    const i = item as Record<string, unknown>
    if (!STAGES.includes(i.stage as OutcomeStage)) return null
    const providerPostId = optString(i.providerPostId)
    const permalink = optString(i.permalink)
    const verifiedAt = optString(i.verifiedAt)
    const errorMessage = optString(i.errorMessage)
    if (providerPostId === null || permalink === null || verifiedAt === null || errorMessage === null) return null
    const receipt: OutcomeReceipt = { channel, stage: i.stage as OutcomeStage }
    if (providerPostId !== undefined) receipt.providerPostId = providerPostId
    if (permalink !== undefined) receipt.permalink = permalink
    if (verifiedAt !== undefined) receipt.verifiedAt = verifiedAt
    if (errorMessage !== undefined) receipt.errorMessage = errorMessage
    receipts[channel] = receipt
  }
  return { overallStatus: r.overallStatus as OutcomeInput['overallStatus'], receipts }
}

export type PublishCommandResult =
  | { kind: 'RESULT'; outcome: OutcomeInput; reconciliationRequired: boolean }
  /** 응답을 읽지 못했거나 서버가 결과를 주지 않았다. 게시 여부를 알 수 없다. */
  | { kind: 'UNKNOWN'; status: number | null }

export function createPublishCommand(options: { missionId: string; workspaceId?: string; fetchImpl?: typeof fetch; endpoint?: string }) {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  return async function publish(): Promise<PublishCommandResult> {
    let response: Response
    try {
      response = await doFetch(options.endpoint ?? '/api/missions/first-post/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.workspaceId ? { 'x-workspace-id': options.workspaceId } : {}),
        },
        body: JSON.stringify({ missionId: options.missionId }),
      })
    } catch {
      return { kind: 'UNKNOWN', status: null }
    }
    const body: { executionResult?: unknown; code?: unknown } = await response.json().catch(() => ({}))
    const outcome = parseExecutionResult(body.executionResult)
    if (!outcome) return { kind: 'UNKNOWN', status: response.status }
    return { kind: 'RESULT', outcome, reconciliationRequired: body.code === 'RECONCILIATION_REQUIRED' }
  }
}
