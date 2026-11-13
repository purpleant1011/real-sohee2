import { describe, expect, it } from 'vitest'
import type { FirstPostMissionDraft } from './conversational-first-post'
import { prepareFirstPostCopySave } from './first-post-copy-save'

const sampleDraft: FirstPostMissionDraft = {
  missionId: 'mission-uuid-1',
  workspaceId: 'ws-uuid-1',
  status: 'AWAITING_EXACT_APPROVAL',
  topic: '가을 신메뉴 소개',
  goal: '첫 게시물 발행 미션',
  copies: {
    instagram: {
      caption: '기존 인스타 본문',
      hashtags: ['신메뉴', '카페'],
      cta: '프로필 링크에서 예약하기',
    },
    threads: {
      content: '기존 스레드 본문',
      cta: 'DM으로 문의',
    },
  },
  selectedImageIds: ['img-1', 'img-2'],
  mediaPreviews: [
    { id: 'img-1', url: '/api/workspaces/ws-uuid-1/media/img-1' },
    { id: 'img-2', url: '/api/workspaces/ws-uuid-1/media/img-2' },
  ],
  boundVersions: {
    knowledgeVersion: 1,
    textHarnessVersion: 2,
    imageHarnessVersion: 3,
    operatingPolicyVersion: 4,
  },
  rights: {
    rightsStatus: 'OWNED',
    consentStatus: 'NOT_APPLICABLE',
  },
  channels: [
    { provider: 'instagram', handle: '@my_shop' },
    { provider: 'threads', handle: '@my_shop' },
  ],
  approvalFingerprint: 'valid-fp-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  createdAt: '2026-10-24T09:00:00.000Z',
  knowledgeSnapshot: {
    businessName: '맛있는 카페',
  },
}

describe('prepareFirstPostCopySave (ANI-1787)', () => {
  it('기대 지문과 일치하지 않으면 STALE_APPROVAL 에러를 반환한다', () => {
    const result = prepareFirstPostCopySave({
      draft: sampleDraft,
      expectedFingerprint: 'different-stale-fingerprint',
      copies: {
        instagram: { caption: '새 본문' },
        threads: { content: '새 본문' },
      },
    })

    expect(result).toEqual({
      ok: false,
      code: 'STALE_APPROVAL',
      message: '초안이 다른 곳에서 수정되었거나 최신 버전이 아닙니다. 최신 초안을 다시 불러와 주세요.',
    })
  })

  it('유효하지 않은 문구 형태(객체 결함 또는 caption/content 누락·비문자열)이면 INVALID_COPY 에러를 반환한다', () => {
    // 1. null copies
    expect(
      prepareFirstPostCopySave({
        draft: sampleDraft,
        expectedFingerprint: sampleDraft.approvalFingerprint,
        copies: null as any,
      })
    ).toEqual({ ok: false, code: 'INVALID_COPY', message: '수정할 문구 형태가 올바르지 않습니다.' })

    // 2. instagram caption 누락
    expect(
      prepareFirstPostCopySave({
        draft: sampleDraft,
        expectedFingerprint: sampleDraft.approvalFingerprint,
        copies: {
          instagram: {} as any,
          threads: { content: '스레드 본문' },
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_COPY', message: '인스타그램 본문(caption)은 문자열이어야 합니다.' })

    // 3. threads content 누락
    expect(
      prepareFirstPostCopySave({
        draft: sampleDraft,
        expectedFingerprint: sampleDraft.approvalFingerprint,
        copies: {
          instagram: { caption: '인스타 본문' },
          threads: {} as any,
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_COPY', message: '스레드 본문(content)은 문자열이어야 합니다.' })
  })

  it('정상 문구 저장 시 사용자 입력(공백/개행/CTA)을 절대 trim하거나 변경하지 않고 100% 원문 그대로 보존한다', () => {
    const rawCopies = {
      instagram: {
        caption: '  앞뒤 공백과\n\n\n여러 개행이\n포함된   문구  ',
        hashtags: ['가을', '신메뉴'],
        cta: '   CTA 공백 보존  ',
      },
      threads: {
        content: '\t탭과 공백이 있는   스레드\n\n내용\n',
        cta: '문의하기\n',
      },
    }

    const result = prepareFirstPostCopySave({
      draft: sampleDraft,
      expectedFingerprint: sampleDraft.approvalFingerprint,
      copies: rawCopies,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 사용자 입력이 trim/LLM 재생성 없이 완전 동일하게 보존됨을 엄격 단언
    expect(result.revisedDraft.copies.instagram.caption).toBe(rawCopies.instagram.caption)
    expect(result.revisedDraft.copies.instagram.cta).toBe(rawCopies.instagram.cta)
    expect(result.revisedDraft.copies.instagram.hashtags).toEqual(rawCopies.instagram.hashtags)
    expect(result.revisedDraft.copies.threads.content).toBe(rawCopies.threads.content)
    expect(result.revisedDraft.copies.threads.cta).toBe(rawCopies.threads.cta)
  })

  it('문구 수정 시 원본 draft를 변이하지 않고, 사진·권리·채널 불변 및 지문 재계산을 수행한다', () => {
    const draftClone = JSON.parse(JSON.stringify(sampleDraft))
    const newCopies = {
      instagram: {
        caption: '완전히 새로운 인스타 문구',
        cta: '새로운 CTA',
      },
      threads: {
        content: '완전히 새로운 스레드 문구',
      },
    }

    const result = prepareFirstPostCopySave({
      draft: sampleDraft,
      expectedFingerprint: sampleDraft.approvalFingerprint,
      copies: newCopies,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 1. 원본 draft 객체 불변 (No mutation)
    expect(sampleDraft).toEqual(draftClone)

    // 2. 사진, rights, channels, boundVersions 등 비-문구 속성 불변 유지
    expect(result.revisedDraft.missionId).toBe(sampleDraft.missionId)
    expect(result.revisedDraft.workspaceId).toBe(sampleDraft.workspaceId)
    expect(result.revisedDraft.selectedImageIds).toEqual(sampleDraft.selectedImageIds)
    expect(result.revisedDraft.mediaPreviews).toEqual(sampleDraft.mediaPreviews)
    expect(result.revisedDraft.rights).toEqual(sampleDraft.rights)
    expect(result.revisedDraft.channels).toEqual(sampleDraft.channels)
    expect(result.revisedDraft.boundVersions).toEqual(sampleDraft.boundVersions)
    expect(result.revisedDraft.knowledgeSnapshot).toEqual(sampleDraft.knowledgeSnapshot)

    // 3. 지문 재계산 검증 (기존 지문과 달라져야 하며 빈 값이 아님)
    expect(result.revisedDraft.approvalFingerprint).not.toBe(sampleDraft.approvalFingerprint)
    expect(result.revisedDraft.approvalFingerprint).toMatch(/^[a-f0-9]{64}$/)

    // 4. 상태 검증: 승인 대기 상태로 유지
    expect(result.revisedDraft.status).toBe('AWAITING_EXACT_APPROVAL')
  })
})
