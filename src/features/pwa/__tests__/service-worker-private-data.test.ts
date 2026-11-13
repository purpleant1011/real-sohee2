import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SW_PRIVATE_PATH_PREFIXES } from '../constants'

/**
 * ANI-1727 — 사적(워크스페이스) 데이터는 공유 캐시에 절대 남지 않는다.
 *
 * 화이트리스트만으로도 대부분 막히지만, 허용 접두사가 넓어지는 순간 조용히 뚫린다.
 * 그래서 (1) 금지 접두사를 명시적 계약으로 승격하고 (2) 허용 목록보다 먼저 검사한다.
 * 이 파일은 그 두 가지를 고정한다.
 */
const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

function extractFunction(name: string): string {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source)
  if (!match) throw new Error(`sw.js 에서 ${name} 을 찾지 못했습니다`)
  return match[0]
}

function extractArray(name: string): string[] {
  const literal = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(source)?.[1]
  if (!literal) throw new Error(`sw.js 에서 ${name} 을 찾지 못했습니다`)
  return new Function(`return ${literal}`)() as string[]
}

const cacheableUrl = new Function(
  `${/const CACHEABLE_PREFIXES = .*/.exec(source)?.[0] ?? ''}
   ${/const CACHEABLE_EXACT = .*/.exec(source)?.[0] ?? ''}
   ${/const SENSITIVE_QUERY = .*/.exec(source)?.[0] ?? ''}
   ${/const PRIVATE_PATH_PREFIXES = .*/.exec(source)?.[0] ?? ''}
   ${extractFunction('isCacheableUrl')}
   return isCacheableUrl`,
)() as (url: URL, selfOrigin: string) => boolean

const origin = 'https://example.com'

/** 워크스페이스·고객·대화·예약·결제·승인 결과가 흐르는 경로. */
const PRIVATE_PATHS = [
  '/api/workspaces/1/inbox',
  '/api/missions/1',
  '/api/channels/1',
  '/app/inbox',
  '/app/approvals',
  '/app/results',
  '/app/customers/1',
  '/app/conversations/1',
  '/admin/workspaces',
  '/auth/callback',
  '/_next/data/abc/app.json',
]

describe('service worker private data contract', () => {
  it('declares the private prefixes as an explicit contract', () => {
    expect(Array.isArray(SW_PRIVATE_PATH_PREFIXES)).toBe(true)
    expect(SW_PRIVATE_PATH_PREFIXES.length).toBeGreaterThan(0)

    for (const prefix of ['/api/', '/app/', '/admin/', '/auth/', '/_next/data/']) {
      expect(SW_PRIVATE_PATH_PREFIXES).toContain(prefix)
    }
  })

  it('keeps the constant and the service worker in step', () => {
    // 상수만 고치고 sw.js 를 잊으면 계약이 조용히 무력해진다.
    expect(extractArray('PRIVATE_PATH_PREFIXES')).toEqual([...SW_PRIVATE_PATH_PREFIXES])
  })

  it('refuses every private path even if it matches an allowlist prefix', () => {
    for (const path of PRIVATE_PATHS) {
      expect(cacheableUrl(new URL(`${origin}${path}`), origin), path).toBe(false)
    }

    // 방어선: 허용 접두사 아래에 사적 경로가 끼어들어도 금지가 먼저 이긴다.
    expect(cacheableUrl(new URL(`${origin}/_next/static/api/workspaces/1/inbox`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/icons/app/customers/1/avatar.png`), origin)).toBe(false)
  })

  it('checks the private list before the allowlist', () => {
    const body = extractFunction('isCacheableUrl')
    const privateAt = body.indexOf('PRIVATE_PATH_PREFIXES')
    const allowAt = body.indexOf('CACHEABLE_PREFIXES')

    expect(privateAt).toBeGreaterThan(-1)
    expect(allowAt).toBeGreaterThan(-1)
    expect(privateAt).toBeLessThan(allowAt)
  })

  it('refuses React Server Component payload requests', () => {
    // Next.js 는 RSC 요청에 ?_rsc= 를 붙인다. 응답은 사용자별 flight 데이터다.
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?_rsc=1abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/_next/static/chunk/a.js?_rsc=1abc`), origin)).toBe(false)
  })

  it('refuses first-post draft, outcome, and action routes from ever being cached (ANI-1727)', () => {
    const firstPostPaths = [
      '/api/missions/first-post/11111111-2222-4333-8444-555555555555',
      '/api/missions/first-post/11111111-2222-4333-8444-555555555555/outcome',
      '/api/missions/first-post/publish',
      '/api/missions/first-post/approve',
      '/app/missions/11111111-2222-4333-8444-555555555555',
      '/app/outcome/11111111-2222-4333-8444-555555555555',
    ]
    for (const path of firstPostPaths) {
      expect(cacheableUrl(new URL(`${origin}${path}`), origin), path).toBe(false)
    }
  })

  it('prohibits background sync and offline write queues for first-post (ANI-1725)', () => {
    // 오프라인 상태에서 쓰기 요청(POST/PUT/DELETE)을 가로채거나 큐에 저장하지 않는다.
    expect(source).toContain("if (request.method !== 'GET') return")
    expect(source).not.toMatch(/addEventListener\('sync'|registration\.sync/)
    expect(source).not.toMatch(/indexedDB|localStorage|sessionStorage/)
  })
})
