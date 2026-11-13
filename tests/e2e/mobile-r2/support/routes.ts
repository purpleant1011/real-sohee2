/**
 * Mobile R2 화면 레지스트리 (W9 소유). 다른 창이 화면을 올리면 status 를 'live' 로 바꿔 게이트에 편입한다.
 * - live: 게이트(오버플로·터치영역·axe·런타임 오류·쓰기 차단)를 반드시 통과해야 한다.
 * - planned: 아직 구현 전. 게이트는 test.skip 되지만 목록에 남아 "미검증"임을 보고서에 드러낸다.
 * - auth: 로그인 세션이 필요. MOBILE_R2_STORAGE_STATE(Playwright storageState 경로)가 없으면 skip.
 * 모드(BROWSE/DETAIL/REVIEW/EDIT/CHAT)는 .claude/rules/mobile-r2-ui.md 의 화면별 계약을 따른다.
 */
export type ScreenMode = 'BROWSE' | 'DETAIL' | 'REVIEW' | 'EDIT' | 'CHAT' | 'PUBLIC'

export interface RouteEntry {
  id: string
  path: string
  mode: ScreenMode
  status: 'live' | 'planned'
  auth: boolean
  /** 담당 Linear 이슈 (증거 디렉터리 이름) */
  issue: string
  /** BROWSE 만 하단 5탭 허용. 그 외는 5탭이 없어야 한다. */
  bottomNav?: 'required' | 'forbidden' | 'any'
  /**
   * 개발 환경 전용 라우트(운영 빌드에서는 404). 모바일 게이트는 대상 서버가 운영 빌드면
   * 통과가 아니라 "미검증"으로 남긴다 — 404 를 조용히 성공으로 치환하지 않는다.
   */
  devOnly?: boolean
  /** 데스크톱 폭(768+)에서만 의미 있는 라우트. 모바일 폭 게이트에서는 제외한다. */
  desktopOnly?: boolean
}

export const ROUTES: RouteEntry[] = [
  { id: 'landing', path: '/', mode: 'PUBLIC', status: 'live', auth: false, issue: 'ANI-1740', bottomNav: 'forbidden' },
  { id: 'pricing', path: '/pricing', mode: 'PUBLIC', status: 'live', auth: false, issue: 'ANI-1740', bottomNav: 'forbidden' },
  { id: 'login', path: '/login', mode: 'PUBLIC', status: 'live', auth: false, issue: 'ANI-1734', bottomNav: 'forbidden' },
  { id: 'signup', path: '/signup', mode: 'PUBLIC', status: 'live', auth: false, issue: 'ANI-1734', bottomNav: 'forbidden' },
  // W1 셸 육안 검수용 개발 프리뷰 (ANI-1662). 인증/데이터/외부 요청 없음.
  { id: 'dev-mobile-r2', path: '/dev/mobile-r2', mode: 'BROWSE', status: 'live', auth: false, issue: 'ANI-1740', bottomNav: 'required', devOnly: true },
  // 프리뷰 프레임은 390px 셸을 데스크톱 폭에 놓고 보는 화면이라 모바일 폭 게이트에서 제외한다.
  { id: 'dev-mobile-r2-frame', path: '/dev/mobile-r2/frame?w=390', mode: 'BROWSE', status: 'live', auth: false, issue: 'ANI-1740', bottomNav: 'any', devOnly: true, desktopOnly: true },
  // 아래는 W1~W8 이 구현하면 live 로 승격한다.
  { id: 'app-today', path: '/app', mode: 'BROWSE', status: 'planned', auth: true, issue: 'ANI-1734', bottomNav: 'required' },
  { id: 'app-inbox', path: '/app/inbox', mode: 'BROWSE', status: 'planned', auth: true, issue: 'ANI-1736', bottomNav: 'required' },
  { id: 'app-work', path: '/app/work', mode: 'BROWSE', status: 'planned', auth: true, issue: 'ANI-1734', bottomNav: 'required' },
  { id: 'app-customers', path: '/app/customers', mode: 'BROWSE', status: 'planned', auth: true, issue: 'ANI-1736', bottomNav: 'required' },
  { id: 'app-results', path: '/app/results', mode: 'BROWSE', status: 'planned', auth: true, issue: 'ANI-1736', bottomNav: 'required' },
  { id: 'app-more', path: '/app/settings', mode: 'BROWSE', status: 'planned', auth: true, issue: 'ANI-1740', bottomNav: 'required' },
  { id: 'start-first-post', path: '/start', mode: 'EDIT', status: 'planned', auth: true, issue: 'ANI-1734', bottomNav: 'forbidden' },
  // 미션 상세는 라이브(ANI-1666). 목록의 고정 id(ms-001)로 진입하며 DETAIL 계약상 5탭은 숨긴다.
  { id: 'app-missions-detail', path: '/app/missions/ms-001', mode: 'DETAIL', status: 'live', auth: true, issue: 'ANI-1666', bottomNav: 'forbidden' },
]

export function liveRoutes(): RouteEntry[] {
  return ROUTES.filter((r) => r.status === 'live')
}

/** 모바일 폭 게이트 대상 (데스크톱 전용 라우트 제외, planned 포함해 skip 사유를 남긴다). */
export function mobileGateRoutes(): RouteEntry[] {
  return ROUTES.filter((r) => !r.desktopOnly)
}

/** PC 회귀 기준선은 공개·비-dev 라우트만 픽셀 비교한다. */
export function pcBaselineRoutes(): RouteEntry[] {
  return liveRoutes().filter((r) => !r.auth && !r.devOnly)
}

/** 데스크톱 폭에서만 검사하는 개발 프리뷰 라우트. */
export function desktopOnlyRoutes(): RouteEntry[] {
  return ROUTES.filter((r) => r.desktopOnly)
}
