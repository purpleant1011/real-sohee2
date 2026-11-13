/** 승인 CTA 단일 요청 보장 + 승인 지문 stale 판정 (ANI-1680, M07). */
export const APPROVAL_PHRASE = '이 버전 승인하고 발행'

export function createSingleFlight<T>(fn: () => Promise<T>) {
  let inflight: Promise<T> | null = null
  return {
    run(): Promise<T> {
      if (!inflight) inflight = fn().finally(() => { inflight = null })
      return inflight
    },
    get busy() { return inflight !== null },
  }
}

export function isApprovalStale(p: { approvedFingerprint: string | null; currentFingerprint: string }): boolean {
  return !p.approvedFingerprint || p.approvedFingerprint !== p.currentFingerprint
}
