import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  createOpenAIInstagramDraftProvider,
  InstagramDraftProviderError,
  parseInstagramDraftOutput,
} from './instagram-draft-provider'
import type { ContentBrief } from './content-interview'

const contentBrief: ContentBrief = {
  channels: ['instagram'],
  goal: { value: 'consultation' },
  audience: { value: 'local' },
  audienceProblem: '청라에서 자연스러운 눈썹 상담을 찾는 분',
  textDirection: { structure: { value: 'empathy_info_consult' }, tone: '차분하고 친절하게', messageAngle: '고민 공감 뒤 상담 기준 안내' },
  imageDirection: { mood: { value: 'detail' }, composition: '눈썹 결 중심의 가까운 구도', sceneRoles: ['표지', '상담 기준'], avoid: ['과장된 전후 비교'] },
  callToAction: { value: 'consult' },
  mustInclude: ['청라 상담'],
  mustAvoid: ['가격 단정'],
  referenceMediaIds: [],
}

const validDraft = {
  caption: '오늘의 눈썹 디자인을 소개합니다.',
  hashtags: ['#눈썹', '#소희'],
  cta: '상담 전 원하는 분위기를 알려 주세요.',
  disclosure: 'AI 초안이며 게시 전 검토가 필요합니다.',
  observations: ['고객이 자연스러운 결과를 요청했습니다.'],
  limitations: ['시술 결과는 개인마다 다를 수 있습니다.'],
  evidence: ['현재 작업공간의 브랜드 말투를 반영했습니다.'],
  unresolvedQuestions: ['예약 가능 시간을 확인해야 합니다.'],
}

const context = {
  businessName: '바이름',
  industry: '반영구 화장',
  location: '서울',
  businessSummary: '자연스러운 눈썹 디자인을 제공합니다.',
  brandVoice: '차분하고 친절한 말투',
  keywords: ['자연스러움', '상담'],
  prohibitedTerms: ['완벽 보장'],
} as const

function clientWith(outputText: string | undefined) {
  const create = vi.fn().mockResolvedValue({
    id: 'resp_draft_123',
    output_text: outputText,
    usage: {
      input_tokens: 900,
      input_tokens_details: { cached_tokens: 100 },
      output_tokens: 300,
      total_tokens: 1200,
    },
  })
  return {
    client: { responses: { create } } as unknown as Pick<OpenAI, 'responses'>,
    create,
  }
}

describe('parseInstagramDraftOutput', () => {
  it('returns a validated structured Instagram draft', () => {
    expect(parseInstagramDraftOutput(JSON.stringify(validDraft))).toEqual({ ...validDraft, disclosure: '' })
  })

  it('removes internal AI production copy from the public caption', () => {
    expect(parseInstagramDraftOutput(JSON.stringify({
      ...validDraft,
      caption: '오늘의 눈썹 디자인을 소개합니다.\n\nAI를 활용해 제작한 이미지와 문안입니다.',
    }))).toMatchObject({ caption: '오늘의 눈썹 디자인을 소개합니다.', disclosure: '' })
  })

  it('removes internal production copy from the public call to action', () => {
    expect(parseInstagramDraftOutput(JSON.stringify({
      ...validDraft,
      cta: '상담 전 원하는 분위기를 알려 주세요. 소희 자동 게시 시스템입니다.',
    }))).toMatchObject({ cta: '상담 전 원하는 분위기를 알려 주세요.' })
  })

  it('deduplicates repetitive sentences in caption', () => {
    expect(parseInstagramDraftOutput(JSON.stringify({
      ...validDraft,
      caption: '오늘의 눈썹 디자인을 소개합니다. 문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.',
    }))).toMatchObject({
      caption: '오늘의 눈썹 디자인을 소개합니다. 문의는 카카오톡 채널로 주세요.',
    })
  })

  it('allows empty cta string when user requested no call to action, while preserving caption and other fields', () => {
    const draftWithoutCta = { ...validDraft, cta: '' }
    const result = parseInstagramDraftOutput(JSON.stringify(draftWithoutCta))
    expect(result.cta).toBe('')
    expect(result.caption).toBe('오늘의 눈썹 디자인을 소개합니다.')
  })

  it('rejects missing cta field while allowing empty cta string', () => {
    const candidate = { ...validDraft }
    delete (candidate as { cta?: string }).cta
    expect(() => parseInstagramDraftOutput(JSON.stringify(candidate))).toThrow(InstagramDraftProviderError)
  })

  it.each([
    ['invalid JSON', '{not-json'],
    ['empty caption', JSON.stringify({ ...validDraft, caption: ' ' })],
    ['string hashtags', JSON.stringify({ ...validDraft, hashtags: '#눈썹' })],
    ['internal key', JSON.stringify({ ...validDraft, requestId: 'req_private' })],
  ])('normalizes %s without exposing raw output', (_label, raw) => {
    expect(() => parseInstagramDraftOutput(raw)).toThrow(
      new InstagramDraftProviderError(),
    )
  })
})

