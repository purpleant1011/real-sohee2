import { describe, expect, it, vi } from 'vitest'

import {
  CHAT_PHOTO_ACCEPT,
  chatPhotoCountLabel,
  createPreviewUrl,
  isChatPhotoFull,
  MAX_CHAT_PHOTOS,
  MAX_PHOTO_BYTES,
  photoKey,
  planChatPhotos,
  revokePreviewUrl,
} from './attachment-preview'

function file(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return {
    name: 'dress.jpg',
    type: 'image/jpeg',
    size: 1024,
    ...overrides,
  }
}

describe('planChatPhotos', () => {
  it('통과한 사진만 붙이고 거절은 비운다', () => {
    const plan = planChatPhotos([file(), file({ name: 'b.png', type: 'image/png' })])

    expect(plan.accepted).toHaveLength(2)
    expect(plan.rejected).toEqual([])
  })

  it('HEIC 는 서버 계약과 같은 문구로 거절한다', () => {
    const plan = planChatPhotos([file({ name: 'IMG_1.heic', type: 'image/heic' })])

    expect(plan.accepted).toEqual([])
    expect(plan.rejected).toEqual([
      {
        name: 'IMG_1.heic',
        message: '아이폰 HEIC 사진은 아직 올릴 수 없어요. JPG 또는 PNG로 변환한 뒤 골라 주세요.',
      },
    ])
  })

  it('10MB 를 넘는 사진은 거절한다', () => {
    const plan = planChatPhotos([file({ size: MAX_PHOTO_BYTES + 1 })])

    expect(plan.accepted).toEqual([])
    expect(plan.rejected[0]?.message).toContain('10MB')
  })

  it('상한을 넘는 파일은 상한 문구로 거절한다', () => {
    const plan = planChatPhotos(
      [file({ name: 'a.jpg' }), file({ name: 'b.jpg' }), file({ name: 'c.jpg' }), file({ name: 'd.jpg' })],
      0,
      MAX_CHAT_PHOTOS,
    )

    expect(plan.accepted.map(entry => entry.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(plan.rejected).toEqual([
      { name: 'd.jpg', message: '사진은 최대 3장까지 붙일 수 있어요.' },
    ])
  })

  it('이미 붙인 사진이 있으면 남은 자리만큼만 받는다', () => {
    const plan = planChatPhotos([file({ name: 'b.jpg' }), file({ name: 'c.jpg' })], 2, 3)

    expect(plan.accepted.map(entry => entry.name)).toEqual(['b.jpg'])
    expect(plan.rejected).toEqual([
      { name: 'c.jpg', message: '사진은 최대 3장까지 붙일 수 있어요.' },
    ])
  })

  it('같은 사진을 다시 고르면 중복으로 거절한다', () => {
    const plan = planChatPhotos([file(), file()])

    expect(plan.accepted).toHaveLength(1)
    expect(plan.rejected).toEqual([{ name: 'dress.jpg', message: '이미 붙인 사진이에요.' }])
  })

  it('이미 붙인 사진의 키를 넘기면 중복으로 거절한다', () => {
    const plan = planChatPhotos([file()], 1, 3, [photoKey(file())])

    expect(plan.accepted).toEqual([])
    expect(plan.rejected[0]?.message).toBe('이미 붙인 사진이에요.')
  })

  it('거절된 사진은 상한 자리를 쓰지 않는다', () => {
    const plan = planChatPhotos(
      [file({ name: 'x.heic', type: 'image/heic' }), file({ name: 'a.jpg' }), file({ name: 'b.jpg' })],
      2,
      3,
    )

    expect(plan.accepted.map(entry => entry.name)).toEqual(['a.jpg'])
    expect(plan.rejected).toHaveLength(2)
  })

  it('빈 선택은 아무 일도 하지 않는다', () => {
    expect(planChatPhotos([])).toEqual({ accepted: [], rejected: [] })
  })
})

describe('photoKey', () => {
  it('이름과 크기로 같은 사진을 가른다', () => {
    expect(photoKey(file())).toBe('dress.jpg:1024')
    expect(photoKey(file({ size: 1025 }))).not.toBe(photoKey(file()))
  })
})

describe('안내 문구', () => {
  it('상한을 문장으로 보여 준다', () => {
    expect(chatPhotoCountLabel(0)).toBe('사진 0장 (최대 3장)')
    expect(chatPhotoCountLabel(2, 5)).toBe('사진 2장 (최대 5장)')
  })

  it('상한에 닿으면 가득 찬 것으로 본다', () => {
    expect(isChatPhotoFull(2)).toBe(false)
    expect(isChatPhotoFull(3)).toBe(true)
    expect(isChatPhotoFull(4)).toBe(true)
  })

  it('accept 값은 검사 통과 형식과 같다', () => {
    expect(CHAT_PHOTO_ACCEPT).toBe('image/jpeg,image/png')
  })
})

describe('미리보기 URL', () => {
  it('브라우저가 지원하지 않으면 만들지 않는다', () => {
    vi.stubGlobal('URL', undefined)
    try {
      expect(createPreviewUrl(new Blob(['x']))).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('null 은 조용히 넘긴다', () => {
    expect(() => revokePreviewUrl(null)).not.toThrow()
  })
})
