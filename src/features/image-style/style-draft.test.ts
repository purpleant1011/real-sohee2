import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStyleDraft,
  isDraftDifferentFromBaseline,
  loadStyleDraft,
  saveStyleDraft,
  type StyleDraftV1,
} from './style-draft'
import type { WorkspaceImageStyle } from './workspace-image-style'

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('style-draft', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('saves and loads a valid version 1 draft with form, references, and scene', () => {
    const draftInput = {
      form: {
        subject: '대표 디저트',
        composition: '위에서 45도',
        setting: '자연광 매장',
        mood: '따뜻한',
        lookAndColor: '베이지 톤',
        people: 'none' as const,
        avoid: '네온, 과한 보정',
        extra: '추가 요청 메모',
        guide: '소희에게 가르친 상세 지침',
      },
      references: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          url: '/api/workspaces/20000000-0000-4000-8000-000000000001/media/30000000-0000-4000-8000-000000000001',
          note: '대표 크루아상',
        },
      ],
      scene: '디저트 단독 샷',
    }

    saveStyleDraft(workspaceId, draftInput)
    const loaded = loadStyleDraft(workspaceId)

    expect(loaded).not.toBeNull()
    expect(loaded?.version).toBe(1)
    expect(loaded?.form).toEqual(draftInput.form)
    expect(loaded?.references).toEqual(draftInput.references)
    expect(loaded?.scene).toBe('디저트 단독 샷')
    expect(typeof loaded?.updatedAt).toBe('number')
  })

  it('ignores invalid JSON in sessionStorage gracefully without crashing', () => {
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, '{ invalid-json ...')
    const loaded = loadStyleDraft(workspaceId)
    expect(loaded).toBeNull()
  })

  it('rejects drafts exceeding field length limits', () => {
    const tooLongGuide = 'a'.repeat(2001)
    const draftInput = {
      version: 1,
      form: {
        subject: '테스트',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any',
        avoid: '',
        extra: '',
        guide: tooLongGuide,
      },
      references: [],
      scene: '',
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(draftInput))
    const loaded = loadStyleDraft(workspaceId)
    expect(loaded).toBeNull()
  })

  it('rejects drafts with invalid UUID reference ids', () => {
    const draftInput = {
      version: 1,
      form: {
        subject: '테스트',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any',
        avoid: '',
        extra: '',
        guide: '',
      },
      references: [
        {
          id: 'invalid-not-a-uuid',
          url: '/api/workspaces/w/media/1',
          note: '메모',
        },
      ],
      scene: '',
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(draftInput))
    const loaded = loadStyleDraft(workspaceId)
    expect(loaded).toBeNull()
  })

  it('rejects drafts with unsafe blob or data URL references to prevent File/blob/b64 leakage', () => {
    const draftInput = {
      version: 1,
      form: {
        subject: '테스트',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any',
        avoid: '',
        extra: '',
        guide: '',
      },
      references: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          url: 'blob:http://localhost:3000/some-blob-guid',
          note: '블롭 참조',
        },
      ],
      scene: '',
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(draftInput))
    expect(loadStyleDraft(workspaceId)).toBeNull()

    const dataUrlDraft = {
      ...draftInput,
      references: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY44YAAAAASUVORK5CYII=',
          note: 'b64 참조',
        },
      ],
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(dataUrlDraft))
    expect(loadStyleDraft(workspaceId)).toBeNull()
  })

  it('rejects drafts exceeding maximum references limit (8)', () => {
    const refs = Array.from({ length: 9 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      url: `/api/workspaces/w/media/${index}`,
      note: `사진 ${index}`,
    }))
    const draftInput = {
      version: 1,
      form: {
        subject: '테스트',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any',
        avoid: '',
        extra: '',
        guide: '',
      },
      references: refs,
      scene: '',
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(draftInput))
    expect(loadStyleDraft(workspaceId)).toBeNull()
  })

  it('handles sessionStorage errors (QuotaExceededError or security block) gracefully', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => {
      saveStyleDraft(workspaceId, {
        form: {
          subject: '제목',
          composition: '',
          setting: '',
          mood: '',
          lookAndColor: '',
          people: 'any',
          avoid: '',
          extra: '',
          guide: '',
        },
        references: [],
        scene: '',
      })
    }).not.toThrow()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => {
      const result = loadStyleDraft(workspaceId)
      expect(result).toBeNull()
    }).not.toThrow()

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => {
      clearStyleDraft(workspaceId)
    }).not.toThrow()
  })

  it('strictly prohibits storing tokens, secrets, or arbitrary injected properties in draft', () => {
    const maliciousDraft = {
      form: {
        subject: '안전한 피사체',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any' as const,
        avoid: '',
        extra: '',
        guide: '',
        // 주입 시도 필드들
        secretKey: 'sk-secret-12345',
        accessToken: 'bearer-token-xxx',
        password: 'admin-password',
      } as any,
      references: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          url: '/api/workspaces/w/media/1',
          note: '정상 메모',
          // 참조 객체에 주입 시도
          authToken: 'sensitive-token',
        } as any,
      ],
      scene: '',
      apiKey: 'api-key-injection',
    } as any

    saveStyleDraft(workspaceId, maliciousDraft)

    const raw = sessionStorage.getItem(`image-style-draft:${workspaceId}`)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('sk-secret-12345')
    expect(raw).not.toContain('bearer-token-xxx')
    expect(raw).not.toContain('admin-password')
    expect(raw).not.toContain('sensitive-token')
    expect(raw).not.toContain('api-key-injection')

    const loaded = loadStyleDraft(workspaceId)
    expect(loaded).not.toBeNull()
    expect((loaded?.form as any).secretKey).toBeUndefined()
    expect((loaded?.form as any).accessToken).toBeUndefined()
    expect((loaded?.references[0] as any).authToken).toBeUndefined()
    expect((loaded as any).apiKey).toBeUndefined()
  })

  it('strictly isolates drafts between different workspaces during saving, loading, and clearing', () => {
    const workspaceIdA = '20000000-0000-4000-8000-000000000001'
    const workspaceIdB = '20000000-0000-4000-8000-000000000002'

    saveStyleDraft(workspaceIdA, {
      form: {
        subject: '매장 A의 대표 디저트',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any',
        avoid: '',
        extra: '',
        guide: '',
      },
      references: [],
      scene: '매장 A 씬',
    })

    saveStyleDraft(workspaceIdB, {
      form: {
        subject: '매장 B의 헤어 스타일',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'people',
        avoid: '',
        extra: '',
        guide: '',
      },
      references: [],
      scene: '매장 B 씬',
    })

    const loadedA = loadStyleDraft(workspaceIdA)
    const loadedB = loadStyleDraft(workspaceIdB)

    expect(loadedA?.form.subject).toBe('매장 A의 대표 디저트')
    expect(loadedA?.scene).toBe('매장 A 씬')
    expect(loadedB?.form.subject).toBe('매장 B의 헤어 스타일')
    expect(loadedB?.scene).toBe('매장 B 씬')

    // 매장 A의 초안만 삭제
    clearStyleDraft(workspaceIdA)

    expect(loadStyleDraft(workspaceIdA)).toBeNull()
    // 매장 B의 초안은 온전히 남아있어야 함
    expect(loadStyleDraft(workspaceIdB)?.form.subject).toBe('매장 B의 헤어 스타일')
  })

  it('clears draft for a specific workspace', () => {
    saveStyleDraft(workspaceId, {
      form: {
        subject: '제목',
        composition: '',
        setting: '',
        mood: '',
        lookAndColor: '',
        people: 'any',
        avoid: '',
        extra: '',
        guide: '',
      },
      references: [],
      scene: '',
    })
    expect(loadStyleDraft(workspaceId)).not.toBeNull()

    clearStyleDraft(workspaceId)
    expect(loadStyleDraft(workspaceId)).toBeNull()
  })

  describe('isDraftDifferentFromBaseline', () => {
    const initialStyle: WorkspaceImageStyle = {
      subject: '초기 피사체',
      composition: '정면',
      setting: '실내',
      mood: '화사한',
      lookAndColor: '자연광',
      people: 'none',
      avoid: ['어두운 조명'],
      extra: '추가 요청 없음',
      guide: '기본 가이드',
      referenceAssetIds: ['30000000-0000-4000-8000-000000000001'],
      referenceNotes: {
        '30000000-0000-4000-8000-000000000001': '기본 사진',
      },
    }

    it('returns false when draft values match initialStyle exactly', () => {
      const draft: StyleDraftV1 = {
        version: 1,
        form: {
          subject: '초기 피사체',
          composition: '정면',
          setting: '실내',
          mood: '화사한',
          lookAndColor: '자연광',
          people: 'none',
          avoid: '어두운 조명',
          extra: '추가 요청 없음',
          guide: '기본 가이드',
        },
        references: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            url: '/api/workspaces/w/media/30000000-0000-4000-8000-000000000001',
            note: '기본 사진',
          },
        ],
        scene: '',
        updatedAt: Date.now(),
      }

      expect(isDraftDifferentFromBaseline(draft, initialStyle)).toBe(false)
    })

    it('returns true when draft form has modified values', () => {
      const draft: StyleDraftV1 = {
        version: 1,
        form: {
          subject: '수정된 피사체',
          composition: '정면',
          setting: '실내',
          mood: '화사한',
          lookAndColor: '자연광',
          people: 'none',
          avoid: '어두운 조명',
          extra: '추가 요청 없음',
          guide: '기본 가이드',
        },
        references: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            url: '/api/workspaces/w/media/30000000-0000-4000-8000-000000000001',
            note: '기본 사진',
          },
        ],
        scene: '',
        updatedAt: Date.now(),
      }

      expect(isDraftDifferentFromBaseline(draft, initialStyle)).toBe(true)
    })

    it('returns false when initialStyle has empty notes and reversed key order (canonical normalization)', () => {
      const id1 = '30000000-0000-4000-8000-000000000001'
      const id2 = '30000000-0000-4000-8000-000000000002'
      const styleWithEmptyAndReversedNotes: WorkspaceImageStyle = {
        subject: '초기 피사체',
        composition: '정면',
        setting: '실내',
        mood: '화사한',
        lookAndColor: '자연광',
        people: 'none',
        avoid: ['어두운 조명'],
        extra: '추가 요청 없음',
        guide: '기본 가이드',
        referenceAssetIds: [id1, id2],
        referenceNotes: {
          [id2]: '', // 빈 note
          [id1]: '사진1 메모', // 키 순서가 id2 먼저
        },
      }

      const draft: StyleDraftV1 = {
        version: 1,
        form: {
          subject: '초기 피사체',
          composition: '정면',
          setting: '실내',
          mood: '화사한',
          lookAndColor: '자연광',
          people: 'none',
          avoid: '어두운 조명',
          extra: '추가 요청 없음',
          guide: '기본 가이드',
        },
        references: [
          {
            id: id1,
            url: `/api/workspaces/w/media/${id1}`,
            note: '사진1 메모',
          },
          {
            id: id2,
            url: `/api/workspaces/w/media/${id2}`,
            note: '',
          },
        ],
        scene: '',
        updatedAt: Date.now(),
      }

      expect(isDraftDifferentFromBaseline(draft, styleWithEmptyAndReversedNotes)).toBe(false)
    })

    it('returns true when draft references differ from initialStyle', () => {
      const draft: StyleDraftV1 = {
        version: 1,
        form: {
          subject: '초기 피사체',
          composition: '정면',
          setting: '실내',
          mood: '화사한',
          lookAndColor: '자연광',
          people: 'none',
          avoid: '어두운 조명',
          extra: '추가 요청 없음',
          guide: '기본 가이드',
        },
        references: [],
        scene: '',
        updatedAt: Date.now(),
      }

      expect(isDraftDifferentFromBaseline(draft, initialStyle)).toBe(true)
    })

    it('returns true when initialStyle is null and draft has non-empty values', () => {
      const draft: StyleDraftV1 = {
        version: 1,
        form: {
          subject: '입력된 피사체',
          composition: '',
          setting: '',
          mood: '',
          lookAndColor: '',
          people: 'any',
          avoid: '',
          extra: '',
          guide: '',
        },
        references: [],
        scene: '',
        updatedAt: Date.now(),
      }

      expect(isDraftDifferentFromBaseline(draft, null)).toBe(true)
    })

    it('returns false when initialStyle is null and draft is completely empty', () => {
      const draft: StyleDraftV1 = {
        version: 1,
        form: {
          subject: '',
          composition: '',
          setting: '',
          mood: '',
          lookAndColor: '',
          people: 'any',
          avoid: '',
          extra: '',
          guide: '',
        },
        references: [],
        scene: '',
        updatedAt: Date.now(),
      }

      expect(isDraftDifferentFromBaseline(draft, null)).toBe(false)
    })
  })
})