describe('createOpenAIInstagramDraftProvider', () => {
  it('uses strict structured output and only the supplied workspace context', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')
    const onUsage = vi.fn()

    await expect(provider.generate({
      prompt: '눈썹 시술 인스타 문안을 만들어줘',
      context,
      channel: 'instagram',
      onUsage,
    })).resolves.toEqual({ ...validDraft, disclosure: '' })

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: 'resp_draft_123',
      operation: 'text_response',
    }))

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-luna',
      store: false,
      text: {
        format: expect.objectContaining({
          type: 'json_schema',
          name: 'instagram_draft',
          strict: true,
        }),
      },
    }))
    const serializedRequest = JSON.stringify(create.mock.calls[0]?.[0])
    expect(serializedRequest).toContain('바이름')
    expect(serializedRequest).toContain('완벽 보장')
    expect(serializedRequest).not.toContain('workspace_id')
    expect(serializedRequest).not.toContain('requestId')
  })

  it('normalizes provider failures without exposing their body', async () => {
    const create = vi.fn().mockRejectedValue(new Error('provider secret body'))
    const client = { responses: { create } } as unknown as Pick<OpenAI, 'responses'>
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')

    await expect(provider.generate({ prompt: '문안을 만들어줘', context, channel: 'instagram' })).rejects.toEqual(
      new InstagramDraftProviderError(),
    )
  })

  it('passes the exact interview brief into the text-generation contract', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')

    await provider.generate({
      prompt: '눈썹 상담 게시물을 만들어줘',
      context: { ...context, brandVoice: null, activeTextHarnesses: [] },
      channel: 'instagram',
      contentBrief,
    })

    const requestInput = JSON.parse(String(create.mock.calls[0]?.[0]?.input))
    expect(requestInput.contentBrief).toEqual(contentBrief)
    expect(requestInput.constraints).toContain('contentBrief의 목적, 독자, 글 흐름, 말투와 행동 유도를 공개 문안에 반영하세요. 단, 사실성과 채널 제한은 항상 최우선입니다.')
    expect(requestInput.constraints).toContain('contentBrief.mustAvoid의 표현과 장면을 공개 문안에 넣지 마세요.')
  })

  it('enforces active voice priority over contentBrief generic tone when active text harness or brandVoice is present', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')

    await provider.generate({
      prompt: '눈썹 상담 게시물을 만들어줘',
      context: {
        ...context,
        brandVoice: '차분하고 정중한 어조',
        activeTextHarnesses: [{
          title: '인스타 문체 하네스',
          description: '문체 규칙',
          structuredRule: { toneAndManner: '정중하고 차분한 경어체' },
          channels: ['instagram'],
        }],
      },
      channel: 'instagram',
      contentBrief,
    })

    const requestInput = JSON.parse(String(create.mock.calls[0]?.[0]?.input))
    expect(requestInput.constraints).toContain('등록된 활성 문체(brandVoice 또는 활성 텍스트 하네스의 toneAndManner)를 말투의 기준으로 삼으세요.')
    expect(requestInput.constraints).toContain('contentBrief는 글의 목적, 대상 독자, 글 흐름, 행동 유도를 조정하며, contentBrief의 제네릭 tone은 등록된 활성 문체를 덮어쓰지 않습니다. 단, 사실성과 채널 제한은 항상 최우선입니다.')
  })

  it('treats a matching active channel harness as authoritative over a different workspace business name', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')

    await provider.generate({
      prompt: '바이름 눈썹 상담 Instagram 문안을 만들어줘',
      channel: 'instagram',
      context: {
        ...context,
        businessName: '소희',
        activeTextHarnesses: [{
          title: '바이름 Instagram 텍스트 하네스',
          description: '바이름 눈썹 상담 홍보 글 생성 규칙',
          structuredRule: { brandName: '바이름', serviceCategory: '눈썹 문신과 눈썹 반영구 상담' },
          channels: ['instagram'],
        }],
      },
    })

    const requestInput = JSON.parse(String(create.mock.calls[0]?.[0]?.input))
    expect(requestInput.constraints).toContain(
      '사용자 요청의 브랜드와 현재 채널에 적용되는 활성 텍스트 하네스가 일치하면, 하네스의 검증된 사업 사실과 채널 규칙을 기본 사업 프로필보다 우선하세요.',
    )
    expect(requestInput.constraints).toContain(
      'caption과 hashtags에는 AI 제작, AI 생성, 검토용 초안, 자동 게시 같은 내부 제작·운영 문구를 넣지 마세요.',
    )
    expect(requestInput.constraints).toContain(
      'disclosure는 항상 빈 문자열로 반환하세요. 생성 근거와 공개 여부는 소희 시스템이 별도로 관리합니다.',
    )
  })

  it('includes an explicit rule in constraints for writing teaser copy without inventing facts or questioning the owner when event facts are missing', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')

    await provider.generate({
      prompt: '이벤트 홍보 게시물 작성해줘',
      context,
      channel: 'instagram',
    })

    const requestInput = JSON.parse(String(create.mock.calls[0]?.[0]?.input))
    const rule = requestInput.constraints.find((c: string) => c.includes('이벤트 상세') || c.includes('티저'))
    expect(rule).toBeDefined()
    expect(rule).toContain('점주에게 말을 걸거나 질문하지 마세요')
    expect(rule).toContain('날짜·가격·혜택을 지어내지 않고')
    expect(rule).toContain('[이벤트 기간]')
  })

  it('applies stricterInstruction to constraints when provided during regeneration', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')
    const stricterInstruction = '점주에게 추가 정보를 묻거나 확인을 요청하는 안내 문구를 절대로 작성하지 마세요. 매장 소개 중심의 티저 게시글 본문만 작성하고, 확정되지 않은 항목은 [이벤트 기간]과 같은 대괄호 슬롯으로 남기세요.'

    await provider.generate({
      prompt: '이벤트 홍보 게시물 작성해줘',
      context,
      channel: 'instagram',
      stricterInstruction,
    })

    const requestInput = JSON.parse(String(create.mock.calls[0]?.[0]?.input))
    expect(requestInput.constraints).toContain(stricterInstruction)
  })

  it('includes an explicit rule in constraints that inquiry and consultation sentences are written only once across the caption', async () => {
    const { client, create } = clientWith(JSON.stringify(validDraft))
    const provider = createOpenAIInstagramDraftProvider(client, 'gpt-5.6-luna')

    await provider.generate({
      prompt: '눈썹 상담 게시물 만들어줘',
      context,
      channel: 'instagram',
    })

    const requestInput = JSON.parse(String(create.mock.calls[0]?.[0]?.input))
    const singleCtaRule = requestInput.constraints.find((c: string) =>
      c.includes('문의·상담 안내 문장은 캡션 전체에서 단 한 번만 쓴다'),
    )
    expect(singleCtaRule).toBeDefined()
  })

  it('deduplicates Threads caption and collapses duplicate CTA in parseInstagramDraftOutput', () => {
    const rawOutput = JSON.stringify({
      ...validDraft,
      caption:
        '이번 주 토요일, 바이름 청라점에서 소소하지만 달콤한 이벤트를 준비했어요.\n\n11월 8일(토) 하루 동안 매장에 방문해 주시는 모든 분들께 시원하고 달콤한 딸기우유 한 잔을 선물로 드려요.\n\n처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.\n\n궁금하신 점이나 상담은 카카오톡 채널로 편하게 문의해 주세요.\n\n#바이름청라점 #청라뷰티샵 #바이름 #퍼스널뷰티',
      cta: '궁금하신 점이나 상담은 카카오톡 채널로 편하게 문의해 주세요.',
    })

    const parsed = parseInstagramDraftOutput(rawOutput)
    expect(parsed.caption).toBe(
      '이번 주 토요일, 바이름 청라점에서 소소하지만 달콤한 이벤트를 준비했어요.\n\n11월 8일(토) 하루 동안 매장에 방문해 주시는 모든 분들께 시원하고 달콤한 딸기우유 한 잔을 선물로 드려요.\n\n처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.\n\n#바이름청라점 #청라뷰티샵 #바이름 #퍼스널뷰티',
    )
    expect(parsed.cta).toBe('')
  })
})

