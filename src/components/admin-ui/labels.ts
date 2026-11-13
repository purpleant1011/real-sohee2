/**
 * Operator-facing Korean labels for internal codes. Pages must never render raw enums, UUIDs or table names.
 * Unknown codes fall back to a neutral Korean label instead of the code itself.
 */

const CHANNEL_LABELS: Record<string, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈프로필',
  facebook: '페이스북',
  kakao: '카카오',
}

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return '채널 미정'
  return CHANNEL_LABELS[channel] ?? '기타 채널'
}

const PUBLISH_STATE_LABELS: Record<string, string> = {
  success: '게시 완료',
  published: '게시 완료',
  pending: '대기 중',
  queued: '대기 중',
  publishing: '게시 중',
  failure: '실패',
  failed: '실패',
  unknown: '확인 필요',
}

export function publishStateLabel(state: string | null | undefined, channel?: string | null): string {
  if (channel === 'naver_blog' && (state === 'pending' || state === 'queued' || state === 'publishing' || state === 'unknown' || state === 'in_progress')) {
    return '정책으로 중단됨 — 네이버에는 자동으로 올리지 않아요. 원고는 보관돼 있으니 복사해서 직접 올려 주세요.'
  }
  if (!state) return '확인 필요'
  return PUBLISH_STATE_LABELS[state] ?? '확인 필요'
}

const CONNECTION_LABELS: Record<string, string> = {
  connected: '연결됨',
  active: '연결됨',
  verified: '연결됨',
  expired: '재연결 필요',
  revoked: '연결 해제됨',
  disconnected: '연결 해제됨',
  not_connected: '미연결',
  pending: '연결 중',
  error: '오류',
}

export function connectionLabel(status: string | null | undefined): string {
  if (!status) return '미연결'
  return CONNECTION_LABELS[status.toLowerCase()] ?? '확인 필요'
}

const MEMBER_STATUS_LABELS: Record<string, string> = {
  formal: '정회원',
  applicant: '가입자(미인증)',
}

export function memberStatusLabel(status: string | null | undefined): string {
  if (!status) return '확인 필요'
  return MEMBER_STATUS_LABELS[status.toLowerCase()] ?? '확인 필요'
}

const LIFECYCLE_LABELS: Record<string, string> = {
  applied: '가입 신청',
  information_pending: '정보 입력 대기',
  contract_review: '계약 검토',
  consent_pending: '동의 대기',
  channel_pending: '채널 연결 대기',
  payment_pending: '결제 대기',
  ready_for_activation: '활성화 준비',
  active: '운영 중',
  paused: '일시 중지',
  terminated: '해지',
  trial: '체험 중',
}

export function lifecycleLabel(status: string | null | undefined): string {
  if (!status) return '상태 미확인'
  return LIFECYCLE_LABELS[status] ?? '상태 미확인'
}

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** "2026. 10. 08. 11:57" in KST; null or invalid input renders as "-". */
export function formatKst(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? KST.format(date) : '-'
}

/** Relative "3분 전" style for recent activity; falls back to the KST date after 7 days. */
export function formatRelativeKst(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}일 전`
  return formatKst(date)
}

export function formatCount(value: number | null | undefined, unit = '건'): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}${unit}` : '확인할 수 없어요'
}

