import { describe, expect, it } from 'vitest'
import { verifyDraftReadback } from './draft-readback-match'
import type { FirstPostMissionDraft } from '@/features/missions/conversational-first-post'

describe('verifyDraftReadback', () => {
  const expected: {
    missionId: string
    workspaceId: string
    copies: FirstPostMissionDraft['copies']
    selectedImageIds: string[]
    approvalFingerprint: string
  } = {
    missionId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    copies: {
      instagram: {
        caption: '본문 원고 내용입니다.\n줄바꿈 포함',
        hashtags: ['#태그1', '#태그2'],
        cta: '지금 바로 예약해 보세요!',
      },
      threads: {
        content: '스레드 본문입니다.',
        cta: '프로필 링크 확인',
      },
    },
    selectedImageIds: ['img-1', 'img-2'],
    approvalFingerprint: 'a'.repeat(64),
  }

  it('동일한 내용이면 객체 키 삽입 순서가 달라도 matches=true', () => {
    const actual = {
      workspaceId: expected.workspaceId,
      missionId: expected.missionId,
      approvalFingerprint: expected.approvalFingerprint,
      selectedImageIds: ['img-1', 'img-2'],
      copies: {
        threads: {
          cta: '프로필 링크 확인',
          content: '스레드 본문입니다.',
        },
        instagram: {
          cta: '지금 바로 예약해 보세요!',
          hashtags: ['#태그1', '#태그2'],
          caption: '본문 원고 내용입니다.\n줄바꿈 포함',
        },
      },
    }

    const res = verifyDraftReadback(expected, actual)
    expect(res.matches).toBe(true)
    expect(res.mismatches).toEqual([])
  })

  it('actual이 객체가 아니거나 null이면 전체 불일치', () => {
    expect(verifyDraftReadback(expected, null)).toEqual({
      matches: false,
      mismatches: ['actual_not_object'],
    })
    expect(verifyDraftReadback(expected, 'string')).toEqual({
      matches: false,
      mismatches: ['actual_not_object'],
    })
  })

  it('기본 메타데이터(missionId, workspaceId, approvalFingerprint) 불일치 감지', () => {
    const actual = {
      ...expected,
      missionId: 'diff-mission',
      workspaceId: 'diff-ws',
      approvalFingerprint: 'b'.repeat(64),
    }

    const res = verifyDraftReadback(expected, actual)
    expect(res.matches).toBe(false)
    expect(res.mismatches).toContain('missionId')
    expect(res.mismatches).toContain('workspaceId')
    expect(res.mismatches).toContain('approvalFingerprint')
  })

  it('사진 IDs 순서가 다르면 불일치 (순서 보장)', () => {
    const actual = {
      ...expected,
      selectedImageIds: ['img-2', 'img-1'],
    }

    const res = verifyDraftReadback(expected, actual)
    expect(res.matches).toBe(false)
    expect(res.mismatches).toEqual(['selectedImageIds'])
  })

  it('원문 공백/줄바꿈이 다르면 불일치 감지 및 PII 노출 없이 필드명만 반환', () => {
    const actual = {
      ...expected,
      copies: {
        ...expected.copies,
        instagram: {
          ...expected.copies.instagram,
          caption: '본문 원고 내용입니다. 줄바꿈 없음',
        },
      },
    }

    const res = verifyDraftReadback(expected, actual)
    expect(res.matches).toBe(false)
    expect(res.mismatches).toEqual(['copies.instagram.caption'])
    // 원고 내용(PII)이 에러 문자열에 포함되지 않아야 함
    expect(JSON.stringify(res.mismatches)).not.toContain('본문 원고 내용입니다')
  })

  it('채널별 CTA 불일치 및 누락 감지', () => {
    const actualMissingCta = {
      ...expected,
      copies: {
        ...expected.copies,
        instagram: {
          caption: expected.copies.instagram.caption,
          hashtags: expected.copies.instagram.hashtags,
          // cta 누락
        },
      },
    }

    const res = verifyDraftReadback(expected, actualMissingCta)
    expect(res.matches).toBe(false)
    expect(res.mismatches).toEqual(['copies.instagram.cta'])
  })

  it('해시태그 순서 및 값 불일치 감지', () => {
    const actualDiffHashtags = {
      ...expected,
      copies: {
        ...expected.copies,
        instagram: {
          ...expected.copies.instagram,
          hashtags: ['#태그2', '#태그1'],
        },
      },
    }

    const res = verifyDraftReadback(expected, actualDiffHashtags)
    expect(res.matches).toBe(false)
    expect(res.mismatches).toEqual(['copies.instagram.hashtags'])
  })

  it('array-like 객체({ 0: id, length: 1 })나 비배열/숫자/비문자열 요소는 엄격 차단', () => {
    // selectedImageIds array-like 위조 객체
    const arrayLikeImages = {
      ...expected,
      selectedImageIds: { 0: 'img-1', 1: 'img-2', length: 2 },
    }
    const resImages = verifyDraftReadback(expected, arrayLikeImages)
    expect(resImages.matches).toBe(false)
    expect(resImages.mismatches).toContain('selectedImageIds')

    // selectedImageIds 요소가 숫자인 경우
    const nonStringImages = {
      ...expected,
      selectedImageIds: ['img-1', 12345],
    }
    expect(verifyDraftReadback(expected, nonStringImages).matches).toBe(false)

    // hashtags array-like 위조 객체
    const arrayLikeHashtags = {
      ...expected,
      copies: {
        ...expected.copies,
        instagram: {
          ...expected.copies.instagram,
          hashtags: { 0: '#태그1', 1: '#태그2', length: 2 },
        },
      },
    }
    const resHashtags = verifyDraftReadback(expected, arrayLikeHashtags)
    expect(resHashtags.matches).toBe(false)
    expect(resHashtags.mismatches).toContain('copies.instagram.hashtags')

    // hashtags 요소가 숫자인 경우
    const nonStringHashtags = {
      ...expected,
      copies: {
        ...expected.copies,
        instagram: {
          ...expected.copies.instagram,
          hashtags: ['#태그1', 999],
        },
      },
    }
    expect(verifyDraftReadback(expected, nonStringHashtags).matches).toBe(false)
  })
})
