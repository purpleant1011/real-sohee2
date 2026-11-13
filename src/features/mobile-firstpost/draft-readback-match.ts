import type { FirstPostMissionDraft } from '@/features/missions/conversational-first-post'

export interface ExpectedDraftReadback {
  missionId: string
  workspaceId: string
  copies: FirstPostMissionDraft['copies']
  selectedImageIds: string[]
  approvalFingerprint: string
  rights?: unknown
  boundVersions?: unknown
  channels?: unknown
  mediaPreviews?: unknown
  datasetMode?: unknown
  knowledgeSnapshot?: unknown
}

export interface DraftReadbackVerificationResult {
  matches: boolean
  mismatches: string[]
}

function areStringArraysEqual(a: readonly string[] | undefined, b: unknown): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (typeof a[i] !== 'string' || typeof b[i] !== 'string' || a[i] !== b[i]) return false
  }
  return true
}

/**
 * 서버에 저장/재조회된 초안이 사장님에게 제시된 expected 초안과 정확히 동일한지 엄격 검증한다 (ANI-1787).
 *
 * - 객체 키 삽입 순서 차이는 허용(의미적 동치).
 * - 공백/줄바꿈/CTA 불일치는 엄격 차단.
 * - 사진 IDs 순서 엄격 비교.
 * - 실제 원고 PII는 반환 메시지에 누설하지 않고 필드 경로명만 반환.
 */
export function verifyDraftReadback(
  expected: ExpectedDraftReadback,
  actual: unknown
): DraftReadbackVerificationResult {
  const mismatches: string[] = []

  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return { matches: false, mismatches: ['actual_not_object'] }
  }

  const act = actual as Record<string, any>

  if (act.missionId !== expected.missionId) {
    mismatches.push('missionId')
  }
  if (act.workspaceId !== expected.workspaceId) {
    mismatches.push('workspaceId')
  }
  if (act.approvalFingerprint !== expected.approvalFingerprint) {
    mismatches.push('approvalFingerprint')
  }

  if (!areStringArraysEqual(expected.selectedImageIds, act.selectedImageIds)) {
    mismatches.push('selectedImageIds')
  }

  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
    return value
  }
  for (const field of ['rights', 'boundVersions', 'channels', 'mediaPreviews', 'datasetMode', 'knowledgeSnapshot'] as const) {
    if (expected[field] !== undefined && JSON.stringify(stable(expected[field])) !== JSON.stringify(stable(act[field]))) mismatches.push(field)
  }

  const actCopies = act.copies
  if (!actCopies || typeof actCopies !== 'object' || Array.isArray(actCopies)) {
    mismatches.push('copies')
  } else {
    // 1. Instagram copies 검증
    const expIg = expected.copies.instagram
    const actIg = actCopies.instagram
    if (!actIg || typeof actIg !== 'object' || Array.isArray(actIg)) {
      mismatches.push('copies.instagram')
    } else {
      if (actIg.caption !== expIg.caption) {
        mismatches.push('copies.instagram.caption')
      }
      if (expIg.cta !== undefined || actIg.cta !== undefined) {
        if (actIg.cta !== expIg.cta) {
          mismatches.push('copies.instagram.cta')
        }
      }
      if (expIg.hashtags !== undefined || actIg.hashtags !== undefined) {
        if (!areStringArraysEqual(expIg.hashtags, actIg.hashtags)) {
          mismatches.push('copies.instagram.hashtags')
        }
      }
    }

    // 2. Threads copies 검증
    const expTh = expected.copies.threads
    const actTh = actCopies.threads
    if (!actTh || typeof actTh !== 'object' || Array.isArray(actTh)) {
      mismatches.push('copies.threads')
    } else {
      if (actTh.content !== expTh.content) {
        mismatches.push('copies.threads.content')
      }
      if (expTh.cta !== undefined || actTh.cta !== undefined) {
        if (actTh.cta !== expTh.cta) {
          mismatches.push('copies.threads.cta')
        }
      }
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  }
}
