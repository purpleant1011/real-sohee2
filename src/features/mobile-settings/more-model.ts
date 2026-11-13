import type { LoadState } from '@/features/mobile-decision/contracts'
import type { AuthFailure } from '@/features/mobile-shell/auth-failure'

export type MoreSectionId = 'store' | 'channels' | 'automation' | 'notifications' | 'billing' | 'security'
export type SectionStatus = 'ok' | 'attention' | 'unknown' | 'checked' | 'inactive'

/** 더보기 순서는 고정: 가게 → 연결 → 자동화 → 알림 → 요금 → 보안. */
export const MORE_SECTION_ORDER: MoreSectionId[] = ['store', 'channels', 'automation', 'notifications', 'billing', 'security']
export const MORE_SECTION_LABEL: Record<MoreSectionId, string> = {
  store: '가게 정보', channels: '채널 연결', automation: '자동 업무', notifications: '알림', billing: '이용 요금', security: '보안·개인정보',
}
export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = { ok: '정상', attention: '확인 필요', unknown: '확인 중', checked: '확인됨', inactive: '중지됨' }

/**
 * 섹션 → 실제 하위 화면. 앱 안에 그 화면이 이미 있는 섹션만 적는다.
 * 보안·개인정보는 /app 안에 요청 화면이 아직 없어 비워 둔다 — 누르면 아무 일도 없는 버튼을 만들지 않는다.
 */
export const MORE_SECTION_HREF: Partial<Record<MoreSectionId, string>> = {
  store: '/app/settings/business',
  channels: '/app/channels',
  automation: '/app/account/automation',
  notifications: '/app/notifications',
  billing: '/app/account/billing',
}

export interface MoreSectionDto { id: MoreSectionId; status: SectionStatus; summary: string | null; checkedAt?: string }

/** 서버가 준 섹션을 고정 순서로 정렬한다. 빠진 섹션은 '확인하지 못함' 으로 채워 숨기지 않는다. */
export function orderedSections(sections: MoreSectionDto[]): MoreSectionDto[] {
  return MORE_SECTION_ORDER.map(id => sections.find(s => s.id === id) ?? { id, status: 'unknown' as const, summary: null })
}

export interface WorkspaceOption { id: string; name: string; role: 'owner' | 'manager' | 'reviewer' }

/** 가게별 데이터는 모두 workspaceId 를 달고 온다. 현재 가게 것만 통과시킨다(전환 시 섞임 0). */
export function scopedTo<T extends { workspaceId: string }>(items: T[], workspaceId: string): T[] {
  return items.filter(i => i.workspaceId === workspaceId)
}

/** 캐시 키는 항상 가게 id 를 앞에 붙인다. 가게를 바꾸면 이전 가게 키는 읽히지 않는다. */
export function scopedKey(workspaceId: string, key: string): string {
  return `${workspaceId}::${key}`
}
export function dropForeignKeys<V>(cache: Record<string, V>, workspaceId: string): Record<string, V> {
  const prefix = `${workspaceId}::`
  return Object.fromEntries(Object.entries(cache).filter(([k]) => k.startsWith(prefix)))
}

export type PrivacyKind = 'export' | 'withdraw'
export type PrivacyRequestState = 'none' | 'requested' | 'processing' | 'ready' | 'failed' | 'unknown'
export const PRIVACY_STATE_LABEL: Record<PrivacyRequestState, string> = {
  none: '요청한 적 없어요', requested: '요청이 접수됐어요', processing: '처리 중이에요', ready: '준비됐어요', failed: '처리하지 못했어요', unknown: '진행 상태를 확인하지 못했어요',
}

/** 민감 작업은 최근 본인 확인(분 단위)이 있어야 한다. 확인 시각이 없거나 이상하면 재확인(fail-closed). */
export function needsReauth(lastVerifiedAt: string | null, now: Date, maxMinutes = 10): boolean {
  if (!lastVerifiedAt) return true
  const t = Date.parse(lastVerifiedAt)
  return Number.isNaN(t) || now.getTime() - t > maxMinutes * 60_000
}

export type PrivacyAction = 'reauth' | 'request' | 'disabled'
/** 진행 중인 요청이 있으면 다시 누를 수 없다(중복 요청 방지). */
export function privacyAction(state: PrivacyRequestState, reauthNeeded: boolean): PrivacyAction {
  if (state === 'requested' || state === 'processing') return 'disabled'
  return reauthNeeded ? 'reauth' : 'request'
}

