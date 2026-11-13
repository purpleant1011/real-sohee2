import { describe, expect, it, vi } from 'vitest'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import type { ChannelDraftRepository, ClaimChecker } from './ports'
import type { ChannelDraftRequest, ChannelDraftResult, GroundedBusinessContext } from './types'
import { generateChannelDraft } from './generate'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const KEY = '22222222-2222-4222-8222-222222222222'
const request: ChannelDraftRequest = { workspaceId: WORKSPACE, userId: '33333333-3333-4333-8333-333333333333', requestKey: KEY, topic: '  가게 인사  ', includeImage: true }
const context: GroundedBusinessContext = {
  businessName: '우리 가게', industry: '카페', location: '서울',
  facts: [{ kind: 'offering', label: '대표 상품', value: '커피' }],
  tone: { presetKey: null, brandVoice: '다정하게' }, knowledgeVersion: 3, warnings: ['가격 정보가 없어요'],
}
const fourChannelJson = JSON.stringify({
  instagram: { caption: '우리 가게에서 커피를 소개합니다.', hashtags: ['#커피'], firstLineHook: '커피 이야기' },
  threads: { text: '우리 가게의 커피 이야기입니다.' },
  naver_blog: { title: '우리 가게 커피', blocks: [{ type: 'paragraph', text: '커피를 소개합니다.' }] },
  daangn_business: { text: '동네 이웃에게 커피를 소개합니다.', coupon: null },
})

function setup(options: { saved?: ChannelDraftResult | null; output?: string; checker?: ClaimChecker } = {}) {
  const text: TextGenerator = { generateText: vi.fn().mockResolvedValue(options.output ?? fourChannelJson) }
  let stored = options.saved ?? null
  const repo: ChannelDraftRepository = {
    findByRequestKey: vi.fn().mockImplementation(async () => stored),
    findEditSnapshot: vi.fn().mockResolvedValue(null),
    updateVariant: vi.fn().mockResolvedValue(null),
    countSince: vi.fn().mockResolvedValue(0),
    reserve: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    release: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockImplementation(async (input) => {
      stored = {
        requestKey: input.requestKey, topic: input.topic, createdAt: '2026-10-08T12:00:00.000Z', basisNotes: input.basisNotes, imageNotice: input.imageNotice,
        variants: input.variants.map((v: any) => ({ ...v, contentId: null, versionId: null, vaultSavable: v.savableReason === null, blockedReason: v.savableReason,
          payload: input.imageIds.length ? { ...v.payload, media: input.imageIds.map((id: string) => ({ src: `/api/workspaces/${input.workspaceId}/media/${id}` })) } : v.payload })),
      }
      return stored
    }),
    listRecent: vi.fn().mockResolvedValue([]),
  }
  const deps = {
    image: vi.fn().mockResolvedValue({
      imageIds: ['44444444-4444-4444-8444-444444444444'],
      notice: null,
      media: [{ type: 'image', mimeType: 'image/png', fileSizeBytes: 1024 }],
      providerAttempted: true,
      needsReconciliation: false,
    }),
    loadContext: vi.fn().mockResolvedValue(context),
    buildBaseDraft: vi.fn().mockReturnValue('확인된 사실: 커피'),
    checkClaims: options.checker ?? vi.fn().mockReturnValue({ status: 'OK', issues: [] }),
    text, repo,
  }
  return { deps, text, repo }
}

