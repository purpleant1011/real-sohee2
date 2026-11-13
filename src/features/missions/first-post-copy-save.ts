import {
  reviseFirstPostMissionDraft,
  type FirstPostMissionDraft,
} from './conversational-first-post'

export type PrepareCopySaveErrorCode = 'STALE_APPROVAL' | 'INVALID_COPY'

export type PrepareCopySaveResult =
  | { ok: true; revisedDraft: FirstPostMissionDraft }
  | { ok: false; code: PrepareCopySaveErrorCode; message: string }

export interface PrepareFirstPostCopySaveParams {
  draft: FirstPostMissionDraft
  expectedFingerprint: string
  copies: FirstPostMissionDraft['copies']
}

/**
 * 첫 포스팅 초안의 사용자 직접 문구 수정 저장 준비 (ANI-1787).
 *
 * 주의: 기존 `/api/missions/first-post/revise` 엔드포인트는 LLM 자연어 피드백(`feedbackUtterance`)
 * 기반의 재생성 로직이므로, 사용자가 화면에서 직접 타이핑한 정확한 문구를 있는 그대로
 * 영속화하는 목적과 분리되어야 합니다.
 *
 * 이 함수는:
 * 1. 클라이언트가 보고 있던 지문(`expectedFingerprint`)과 초안의 지문을 대조해 stale 여부를 검증합니다.
 * 2. 인스타그램 `caption`, 스레드 `content`가 문자열인지 검증합니다.
 * 3. 사용자의 원문(공백, 개행, 들여쓰기, CTA)을 절대 trim하거나 LLM 재생성하지 않고 100% 보존합니다.
 * 4. 기존 권위 로직인 `reviseFirstPostMissionDraft`(`newCopies`)를 호출하여 원본 draft 불변,
 *    사진/채널/권리 메타데이터 보존, 승인 지문 재계산(`calculateApprovalFingerprint`)을 수행합니다.
 */
export function prepareFirstPostCopySave(
  params: PrepareFirstPostCopySaveParams
): PrepareCopySaveResult {
  const { draft, expectedFingerprint, copies } = params

  // 1. Stale fingerprint check
  if (!draft.approvalFingerprint || draft.approvalFingerprint !== expectedFingerprint) {
    return {
      ok: false,
      code: 'STALE_APPROVAL',
      message: '초안이 다른 곳에서 수정되었거나 최신 버전이 아닙니다. 최신 초안을 다시 불러와 주세요.',
    }
  }

  // 2. Validate copy structure
  if (!copies || typeof copies !== 'object') {
    return {
      ok: false,
      code: 'INVALID_COPY',
      message: '수정할 문구 형태가 올바르지 않습니다.',
    }
  }

  if (typeof copies.instagram?.caption !== 'string') {
    return {
      ok: false,
      code: 'INVALID_COPY',
      message: '인스타그램 본문(caption)은 문자열이어야 합니다.',
    }
  }

  if (typeof copies.threads?.content !== 'string') {
    return {
      ok: false,
      code: 'INVALID_COPY',
      message: '스레드 본문(content)은 문자열이어야 합니다.',
    }
  }

  // 3. Delegate to canonical reviseFirstPostMissionDraft with exact copies (TEXT_ONLY, no feedbackUtterance)
  // 원문 공백/줄바꿈/CTA를 trim/변형하지 않고 copies 객체 그대로 전달
  const { revisedDraft } = reviseFirstPostMissionDraft({
    draft,
    revisionType: 'TEXT_ONLY',
    feedbackUtterance: '',
    newCopies: copies,
  })

  return {
    ok: true,
    revisedDraft,
  }
}
