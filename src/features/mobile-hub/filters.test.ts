import { describe, expect, it } from 'vitest'
import { filterWork, listViewState, type WorkItem } from './filters'

const it_ = (id: string, status: WorkItem['status'], title = id): WorkItem => ({ id, title, status })
const items = [it_('a', 'draft', '봄 이벤트'), it_('b', 'review'), it_('c', 'verifying'), it_('d', 'confirmed', '네일 후기')]

describe('filterWork (M11)', () => {
  it('세그먼트와 검색어를 함께 적용', () => {
    expect(filterWork(items, { segment: 'all', query: '이벤트' }).map(i => i.id)).toEqual(['a'])
    expect(filterWork(items, { segment: 'review', query: '' }).map(i => i.id)).toEqual(['b'])
  })
})
describe('listViewState — 조회 실패는 0건이 아니다', () => {
  it('error 와 confirmed_empty 구분', () => {
    expect(listViewState({ loadState: 'error', complete: false, items: [] })).toBe('error')
    expect(listViewState({ loadState: 'ready', complete: true, items: [] })).toBe('confirmed_empty')
  })
  it('불완전 응답은 partial, 필터 결과 없음은 no_match', () => {
    expect(listViewState({ loadState: 'ready', complete: false, items })).toBe('partial')
    expect(listViewState({ loadState: 'ready', complete: true, items, matched: 0 })).toBe('no_match')
    expect(listViewState({ loadState: 'ready', complete: true, items, matched: 4 })).toBe('ready')
  })
  it('offline/stale 그대로 노출', () => {
    expect(listViewState({ loadState: 'stale', complete: true, items })).toBe('stale')
  })
})
