import { describe, expect, it } from 'vitest'
import type { DecisionPage, MobileHomeDto, Remote } from '../mobile-decision/contracts'
import { pickFirstAction } from './first-action'

const rem = <T,>(state: Remote<T>['state'], data: T | null): Remote<T> => ({ state, data, observedAt: '2026-10-22T07:40:00Z', validUntil: null })
const view = (over: Partial<MobileHomeDto> = {}): MobileHomeDto => ({
  workspaceId: 'w1', businessName: '바이름', timeZone: 'Asia/Seoul', generatedAt: '2026-10-22T07:40:00Z',
  agent: rem('ready', { label: '대기 중', detailHref: '/app/sohee' }),
  decisions: rem('ready', { items: [], total: 0, complete: true }),
  activity: rem('ready', []), results: rem('ready', []), ...over,
})
const item = (id: string, expiresAt: string | null = null) => ({ id, kind: 'dm_reply' as const, title: '답변 검토', targetLabel: '인스타그램', createdAt: '2026-10-22T01:00:00Z', expiresAt })

describe('pickFirstAction (M09: 폴드 안 CTA 정확히 1개)', () => {
  it('확인할 결정이 있으면 가장 급한 1건을 검토 CTA로 쓴다', () => {
    const a = pickFirstAction(view({ decisions: rem('ready', { items: [item('b', '2026-10-23T00:00:00Z'), item('a', '2026-10-22T09:00:00Z')], total: 2, complete: true }) }))
    expect(a).toMatchObject({ kind: 'review', itemId: 'a', href: '/app/approvals?item=a' })
  })
  it('확정된 0건이면 다음 가치 행동(소희에게 맡기기)을 보여준다', () => {
    expect(pickFirstAction(view()).kind).toBe('delegate')
  })
  it('조회 오류는 "할 일 없음"이 아니라 다시 확인으로 구분한다', () => {
    expect(pickFirstAction(view({ decisions: rem<DecisionPage>('error', null) })).kind).toBe('retry')
  })
  it('loading/unknown/불완전 0건은 빈 상태로 단정하지 않는다', () => {
    expect(pickFirstAction(view({ decisions: rem<DecisionPage>('loading', null) })).kind).toBe('checking')
    expect(pickFirstAction(view({ decisions: rem<DecisionPage>('unknown', null) })).kind).toBe('checking')
  })
  it('조회는 끝났지만 일부 항목을 읽지 못한 0건은 "확인 중"에 머무르지 않고 소통함 직접 확인으로 안내한다(할 일 없음으로도 단정하지 않는다)', () => {
    expect(pickFirstAction(view({ decisions: rem('ready', { items: [], total: null, complete: false }) }))).toEqual({ kind: 'partial', href: '/app/engagement' })
  })
  it('stale 이면 검토 항목이 있어도 새로 확인 후 검토하도록 표시한다', () => {
    const a = pickFirstAction(view({ decisions: rem('stale', { items: [item('a')], total: 1, complete: true }) }))
    expect(a).toMatchObject({ kind: 'review', stale: true })
  })
})