describe('지식 기반 4채널 생성 서비스', () => {
  it('같은 요청 키는 저장 결과를 돌려주고 모델을 다시 부르지 않는다', async () => {
    const { deps, text, repo } = setup()
    const first = await generateChannelDraft(request, deps)
    const second = await generateChannelDraft(request, deps)
    expect(second).toEqual(first)
    expect(text.generateText).toHaveBeenCalledTimes(2) // 최초 호출 + 이미지 필수인 네이버 글만 재시도
    expect(repo.save).toHaveBeenCalledTimes(1)
    expect(first.variants).toHaveLength(4)
    expect(first.topic).toBe('가게 인사')
    expect(first.imageNotice).toBeNull()
  })

  it('선택형 옵션이 빠져도 이미지 생성 의존성을 호출하지 않는다', async () => {
    const { deps, repo } = setup()
    await generateChannelDraft({ ...request, includeImage: undefined }, deps)
    expect(deps.image).not.toHaveBeenCalled()
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ imageIds: [] }))
  })

  it('includeImage=false이면 이미지 생성 의존성을 호출하지 않는다', async () => {
    const { deps, repo } = setup()
    await generateChannelDraft({ ...request, includeImage: false }, deps)
    expect(deps.image).not.toHaveBeenCalled()
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ imageIds: [], imageNotice: null }))
  })

  it('저장 결과를 재생할 때는 요청이 사진 생성이어도 다시 만들지 않는다', async () => {
    const { deps } = setup({ saved: { requestKey: KEY, topic: '이미 저장', createdAt: '2026-10-08T00:00:00Z', basisNotes: [], imageNotice: null, variants: [{ channel: 'threads', payload: { text: '기존 글' }, status: 'READY', statusLabel: '준비 완료', issues: [], contentId: null, versionId: null, vaultSavable: false, blockedReason: null }] } })
    await generateChannelDraft(request, deps)
    expect(deps.image).not.toHaveBeenCalled()
  })

  it('이미지 생성 실패에도 글 4개를 저장하고 한국어 안내를 반환한다', async () => {
    const { deps, repo } = setup()
    deps.image.mockRejectedValueOnce(new Error('provider sk-secret error'))
    const result = await generateChannelDraft(request, deps)
    expect(result.variants).toHaveLength(4)
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ imageIds: [], imageNotice: expect.stringMatching(/[가-힣]/) }))
    expect(JSON.stringify(result)).not.toContain('sk-secret')
  })

  it('includeImage=true이면 글과 이미지를 병렬 시작하고 생성된 이미지 ID를 저장한다', async () => {
    const { deps, text, repo } = setup()
    const start = vi.fn().mockResolvedValue(fourChannelJson)
    vi.mocked(text.generateText).mockImplementation(async () => {
      expect(deps.image).toHaveBeenCalledTimes(1)
      return start()
    })
    await generateChannelDraft(request, deps)
    expect(deps.image).toHaveBeenCalledWith(expect.objectContaining({ includeImage: true, workspaceId: WORKSPACE, context: expect.objectContaining({ businessName: '우리 가게' }) }))
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ imageIds: ['44444444-4444-4444-8444-444444444444'] }))
  })

  it('이미지가 아직 처리 중이어도 첫 글 생성 호출을 기다리지 않는다', async () => {
    const { deps, text } = setup()
    let resolveImage!: (value: { imageIds: string[]; notice: null; media: { type: 'image'; mimeType: string; fileSizeBytes: number }[] }) => void
    deps.image.mockReturnValue(new Promise((resolve) => { resolveImage = resolve }))
    const task = generateChannelDraft(request, deps)
    await vi.waitFor(() => expect(text.generateText).toHaveBeenCalledTimes(1))
    resolveImage({ imageIds: ['44444444-4444-4444-8444-444444444444'], notice: null, media: [{ type: 'image', mimeType: 'image/png', fileSizeBytes: 1024 }] })
    await expect(task).resolves.toMatchObject({ variants: expect.any(Array) })
  })

  it('빈 variants 예약 행을 성공으로 반환하지 않는다', async () => {
    const { deps } = setup({ saved: { requestKey: KEY, topic: '준비 중', createdAt: '2026-10-08T00:00:00Z', basisNotes: [], variants: [], imageNotice: null } })
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' })
    expect(deps.text.generateText).not.toHaveBeenCalled()
  })

  it('저장된 요청을 재개할 때 지식 조회와 하루 한도 검사를 건너뛴다', async () => {
    const { deps, text } = setup({ saved: { requestKey: KEY, topic: '가게 인사', createdAt: '2026-10-08T01:00:00.000Z', basisNotes: [], variants: [{ channel: 'threads', payload: { text: '기존 글' }, status: 'READY', statusLabel: '준비 완료', issues: [], contentId: null, versionId: null, vaultSavable: false, blockedReason: null }], imageNotice: null } })
    const result = await generateChannelDraft(request, deps)
    expect(result.createdAt).toBe('2026-10-08T01:00:00.000Z')
    expect(deps.repo.countSince).not.toHaveBeenCalled()
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(text.generateText).not.toHaveBeenCalled()
  })

  it('같은 요청 키의 예약 충돌이면 모델 호출 전에 한국어 진행 중 응답을 반환한다', async () => {
    const { deps } = setup()
    const reservation = vi.fn().mockResolvedValue({ kind: 'pending' })
    vi.mocked(deps.repo.reserve).mockImplementation(reservation)
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ status: 409 })
    expect(deps.text.generateText).not.toHaveBeenCalled()
    expect(deps.image).not.toHaveBeenCalled()
  })

  it('모델 실패 시 본인이 보유한 예약 행을 해제한다', async () => {
    const { deps, text } = setup()
    const release = vi.fn().mockResolvedValue(undefined)
    vi.mocked(deps.repo.reserve).mockResolvedValue({ kind: 'acquired' })
    vi.mocked(deps.repo.release).mockImplementation(release)
    vi.mocked(text.generateText).mockRejectedValueOnce(new Error('model failed'))
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'MODEL_FAILED' })
    expect(release).toHaveBeenCalledWith(WORKSPACE, KEY, request.userId)
  })

  it('원자적 예약에서 하루 10개 한도를 확인하고 모델 호출 전에 429로 거부한다', async () => {
    const { deps, text } = setup()
    vi.mocked(deps.repo.reserve).mockResolvedValueOnce({ kind: 'limit' })
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED', status: 429 })
    expect(deps.repo.save).not.toHaveBeenCalled()
    expect(text.generateText).not.toHaveBeenCalled()
  })

  it.each(['', '   ', '가'.repeat(301)])('빈 주제 또는 300자 초과는 조회하지 않는다', async (topic) => {
    const { deps } = setup()
    await expect(generateChannelDraft({ ...request, topic }, deps)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(deps.repo.findByRequestKey).not.toHaveBeenCalled()
  })

  it('UUID 형식이 아닌 키를 거절한다', async () => {
    const { deps } = setup()
    await expect(generateChannelDraft({ ...request, requestKey: 'same' }, deps)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(deps.repo.findByRequestKey).not.toHaveBeenCalled()
  })

  it('모델 예외를 성공으로 위장하지 않고 503으로 반환한다', async () => {
    const { deps, text } = setup()
    vi.mocked(text.generateText).mockRejectedValueOnce(new Error('secret provider token'))
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'MODEL_FAILED', status: 503 })
    expect(deps.repo.save).not.toHaveBeenCalled()
  })

  it.each(['not-json', '{}', '{"instagram":{"caption":"hello"}}'])('잘못된 모델 JSON을 저장하지 않고 502로 반환한다', async (output) => {
    const { deps } = setup({ output })
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', status: 502 })
    expect(deps.repo.save).not.toHaveBeenCalled()
  })

  it('이미지 저장 결과를 재생해도 모델과 이미지 생성 호출을 반복하지 않는다', async () => {
    const { deps, text } = setup()
    vi.mocked(deps.repo.reserve).mockResolvedValueOnce({ kind: 'existing', result: {
      requestKey: KEY, topic: '기존 글', createdAt: '2026-10-08T00:00:00Z', basisNotes: [], imageNotice: null,
      variants: [{ channel: 'threads', payload: { text: '기존 글' }, status: 'READY', statusLabel: '준비 완료', issues: [], contentId: null, versionId: null, vaultSavable: false, blockedReason: null }],
    } })
    const result = await generateChannelDraft(request, deps)
    expect(result.topic).toBe('기존 글')
    expect(text.generateText).not.toHaveBeenCalled()
    expect(deps.image).not.toHaveBeenCalled()
  })

  it('상호·업종·지역만 있으면 생성 전에 지식 부족 오류로 거부한다', async () => {
    const { deps } = setup()
    deps.loadContext.mockResolvedValue({ ...context, facts: [{ kind: 'profile', label: '상호', value: '우리 가게' }, { kind: 'profile', label: '업종', value: '카페' }, { kind: 'profile', label: '지역', value: '서울' }] })
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'KNOWLEDGE_MISSING' })
    expect(deps.image).not.toHaveBeenCalled()
    expect(deps.text.generateText).not.toHaveBeenCalled()
  })

  it('확인되지 않은 주장은 보관 불가 상태로 저장한다', async () => {
    const { deps, repo } = setup({ checker: (_channel, payload) => payload.text?.toString().includes('커피') ? { status: 'UNKNOWN', issues: ['가격을 확인해 주세요.'] } : { status: 'OK', issues: [] } })
    const result = await generateChannelDraft(request, deps)
    const threads = result.variants.find((v) => v.channel === 'threads')!
    expect(threads.status).toBe('NEEDS_CHECK')
    expect(threads.issues).toContain('가격을 확인해 주세요.')
    expect(threads.vaultSavable).toBe(false)
    expect(threads.blockedReason).toContain('가격을 확인해 주세요.')
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('모델 재시도 오류는 원래 글을 유지하고 문제 채널만 수정 필요 상태로 둔다', async () => {
    const { deps, text, repo } = setup()
    vi.mocked(text.generateText).mockResolvedValueOnce(fourChannelJson).mockRejectedValueOnce(new Error('provider unavailable'))
    const result = await generateChannelDraft({ ...request, includeImage: false }, deps)
    expect(result.variants).toHaveLength(4)
    expect(result.variants.find((v) => v.channel === 'naver_blog')?.status).toBe('NEEDS_FIX')
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it.each(['not-json', '{}'])('재시도 응답 %s이 잘못되어도 원래 글 4개와 해당 채널 수정 필요 상태를 유지한다', async (retry) => {
    const { deps, text, repo } = setup()
    vi.mocked(text.generateText).mockResolvedValueOnce(fourChannelJson).mockResolvedValueOnce(retry)
    const result = await generateChannelDraft({ ...request, includeImage: false }, deps)
    expect(result.variants).toHaveLength(4)
    expect(result.variants.find((v) => v.channel === 'naver_blog')).toMatchObject({ status: 'NEEDS_FIX', payload: { title: '우리 가게 커피' } })
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('이미지가 없다는 이유만으로는 글 모델을 다시 부르지 않고, 인스타·네이버는 보관 불가(NEEDS_FIX)로 남는다', async () => {
    // 이미지 누락은 글을 다시 써도 해결되지 않는다. 헛재시도(모델 비용·지연)를 하지 않되 보관 불가는 유지해야 한다.
    // (참고: 네이버에서 글로 고칠 수 있는 FAIL은 '제목 없음'뿐인데 운영 스키마가 빈 제목을 평가 이전에 거부하므로,
    //  예전의 '네이버 재시도 응답 모양' 검증 경로는 첫 응답 기준으로 더 이상 도달하지 않는다.)
    const { deps, text } = setup()
    const result = await generateChannelDraft({ ...request, includeImage: false }, deps)
    expect(text.generateText).toHaveBeenCalledTimes(1)
    for (const channel of ['instagram', 'naver_blog'] as const) {
      const variant = result.variants.find((v) => v.channel === channel)
      expect(variant).toMatchObject({ status: 'NEEDS_FIX', vaultSavable: false })
    }
  })

  it('이미지 메타데이터가 있으면 네이버 필수 이미지 재시도를 하지 않고 보관 가능 상태가 된다', async () => {
    const { deps, text, repo } = setup()
    deps.image.mockResolvedValue({ imageIds: ['44444444-4444-4444-8444-444444444444'], notice: null, media: [{ type: 'image', mimeType: 'image/png', fileSizeBytes: 1024 }] })
    const result = await generateChannelDraft(request, deps)
    expect(vi.mocked(text.generateText).mock.calls.every(([prompt]) => !prompt.includes('이전에 생성한 naver_blog 채널의 결과물'))).toBe(true)
    expect(result.variants.find((v) => v.channel === 'naver_blog')).toMatchObject({ status: 'READY' })
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ imageIds: ['44444444-4444-4444-8444-444444444444'] }))
  })

  it('비어 있는 모델 출력 문구는 성공 결과로 저장하지 않는다', async () => {
    const { deps } = setup({ output: JSON.stringify({ ...JSON.parse(fourChannelJson), threads: { text: '  ' } }) })
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', status: 502 })
    expect(deps.repo.save).not.toHaveBeenCalled()
  })

  it('이미지가 없어서 규격이 불합격인 네이버 글은 수정 필요 상태로 둔다', async () => {
    const { deps } = setup()
    const result = await generateChannelDraft({ ...request, includeImage: false }, deps)
    const naver = result.variants.find((v) => v.channel === 'naver_blog')!
    expect(naver.status).toBe('NEEDS_FIX')
    expect(naver.issues).toContain('네이버 블로그 발행을 위해 대표 이미지가 최소 1장 이상 필요해요.')
    expect(naver.vaultSavable).toBe(false)
  })

  it('규격 실패 채널만 재시도하고 통과한 채널을 다시 생성하지 않는다', async () => {
    const { deps, text } = setup()
    deps.image.mockResolvedValue({ imageIds: ['44444444-4444-4444-8444-444444444444'], notice: null, media: [{ type: 'image', format: 'jpeg', mimeType: 'image/jpeg', fileSizeBytes: 1024 }] })
    vi.mocked(text.generateText)
      .mockResolvedValueOnce(JSON.stringify({
        ...JSON.parse(fourChannelJson),
        threads: { text: '가'.repeat(501) },
        instagram: { caption: '가'.repeat(2201) },
      }))
      .mockResolvedValueOnce(JSON.stringify({ caption: '커피를 소개합니다.' }))
      .mockResolvedValueOnce(JSON.stringify({ text: '커피를 소개합니다.' }))
    const result = await generateChannelDraft(request, deps)
    expect(result.variants.find((v) => v.channel === 'threads')?.payload.text).toBe('커피를 소개합니다.')
    expect(result.variants.find((v) => v.channel === 'instagram')?.payload.caption).toBe('커피를 소개합니다.')
    expect(text.generateText).toHaveBeenCalledTimes(3) // 기본 1회 + 글로 고칠 수 있는 규격 실패(스레드 글자 수·인스타 캡션 길이)만 재시도
    // 통과한 네이버·당근은 다시 생성하지 않았다
    const prompts = vi.mocked(text.generateText).mock.calls.map(([prompt]) => prompt)
    expect(prompts.some((prompt) => prompt.includes('이전에 생성한 naver_blog'))).toBe(false)
    expect(prompts.some((prompt) => prompt.includes('이전에 생성한 daangn_business'))).toBe(false)
  })

  it('저장소 실패를 성공 결과로 바꾸지 않는다', async () => {
    const { deps, repo } = setup()
    vi.mocked(repo.save).mockRejectedValueOnce(new Error('database secret'))
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', status: 503 })
  })

  it('지식 조회 실패는 빈 지식으로 처리하지 않는다', async () => {
    const { deps } = setup()
    deps.loadContext.mockRejectedValueOnce(new Error('database private detail'))
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'KNOWLEDGE_UNAVAILABLE', status: 503 })
    expect(deps.repo.save).not.toHaveBeenCalled()
  })
})

