import { afterEach, describe, expect, it, vi } from 'vitest'
import { versionSchema } from '@/features/content/version-schema'
import { mockRevisionProvider } from './mock-revision-provider'
import type { RevisionInput } from './revision-provider'

const baseInput: RevisionInput = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  contentId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  channel: 'instagram',
  instruction: '더 따뜻하고 간결하게 수정해 줘.',
  inputType: 'caption',
  currentVersionFingerprint: '0'.repeat(64),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mockRevisionProvider', () => {
  it('declares mock mode', () => {
    expect(mockRevisionProvider.mode).toBe('mock')
  })

  it('returns a deep-equal result for repeated identical input', async () => {
    const first = await mockRevisionProvider.revise(baseInput)
    const second = await mockRevisionProvider.revise({ ...baseInput })

    expect(first).toEqual(second)
  })

  it.each([
    ['caption', 'caption', '문구'],
    ['disclosure', 'disclosure', '고지'],
  ] as const)(
    'makes a meaningful %s change in the %s field',
    async (inputType, field, expectedCopy) => {
      const result = await mockRevisionProvider.revise({ ...baseInput, inputType })

      expect(result[field]).toContain(expectedCopy)
    },
  )

  it('makes a meaningful hashtag change for hashtag input', async () => {
    const result = await mockRevisionProvider.revise({ ...baseInput, inputType: 'hashtags' })

    expect(result.hashtags).toContain('#해시태그정리')
  })

  it('makes a meaningful change in every field for full input', async () => {
    const result = await mockRevisionProvider.revise({ ...baseInput, inputType: 'full' })

    expect(result.caption).toContain('전체')
    expect(result.hashtags).toContain('#전체수정')
    expect(result.disclosure).toContain('전체')
    expect(result.revisionReason).toContain('전체')
  })

  it('uses the fingerprint for deterministic variation without exposing it', async () => {
    const firstFingerprint = '0'.repeat(64)
    const secondFingerprint = 'f'.repeat(64)
    const first = await mockRevisionProvider.revise({
      ...baseInput,
      currentVersionFingerprint: firstFingerprint,
    })
    const second = await mockRevisionProvider.revise({
      ...baseInput,
      currentVersionFingerprint: secondFingerprint,
    })
    const serialized = JSON.stringify([first, second])

    expect(first).not.toEqual(second)
    expect(serialized).not.toContain(firstFingerprint)
    expect(serialized).not.toContain(secondFingerprint)
    expect(serialized).not.toContain(baseInput.workspaceId)
    expect(serialized).not.toContain(baseInput.contentId)
    expect(serialized).not.toContain(baseInput.versionId)
  })

  it('uses the instruction as deterministic context without echoing it', async () => {
    const firstInstruction = '정보를 명확하게 전달해 줘.'
    const alternatives = [
      '감성적인 표현으로 바꿔 줘.',
      '핵심만 간결하게 정리해 줘.',
      '고객에게 질문하는 문장을 추가해 줘.',
      '신뢰감 있는 어조로 다듬어 줘.',
    ]
    const first = await mockRevisionProvider.revise({
      ...baseInput,
      instruction: firstInstruction,
    })
    const alternativesResults = await Promise.all(
      alternatives.map((instruction) => mockRevisionProvider.revise({ ...baseInput, instruction })),
    )

    expect(alternativesResults.some((result) => JSON.stringify(result) !== JSON.stringify(first))).toBe(
      true,
    )
    expect(JSON.stringify([first, ...alternativesResults])).not.toContain(firstInstruction)
  })

  it('returns visibly channel-specific Korean sample copy', async () => {
    const instagram = await mockRevisionProvider.revise({ ...baseInput, channel: 'instagram' })
    const threads = await mockRevisionProvider.revise({ ...baseInput, channel: 'threads' })

    expect(instagram.caption).toContain('인스타그램')
    expect(instagram.hashtags).toContain('#인스타그램')
    expect(threads.caption).toContain('스레드')
    expect(threads.hashtags).toContain('#스레드')
    expect(instagram).not.toEqual(threads)
  })

  it.each(['caption', 'hashtags', 'disclosure', 'full'] as const)(
    'returns valid version fields for %s input',
    async (inputType) => {
      const result = await mockRevisionProvider.revise({ ...baseInput, inputType })

      expect(
        versionSchema.safeParse({
          workspaceId: baseInput.workspaceId,
          contentId: baseInput.contentId,
          channel: baseInput.channel,
          ...result,
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaIds: ['44444444-4444-4444-8444-444444444444'],
        }).success,
      ).toBe(true)
    },
  )

  it('does not call global fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await mockRevisionProvider.revise(baseInput)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects malformed runtime input before generating a result', async () => {
    await expect(
      mockRevisionProvider.revise({
        ...baseInput,
        currentVersionFingerprint: 'NOT-A-SHA-256-FINGERPRINT',
      }),
    ).rejects.toThrow()
  })

  it('does not mutate the caller input', async () => {
    const input = Object.freeze({ ...baseInput })
    const before = { ...input }

    await mockRevisionProvider.revise(input)

    expect(input).toEqual(before)
  })
})
