import { describe, expect, it, vi } from 'vitest'
import {
  BYREUM_IMAGE_HARNESS,
  composeByreumImagePrompt,
} from '@/features/harness/byreum-image-harness'
import {
  generateConversationImageArtifact,
  generateConversationImageBatchArtifacts,
  selectReferenceIds,
} from './conversation-image-generation'
import type { ContentBrief } from './content-interview'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const assetId = '77777777-7777-4777-8777-777777777777'

describe('generateConversationImageArtifact', () => {
  it('composes the approved Byreum harness, stores the private draft, and returns a stable media route', async () => {
    const generate = vi.fn(async (request: { prompt: string; size: '1024x1536' }) => {
      void request
      return {
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png' as const,
        requestId: 'openai-request-1',
      }
    })
    const store = vi.fn(async () => ({ assetId }))

    const artifact = await generateConversationImageArtifact({
      workspaceId,
      userId,
      prompt: '부드러운 인상의 자연스러운 눈썹 사진을 만들어줘',
      channel: 'instagram',
    }, {
      authorize: vi.fn(async () => ({ email: 'test@example.com', role: 'owner' as const })),
      loadHarness: vi.fn(async () => BYREUM_IMAGE_HARNESS),
      generate,
      store,
    })

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('No visible text, logo, watermark'),
      size: '1024x1536',
    }))
    expect(store).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      userId,
      role: 'owner',
      mimeType: 'image/png',
    }))
    expect(artifact).toEqual({
      id: assetId,
      kind: 'image_draft',
      title: '바이름 인스타그램 이미지 초안',
      href: `/api/workspaces/${workspaceId}/media/${assetId}`,
      previewUrl: `/api/workspaces/${workspaceId}/media/${assetId}`,
      statusLabel: '승인 대기',
      requiresConfirmation: true,
    })
  })

  it('refuses image generation when the member cannot create customer content', async () => {
    await expect(generateConversationImageArtifact({
      workspaceId,
      userId,
      prompt: '이미지를 만들어줘',
      channel: 'threads',
    }, {
      authorize: vi.fn(async () => null),
      loadHarness: vi.fn(),
      generate: vi.fn(),
      store: vi.fn(),
    })).rejects.toThrow('CHAT_IMAGE_FORBIDDEN')
  })
})

