import { describe, it, expect } from 'vitest'
import { ProductionGoldenJourneyRunner } from '@/features/qa/golden-journey-runner'
import type { GoldenJourneyConfig } from '@/features/qa/golden-journey-runner'

describe('Golden Journey Anti-False-Green Fail-Closed Contract (ANI-1152)', () => {
  const runner = new ProductionGoldenJourneyRunner()

  const baseConfig: GoldenJourneyConfig = {
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    scenario: 'JOURNEY_A_SWEET_PUMPKIN_TART',
    businessName: '바이름',
    businessCategory: '디저트 베이커리',
    userPrompt: '단호박 타르트 신메뉴 인스타그램 게시물 올려줘',
    productSubject: '단호박 타르트',
    channel: 'instagram',
  }

  it('blocks synthetic image generation in PRODUCTION_VERIFIED mode when overrideImageBytes is missing', async () => {
    const config: GoldenJourneyConfig = {
      ...baseConfig,
      executionMode: 'PRODUCTION_VERIFIED',
      overrideImageBytes: undefined, // Missing real image bytes!
    }

    await expect(runner.executeJourney(config)).rejects.toThrow(
      /BLOCKED_SYNTHETIC_ADAPTER_FORBIDDEN/
    )
  })

  it('blocks fake provider ID / permalink fallback in PRODUCTION_VERIFIED mode when liveMetaPublishFn is missing', async () => {
    const realBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])
    const config: GoldenJourneyConfig = {
      ...baseConfig,
      executionMode: 'PRODUCTION_VERIFIED',
      overrideImageBytes: realBytes,
      liveMetaPublishFn: undefined, // Missing live Meta publish adapter!
    }

    await expect(runner.executeJourney(config)).rejects.toThrow(
      /BLOCKED_FAKE_PROVIDER_ID_FORBIDDEN/
    )
  })

  it('blocks source-to-source self-comparison in PRODUCTION_VERIFIED mode when observedMediaBytes is missing', async () => {
    const realBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])
    const config: GoldenJourneyConfig = {
      ...baseConfig,
      executionMode: 'PRODUCTION_VERIFIED',
      overrideImageBytes: realBytes,
      liveMetaPublishFn: async () => ({
        providerPostId: '18097282883635509',
        permalink: 'https://www.instagram.com/p/DdEbfNfCbSC/',
      }),
      observedMediaBytes: undefined, // Missing independently fetched observed bytes!
    }

    await expect(runner.executeJourney(config)).rejects.toThrow(
      /BLOCKED_SELF_COMPARISON_FORBIDDEN/
    )
  })

  it('blocks memory-only restoration in PRODUCTION_VERIFIED mode when freshDbReadbackFn is missing', async () => {
    const realBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])
    const config: GoldenJourneyConfig = {
      ...baseConfig,
      executionMode: 'PRODUCTION_VERIFIED',
      overrideImageBytes: realBytes,
      liveMetaPublishFn: async () => ({
        providerPostId: '18097282883635509',
        permalink: 'https://www.instagram.com/p/DdEbfNfCbSC/',
      }),
      observedMediaBytes: realBytes,
      freshDbReadbackFn: undefined, // Missing live DB readback!
    }

    await expect(runner.executeJourney(config)).rejects.toThrow(
      /BLOCKED_MEMORY_RESTORE_FORBIDDEN/
    )
  })
})
