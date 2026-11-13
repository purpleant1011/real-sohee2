import { describe, expect, it } from 'vitest'
import { resolveRoute } from './routes'

/**
 * ANI-1771 배선 B: 실제 페이지가 있는데 라우트 맵에 없어 '더보기'로 떨어지던 경로.
 * 떨어지면 탭 하이라이트와 탭별 마지막 위치가 틀어진다.
 */
describe('배선 B 경로 등록', () => {
  it.each([
    ['/app/reports', 'M20', 'results', 'BROWSE'],
    ['/app/conversations', 'M10', 'today', 'CHAT'],
    ['/app/conversations/t-1', 'M10', 'today', 'CHAT'],
  ] as const)('%s → %s / %s / %s', (path, id, tab, mode) => {
    const route = resolveRoute(path)
    expect([route?.id, route?.tab, route?.mode]).toEqual([id, tab, mode])
  })

  it('성과 리포트와 성과 탭이 같은 탭에 머문다', () => {
    expect(resolveRoute('/app/reports')?.tab).toBe(resolveRoute('/app/results')?.tab)
  })

  it('대화 상세의 뒤로가기는 목록으로 돌아온다', () => {
    expect(resolveRoute('/app/conversations/t-1')?.backFallback).toBe('/app/conversations')
  })
})
