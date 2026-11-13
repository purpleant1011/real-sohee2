import { describe, expect, it } from 'vitest'
import { parseHubRestore, serializeHubRestore } from './restore'
import { deriveWorkStatus, statusLabelFor, toWorkList, toWorkRow } from './work-items'

const workspaceId = '11111111-1111-4111-8111-111111111111'

describe('toWorkList (M11)', () => {
  it('타 매장 항목을 제외한다', () => {
    const result = toWorkList({ success: true, contents: [
      { contentId: 'a', title: '봄 이벤트', status: 'draft', workspaceId },
      { contentId: 'b', title: '다른 매장', status: 'draft', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ] }, workspaceId)
    expect(result.items.map(item => item.id)).toEqual(['a'])
  })

  it('빈 배열을 확정 0건으로 주장하지 않는다', () => {
    const result = toWorkList({ success: true, contents: [] }, workspaceId)
    expect(result.items).toEqual([])
    expect(result.complete).toBe(false)
    expect(result.error).toBe(false)
  })

  it('서버의 전체 조회 완료만 완전성으로 인정한다', () => {
    expect(toWorkList({ success: true, contents: [], complete: true, hasMore: false }, workspaceId).complete).toBe(true)
    expect(toWorkList({ success: true, contents: [], complete: true, hasMore: true }, workspaceId).complete).toBe(false)
  })

  it('소속이 없거나 충돌하는 항목은 노출하지 않는다', () => {
    expect(toWorkRow({ contentId: 'unknown', status: 'draft' }, workspaceId)).toBeNull()
    expect(toWorkRow({ contentId: 'conflict', workspaceId, workspace_id: 'other', status: 'draft' }, workspaceId)).toBeNull()
  })

  it('API 오류는 error 로 남긴다', () => {
    expect(toWorkList({ success: false, error: { code: 'X' } }, workspaceId).error).toBe(true)
    expect(toWorkList({ contents: 'nope' }, workspaceId).error).toBe(true)
  })
})

describe('게시 상태 정직성', () => {
  it.each(['published', 'completed'])('요약 목록의 %s 상태만으로 게시 확인을 주장하지 않는다', status => {
    const row = toWorkRow({ contentId: 'summary', workspaceId, status, publicationVerified: false }, workspaceId)
    expect(row?.rawState).toBe(status)
    expect(row?.status).toBe('verifying')
    expect(row?.statusLabel).toBe('게시 확인 전')
  })
  it('게시 확인은 publishedUrl 근거가 있을 때만', () => {
    const published = toWorkRow({ contentId: 'a', title: 't', status: 'published', workspaceId }, workspaceId)
    expect(published?.status).toBe('verifying')
    expect(published?.publishedUrl).toBeNull()
    const withUrl = toWorkRow({ contentId: 'b', title: 't', status: 'published', workspaceId, publishedUrl: 'https://blog.naver.com/x/1' }, workspaceId)
    expect(withUrl?.publishedUrl).toBe('https://blog.naver.com/x/1')
  })

  it('모르는 상태를 초안으로 단정하지 않는다', () => {
    expect(statusLabelFor('weird_state', false, false)).toBe('상태 확인 필요')
    expect(statusLabelFor('completed', true, false)).toBe('승인 완료 · 게시 확인 전')
  })

  it('검토·예약·확인 중을 구분한다', () => {
    expect(deriveWorkStatus('waiting_for_approval', false, false)).toBe('review')
    expect(deriveWorkStatus('scheduled', true, false)).toBe('scheduled')
    expect(deriveWorkStatus('verifying', true, false)).toBe('verifying')
  })
})

describe('허브 복원 상태', () => {
  it('검색·세그먼트·스크롤을 왕복 보존한다', () => {
    const state = { query: '이벤트', segment: 'review' as const, scrollY: 320 }
    expect(parseHubRestore(serializeHubRestore(state))).toEqual(state)
  })
  it('손상되거나 알 수 없는 값은 안전한 기본값으로', () => {
    expect(parseHubRestore('{oops')).toEqual({ query: '', segment: 'all', scrollY: 0 })
    expect(parseHubRestore(JSON.stringify({ query: 'x', segment: 'bogus', scrollY: -5 }))).toEqual({ query: 'x', segment: 'all', scrollY: 0 })
  })
})
