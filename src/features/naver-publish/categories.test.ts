import { describe, expect, it } from 'vitest'
import { findCategory, formatCategoryPath, isCategoryStillValid, normalizeCategories } from './categories'

const RAW = [
  { id: '16', label: '고스트셀러', depth: 0 },
  { id: '17', label: '하위 카테고리 고스트셀러 소개', depth: 1 },
  { id: '18', label: '└ 고스트셀러 서비스', depth: 1 },
  { id: '20', label: '파인드케이', depth: 0 },
  { id: '21', label: '하위 카테고리 회사소개', depth: 1 },
]

describe('normalizeCategories', () => {
  it('builds a two-level list and strips the accessibility prefix', () => {
    expect(normalizeCategories(RAW)).toEqual([
      { id: '16', name: '고스트셀러', parentId: null },
      { id: '17', name: '고스트셀러 소개', parentId: '16' },
      { id: '18', name: '고스트셀러 서비스', parentId: '16' },
      { id: '20', name: '파인드케이', parentId: null },
      { id: '21', name: '회사소개', parentId: '20' },
    ])
  })

  it('drops blank labels, blank ids and duplicate ids', () => {
    const list = normalizeCategories([
      { id: '1', label: ' 일상 ', depth: 0 },
      { id: '1', label: '중복', depth: 0 },
      { id: '', label: '아이디 없음', depth: 0 },
      { id: '2', label: '   ', depth: 0 },
    ])
    expect(list).toEqual([{ id: '1', name: '일상', parentId: null }])
  })

  it('does not invent a parent for an orphan sub-category', () => {
    expect(normalizeCategories([{ id: '9', label: '하위 카테고리 외톨이', depth: 1 }])).toEqual([{ id: '9', name: '외톨이', parentId: null }])
  })

  it('preserves path-based ids and sets depth 1 parentId to previous top-level id', () => {
    const raw = [
      { id: 'path:고스트셀러', label: '고스트셀러', depth: 0 },
      { id: 'path:고스트셀러/공지사항', label: '공지사항', depth: 1 },
      { id: 'path:고스트셀러/이벤트', label: '하위 카테고리 이벤트', depth: 1 },
    ]
    expect(normalizeCategories(raw)).toEqual([
      { id: 'path:고스트셀러', name: '고스트셀러', parentId: null },
      { id: 'path:고스트셀러/공지사항', name: '공지사항', parentId: 'path:고스트셀러' },
      { id: 'path:고스트셀러/이벤트', name: '이벤트', parentId: 'path:고스트셀러' },
    ])
  })
})

describe('category helpers', () => {
  const list = normalizeCategories(RAW)

  it('detects a category removed from the synced list', () => {
    expect(isCategoryStillValid(list, '17')).toBe(true)
    expect(isCategoryStillValid(list, '999')).toBe(false)
    expect(isCategoryStillValid(list, null)).toBe(false)
  })

  it('formats a readable path', () => {
    expect(formatCategoryPath(list, findCategory(list, '17')!)).toBe('고스트셀러 > 고스트셀러 소개')
    expect(formatCategoryPath(list, findCategory(list, '20')!)).toBe('파인드케이')
  })
})