describe('generateConversationImageBatchArtifacts', () => {
  it('passes the same interview brief into every generated image prompt', async () => {
    const contentBrief = {
      channels: ['instagram'], goal: { value: 'consultation' }, audience: { value: 'local' },
      audienceProblem: '청라에서 자연스러운 눈썹 상담을 찾는 분',
      textDirection: { structure: { value: 'empathy_info_consult' }, tone: '친절하게', messageAngle: '상담 기준' },
      imageDirection: { mood: { value: 'detail' }, composition: '눈썹 결 중심', sceneRoles: ['표지'], avoid: ['전후 비교'] },
      callToAction: { value: 'consult' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
    } satisfies ContentBrief
    const generate = vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' as const, requestId: null }))

    await generateConversationImageBatchArtifacts({
      workspaceId, userId, prompt: '눈썹 캐러셀', channel: 'instagram', count: 1,
      idempotencyKey: 'brief-batch', contentBrief,
    }, {
      authorize: vi.fn(async () => ({ email: null, role: 'owner' as const })),
      loadHarness: vi.fn(async () => BYREUM_IMAGE_HARNESS), generate,
      store: vi.fn(async () => ({ assetId })), createSlideId: () => 'slide-1',
    })

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('대상 독자와 고민: 청라에서 자연스러운 눈썹 상담을 찾는 분'),
    }))
  })

  it('authorizes once and stores every successful slide in order', async () => {
    let nextAsset = 0
    const authorize = vi.fn(async () => ({ email: 'test@example.com', role: 'owner' as const }))
    const loadHarness = vi.fn(async () => BYREUM_IMAGE_HARNESS)
    const generate = vi.fn(async (request: { prompt: string; size: '1024x1536' }) => {
      void request
      return {
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png' as const,
        requestId: null,
      }
    })
    const store = vi.fn(async () => ({ assetId: `asset-${++nextAsset}` }))

    const batch = await generateConversationImageBatchArtifacts({
      workspaceId,
      userId,
      prompt: '눈썹 캐러셀을 만들어줘',
      channel: 'instagram',
      count: 3,
      idempotencyKey: 'batch-request-1',
    }, {
      authorize,
      loadHarness,
      generate,
      store,
      createSlideId: (position) => `slide-${position}`,
    })

    expect(authorize).toHaveBeenCalledTimes(1)
    expect(loadHarness).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledTimes(3)
    expect(store).toHaveBeenCalledTimes(3)
    expect(batch.slides.map((slide) => slide.mediaAssetId)).toEqual([
      'asset-1',
      'asset-2',
      'asset-3',
    ])
    expect(generate.mock.calls.map(([request]) => request.prompt)).toEqual([
      expect.stringContaining('표지'),
      expect.stringContaining('상세'),
      expect.stringContaining('행동 유도'),
    ])
  })

  it('uses the exact editorial prompt assigned to each image slot', async () => {
    const generate = vi.fn(async (request: { prompt: string; size: '1024x1536' }) => {
      void request
      return {
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png' as const,
        requestId: null,
      }
    })
    await generateConversationImageBatchArtifacts({
      workspaceId, userId, prompt: '공통 요청', channel: 'naver_blog', count: 3,
      idempotencyKey: 'batch-editorial-prompts',
      slidePrompts: ['표지 장면', '상담 기준 장면', '문의 유도 장면'],
    }, {
      authorize: vi.fn(async () => ({ email: null, role: 'owner' as const })),
      loadHarness: vi.fn(async () => BYREUM_IMAGE_HARNESS),
      generate,
      store: vi.fn(async () => ({ assetId })),
      createSlideId: (position) => `slide-${position}`,
    })

    expect(generate.mock.calls.map(([request]) => request.prompt)).toEqual([
      expect.stringContaining('표지 장면'),
      expect.stringContaining('상담 기준 장면'),
      expect.stringContaining('문의 유도 장면'),
    ])
  })

  it('keeps stored successes when one provider call fails', async () => {
    let generateCall = 0
    let stored = 0
    const batch = await generateConversationImageBatchArtifacts({
      workspaceId,
      userId,
      prompt: '눈썹 캐러셀을 만들어줘',
      channel: 'instagram',
      count: 3,
      idempotencyKey: 'batch-request-2',
    }, {
      authorize: vi.fn(async () => ({ email: null, role: 'manager' as const })),
      loadHarness: vi.fn(async () => BYREUM_IMAGE_HARNESS),
      generate: vi.fn(async () => {
        generateCall += 1
        if (generateCall === 2) throw new Error('private provider detail')
        return {
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          mimeType: 'image/png' as const,
          requestId: null,
        }
      }),
      store: vi.fn(async () => ({ assetId: `stored-${++stored}` })),
      createSlideId: (position) => `slide-${position}`,
    })

    expect(batch.status).toBe('partial')
    expect(batch.slides.map((slide) => slide.status)).toEqual([
      'succeeded',
      'failed',
      'succeeded',
    ])
    expect(batch.slides[1]?.safeErrorCode).toBe('IMAGE_RETRYABLE')
    expect(stored).toBe(2)
  })

  it('regression: Byreum path prompt and output remain byte-identical', async () => {
    let capturedPrompt = ''
    const userPrompt = '부드러운 인상의 자연스러운 눈썹 사진을 만들어줘'
    const expectedPrompt = composeByreumImagePrompt({
      harness: BYREUM_IMAGE_HARNESS,
      channel: 'naver_blog',
      userPrompt,
    })

    const artifact = await generateConversationImageArtifact({
      workspaceId,
      userId,
      prompt: userPrompt,
      channel: 'naver_blog',
    }, {
      authorize: vi.fn(async () => ({ email: 'test@example.com', role: 'owner' as const })),
      loadHarness: vi.fn(async () => BYREUM_IMAGE_HARNESS),
      generate: vi.fn(async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          mimeType: 'image/png' as const,
          requestId: null,
        }
      }),
      store: vi.fn(async () => ({ assetId })),
    })

    expect(capturedPrompt).toBe(expectedPrompt)
    expect(artifact.title).toBe('바이름 네이버 블로그 이미지 초안')
  })

  it('throws CHAT_IMAGE_HARNESS_UNAVAILABLE when harness is null and allowNeutralFallback is false/omitted', async () => {
    await expect(generateConversationImageArtifact({
      workspaceId,
      userId,
      prompt: '이미지 생성',
      channel: 'naver_blog',
    }, {
      authorize: vi.fn(async () => ({ email: 'other@example.com', role: 'owner' as const })),
      loadHarness: vi.fn(async () => null),
      generate: vi.fn(),
      store: vi.fn(),
    })).rejects.toThrow('CHAT_IMAGE_HARNESS_UNAVAILABLE')
  })

  it('generates neutral image prompt when harness is null and allowNeutralFallback is true', async () => {
    let capturedPrompt = ''
    const artifact = await generateConversationImageArtifact({
      workspaceId,
      userId,
      prompt: '세무 상담 안내 이미지',
      channel: 'naver_blog',
      allowNeutralFallback: true,
      neutralContext: {
        altText: '세무 상담 데스크',
        industry: '세무',
        tone: '전문적',
      },
    }, {
      authorize: vi.fn(async () => ({ email: 'other@example.com', role: 'owner' as const })),
      loadHarness: vi.fn(async () => null),
      generate: vi.fn(async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          mimeType: 'image/png' as const,
          requestId: null,
        }
      }),
      store: vi.fn(async () => ({ assetId })),
    })

    expect(capturedPrompt).toContain('1024x1536')
    expect(capturedPrompt).toContain('Business industry: 세무')
    expect(capturedPrompt).toContain('Subject and scene: 세무 상담 데스크')
    expect(capturedPrompt).not.toContain('바이름')
    expect(artifact.title).toBe('네이버 블로그 이미지 초안')
  })

  it('applies the owner-registered image style on the neutral path (single and batch)', async () => {
    const refId = '30000000-0000-4000-8000-000000000001'
    const prompts: string[] = []
    const style = { subject: '네일 아트 완성 손', mood: '', setting: '', lookAndColor: '', people: 'hands' as const, avoid: ['네온'], extra: '', composition: '', guide: '', referenceAssetIds: [refId], referenceNotes: {} }
    const deps = {
      authorize: vi.fn(async () => ({ email: 'other@example.com', role: 'owner' as const })),
      loadHarness: vi.fn(async () => null),
      loadWorkspaceStyle: vi.fn(async () => style),
      generate: vi.fn(async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt)
        return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png' as const, requestId: null }
      }),
      store: vi.fn(async () => ({ assetId })),
    }
    await generateConversationImageArtifact({
      workspaceId, userId, prompt: '봄 신상', channel: 'instagram', allowNeutralFallback: true,
    }, deps)
    await generateConversationImageBatchArtifacts({
      workspaceId, userId, prompt: '봄 신상', channel: 'instagram', allowNeutralFallback: true,
      count: 2, idempotencyKey: 'k-style-1',
    }, { ...deps, createSlideId: () => '88888888-8888-4888-8888-888888888888' })

    expect(deps.loadWorkspaceStyle).toHaveBeenCalledWith(workspaceId)
    expect(deps.generate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, referenceAssetIds: [refId] }))
    expect(prompts.length).toBeGreaterThanOrEqual(3)
    for (const prompt of prompts) expect(prompt).toContain('네일 아트 완성 손')
  })

  it('uses a draft style override on the neutral path even when a harness exists', async () => {
    let captured = ''
    const style = { subject: '시안 전용 카페 라떼', mood: '', setting: '', lookAndColor: '', people: 'none' as const, avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [], referenceNotes: {} }
    const loadWorkspaceStyle = vi.fn(async () => null)
    await generateConversationImageArtifact({
      workspaceId, userId, prompt: '시안', channel: 'instagram', workspaceStyleOverride: style,
    }, {
      authorize: vi.fn(async () => ({ email: 'o@example.com', role: 'owner' as const })),
      loadHarness: vi.fn(async () => BYREUM_IMAGE_HARNESS),
      loadWorkspaceStyle,
      generate: vi.fn(async ({ prompt }: { prompt: string }) => {
        captured = prompt
        return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png' as const, requestId: null }
      }),
      store: vi.fn(async () => ({ assetId })),
    })
    expect(captured).toContain('시안 전용 카페 라떼')
    expect(captured).not.toContain('three-pleat')
    expect(loadWorkspaceStyle).not.toHaveBeenCalled()
  })

  describe('selectReferenceIds helper', () => {
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
    ]

    it('chosen이 없거나 비면 styleIds 전체를 반환한다', () => {
      expect(selectReferenceIds(ids, undefined)).toEqual(ids)
      expect(selectReferenceIds(ids, [])).toEqual(ids)
    })

    it('chosen이 있으면 styleIds 순서를 유지한 채 교집합을 반환한다', () => {
      // chosen 순서가 역순이어도 반환 순서는 styleIds의 순서 유지
      const chosen = [ids[3], ids[1]]
      expect(selectReferenceIds(ids, chosen)).toEqual([ids[1], ids[3]])
    })

    it('교집합이 비면 styleIds 전체로 되돌린다', () => {
      const chosen = ['90000000-0000-4000-8000-000000000099']
      expect(selectReferenceIds(ids, chosen)).toEqual(ids)
    })

    it('최대 8개 상한을 지킨다', () => {
      const tenIds = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
      expect(selectReferenceIds(tenIds, undefined)).toHaveLength(8)
      expect(selectReferenceIds(tenIds, tenIds)).toHaveLength(8)
      expect(selectReferenceIds(tenIds, ['no-match'])).toHaveLength(8)
    })
  })

  describe('contentBrief styleReferenceIds routing in single and batch generation', () => {
    const id1 = '10000000-0000-4000-8000-000000000001'
    const id2 = '10000000-0000-4000-8000-000000000002'
    const id3 = '10000000-0000-4000-8000-000000000003'
    const workspaceStyle = {
      subject: '자연스러운 시술 사진',
      mood: '따뜻함',
      setting: '스튜디오',
      lookAndColor: '밝은 톤',
      people: 'people' as const,
      avoid: [],
      extra: '',
      composition: '',
      guide: '',
      referenceAssetIds: [id1, id2, id3],
      referenceNotes: {
        [id1]: '정면 기준 샷',
        [id2]: '클로즈업 샷',
        [id3]: '측면 연출 샷',
      },
    }

    it('단건: contentBrief의 선택이 generate의 referenceAssetIds에 반영되고 프롬프트의 Reference photo 번호가 선택 수와 같다', async () => {
      let capturedReferenceAssetIds: readonly string[] | undefined
      let capturedPrompt = ''

      const contentBrief = {
        channels: ['instagram'],
        goal: { value: 'consultation' },
        audience: { value: 'local' },
        audienceProblem: '청라에서 자연스러운 상담을 찾는 분',
        textDirection: { structure: { value: 'empathy_info_consult' }, tone: '친절하게', messageAngle: '상담 기준' },
        imageDirection: {
          mood: { value: 'detail' },
          composition: '구도',
          sceneRoles: ['표지'],
          avoid: [],
          styleReferenceIds: [id3, id1], // id1, id3 선택 (id2 제외)
        },
        callToAction: { value: 'consult' },
        mustInclude: [],
        mustAvoid: [],
        referenceMediaIds: [],
      } satisfies ContentBrief

      await generateConversationImageArtifact({
        workspaceId,
        userId,
        prompt: '이미지 생성',
        channel: 'instagram',
        allowNeutralFallback: true,
        contentBrief,
      }, {
        authorize: vi.fn(async () => ({ email: 'owner@example.com', role: 'owner' as const })),
        loadHarness: vi.fn(async () => null),
        loadWorkspaceStyle: vi.fn(async () => workspaceStyle),
        generate: vi.fn(async ({ prompt, referenceAssetIds }) => {
          capturedPrompt = prompt
          capturedReferenceAssetIds = referenceAssetIds
          return { bytes: new Uint8Array([1]), mimeType: 'image/png' as const, requestId: null }
        }),
        store: vi.fn(async () => ({ assetId })),
      })

      // styleIds 순서대로 [id1, id3]
      expect(capturedReferenceAssetIds).toEqual([id1, id3])
      // Reference photo는 정확히 2개여야 하며 번호 1, 2로 매겨져야 하고 id2의 노트는 없어야 함
      expect(capturedPrompt).toContain('Reference photo 1: 정면 기준 샷')
      expect(capturedPrompt).toContain('Reference photo 2: 측면 연출 샷')
      expect(capturedPrompt).not.toContain('클로즈업 샷')
      expect(capturedPrompt).not.toContain('Reference photo 3')
    })

    it('배치: contentBrief의 선택이 generate의 referenceAssetIds에 반영되고 프롬프트의 Reference photo 번호가 선택 수와 같다', async () => {
      const generatedReferenceAssetIds: (readonly string[] | undefined)[] = []
      const generatedPrompts: string[] = []

      const contentBrief = {
        channels: ['instagram'],
        goal: { value: 'consultation' },
        audience: { value: 'local' },
        audienceProblem: '청라에서 자연스러운 상담을 찾는 분',
        textDirection: { structure: { value: 'empathy_info_consult' }, tone: '친절하게', messageAngle: '상담 기준' },
        imageDirection: {
          mood: { value: 'detail' },
          composition: '구도',
          sceneRoles: ['표지', '상세'],
          avoid: [],
          styleReferenceIds: [id2], // id2만 선택
        },
        callToAction: { value: 'consult' },
        mustInclude: [],
        mustAvoid: [],
        referenceMediaIds: [],
      } satisfies ContentBrief

      await generateConversationImageBatchArtifacts({
        workspaceId,
        userId,
        prompt: '배치 생성',
        channel: 'instagram',
        allowNeutralFallback: true,
        count: 2,
        idempotencyKey: 'batch-test-ref-ids',
        contentBrief,
      }, {
        authorize: vi.fn(async () => ({ email: 'owner@example.com', role: 'owner' as const })),
        loadHarness: vi.fn(async () => null),
        loadWorkspaceStyle: vi.fn(async () => workspaceStyle),
        generate: vi.fn(async ({ prompt, referenceAssetIds }) => {
          generatedPrompts.push(prompt)
          generatedReferenceAssetIds.push(referenceAssetIds)
          return { bytes: new Uint8Array([1]), mimeType: 'image/png' as const, requestId: null }
        }),
        store: vi.fn(async () => ({ assetId })),
        createSlideId: (pos) => `slide-${pos}`,
      })

      expect(generatedReferenceAssetIds).toHaveLength(2)
      for (const refIds of generatedReferenceAssetIds) {
        expect(refIds).toEqual([id2])
      }
      for (const prompt of generatedPrompts) {
        expect(prompt).toContain('Reference photo 1: 클로즈업 샷')
        expect(prompt).not.toContain('정면 기준 샷')
        expect(prompt).not.toContain('측면 연출 샷')
        expect(prompt).not.toContain('Reference photo 2')
      }
    })
  })
})
