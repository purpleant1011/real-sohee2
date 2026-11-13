import type { ExternalActionStatus, ExternalFailureCode } from './types'

export type ExternalActionStatusCopy = Readonly<{
  label: string
  detail: string
  nextAction: string
}>

export const externalActionStatusCopy: Readonly<Record<ExternalActionStatus, ExternalActionStatusCopy>> = {
  connection_required: { label: '연결이 필요해요', detail: '이 작업은 실행되지 않았어요.', nextAction: '채널 연결을 확인해 주세요.' },
  user_login_required: { label: '사용자 로그인이 필요해요', detail: '공식 로그인 화면에서 직접 인증해 주세요.', nextAction: '공식 로그인 열기' },
  ready: { label: '준비했어요', detail: '아직 실행되지 않았어요.', nextAction: '승인 값 확인' },
  prepared: { label: '준비했어요', detail: '정확한 대상과 버전을 확인한 뒤 실행할 수 있어요.', nextAction: '승인 값 확인' },
  approval_required: { label: '확인이 필요해요', detail: '정확한 값 승인이 아직 완료되지 않았어요.', nextAction: '승인 카드 열기' },
  executing: { label: '실행 중이에요', detail: '인증 요구나 화면 변경이 생기면 즉시 중단해요.', nextAction: '상태 확인' },
  submitted: { label: '제출됨', detail: '아직 반영 완료나 공개 확인을 의미하지 않아요.', nextAction: '결과 다시 확인' },
  provider_review: { label: '외부에서 검토 중이에요', detail: '외부 검토 결과를 기다리고 있어요.', nextAction: '결과 다시 확인' },
  succeeded: { label: '외부 결과를 확인했어요', detail: '대상과 승인 버전에 맞는 결과가 확인됐어요.', nextAction: '결과 보기' },
  failed: { label: '실행되지 않았어요', detail: '외부 제출 전에 안전하게 멈췄어요.', nextAction: '수동 마무리 열기' },
  manual_assist_required: { label: '수동 마무리가 필요해요', detail: '이 작업은 자동 게시 완료로 처리되지 않았어요.', nextAction: '공식 화면 열기' },
  unknown_result: { label: '결과 확인이 필요해요', detail: '중복 실행하지 마세요.', nextAction: '결과 확인 절차 보기' },
  reconfirmation_required: { label: '다시 확인이 필요해요', detail: '예약 시각에서 30분을 넘어 자동 게시하지 않았어요.', nextAction: '늦어진 게시 다시 확인' },
}

export const externalFailureRecoveryCopy: Readonly<Record<ExternalFailureCode, ExternalActionStatusCopy>> = {
  REAUTH_REQUIRED: { label: '재로그인이 필요해요', detail: '제출하지 않고 멈췄어요.', nextAction: '공식 로그인 열기' },
  CATEGORY_NOT_FOUND: { label: '카테고리를 찾지 못했어요', detail: '선택한 카테고리가 네이버 블로그에 없어요.', nextAction: '카테고리 다시 불러오기' },
  DRAFT_RECOVERY_PENDING: { label: '작성 중인 글이 있어요', detail: '임시저장 복구 화면에서 멈췄어요.', nextAction: '네이버에서 글 정리' },
  UI_DRIFT: { label: '화면이 변경됐어요', detail: '제출하지 않고 멈췄어요.', nextAction: '수동 마무리 열기' },
  TARGET_MISMATCH: { label: '대상이 일치하지 않아요', detail: '제출하지 않고 멈췄어요.', nextAction: '대상 다시 선택' },
  POLICY_RESTRICTION: { label: '정책 제한이 있어요', detail: '제출하지 않고 멈췄어요.', nextAction: '공식 안내 보기' },
  DOCUMENT_REQUIRED: { label: '서류가 필요해요', detail: '제출하지 않고 멈췄어요.', nextAction: '공식 경로 확인' },
  DUPLICATE_AMBIGUOUS: { label: '중복 여부를 확인해야 해요', detail: '중복 제출을 막기 위해 멈췄어요.', nextAction: '결과 확인 절차 보기' },
  UNKNOWN_RESULT: { label: '결과가 불분명해요', detail: '중복 실행하지 마세요.', nextAction: '결과 확인 절차 보기' },
  BROKER_UNAVAILABLE: { label: '감독형 실행을 사용할 수 없어요', detail: '이 작업은 실행되지 않았어요. 사용한 실행 크레딧은 반환해요.', nextAction: '수동 마무리 열기' },
  CONTENT_MISMATCH: { label: '승인 내용과 편집기가 달라요', detail: '제출하지 않고 멈췄어요.', nextAction: '차이 확인' },
  MEDIA_DOWNLOAD_FAILED: { label: '이미지를 준비하지 못했어요', detail: '제출하지 않고 멈췄어요.', nextAction: '이미지 다시 확인' },
  MEDIA_UPLOAD_FAILED: { label: '이미지를 올리지 못했어요', detail: '제출하지 않고 멈췄어요.', nextAction: '이미지 다시 확인' },
  DEADLINE_EXPIRED: { label: '예약 게시 확인이 필요해요', detail: '예약 시각에서 30분을 넘어 자동 게시하지 않았어요.', nextAction: '늦어진 게시 다시 확인' },
  DEVICE_OFFLINE: { label: '연결 기기가 오프라인이에요', detail: '게시 작업은 실행되지 않았어요.', nextAction: 'Chrome 연결 확인' },
  SUBMIT_PERMIT_REQUIRED: { label: '제출 권한을 확인하지 못했어요', detail: '게시 버튼을 누르기 전에 안전하게 멈췄어요.', nextAction: '실행 상태 다시 확인' },
}
