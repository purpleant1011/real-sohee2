/**
 * M07 승인 요청 → 서버 승인 명령 (ANI-1765).
 *
 * `POST /api/missions/first-post/approve` 에 승인 스냅샷을 그대로 전달한다.
 * - 서버 지문은 화면에서 다시 계산하지 않고 `ApprovalSubmission.serverFingerprint` 를 보낸다.
 * - 2xx + `success: true` 가 아니면 던진다(화면은 '게시된 것 없음' 안내). 서버 코드는 사용자 문구와 분리한다.
 * - 승인 성공은 게시가 아니다. 이 함수는 게시 API 를 호출하지 않는다.
 * - fetch 는 주입한다(테스트·오프라인 처리).
 */
import type { ApprovalSubmission } from './approval-review'

export class ApprovalRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    /** 서버가 준 사용자용 문구. 없으면 null — 화면이 기본 문구를 쓴다. */
    readonly userMessage: string | null,
  ) {
    super(`approval request failed: ${status}${code ? ` ${code}` : ''}`)
    this.name = 'ApprovalRequestError'
  }
}

export interface ApprovalCommandOptions {
  missionId: string
  workspaceId?: string
  fetchImpl?: typeof fetch
  endpoint?: string
}

export const APPROVE_ENDPOINT = '/api/missions/first-post/approve'

export function createApprovalCommand(options: ApprovalCommandOptions) {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  return async function submitApproval(request: ApprovalSubmission): Promise<{ success: true }> {
    const response = await doFetch(options.endpoint ?? APPROVE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.workspaceId ? { 'x-workspace-id': options.workspaceId } : {}),
      },
      body: JSON.stringify({
        missionId: options.missionId,
        fingerprint: request.serverFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: request.explicitPhrase,
      }),
    })
    const body: { success?: unknown; code?: unknown; error?: unknown } = await response.json().catch(() => ({}))
    if (!response.ok || body.success !== true) {
      throw new ApprovalRequestError(
        response.status,
        typeof body.code === 'string' ? body.code : null,
        typeof body.error === 'string' ? body.error : null,
      )
    }
    return { success: true }
  }
}
