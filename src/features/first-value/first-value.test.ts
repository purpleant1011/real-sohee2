import { describe, expect, it } from 'vitest'
import { buildFirstValueView } from './first-value'

const item = { businessName: '모모 카페' }
const allowed = { allowed: true as const, message: null }
const denied = { allowed: false as const, message: '채널을 연결하면 발행할 수 있어요' }
const target = (publish: boolean, vault = true) => ({ contentId: 'c1', versionId: 'v1', actions: { VAULT: vault ? allowed : denied, PUBLISH: publish ? allowed : denied } as never })

describe('ANI-1548 first value view', () => {
  it('shows the vault action unless the server approval policy allows publication', () => {
    const prepare = buildFirstValueView(item, { progressPercent: 75 }, { target: target(false), industry: '카페' })
    expect(prepare).toMatchObject({ action: 'VAULT', actionLabel: '승인하고 보관', progressPercent: 75, contentId: 'c1', versionId: 'v1' })
    expect(prepare.summary).toContain('모모 카페')
    expect(buildFirstValueView(item, { progressPercent: 100 }, { target: target(true) })).toMatchObject({ action: 'PUBLISH', actionLabel: '승인하고 발행' })
  })

  it('withholds the version handles when neither action is allowed', () => {
    const view = buildFirstValueView(item, { progressPercent: 40 }, { target: target(false, false) })
    expect(view).toMatchObject({ contentId: null, versionId: null, progressPercent: 40 })
  })

  it('correctly builds dual-channel target view when both channels are publishable', () => {
    const targets = [
      {
        channel: 'instagram' as const,
        contentId: 'ig-c1',
        versionId: 'ig-v1',
        handle: 'momo_insta',
        specLabel: '규격 확인 완료',
        actions: { VAULT: allowed, PUBLISH: allowed } as never,
      },
      {
        channel: 'threads' as const,
        contentId: 'th-c1',
        versionId: 'th-v1',
        handle: 'momo_threads',
        specLabel: '규격 확인 완료',
        actions: { VAULT: allowed, PUBLISH: allowed } as never,
      },
    ]

    const view = buildFirstValueView(item, { progressPercent: 100 }, { targets })
    expect(view.action).toBe('PUBLISH')
    expect(view.actionLabel).toBe('승인하고 발행')
    expect(view.targetChannelsText).toBe('인스타그램 · 스레드에 올려요')
    expect(view.targetChannels).toEqual(['instagram', 'threads'])
    expect(view.excludedChannels).toHaveLength(0)
  })

  it('excludes unpublishable channels and provides exclusion reason', () => {
    const targets = [
      {
        channel: 'instagram' as const,
        contentId: 'ig-c1',
        versionId: 'ig-v1',
        handle: 'momo_insta',
        specLabel: '규격 확인 필요',
        actions: { VAULT: allowed, PUBLISH: { allowed: false, message: '인스타그램 이미지가 필요해요' } } as never,
      },
      {
        channel: 'threads' as const,
        contentId: 'th-c1',
        versionId: 'th-v1',
        handle: 'momo_threads',
        specLabel: '규격 확인 완료',
        actions: { VAULT: allowed, PUBLISH: allowed } as never,
      },
    ]

    const view = buildFirstValueView(item, { progressPercent: 90 }, {
      targets,
      connectedChannels: [{ provider: 'instagram' }, { provider: 'threads' }],
    })
    expect(view.action).toBe('PUBLISH')
    expect(view.targetChannelsText).toBe('스레드에 올려요')
    expect(view.targetChannels).toEqual(['threads'])
    expect(view.excludedChannels).toEqual([
      { channel: 'instagram', name: '인스타그램', reason: '인스타그램 이미지가 필요해요' },
    ])
  })

  it('marks channel as reconnectRequired and includes reconnectUrl when identity is missing', () => {
    const targets = [
      {
        channel: 'instagram' as const,
        contentId: 'ig-c1',
        versionId: 'ig-v1',
        handle: 'momo_insta',
        specLabel: '규격 확인 완료',
        actions: {
          VAULT: allowed,
          PUBLISH: {
            allowed: false,
            message: '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.',
          },
        } as never,
        reasonCode: 'CONNECTION_IDENTITY_MISSING',
      },
    ]

    const view = buildFirstValueView(item, { progressPercent: 75 }, {
      targets,
      connectedChannels: [],
    })
    expect(view.action).toBe('VAULT')
    expect(view.excludedChannels).toEqual([
      {
        channel: 'instagram',
        name: '인스타그램',
        reason: '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.',
        reasonCode: 'CONNECTION_IDENTITY_MISSING',
        reconnectRequired: true,
        reconnectUrl: '/api/channels/instagram/connect?returnPath=/start/preview',
      },
    ])
    expect(view.channelViews?.[0]).toMatchObject({
      channel: 'instagram',
      publishAllowed: false,
      reconnectRequired: true,
      reconnectUrl: '/api/channels/instagram/connect?returnPath=/start/preview',
      publishReasonCode: 'CONNECTION_IDENTITY_MISSING',
    })
  })

  it('demotes action to VAULT, marks liveRolloutBlocked, and updates publishReason when liveRolloutBlocked is true', () => {
    const targets = [
      {
        channel: 'instagram' as const,
        contentId: 'ig-c1',
        versionId: 'ig-v1',
        handle: 'momo_insta',
        specLabel: '규격 확인 완료',
        actions: { VAULT: allowed, PUBLISH: allowed } as never,
      },
      {
        channel: 'threads' as const,
        contentId: 'th-c1',
        versionId: 'th-v1',
        handle: 'momo_threads',
        specLabel: '규격 확인 완료',
        actions: { VAULT: allowed, PUBLISH: allowed } as never,
      },
    ]

    const view = buildFirstValueView(item, { progressPercent: 100 }, {
      targets,
      connectedChannels: [{ provider: 'instagram' }, { provider: 'threads' }],
      liveRolloutBlocked: true,
    })

    const expectedMessage = '실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.'

    expect(view.action).toBe('VAULT')
    expect(view.actionLabel).toBe('승인하고 보관')
    expect(view.liveRolloutBlocked).toBe(true)
    expect(view.liveRolloutNotice).toBe(expectedMessage)
    expect(view.targetChannels).toEqual([])
    expect(view.targetChannelsText).toBeUndefined()
    expect(view.contentId).toBe('ig-c1')
    expect(view.versionId).toBe('ig-v1')

    expect(view.channelViews).toEqual([
      expect.objectContaining({
        channel: 'instagram',
        publishAllowed: false,
        publishReason: expectedMessage,
        publishReasonCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      }),
      expect.objectContaining({
        channel: 'threads',
        publishAllowed: false,
        publishReason: expectedMessage,
        publishReasonCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      }),
    ])

    expect(view.excludedChannels).toEqual([
      {
        channel: 'instagram',
        name: '인스타그램',
        reason: expectedMessage,
        reasonCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      },
      {
        channel: 'threads',
        name: '스레드',
        reason: expectedMessage,
        reasonCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      },
    ])
  })
})