export interface MoreViewSnapshot {
  loadState: LoadState
  workspaceId: string
  workspaces: WorkspaceOption[]
  sections: MoreSectionDto[]
  privacy: Record<PrivacyKind, PrivacyRequestState>
  lastReauthAt: string | null
  now: string
  checkedAt: string | null
  /**
   * 서버가 인증(401)·권한(403)을 거부한 경우(ANI-1714). '다시 확인'으로 풀리는 실패가 아니므로
   * 일반 조회 실패(error)와 구분해 보여준다. 401 이면 '로그인 만료', 403 이면 '권한 없음'이다.
   */
  authFailure?: AuthFailure
}

export type MoreGroupId = 'store' | 'channels' | 'billing' | 'account' | 'help'

export const MORE_GROUP_LABEL: Record<MoreGroupId, string> = {
  store: '우리 가게',
  channels: '연결',
  billing: '요금·결제',
  account: '알림·계정',
  help: '도움',
}
export const MORE_GROUP_ORDER: MoreGroupId[] = ['store', 'channels', 'billing', 'account', 'help']

export interface MoreMenuItem {
  id: string
  label: string
  href: string
  groupId: MoreGroupId
  icon: string
  sectionId?: MoreSectionId
}

/**
 * 더보기 메뉴 그룹 재편 (S2-W4):
 * [우리 가게] 가게 정보·사진/말투 / [연결] 채널 연결 / [요금·결제] 이용 요금·결제 내역 / [알림·계정] 알림 설정·내 정보·개인정보 / [도움] 도움말·문의하기·약관·개인정보처리방침.
 * 그룹 제목 1줄, 항목은 아이콘+한 줄 이름(+선택적 상태 StatusPill). 항목 설명 문장 제거.
 * 이미 존재하는 라우트만 연결하고 없는 것은 항목을 만들지 않는다(도움말만 신설).
 */
export const MORE_MENU_ITEMS: ReadonlyArray<MoreMenuItem> = [
  // [우리 가게] 가게 정보·사진/말투·이미지 스타일
  { id: 'store-info', label: '가게 정보', href: '/app/settings/business', groupId: 'store', icon: 'store', sectionId: 'store' },
  { id: 'store-brand', label: '사진/말투', href: '/app/settings/brand', groupId: 'store', icon: 'palette' },
  { id: 'store-image-style', label: '이미지 스타일', href: '/app/settings/image-style', groupId: 'store', icon: 'sparkles' },

  // [연결] 채널 연결
  { id: 'channels', label: '채널 연결', href: '/app/channels', groupId: 'channels', icon: 'share', sectionId: 'channels' },
  { id: 'connectors', label: '업무 도구 연결', href: '/app/connectors', groupId: 'channels', icon: 'link' },

  // [요금·결제] 이용 요금 (결제 내역은 전용 라우트 부재로 미생성)
  { id: 'billing', label: '이용 요금', href: '/app/account/billing', groupId: 'billing', icon: 'credit-card', sectionId: 'billing' },

  // [알림·계정] 가게 설정과 개인 계정 관리는 서로 다른 동선이다.
  { id: 'notifications', label: '알림 설정', href: '/app/notifications', groupId: 'account', icon: 'bell', sectionId: 'notifications' },
  { id: 'kakao-history', label: '카카오 안내 내역', href: '/app/kakao', groupId: 'account', icon: 'message-square' },
  { id: 'account', label: '개인정보 관리', href: '/app/system/privacy', groupId: 'account', icon: 'user' },

  // [도움] 도움말·약관·개인정보처리방침 (문의하기는 전용 라우트 부재로 도움말 안내 및 의견 보내기로 연계)
  { id: 'help', label: '도움말', href: '/app/help', groupId: 'help', icon: 'help-circle' },
  { id: 'terms', label: '약관', href: '/terms', groupId: 'help', icon: 'file-text' },
  { id: 'privacy', label: '개인정보처리방침', href: '/privacy', groupId: 'help', icon: 'shield-check' },
]

export type FeatureGroupId = 'delegate' | 'customers' | 'content' | 'run' | 'settings'
export const FEATURE_GROUP_LABEL: Record<FeatureGroupId, string> = {
  delegate: '소희와 함께', customers: '고객·예약', content: '콘텐츠·성과', run: '실행·자동화', settings: '설정',
}
export const FEATURE_GROUP_ORDER: FeatureGroupId[] = ['delegate', 'customers', 'content', 'run', 'settings']

export interface FeatureShortcut { label: string; description: string; href: string; group: FeatureGroupId; icon: string }

export const FEATURE_SHORTCUTS: ReadonlyArray<FeatureShortcut> = []
