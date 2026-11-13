import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  contentDispatcher,
  deriveDeterministicRequestKey,
} from '@/features/tool-runtime/dispatchers/content-dispatcher'
import { createChannelDraftService } from '@/features/channel-studio/compose'
import { ContentDraftService } from '@/features/content/content-draft-service'
import { ChannelDraftError, type ChannelDraftResult } from '@/features/channel-studio/types'
import type { ToolExecutionContext } from '@/features/tool-runtime/types'

const mockGenerate = vi.fn()
const mockEdit = vi.fn()
const mockListRecent = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}))

vi.mock('@/features/channel-studio/compose', () => ({
  createChannelDraftService: vi.fn(() => ({
    generate: mockGenerate,
    edit: mockEdit,
    listRecent: mockListRecent,
  })),
}))

describe('과제 1: content.generate 4채널 스튜디오 전환 (contentDispatcher)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'
  const baseContext: ToolExecutionContext = {
    workspaceId,
    actorId: 'user-actor-123',
    correlationId: 'turn-corr-456',
    intentMode: 'EXECUTE',
    isTestAccount: false,
  }

  const sampleStudioResult: ChannelDraftResult = {
    requestKey: '550e8400-e29b-41d4-a716-446655440000',
    topic: '가을 시그니처 헤드스파',
    createdAt: '2026-10-09T00:00:00.000Z',
    basisNotes: ['지식 v2 기준'],
    imageNotice: null,
    variants: [
      {
        channel: 'instagram',
        payload: {
          caption: '✨ 가을 맞이 시그니처 헤드스파로 지친 두피에 힐링을 선물하세요.',
          hashtags: ['#헤드스파', '#두피케어', '#힐링'],
          firstLineHook: '가을 맞이 힐링 헤드스파',
        },
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-insta',
        versionId: 'vid-insta',
        vaultSavable: true,
        blockedReason: null,
      },
      {
        channel: 'threads',
        payload: {
          text: '요즘 일교차 커지면서 두피 각질 고민 많으시죠? 헤드스파 케어 팁 공유합니다.',
          hashtags: ['#스레드', '#두피관리'],
        },
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-threads',
        versionId: 'vid-threads',
        vaultSavable: true,
        blockedReason: null,
      },
      {
        channel: 'naver_blog',
        payload: {
          title: '가을 시그니처 헤드스파 솔직 안내',
          blocks: [{ type: 'text', text: '네이버 블로그 본문 블록입니다.' }],
          hashtags: ['#네이버블로그'],
        },
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-blog',
        versionId: 'vid-blog',
        vaultSavable: true,
        blockedReason: null,
      },
      {
        channel: 'daangn_business',
        payload: {
          text: '우리동네 이웃분들을 위한 가을 헤드스파 소식입니다.',
          hashtags: ['#당근소식'],
        },
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-daangn',
        versionId: 'vid-daangn',
        vaultSavable: true,
        blockedReason: null,
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue(sampleStudioResult)
  })

  describe('deriveDeterministicRequestKey', () => {
    it('같은 workspaceId와 correlationId에 대해 항상 같은 UUID를 반환한다', () => {
      const key1 = deriveDeterministicRequestKey(workspaceId, 'corr-abc')
      const key2 = deriveDeterministicRequestKey(workspaceId, 'corr-abc')
      expect(key1).toBe(key2)
    })

    it('다른 입력에 대해 서로 다른 UUID를 반환한다', () => {
      const key1 = deriveDeterministicRequestKey(workspaceId, 'corr-abc')
      const key2 = deriveDeterministicRequestKey(workspaceId, 'corr-xyz')
      expect(key1).not.toBe(key2)
    })

    it('RFC 4122 v4 UUID 정규식을 통과한다 (8-4-4-4-12, version 4, variant 8/9/a/b)', () => {
      const key = deriveDeterministicRequestKey(workspaceId, 'corr-test-v4')
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      expect(key).toMatch(uuidV4Regex)
    })

    it('턴 고유값(correlationId)이 없으면 crypto.randomUUID()로 생성한다', () => {
      const key1 = deriveDeterministicRequestKey(workspaceId, '')
      const key2 = deriveDeterministicRequestKey(workspaceId, undefined)
      expect(key1).not.toBe(key2)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      expect(key1).toMatch(uuidRegex)
      expect(key2).toMatch(uuidRegex)
    })
  })

  describe('content.generate 전환 검증', () => {
    it('(a) 정상 실행 (기본/인스타그램): 스튜디오 서비스를 호출하고 인스타 variant와 링크, 크레딧 100을 반환한다', async () => {
      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        baseContext
      )

      expect(result.success).toBe(true)
      expect(result.status).toBe('COMPLETED')
      expect(mockGenerate).toHaveBeenCalledTimes(1)
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          userId: 'user-actor-123',
          topic: '가을 시그니처 헤드스파',
          includeImage: false,
        })
      )

      const data = result.data as any
      expect(data).toBeDefined()
      expect(data.draftId).toBe(sampleStudioResult.requestKey)
      expect(data.topic).toBe('가을 시그니처 헤드스파')
      expect(data.channel).toBe('INSTAGRAM')
      expect(data.caption).toContain('지친 두피에 힐링을 선물하세요')
      expect(data.hashtags).toEqual(['#헤드스파', '#두피케어', '#힐링'])
      expect(data.openInStudioPath).toBe('/app/content?studio=four-channel')
      expect(data.needsCheck).toBe(false)
      expect(data.needsAttention).toBe(false)

      // 크레딧: 글만 생성이므로 100 SC 차감
      expect(result.creditDeducted).toBe(100)

      // 로그: 한국어만, UUID 미포함
      expect(result.logs).toBeDefined()
      expect(result.logs?.every(log => !log.includes(sampleStudioResult.requestKey))).toBe(true)
      expect(result.logs?.some(log => log.includes('초안') || log.includes('완료'))).toBe(true)
    })

    it('(b) 요청 채널이 THREADS일 때 스레드 variant의 본문을 data.caption에 매핑한다', async () => {
      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'THREADS',
        },
        baseContext
      )

      expect(result.success).toBe(true)
      const data = result.data as any
      expect(data.channel).toBe('THREADS')
      expect(data.caption).toContain('두피 각질 고민 많으시죠')
      expect(data.hashtags).toEqual(['#스레드', '#두피관리'])
    })

    it('(c) claim-guard 결과가 NEEDS_CHECK이면 data.needsCheck: true 및 한국어 이슈를 담고 완료/발행 가능 단어를 배제한다', async () => {
      mockGenerate.mockResolvedValueOnce({
        ...sampleStudioResult,
        variants: sampleStudioResult.variants.map(v =>
          v.channel === 'instagram'
            ? {
                ...v,
                status: 'NEEDS_CHECK',
                statusLabel: '사실 확인이 필요해요',
                issues: ['가격 및 할인 정보는 등록된 지식에서 확인할 수 없어요.'],
              }
            : v
        ),
      })

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        baseContext
      )

      expect(result.success).toBe(true)
      const data = result.data as any
      expect(data.needsCheck).toBe(true)
      expect(data.issues).toContain('가격 및 할인 정보는 등록된 지식에서 확인할 수 없어요.')
      expect(data.statusLabel).toBe('사실 확인이 필요해요')

      // 로그에서 '완성', '발행 가능' 같은 낙관적 단어 배제
      const logText = (result.logs || []).join(' ')
      expect(logText).not.toContain('완성')
      expect(logText).not.toContain('발행 가능')
    })

    it('(d) 크레딧 부족 에러 발생 시 사용자용 한국어 안내와 status FAILED를 반환한다', async () => {
      mockGenerate.mockRejectedValueOnce(
        new ChannelDraftError(
          '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
          'INSUFFICIENT_CREDITS',
          402
        )
      )

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        baseContext
      )

      expect(result.success).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.error?.code).toBe('INSUFFICIENT_CREDITS')
      expect(result.error?.message).toContain('크레딧')
      expect(result.error?.message).toContain('콘텐츠 센터')
    })

    it('(e) topic 누락 시 INVALID_ARGUMENT로 FAILED 반환하고 스튜디오 서비스를 호출하지 않는다', async () => {
      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '   ',
          channel: 'INSTAGRAM',
        },
        baseContext
      )

      expect(result.success).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.error?.code).toBe('INVALID_ARGUMENT')
      expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('(f) 같은 correlationId는 같은 requestKey로 generate를 호출한다', async () => {
      await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        { ...baseContext, correlationId: 'same-turn-correlation-id' }
      )

      await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        { ...baseContext, correlationId: 'same-turn-correlation-id' }
      )

      expect(mockGenerate).toHaveBeenCalledTimes(2)
      const call1RequestKey = mockGenerate.mock.calls[0][0].requestKey
      const call2RequestKey = mockGenerate.mock.calls[1][0].requestKey
      expect(call1RequestKey).toBe(call2RequestKey)
    })

    it('(g) ContentDraftService.generateAndSaveDraft를 더는 호출하지 않는다', async () => {
      const spy = vi.spyOn(ContentDraftService, 'generateAndSaveDraft')

      await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        baseContext
      )

      expect(spy).not.toHaveBeenCalled()
    })

    it('사진 포함(includeImage: true)이고 이미지가 실제로 저장된 경우에만 250 SC를 보고한다', async () => {
      const normalResult = await contentDispatcher.execute(
        { _toolName: 'content.generate', topic: '가을 시그니처 헤드스파', channel: 'INSTAGRAM', includeImage: true },
        baseContext
      )
      expect(normalResult.creditDeducted).toBe(250)
      expect(mockGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ includeImage: true }))
    })

    it('사진을 요청했지만 이미지 생성이 대체 안내(imageNotice)로 끝나면 이미지 150 SC는 정산되지 않으므로 100 SC만 보고한다', async () => {
      mockGenerate.mockResolvedValueOnce({ ...sampleStudioResult, imageNotice: '사진은 만들지 못했어요. 글만 준비했어요.' })
      const result = await contentDispatcher.execute(
        { _toolName: 'content.generate', topic: '가을 시그니처 헤드스파', channel: 'INSTAGRAM', includeImage: true },
        baseContext
      )
      expect(result.creditDeducted).toBe(100)
    })

    it('테스트 계정도 스튜디오에서는 실제로 차감되므로 0이 아니라 실제 금액(100/250)을 보고한다', async () => {
      const text = await contentDispatcher.execute(
        { _toolName: 'content.generate', topic: '가을 시그니처 헤드스파', channel: 'INSTAGRAM' },
        { ...baseContext, isTestAccount: true }
      )
      expect(text.creditDeducted).toBe(100)
      const withImage = await contentDispatcher.execute(
        { _toolName: 'content.generate', topic: '가을 시그니처 헤드스파', channel: 'INSTAGRAM', includeImage: true },
        { ...baseContext, isTestAccount: true }
      )
      expect(withImage.creditDeducted).toBe(250)
    })

    it('다른 채널 초안 중 하나라도 사실 확인이 필요하면 allChannelsReady 는 false 이다 (무조건 true 금지)', async () => {
      const variants = sampleStudioResult.variants.map((v, i) =>
        i === 2 ? { ...v, status: 'NEEDS_CHECK' as const, statusLabel: '사실 확인이 필요해요', issues: ['가격 정보를 확인해 주세요.'] } : v
      )
      mockGenerate.mockResolvedValueOnce({ ...sampleStudioResult, variants })
      const result = await contentDispatcher.execute(
        { _toolName: 'content.generate', topic: '가을 시그니처 헤드스파', channel: 'INSTAGRAM' },
        baseContext
      )
      expect((result.data as any).allChannelsReady).toBe(false)
      // 요청한 인스타그램 자체는 문제없음
      expect((result.data as any).needsCheck).toBe(false)

      const ok = await contentDispatcher.execute(
        { _toolName: 'content.generate', topic: '가을 시그니처 헤드스파', channel: 'INSTAGRAM' },
        baseContext
      )
      expect((ok.data as any).allChannelsReady).toBe(true)
    })

    it('content.rewrite 가 스튜디오 초안(미존재 contentId)으로 호출되어도 FAILED가 아닌 안전한 안내 응답을 반환한다', async () => {
      vi.spyOn(ContentDraftService, 'getDraft').mockResolvedValueOnce(null)

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.rewrite',
          contentId: 'studio-request-key-abc',
          targetChannel: 'THREADS',
        },
        baseContext
      )

      expect(result.success).toBe(true)
      expect(result.status).toBe('COMPLETED')
      const data = result.data as any
      expect(data.openInStudioPath).toBe('/app/content?studio=four-channel')
      expect(result.logs?.[0]).toContain('콘텐츠 센터')
    })

    it('(h) NEEDS_FIX 변형이면 needsAttention true, 로그에 "생성 완료" 없음, nextStepHint가 존재한다', async () => {
      mockGenerate.mockResolvedValueOnce({
        ...sampleStudioResult,
        variants: sampleStudioResult.variants.map(v =>
          v.channel === 'instagram'
            ? {
                ...v,
                status: 'NEEDS_FIX',
                statusLabel: '수정이 필요해요',
                issues: ['인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.'],
              }
            : v
        ),
      })

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시그니처 헤드스파',
          channel: 'INSTAGRAM',
        },
        baseContext
      )

      expect(result.success).toBe(true)
      const data = result.data as any
      expect(data.needsAttention).toBe(true)
      expect(data.statusLabel).toBe('수정이 필요해요')
      expect(data.issues).toContain('인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.')
      expect(data.nextStepHint).toBe('사진을 붙이려면 콘텐츠 센터의 4채널 글 만들기에서 사진 포함으로 만들어 주세요')

      const logText = (result.logs || []).join(' ')
      expect(logText).not.toContain('생성 완료')
      expect(logText).toContain('초안은 만들었지만 수정이 필요해요 — 인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.')
    })
  })
})