describe('크레딧 예약·정산 (quote → reserve → execute → settle/release)', () => {
  const hold = (scope: string) => ({ reservationId: `r-${scope}`, state: 'reserved' as const, requestedCredits: scope === 'text' ? 100 : 150, operationKey: `k-${scope}`, isReplay: false })
  function withCredits() {
    const ctx = setup()
    const credits = {
      reserve: vi.fn().mockImplementation(async (_ws: string, _key: string, scope: string) => hold(scope)),
      settle: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    }
    return { ...ctx, credits, deps: { ...ctx.deps, credits } }
  }

  it('4채널을 한 번의 글 요금으로 만들고, 저장한 이미지가 있을 때만 이미지 요금을 정산한다', async () => {
    const { deps, credits } = withCredits()
    await generateChannelDraft(request, deps)
    expect(credits.reserve.mock.calls.map(call => call[2]).sort()).toEqual(['image', 'text'])
    expect(credits.settle.mock.calls.map(call => call[1].reservationId).sort()).toEqual(['r-image', 'r-text'])
    expect(credits.release).not.toHaveBeenCalled()
  })

  it('크레딧이 부족하면 모델을 부르지 않고 예약을 풀어 둔다', async () => {
    const { deps, credits, text, repo } = withCredits()
    const { ChannelDraftError } = await import('./types')
    credits.reserve.mockRejectedValueOnce(new ChannelDraftError('크레딧이 부족해서 글을 만들 수 없어요.', 'INSUFFICIENT_CREDITS', 402))
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402 })
    expect(text.generateText).not.toHaveBeenCalled()
    expect(repo.release).toHaveBeenCalled()
  })

  it('모델 호출 시도 후 실패 시 자동 환불하지 않고 reconciliation 대사 상태를 유지한다', async () => {
    const { deps, credits, text } = withCredits()
    ;(text.generateText as any).mockRejectedValue(new Error('provider down'))
    await expect(generateChannelDraft({ ...request, includeImage: false }, deps)).rejects.toMatchObject({ code: 'MODEL_FAILED' })
    expect(text.generateText).toHaveBeenCalledTimes(1)
    expect(credits.settle).not.toHaveBeenCalled()
    // Once provider attempt was entered, no auto-refund (retain hold for reconciliation)
    expect(credits.release).not.toHaveBeenCalled()
  })

  it('이미지 요금은 저장 결과에 이미지 ID가 포함된 뒤에만 정산한다', async () => {
    const { deps, credits, repo } = withCredits()
    const imageId = '44444444-4444-4444-8444-444444444444'
    vi.mocked(repo.save).mockImplementationOnce(async (input) => {
      expect(credits.settle).not.toHaveBeenCalled()
      return {
        requestKey: input.requestKey, topic: input.topic, createdAt: '2026-10-08T12:00:00Z', basisNotes: input.basisNotes, imageNotice: input.imageNotice,
        variants: input.variants.map(v => ({ ...v, contentId: null, versionId: null, vaultSavable: false, blockedReason: null,
          payload: { ...v.payload, media: [{ src: `/api/workspaces/${WORKSPACE}/media/${imageId}` }] } })),
      }
    })
    await generateChannelDraft(request, deps)
    expect(credits.settle.mock.calls.map(call => call[1].reservationId).sort()).toEqual(['r-image', 'r-text'])
  })

  it('저장 실패 시 이미 프로바이더가 실행되었으면 자동 환불하지 않고 hold 대사를 유지한다', async () => {
    const { deps, credits, repo, text } = withCredits()
    vi.mocked(repo.save).mockRejectedValueOnce(new Error('db unavailable'))
    await expect(generateChannelDraft(request, deps)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' })
    expect(text.generateText).toHaveBeenCalled()
    expect(credits.settle).not.toHaveBeenCalled()
    // Once provider was executed, no auto-refund (hold preserved for reconciliation)
    expect(credits.release).not.toHaveBeenCalled()
  })

  it('저장 결과에서 이미지가 빠졌으면 이미지 요금을 돌려준다', async () => {
    const { deps, credits, repo } = withCredits()
    vi.mocked(repo.save).mockImplementationOnce(async (input) => ({
      requestKey: input.requestKey, topic: input.topic, createdAt: '2026-10-08T12:00:00Z', basisNotes: input.basisNotes, imageNotice: input.imageNotice,
      variants: input.variants.map(v => ({ ...v, contentId: null, versionId: null, vaultSavable: false, blockedReason: null })),
    }))
    await generateChannelDraft(request, deps)
    expect(credits.release).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-image' }))
    expect(credits.settle.mock.calls.map(call => call[1].reservationId)).toEqual(['r-text'])
  })

  it('이미지가 만들어지지 않으면 이미지 요금을 돌려준다', async () => {
    const { deps, credits } = withCredits()
    deps.image.mockResolvedValueOnce({ imageIds: [], notice: '이미지 없이 글을 만들었어요', media: [] })
    await generateChannelDraft(request, deps)
    expect(credits.release).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-image' }))
    expect(credits.settle).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-text' }))
  })

  it('F2 cross-failure: 텍스트 시도 0 / 이미지 시도 1일 때 텍스트는 환급하고 이미지 hold는 보존한다', async () => {
    const { deps, credits, text } = withCredits()
    // Text generator is never called because buildBaseDraft throws
    deps.buildBaseDraft = vi.fn().mockImplementation(() => {
      throw new Error('base draft builder failed before provider call')
    })
    // Image provider was attempted in parallel
    deps.image.mockResolvedValueOnce({
      imageIds: [],
      notice: '이미지 실패',
      media: [],
      providerAttempted: true,
      needsReconciliation: true,
    })

    await expect(generateChannelDraft(request, deps)).rejects.toThrow()
    expect(text.generateText).not.toHaveBeenCalled()
    // Text hold is released because text provider was never attempted
    expect(credits.release).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-text' }))
    // Image hold is NOT released because image provider was attempted (retained for reconciliation)
    expect(credits.release).not.toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-image' }))
  })

  it('F2 cross-failure: 텍스트 시도 1 / 이미지 시도 0일 때 이미지 hold는 환급하고 텍스트 hold는 보존한다', async () => {
    const { deps, credits, text } = withCredits()
    // Text provider throws after attempt
    ;(text.generateText as any).mockRejectedValueOnce(new Error('text provider failed'))
    // Image fails before provider call
    deps.image.mockResolvedValueOnce({
      imageIds: [],
      notice: '사전 검증 실패',
      media: [],
      providerAttempted: false,
      needsReconciliation: false,
    })

    await expect(generateChannelDraft(request, deps)).rejects.toThrow()
    expect(text.generateText).toHaveBeenCalled()
    // Text hold is retained for reconciliation
    expect(credits.release).not.toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-text' }))
    // Image hold is released because image provider was never attempted
    expect(credits.release).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-image' }))
  })

  it('F2: 실행 전 자격 검증 실패 시 두 hold 모두 자동 release된다', async () => {
    const { deps, credits, text } = withCredits()
    deps.buildBaseDraft = vi.fn().mockImplementation(() => {
      throw new Error('pre-execution validation failed')
    })
    deps.image.mockResolvedValueOnce({
      imageIds: [],
      notice: '사전 검증 실패',
      media: [],
      providerAttempted: false,
      needsReconciliation: false,
    })

    await expect(generateChannelDraft(request, deps)).rejects.toThrow()
    expect(text.generateText).not.toHaveBeenCalled()
    expect(credits.release).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-text' }))
    expect(credits.release).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ reservationId: 'r-image' }))
  })
})