export function formatKrw(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}원` : '확인할 수 없어요'
}

const PLAN_LABELS: Record<string, string> = {
  free_taste: '무료 체험',
  starter: '스타터',
  growth: '그로스',
  growth_plus: '그로스 플러스',
  scale: '스케일',
}

/** Plan codes arrive in either case ("starter", "GROWTH_PLUS"); null means no active entitlement. */
export function planLabel(code: string | null | undefined): string {
  if (!code) return '요금제 미지정'
  return PLAN_LABELS[code.toLowerCase()] ?? '기타 요금제'
}

const WORKSPACE_KIND_LABELS: Record<string, string> = {
  pilot: '파일럿',
  production: '운영',
  demo: '데모',
  integration: '연동 시험',
}

export function workspaceKindLabel(kind: string | null | undefined): string {
  if (!kind) return '구분 미확인'
  return WORKSPACE_KIND_LABELS[kind] ?? '구분 미확인'
}

/** Short support reference (first 8 chars) so ids are never shown in full. */
export function referenceCode(id: string | null | undefined): string {
  return id ? id.replace(/-/g, '').slice(0, 8) : '-'
}

const CREDIT_KIND_LABELS: Record<string, string> = {
  grant: '지급',
  consume: '소모',
  expire: '만료',
  refund: '환불',
  reserve: '예약',
  release: '예약 해제',
  adjust: '조정',
  manual_adjust: '수기 조정',
  weekly_grant: '정기 지급',
  signup_bonus: '가입 보너스',
}

export function creditKindLabel(kind: string | null | undefined): string {
  if (!kind) return '기타'
  return CREDIT_KIND_LABELS[kind.toLowerCase()] ?? '기타'
}

const PAYMENT_STATE_LABELS: Record<string, string> = {
  draft: '결제 준비',
  provider_pending: '결제 대기',
  provider_succeeded: '결제 완료',
  activation_succeeded: '구독 활성화',
  failed: '결제 실패',
  cancelled: '결제 취소',
}

export function paymentStateLabel(state: string | null | undefined): string {
  if (!state) return '결제 상태 미확인'
  return PAYMENT_STATE_LABELS[state.toLowerCase()] ?? '결제 상태 미확인'
}

const CONTENT_STATUS_LABELS: Record<string, string> = {
  draft: '초안 작성 중',
  review: '검토 중',
  pending_approval: '승인 대기',
  approved: '승인 완료',
  rejected: '반려됨',
  scheduled: '예약됨',
  publishing: '발행 중',
  published: '발행 완료',
  failed: '발행 실패',
  archived: '보관됨',
}

export function contentStatusLabel(status: string | null | undefined): string {
  if (!status) return '상태 미확인'
  return CONTENT_STATUS_LABELS[status.toLowerCase()] ?? status
}

const ACTION_KIND_LABELS: Record<string, string> = {
  publish: '발행',
  post: '게시',
  update: '수정',
  delete: '삭제',
  sync: '동기화',
}

export function actionKindLabel(kind: string | null | undefined): string {
  if (!kind) return '작업 미정'
  return ACTION_KIND_LABELS[kind.toLowerCase()] ?? kind
}

const RECEIPT_KIND_LABELS: Record<string, string> = {
  publish: '게시 접수',
  delivery: '전달 확인',
  feedback: '반응 수집',
  reconciliation: '대사 확인',
}

export function receiptKindLabel(kind: string | null | undefined): string {
  if (!kind) return '영수증'
  return RECEIPT_KIND_LABELS[kind.toLowerCase()] ?? kind
}

/** Remove only a trailing parenthetical English translation; preserve the stored mission goal. */
export function missionGoalLabel(goal: string | null | undefined): string {
  if (!goal) return '목표 미지정'
  return goal.replace(/\s*\([A-Za-z][A-Za-z\s,\-/]*\)\s*$/u, '').trim() || '목표 미지정'
}

const MISSION_STATUS_LABELS: Record<string, string> = {
  received: '접수됨',
  planning: '계획 중',
  producing: '제작 중',
  awaiting_approval: '승인 대기',
  approved: '승인됨',
  executing: '실행 중',
  published_verified: '발행 확인됨',
  listening: '반응 감지 중',
  customer_engaged: '고객 인입',
  booking_intent: '예약 의도 확인',
  booked: '예약 완료',
  outcome_observed: '성과 관측됨',
  learning: '학습 중',
  next_action_ready: '다음 작업 대기',
  completed: '완료됨',
  blocked: '차단됨',
  failed: '실패',
  failure: '실패',
  result_unknown: '확인 필요',
  paused: '일시 중지',
  cancelled: '취소됨',
  canceled: '취소됨',
  active: '진행 중',
  running: '실행 중',
  pending: '대기 중',
  observed: '관측됨',
  not_observed: '미관측',
}

export function missionStatusLabel(status: string | null | undefined): string {
  if (!status) return '상태 미확인'
  return MISSION_STATUS_LABELS[status.toLowerCase()] ?? '확인 필요'
}

const SOURCE_LABELS: Record<string, string> = {
  business_verifications: '사업자 인증 신청서',
  signup_applications: '회원가입 신청서',
  business_profiles: '매장 프로필',
  channel_connections: '채널 연동',
  workspace_business_details: '사장님 자가 입력 (미검증)',
}

export function sourceToKorean(source?: string | null): string {
  if (!source) return '미등록'
  return SOURCE_LABELS[source] ?? '미등록'
}


const FACT_KIND_LABELS: Record<string, string> = {
  observed: '실제 관측',
  user_claim: '고객 진술',
  inference: '추론',
  calculated: '계산한 값',
  estimated: '추정됨',
  declared: '선언됨',
  unknown: '미확인',
}

export function factKindLabel(kind: string | null | undefined): string {
  if (!kind) return '전체 사실 유형'
  return FACT_KIND_LABELS[kind.toLowerCase()] ?? '기타'
}

const AUDIT_RESULT_LABELS: Record<string, string> = {
  succeeded: '성공',
  success: '성공',
  failed: '실패',
  failure: '실패',
  denied: '거부됨',
}

export function auditResultLabel(result: string | null | undefined): string {
  if (!result) return '전체 결과'
  return AUDIT_RESULT_LABELS[result.toLowerCase()] ?? '기타'
}


const ADMIN_STATUS_LABELS: Record<string, string> = {
  active: '사용 중', invited: '초대됨', suspended: '정지됨', disabled: '비활성', revoked: '권한 회수됨',
}
export function adminStatusLabel(status: string | null | undefined): string {
  if (!status) return '상태 미확인'
  return ADMIN_STATUS_LABELS[status.toLowerCase()] ?? '확인 필요'
}

const ADMIN_ROLE_LABELS: Record<string, string> = {
  platform_owner: '플랫폼 오너', operations_admin: '운영 관리자', billing_admin: '결제 관리자',
  content_operator: '콘텐츠 운영자', customer_support: '고객 지원', audit_viewer: '감사 조회자', system_admin: '시스템 관리자',
}
export function adminRoleLabel(role: string | null | undefined): string {
  if (!role) return '역할 미지정'
  return ADMIN_ROLE_LABELS[role.toLowerCase()] ?? '기타 역할'
}

const ACTION_TOKEN_LABELS: Record<string, string> = {
  account: '계정', activated: '활성화', activate: '활성화', created: '생성', create: '생성', updated: '수정', update: '수정',
  deleted: '삭제', delete: '삭제', approved: '승인', approve: '승인', rejected: '반려', reject: '반려', requested: '요청', request: '요청',
  published: '게시', publish: '게시', failed: '실패', connected: '연결', disconnected: '연결 해제', login: '로그인', logout: '로그아웃',
  signup: '가입', workspace: '고객사', admin: '관리자', credit: '크레딧', grant: '지급', adjust: '조정', adjustment: '조정',
  vault: '보관함', purge: '파기', payment: '결제', verify: '확인', verified: '확인', invite: '초대', invited: '초대', role: '역할',
  channel: '채널', retry: '재시도', reconcile: '대사', export: '내보내기', lifecycle: '진행 단계', support: '지원', session: '세션',
  incident: '장애', intervention: '긴급 개입', agreement: '약관 동의', business: '사업자', review: '심사', mfa: '추가 인증',
}
/** "workspace.lifecycle.activated" → "고객사 진행 단계 활성화"; unknown tokens are dropped, never shown raw. */
export function auditActionLabel(action: string | null | undefined): string {
  if (!action) return '운영 작업'
  const words = action.toLowerCase().split(/[._\-:\s]+/).map((t) => ACTION_TOKEN_LABELS[t]).filter(Boolean)
  return words.length ? [...new Set(words)].join(' ') : '운영 작업'
}

const CREDIT_ACTION_LABELS: Record<string, string> = {
  text_generation: '글 생성 사용', image_generation: '이미지 생성 사용', chat_turn: '대화 사용', settle: '사용량 정산',
  allowance: '주간 기본 지급', weekly_allowance: '주간 기본 지급', signup: '가입 보너스', starter: '스타터 지급',
  free_taste: '무료 체험 지급', manual_adjust: '수기 조정', refund: '환불', expire: '만료', reset_pass: '주간 리셋',
}
export function creditActionLabel(action: string | null | undefined): string {
  if (!action) return '-'
  return CREDIT_ACTION_LABELS[action.toLowerCase()] ?? auditActionLabel(action)
}
