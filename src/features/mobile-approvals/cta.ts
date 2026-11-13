import type { MobileApprovalViewV2 } from './contracts'

export interface ApprovalCtaState {
  label: string
  disabled: boolean
  reason: string
}

/** 조회 전/실패는 실행 이전 상태다. 게이트 판정을 흉내내지 않는다. */
export type ApprovalCtaInput =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; view: MobileApprovalViewV2 | null; fallbackReason: string }

const LOCKED_LABEL = '소희가 실행 조건을 확인해요'

/**
 * M19 실행 CTA 상태(docs/mobile-r2/w6-approval-api-and-cta-contract.md §CTA).
 * 실행은 서버 게이트(v2)가 열려 있고 지문이 있을 때만 열린다.
 * 지금 서버는 v1 조회만 내려주고 실행 API 가 없으므로, 게이트가 열려도 누를 수 없다.
 */
export function resolveApprovalCta(input: ApprovalCtaInput): ApprovalCtaState {
  if (input.state === 'loading') {
    return { label: '확인 중이에요', disabled: true, reason: '전체 내용을 확인하고 있어요.' }
  }
  if (input.state === 'error') {
    return { label: '내용을 확인해 주세요', disabled: true, reason: '내용을 불러오지 못했어요. 다시 확인한 뒤 실행할 수 있어요.' }
  }
  if (!input.view) {
    return { label: LOCKED_LABEL, disabled: true, reason: input.fallbackReason }
  }
  if (!input.view.gate.enabled) {
    return { label: LOCKED_LABEL, disabled: true, reason: input.view.gate.userMessage }
  }
  // 게이트가 열려도 실행 API 가 아직 없다. 눌러서 성공한 척하지 않는다.
  return { label: '실행 기능 준비 중', disabled: true, reason: '실행 기능을 준비하고 있어요. 지금은 내용 검토만 할 수 있어요.' }
}
