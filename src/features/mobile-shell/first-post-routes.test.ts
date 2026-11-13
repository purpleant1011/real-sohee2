import { describe, expect, it } from 'vitest'
import { isFirstPostR2Enabled } from '@/features/mobile-firstpost/first-post-flow'
import { shouldOpenFirstPostRoute, WORK_NEW_FALLBACK_ROUTE } from '@/app/app/work/new/first-post-route-flag'
import { resolveRoute } from './routes'

/**
 * ANI-1767 첫 포스팅 실라우트 — 라우트 맵 계약.
 *
 * 배경: `/app/work/new` 는 오늘 `/app` 로 보내는 빈 리다이렉트였고, 셸 라우트 맵에는 구체 경로가
 * 없어서 `:id='new'` 로 해석됐다. 그 결과 시작 화면의 뒤로가기가 `/app/content`(작업함)로 갔다.
 * 여기서는 (1) 구체 경로가 `:id` 를 이기고, (2) 3단계 흐름 화면(`/app/work/:id`·`/approve`·
 * `/outcome/:id`)의 기존 계약이 그대로인지 고정한다.
 */
describe('/app/work/new 라우트 맵 (ANI-1767)', () => {
  it('첫 포스팅 시작은 작업 탭 DETAIL 이고 뒤로가기는 홈이다', () => {
    const route = resolveRoute('/app/work/new')
    expect(route && [route.id, route.title, route.tab, route.mode, route.backFallback])
      .toEqual(['M06', '첫 포스팅', 'work', 'DETAIL', '/app'])
  })

  it('쿼리·끝 슬래시가 붙어도 같은 라우트다', () => {
    expect(resolveRoute('/app/work/new/?utm=r2')?.backFallback).toBe('/app')
  })

  it('구체 경로가 :id 를 가리지 않는다 — 실제 콘텐츠 상세는 그대로다', () => {
    const route = resolveRoute('/app/work/c1')
    expect(route && [route.id, route.title, route.backFallback]).toEqual(['M06', '홍보 세트', '/app/content'])
  })

  it('3단계 화면 경로는 바뀌지 않았다(최종 확인 · 결과)', () => {
    expect(resolveRoute('/app/work/c1/approve')?.id).toBe('M07')
    expect(resolveRoute('/app/outcome/m1')?.id).toBe('M08')
  })

  it('작업함 루트는 여전히 M11 이다', () => {
    expect(resolveRoute('/app/work')?.id).toBe('M11')
  })
})

/**
 * 서버 판정(`shouldOpenFirstPostRoute`)과 화면 판정(`isFirstPostR2Enabled`)이 같은 계약인지 고정한다.
 * 서버 페이지는 클라이언트 모듈 함수를 부를 수 없어 문자열 비교를 따로 두었다 — 여기서 갈라짐을 잡는다.
 */
describe('첫 포스팅 플래그 계약 (ANI-1767)', () => {
  const VALUES = [undefined, '', 'on', 'off', '1', 'ON', 'true'] as const

  it.each(VALUES)('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST=%s', value => {
    expect(shouldOpenFirstPostRoute(true, value)).toBe(isFirstPostR2Enabled(value))
  })

  it('R2 플래그가 꺼져 있으면 첫 포스팅 플래그와 무관하게 닫힌다', () => {
    expect(shouldOpenFirstPostRoute(false, 'on')).toBe(false)
  })

  it('PC 또는 첫 포스팅 플래그 비활성 시 실제 글쓰기 시작 화면(/app/content 4채널 스튜디오)으로 연결된다', () => {
    expect(WORK_NEW_FALLBACK_ROUTE).toBe('/app/content?studio=four-channel')
  })
})
