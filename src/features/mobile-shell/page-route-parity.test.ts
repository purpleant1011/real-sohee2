import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRoute, SHELL_ROUTES } from './routes'

/**
 * ANI-1771 배선 B 회귀 가드.
 * `src/app/app` 아래 페이지는 있는데 `SHELL_ROUTES` 에 없으면 셸이 '더보기'로 떨어뜨린다.
 * 그러면 탭 하이라이트가 틀어지고 탭별 마지막 위치가 오염된다(PR #2008 리뷰 P2와 같은 결함).
 * 새 페이지를 추가한 창은 여기서 먼저 걸린다.
 */
const APP_ROOT = path.resolve(process.cwd(), 'src/app/app')

/** 동적 세그먼트는 라우트 맵 표기(`:id`)로 바꾼다. 캐치올은 대표 경로를 못 만들므로 건너뛴다. */
function toPattern(dir: string): string | null {
  const segments = path.relative(path.resolve(process.cwd(), 'src/app'), dir).split(path.sep)
  if (segments.some(s => s.startsWith('[') && (s.includes('...')))) return null
  return '/' + segments.map(s => (s.startsWith('[') ? ':id' : s)).join('/')
}

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, out)
    else if (entry.name === 'page.tsx') {
      const pattern = toPattern(dir)
      if (pattern) out.push(pattern)
    }
  }
  return out
}

/**
 * '더보기'로 떨어지는 것이 의도된 경로. 사유 없이 추가하지 않는다.
 * 탭이 정해지면 `SHELL_ROUTES` 에 등록하고 여기서 지운다.
 */
const INTENTIONAL_MORE_FALLBACK: Readonly<Record<string, string>> = {
  '/app/outcome': 'M08 은 /app/outcome/:id 만 등록, 목록 경로의 IA 미정',
  '/app/content/legacy': '내부 레거시 하위 화면, 탭 소속 없음',
  '/app/automation': 'IA 상 탭 미확정 — 추측 등록 금지',
  '/app/missions': 'IA 상 탭 미확정 — 추측 등록 금지',
  '/app/missions/:id': '부모(/app/missions)와 같이 탭 미확정',
  '/app/opportunities': 'IA 상 탭 미확정 — 추측 등록 금지',
  '/app/opportunities/:id': '부모(/app/opportunities)와 같이 탭 미확정',
  '/app/trial-summary': 'IA 상 탭 미확정 — 추측 등록 금지',
  '/app/plugins': '탭 화면으로 리다이렉트되는 경로',
}

describe('실제 페이지 ↔ 셸 라우트 정합', () => {
  const pages = collect(APP_ROOT).sort()

  it('페이지를 하나라도 찾았다', () => {
    expect(pages.length).toBeGreaterThan(30)
  })

  it.each(pages)('%s 는 등록됐거나 의도된 더보기 폴백이다', page => {
    const route = resolveRoute(page)
    expect(route, `${page} 가 셸 밖으로 판정됐다`).not.toBeNull()
    if (route!.pattern === '/app/*') {
      expect(INTENTIONAL_MORE_FALLBACK[page], `${page} 가 이유 없이 더보기로 떨어진다`).toBeTruthy()
    }
  })

  it('의도된 폴백 목록에 죽은 항목이 없다', () => {
    const stale = Object.keys(INTENTIONAL_MORE_FALLBACK).filter(page => !pages.includes(page))
    expect(stale, `페이지가 사라졌는데 목록에 남아 있다: ${stale.join(', ')}`).toEqual([])
  })
})

/**
 * ANI-1664: 반대 방향 대조. 위 테스트는 '페이지는 있는데 맵에 없다'만 잡는다.
 * 맵이 `existing` 이라고 말하는 경로에 페이지가 없으면, 앱은 그 경로에서 404 를 내고
 * 셸 계약(탭·뒤로가기)은 아무 데도 닿지 않는다. 그래서 맵 → 페이지 방향도 고정한다.
 */
const ALL_APP = path.resolve(process.cwd(), 'src/app')

/** `(public)` 같은 라우트 그룹은 URL 세그먼트가 아니다. 캐치올 페이지는 대표 경로를 못 만든다. */
function toUrlPattern(dir: string): string | null {
  const segments = path
    .relative(ALL_APP, dir)
    .split(path.sep)
    .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')))
  // 선택적 캐치올(`[[...tab]]`)은 0 세그먼트와도 매치하므로 부모 경로의 페이지로 기록한다.
  const optionalCatchAll = segments.findIndex(segment => segment.startsWith('[[...'))
  if (optionalCatchAll >= 0) {
    return '/' + segments.slice(0, optionalCatchAll).join('/')
  }
  if (segments.some(segment => segment.startsWith('[') && segment.includes('...'))) return null
  return '/' + segments.map(segment => (segment.startsWith('[') ? ':id' : segment)).join('/')
}

function collectUrlPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectUrlPages(full, out)
    else if (entry.name === 'page.tsx') {
      const pattern = toUrlPattern(dir)
      if (pattern) out.push(pattern)
    }
  }
  return out
}

const URL_PAGES = collectUrlPages(ALL_APP)

function patternHasPage(pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    const root = pattern.slice(0, -2)
    return URL_PAGES.some(page => page === root || page.startsWith(`${root}/`))
  }
  const wanted = pattern.split('/').filter(Boolean)
  return URL_PAGES.some(page => {
    const actual = page.split('/').filter(Boolean)
    if (actual.length !== wanted.length) return false
    return wanted.every((segment, index) => (segment.startsWith(':') ? actual[index].length > 0 : segment === actual[index]))
  })
}

describe('셸 라우트 맵 → 실제 페이지 정합 (ANI-1664)', () => {
  it('existing 이라고 선언한 경로는 모두 page.tsx 가 있다', () => {
    const broken = SHELL_ROUTES
      .filter(route => route.status === 'existing' && !patternHasPage(route.pattern))
      .map(route => `${route.id} ${route.pattern}`)
    expect(broken, `페이지 없는 existing 경로: ${broken.join(', ')}`).toEqual([])
  })

  it('absorbed 경로는 별도 페이지를 만들지 않는다 — 상위 화면 단계로 처리한다', () => {
    const leaked = SHELL_ROUTES
      .filter(route => route.status === 'absorbed' && patternHasPage(route.pattern))
      .map(route => `${route.id} ${route.pattern}`)
    expect(leaked, `페이지가 생겼는데 absorbed 로 남은 경로: ${leaked.join(', ')}`).toEqual([])
  })

  it('proposed 경로에 페이지가 생기면 existing 으로 올려야 한다', () => {
    const mixed = SHELL_ROUTES
      .filter(route => route.status === 'proposed' && patternHasPage(route.pattern))
      .map(route => `${route.id} ${route.pattern}`)
    expect(mixed, `페이지가 있는데 proposed 인 경로: ${mixed.join(', ')}`).toEqual([])
  })
})
