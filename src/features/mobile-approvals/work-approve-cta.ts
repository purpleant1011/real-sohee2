import type { ApprovalPreviewSnapshot } from '@/features/content/types'

/**
 * M07 게시 전 최종 확인 — 고정 CTA 판정 (ANI-1680 계약의 실라우트판).
 *
 * 정본: `docs/mobile-r2/01-onboarding-creative-chat.md` §M07,
 *       `src/features/mobile-firstpost/approval-review.ts`(같은 fail-closed 규칙)
 *
 * 이 판정이 지키는 경계:
 * - 승인 가능 여부는 **서버 스냅샷**만 본다. 화면에서 지문을 다시 계산하지 않는다.
 * - 확인되지 않은 것은 열지 않는다(fail-closed). 사유가 없으면 CTA 도 없다.
 * - 승인은 기록만 남긴다. 메타 채널의 승인된 동일 버전은 별도의 명시적 게시 요청을 허용한다.
 * - 게시 요청도 기존 서버의 권한·지문·연결·중복 실행 검증을 다시 거치며, 네이버는 수동 게시를 유지한다.
 */
export interface WorkApproveCtaState {
  label: string
  disabled: boolean
  reason: string
  action: 'approve' | 'publish'
}

export type WorkApproveCtaInput =
  | { state: 'loading' }
  | { state: 'error' }
  | {
      state: 'ready'
      snapshot: ApprovalPreviewSnapshot
      /** 소유자·관리자만 승인할 수 있다. */
      canApprove: boolean
      hasPlaceholders?: boolean
      hasInfoRequest?: boolean
    }

const LOCKED_LABEL = '승인 준비 확인 필요'

export function resolveWorkApproveCta(input: WorkApproveCtaInput): WorkApproveCtaState {
  if (input.state === 'loading') {
    return { label: '확인 중이에요', disabled: true, reason: '게시 전 확인 항목을 불러오고 있어요.', action: 'approve' }
  }
  if (input.state === 'error') {
    return {
      label: '내용을 확인해 주세요',
      disabled: true,
      reason: '게시 전 확인 항목을 불러오지 못했어요. 다시 확인한 뒤 승인할 수 있어요.',
      action: 'approve',
    }
  }

  const { snapshot, canApprove, hasPlaceholders = false, hasInfoRequest = false } = input
  if (!canApprove) {
    return { label: LOCKED_LABEL, disabled: true, reason: '승인 권한이 없어요. 소유자나 관리자에게 확인해 주세요.', action: 'approve' }
  }
  // 서버가 확인한 문제가 하나라도 있으면 사유 그대로 막는다(추측 금지).
  if (snapshot.issues.length > 0) {
    return { label: LOCKED_LABEL, disabled: true, reason: snapshot.issues[0]!.message, action: 'approve' }
  }
  if (snapshot.account.status !== 'connected') {
    return { label: LOCKED_LABEL, disabled: true, reason: '게시 대상 계정 연결을 먼저 확인해야 해요.', action: 'approve' }
  }

  const isApproved = snapshot.approval.status === 'approved' && snapshot.approval.fingerprint === snapshot.fingerprint
  const isNaverBlog = snapshot.channel === 'naver_blog'

  if (isApproved) {
    if (isNaverBlog) {
      return {
        label: '승인됨',
        disabled: true,
        reason: '이 버전은 이미 승인됐어요. 이제 복사·사진 저장 후 네이버에서 직접 게시해 주세요.',
        action: 'approve',
      }
    }

    // Meta 채널 (Instagram / Threads): 이미 승인된 원고는 실제 게시 요청(publish_now) 단계로 진입
    if (hasInfoRequest || hasPlaceholders) {
      return {
        label: '지금 게시 요청',
        disabled: true,
        reason: hasInfoRequest
          ? '소희의 정보 요청이 포함된 원고는 실제 게시할 수 없어요. 이벤트 정보를 입력하고 다시 생성해 주세요.'
          : '채워지지 않은 빈칸이 있어 실제 게시할 수 없어요. 내용을 먼저 채워 주세요.',
        action: 'publish',
      }
    }

    return {
      label: '지금 게시 요청',
      disabled: false,
      reason: '대상 계정과 본문·이미지를 확인한 뒤 실제 게시를 요청합니다.',
      action: 'publish',
    }
  }

  return {
    label: isNaverBlog ? '이 원고로 게시 준비 승인' : '승인',
    disabled: false,
    // 승인은 게시가 아니다. 누른 뒤 무엇이 일어나는지 먼저 말한다.
    reason: '승인해도 바로 게시되지 않아요. 게시는 다음 단계에서 확인해요.',
    action: 'approve',
  }
}
