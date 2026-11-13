import type { ShellMode, TabId } from './types'

export type RouteStatus = 'existing' | 'proposed' | 'absorbed'
export type Priority = 'P0' | 'P1'

export interface ShellRoute {
  /** M01~M26 (docs/mobile-r2/00 §4). 한 화면 = 한 ID. */
  id: string
  title: string
  /** `:param` 세그먼트, 끝의 `/*` 는 하위 전체. 선언 순서대로 첫 매치(구체적인 것 먼저). */
  pattern: string
  /** null = 셸 밖(공개/인증/온보딩 전). */
  tab: TabId | null
  mode: ShellMode
  /** 직접 진입(딥링크) 시 뒤로가기 목적지. 없으면 탭 루트. */
  backFallback?: string
  priority: Priority
  /**
   * existing = 현재 App Router 에 페이지 존재,
   * proposed = 이 계약이 제안한 경로(담당 창이 확정/PR 로 수정),
   * absorbed = 별도 페이지를 만들지 않고 상위 화면(M03)의 단계에서 처리한다.
   */
  status: RouteStatus
}

/**
 * 라우트 맵. 새 화면/경로는 이 표에 한 줄 추가하는 PR 로만 등록한다(CONTRACT.md §2).
 * 같은 ID 의 보조 경로(예: M02 의 /login, /signup)는 여러 줄로 선언한다.
 */
