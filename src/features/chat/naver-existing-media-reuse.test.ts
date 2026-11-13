import { describe, expect, it } from 'vitest'
import {
  createExistingNaverMediaBatch,
  requestsExistingNaverMedia,
  requestsAttachedMediaReuse,
  type ReusableNaverMediaCandidate,
} from './naver-existing-media-reuse'

const ids = Array.from({ length: 13 }, (_, index) => `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000001`)

function candidate(index: number, title = `콘텐츠 ${index}`): ReusableNaverMediaCandidate {
  return {
    mediaAssetId: ids[index],
    title,
    caption: '네이버 블로그 콘텐츠',
    createdAt: new Date(Date.UTC(2026, 7, 14, 15, index)).toISOString(),
  }
}

describe('Naver existing media reuse', () => {
  it.each([
    ['이 사진으로 인스타그램 글 만들어줘', true],
    ['첨부 사진 원본 2장을 그대로 사용해줘', true],
    ['올린 사진을 활용하고 새 이미지는 생성하지 마', true],
    ['첨부 사진의 스타일만 참고해서 새로 만들어줘', false],
    ['이 사진 색감을 참고해서 새 이미지를 만들어줘', false],
    ['인스타그램 이미지 3장 새로 생성해줘', false],
    ['첨부 사진으로 새 이미지를 생성해서 인스타그램 게시물을 만들어줘', false],
    ['첨부 사진은 사용하지 말고 새 이미지를 생성해줘', false],
    ['첨부 사진을 그대로 사용하고 새 이미지는 생성하지 마', true],
    ['이 사진은 쓰지 말고 다른 초안을 준비해줘', false],
  ])('distinguishes original reuse from image references: %s', (prompt, reuse) => {
    expect(requestsAttachedMediaReuse(prompt)).toBe(reuse)
  })

  it('requires an explicit reuse request that also forbids new generation', () => {
    expect(requestsExistingNaverMedia('기존 사용권 확인 이미지를 활용하고 새 이미지는 생성하지 마.')).toBe(true)
    expect(requestsExistingNaverMedia('기존 이미지와 새 이미지 11장을 추가 생성해줘.')).toBe(false)
  })

  it('builds an ordered ready batch from relevant existing media', () => {
    const candidates = Array.from({ length: 13 }, (_, index) => candidate(index))
    candidates.push({ ...candidate(0), createdAt: new Date().toISOString() })
    candidates.push(candidate(12, '소희 제품 소개'))

    const batch = createExistingNaverMediaBatch({
      candidates,
      count: 12,
      idempotencyKey: '40000000-0000-4000-8000-000000000001',
      createSlideId: (position) => `slide-${position}`,
    })

    expect(batch).toMatchObject({ status: 'ready_for_review', requestedCount: 12, succeededCount: 12 })
    expect(batch.slides).toHaveLength(12)
    expect(batch.slides.map((slide) => slide.position)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
    expect(new Set(batch.slides.map((slide) => slide.mediaAssetId)).size).toBe(12)
  })

  it('preserves the exact attachment order without selecting unrelated workspace media', () => {
    const candidates = [
      candidate(0, '사용자 첨부 첫 번째'),
      candidate(1, '사용자 첨부 두 번째'),
      candidate(2, '사용자 첨부 세 번째'),
    ]

    const batch = createExistingNaverMediaBatch({
      candidates,
      count: 3,
      idempotencyKey: '40000000-0000-4000-8000-000000000001',
      orderedMediaAssetIds: [ids[2], ids[0], ids[1]],
      createSlideId: (position) => `slide-${position}`,
    })

    expect(batch.slides.map((slide) => slide.mediaAssetId)).toEqual([ids[2], ids[0], ids[1]])
  })

  it('fails closed when the workspace lacks enough relevant media', () => {
    expect(() => createExistingNaverMediaBatch({
      candidates: [candidate(0)],
      count: 12,
      idempotencyKey: '40000000-0000-4000-8000-000000000001',
      createSlideId: (position) => `slide-${position}`,
    })).toThrow('NAVER_REUSABLE_MEDIA_INSUFFICIENT')
  })

  it('excludes eyebrow/byreum keywords and only includes media containing 네이버 블로그', () => {
    const relevant = {
      mediaAssetId: ids[0],
      title: '매장 사진',
      caption: '네이버 블로그 포스팅용 사진',
      createdAt: new Date().toISOString(),
    }
    const eyebrowOnly = {
      mediaAssetId: ids[1],
      title: 'BY.REUM 눈썹 반영구',
      caption: '반영구 눈썹 시술 전후',
      createdAt: new Date().toISOString(),
    }

    const batch = createExistingNaverMediaBatch({
      candidates: [relevant, eyebrowOnly],
      count: 1,
      idempotencyKey: '40000000-0000-4000-8000-000000000001',
      createSlideId: (position) => `slide-${position}`,
    })

    expect(batch.slides[0]?.mediaAssetId).toBe(ids[0])
    expect(() => createExistingNaverMediaBatch({
      candidates: [eyebrowOnly],
      count: 1,
      idempotencyKey: '40000000-0000-4000-8000-000000000002',
      createSlideId: (position) => `slide-${position}`,
    })).toThrow('NAVER_REUSABLE_MEDIA_INSUFFICIENT')
  })

  it('uses neutral altText fallback for non-byreum workspaces and preserves byreum text when specified', () => {
    const emptyTitleCandidate = {
      mediaAssetId: ids[0],
      title: '   ',
      caption: '네이버 블로그 포스팅용 사진',
      createdAt: new Date().toISOString(),
    }

    const nonByreumBatch = createExistingNaverMediaBatch({
      candidates: [emptyTitleCandidate],
      count: 1,
      idempotencyKey: '40000000-0000-4000-8000-000000000003',
      createSlideId: (position) => `slide-${position}`,
    })

    expect(nonByreumBatch.slides[0]?.altText).toBe('블로그 이미지 1번')
    expect(nonByreumBatch.slides[0]?.altText).not.toContain('바이름')
    expect(nonByreumBatch.slides[0]?.altText).not.toContain('눈썹')

    const byreumBatch = createExistingNaverMediaBatch({
      candidates: [emptyTitleCandidate],
      count: 1,
      idempotencyKey: '40000000-0000-4000-8000-000000000004',
      isByreum: true,
      createSlideId: (position) => `slide-${position}`,
    })

    expect(byreumBatch.slides[0]?.altText).toBe('바이름 네이버 블로그 1번 이미지')
  })
})
