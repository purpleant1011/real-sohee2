import type { ReactNode } from 'react'

/** 전역 표면 모드. R1(`mobile-decision`)의 소문자 browse/review/chat 은 이 타입으로 대체된다. */
export type ShellMode = 'BROWSE' | 'DETAIL' | 'REVIEW' | 'CHAT' | 'EDIT'

export type TabId = 'today' | 'work' | 'customers' | 'results' | 'more'

/** 하단에 고정되는 표면은 항상 이 중 정확히 하나다 (동시 2개 = P0 결함). */
export type BottomSurface = 'tabbar' | 'cta' | 'composer' | 'none'

export type HeaderKind = 'app' | 'back' | 'chat' | 'none'

export interface ModePolicy {
  header: HeaderKind
  /** 5탭 노출 여부 */
  tabbar: boolean
  /** 단일 고정 CTA 슬롯 허용 정도 */
  cta: 'forbidden' | 'optional' | 'required'
  /** 하단 고정 입력창(채팅 컴포저) */
  composer: boolean
}

export interface HeaderAction {
  id: string
  label: string
  icon?: ReactNode
  onPress?: () => void
  href?: string
  /** 커스텀 액션 엘리먼트(드롭다운 메뉴 등) */
  element?: ReactNode
}

export interface ShellCta {
  label: string
  onPress: () => void
  busy?: boolean
  disabled?: boolean
  /** disabled 일 때 사용자에게 보여줄 이유(없으면 안 됨) */
  disabledReason?: string
  /** 보조 행동. 최대 2개 (화면당 Primary 1 + Secondary ≤2). */
  secondary?: readonly [ShellSecondary] | readonly [ShellSecondary, ShellSecondary]
}

export interface ShellSecondary {
  label: string
  onPress: () => void
  disabled?: boolean
}

export interface ShellScreenConfig {
  /** 라우트 기본 모드를 덮어쓴다 (예: 상세 → EDIT). 생략하면 라우트 맵 값. */
  mode?: ShellMode
  /** 헤더 제목. 생략 시 라우트 맵의 title. */
  title?: string
  /** 뒤로가기 목적지 강제. 생략하면 history → from → 라우트 fallback 순. */
  backHref?: string
  /** 뒤로가기 커스텀 핸들러. 설정 시 backHref/history 대신 먼저 실행된다. */
  onBack?: () => void
  /** 헤더 우측 행동 (최대 3개). */
  actions?: readonly HeaderAction[]
  /** 단일 고정 CTA. null/undefined = 없음. */
  cta?: ShellCta | null
  /** 헤더 보조 문구(저장됨/오프라인 등 정직한 상태). */
  status?: string
  /** CHAT 전용 하단 입력창. 화면은 별도 fixed 요소를 만들지 않는다. */
  composer?: ReactNode
}

export interface ResolvedSurface {
  mode: ShellMode
  policy: ModePolicy
  bottom: BottomSurface
  title: string
  backHref: string | null
  actions: readonly HeaderAction[]
  cta: ShellCta | null
  status: string | null
}