export const SHELL_ROUTES: ReadonlyArray<ShellRoute> = [
  { id: 'M01', title: '소희 소개', pattern: '/', tab: null, mode: 'BROWSE', priority: 'P1', status: 'existing' },
  { id: 'M02', title: '로그인', pattern: '/login', tab: null, mode: 'DETAIL', priority: 'P0', status: 'existing' },
  { id: 'M02', title: '회원가입', pattern: '/signup', tab: null, mode: 'DETAIL', priority: 'P0', status: 'existing' },
  { id: 'M06', title: '홍보 미리보기', pattern: '/start/preview', tab: null, mode: 'DETAIL', priority: 'P0', status: 'existing' },
  { id: 'M04', title: '사진 올리기(M03 가게 단계)', pattern: '/start/photo', tab: null, mode: 'DETAIL', priority: 'P0', status: 'absorbed' },
  { id: 'M05', title: '확인할 내용(M03 말투 단계)', pattern: '/start/facts', tab: null, mode: 'DETAIL', priority: 'P0', status: 'absorbed' },
  { id: 'M03', title: '가게 소개', pattern: '/start', tab: null, mode: 'DETAIL', priority: 'P0', status: 'existing' },
  { id: 'M03', title: '가게 소개', pattern: '/app/onboarding', tab: null, mode: 'DETAIL', priority: 'P0', status: 'existing' },

  { id: 'M19', title: '승인 확인', pattern: '/app/approvals/:id', tab: 'today', mode: 'REVIEW', backFallback: '/app', priority: 'P0', status: 'existing' },
  { id: 'M19', title: '승인 확인', pattern: '/app/approvals', tab: 'today', mode: 'REVIEW', backFallback: '/app', priority: 'P0', status: 'existing' },
  // 첫 포스팅 시작(`/app/work/new`)은 `:id` 보다 먼저 선언해야 한다 — 지금은 `:id='new'` 로 잡혀
  // 뒤로가기가 `/app/content` 로 갔다(ANI-1767). 시작 화면은 홈에서 들어오므로 복귀도 홈이다.
  { id: 'M06', title: '첫 포스팅', pattern: '/app/work/new', tab: 'work', mode: 'DETAIL', backFallback: '/app', priority: 'P0', status: 'existing' },
  { id: 'M07', title: '게시 전 최종 확인', pattern: '/app/work/:id/approve', tab: 'work', mode: 'REVIEW', backFallback: '/app/content', priority: 'P0', status: 'existing' },
  { id: 'M12', title: '게시물 수정', pattern: '/app/work/:id/edit', tab: 'work', mode: 'EDIT', backFallback: '/app/content', priority: 'P0', status: 'existing' },
  { id: 'M08', title: '첫 게시 결과', pattern: '/app/outcome/:id', tab: 'work', mode: 'DETAIL', backFallback: '/app/content', priority: 'P0', status: 'existing' },
  { id: 'M06', title: '홍보 세트', pattern: '/app/work/:id', tab: 'work', mode: 'DETAIL', backFallback: '/app/content', priority: 'P0', status: 'existing' },
  { id: 'M10', title: '소희와의 대화', pattern: '/dev/mobile-chat-redesign', tab: 'today', mode: 'CHAT', backFallback: '/app', priority: 'P1', status: 'existing' },
  { id: 'M10', title: '소희와의 대화', pattern: '/app/command', tab: 'today', mode: 'CHAT', backFallback: '/app', priority: 'P0', status: 'existing' },
  { id: 'M10', title: '소희와의 대화', pattern: '/app/conversations/:id', tab: 'today', mode: 'CHAT', backFallback: '/app/conversations', priority: 'P1', status: 'existing' },
  { id: 'M10', title: '소희와의 대화', pattern: '/app/conversations', tab: 'today', mode: 'CHAT', backFallback: '/app', priority: 'P1', status: 'existing' },
  { id: 'M23', title: '알림', pattern: '/app/notifications', tab: 'today', mode: 'DETAIL', backFallback: '/app', priority: 'P1', status: 'existing' },
  { id: 'M09', title: '오늘', pattern: '/app', tab: 'today', mode: 'BROWSE', priority: 'P0', status: 'existing' },

  { id: 'M11', title: '작업함', pattern: '/app/content', tab: 'work', mode: 'BROWSE', priority: 'P1', status: 'existing' },
  { id: 'M11', title: '보관함', pattern: '/app/vault/*', tab: 'work', mode: 'BROWSE', priority: 'P1', status: 'existing' },
  { id: 'M11', title: '작업', pattern: '/app/work', tab: 'work', mode: 'BROWSE', priority: 'P1', status: 'existing' },
  { id: 'M11', title: '실행안 상세', pattern: '/app/missions/:id', tab: 'work', mode: 'DETAIL', backFallback: '/app/missions', priority: 'P1', status: 'existing' },
  { id: 'M11', title: '실행안 센터', pattern: '/app/missions', tab: 'work', mode: 'BROWSE', priority: 'P1', status: 'existing' },
  { id: 'M18', title: '제안', pattern: '/app/campaigns/*', tab: 'work', mode: 'DETAIL', backFallback: '/app/content', priority: 'P1', status: 'existing' },

  { id: 'M17', title: '고객 상세', pattern: '/app/customers/person/:customerUuid', tab: 'customers', mode: 'DETAIL', backFallback: '/app/customers', priority: 'P1', status: 'existing' },
  { id: 'M17', title: '고객 상세', pattern: '/app/customers/:id', tab: 'customers', mode: 'DETAIL', backFallback: '/app/customers', priority: 'P1', status: 'existing' },
  { id: 'M17', title: '고객', pattern: '/app/customers', tab: 'customers', mode: 'BROWSE', priority: 'P1', status: 'existing' },
  { id: 'M13', title: '대화 상세', pattern: '/app/engagement/:id', tab: 'customers', mode: 'DETAIL', backFallback: '/app/engagement', priority: 'P0', status: 'existing' },
  { id: 'M13', title: '소통함', pattern: '/app/engagement', tab: 'customers', mode: 'BROWSE', priority: 'P0', status: 'existing' },
  { id: 'M13', title: '소통함', pattern: '/app/inbox', tab: 'customers', mode: 'BROWSE', priority: 'P0', status: 'existing' },
  { id: 'M14', title: '예약 문의', pattern: '/app/inbox/:id', tab: 'customers', mode: 'DETAIL', backFallback: '/app/inbox', priority: 'P0', status: 'existing' },
  { id: 'M15', title: '예약 일정', pattern: '/app/schedule', tab: 'customers', mode: 'BROWSE', priority: 'P0', status: 'existing' },
  { id: 'M16', title: '예약금·환불', pattern: '/app/schedule/payments/*', tab: 'customers', mode: 'DETAIL', backFallback: '/app/schedule', priority: 'P1', status: 'existing' },
  { id: 'M15', title: '예약 가능 시간', pattern: '/app/schedule/availability', tab: 'customers', mode: 'DETAIL', backFallback: '/app/schedule', priority: 'P1', status: 'existing' },

  { id: 'M20', title: '성과 근거', pattern: '/app/results/:id/evidence', tab: 'results', mode: 'DETAIL', backFallback: '/app/results', priority: 'P0', status: 'existing' },
  { id: 'M20', title: '성과 자세히', pattern: '/app/results/:id', tab: 'results', mode: 'DETAIL', backFallback: '/app/results', priority: 'P0', status: 'existing' },
  { id: 'M20', title: '성과', pattern: '/app/results', tab: 'results', mode: 'BROWSE', priority: 'P0', status: 'existing' },
  { id: 'M20', title: '성과 리포트', pattern: '/app/reports', tab: 'results', mode: 'BROWSE', priority: 'P1', status: 'existing' },

  { id: 'M21', title: '채널 연결', pattern: '/app/channels/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P0', status: 'existing' },
  { id: 'M22', title: '우리 가게 기억', pattern: '/app/knowledge/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M22', title: '우리 가게 기억', pattern: '/app/memory/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M24', title: '내 소희', pattern: '/app/sohee/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P0', status: 'existing' },
  { id: 'M25', title: '가게 기본 정보', pattern: '/app/settings/business', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '서비스 카탈로그', pattern: '/app/settings/services', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '브랜드 기준', pattern: '/app/settings/brand', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '이미지 스타일', pattern: '/app/settings/image-style', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '구성원 관리', pattern: '/app/settings/members', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '자동화 설정', pattern: '/app/settings/automation', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '채널 설정', pattern: '/app/settings/channels/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '요금·설정', pattern: '/app/settings/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '요금제 및 결제', pattern: '/app/account/billing', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '내 계정', pattern: '/app/account/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '카카오 안내 내역', pattern: '/app/kakao', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '광고 센터', pattern: '/app/ads', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '광고 센터', pattern: '/app/ads/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '도움말', pattern: '/app/help', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '도움말', pattern: '/app/help/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '업무 도구 연결', pattern: '/app/connectors', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M25', title: '개인정보 관리', pattern: '/app/system/privacy', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing' },
  { id: 'M26', title: '연결 상태', pattern: '/app/offline', tab: null, mode: 'DETAIL', priority: 'P0', status: 'existing' },
  { id: 'M25', title: '더보기', pattern: '/app/system', tab: 'more', mode: 'BROWSE', priority: 'P1', status: 'existing' },
]

const FALLBACK: ShellRoute = {
  id: 'M25', title: '더보기', pattern: '/app/*', tab: 'more', mode: 'DETAIL', backFallback: '/app/system', priority: 'P1', status: 'existing',
}

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) {
    const root = pattern.slice(0, -2)
    return path === root || path.startsWith(`${root}/`)
  }
  const p = pattern.split('/')
  const s = path.split('/')
  if (p.length !== s.length) return false
  return p.every((seg, i) => seg.startsWith(':') ? s[i].length > 0 : seg === s[i])
}

/** 쿼리/해시/끝 슬래시를 제거한 경로. */
export function normalizePath(input: string): string {
  const base = input.split('#')[0].split('?')[0]
  return base.length > 1 ? base.replace(/\/+$/, '') : base || '/'
}

/** 미등록 /app 하위 경로는 '더보기' 소속 DETAIL(안전한 기본값). 셸 밖 경로는 null. */
export function resolveRoute(pathname: string): ShellRoute | null {
  const path = normalizePath(pathname)
  const hit = SHELL_ROUTES.find(r => matches(r.pattern, path))
  if (hit) return hit
  return path === '/app' || path.startsWith('/app/') ? FALLBACK : null
}
