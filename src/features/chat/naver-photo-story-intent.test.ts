import { describe, expect, it } from 'vitest'
import { detectPhotoStoryRequest } from './naver-photo-story-intent'

describe('detectPhotoStoryRequest', () => {
  it('detects photo story requests combining photo emphasis and brevity', () => {
    expect(detectPhotoStoryRequest('사진 위주로 2~3줄씩 짧게 써줘')).toBe(true)
    expect(detectPhotoStoryRequest('사진 15장 넣고 각 사진마다 짧게 두세줄 설명만 달아줘')).toBe(true)
    expect(detectPhotoStoryRequest('포토스토리 스타일로 사진 중심으로 짧게 부탁해')).toBe(true)
    expect(detectPhotoStoryRequest('포토 위주 블로그 글 간단히 2-3줄로')).toBe(true)
    expect(detectPhotoStoryRequest('사진 많이 넣고 글은 간결하게 써줘')).toBe(true)
  })

  it('returns false when only photo emphasis is present without brevity', () => {
    expect(detectPhotoStoryRequest('사진 위주로 길고 자세하게 설명해줘')).toBe(false)
    expect(detectPhotoStoryRequest('사진 15장 넣어서 상세하고 전문적인 정보글 써줘')).toBe(false)
    expect(detectPhotoStoryRequest('사진 많이 넣어줘')).toBe(false)
  })

  it('returns false when only brevity is present without photo emphasis', () => {
    expect(detectPhotoStoryRequest('2~3줄로 짧게 써줘')).toBe(false)
    expect(detectPhotoStoryRequest('간결하게 두세줄로 요약해줘')).toBe(false)
    expect(detectPhotoStoryRequest('핵심만 간단히 작성해줘')).toBe(false)
  })

  it('returns false for empty or unrelated messages', () => {
    expect(detectPhotoStoryRequest('')).toBe(false)
    expect(detectPhotoStoryRequest('   ')).toBe(false)
    expect(detectPhotoStoryRequest('네이버 블로그 정보성 글 작성해줘')).toBe(false)
    expect(detectPhotoStoryRequest('바이름 매장 소개글 써줘')).toBe(false)
  })
})
