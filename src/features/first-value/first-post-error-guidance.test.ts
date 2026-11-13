import { describe, expect, it } from 'vitest'
import { resolveFirstPostErrorGuidance } from './first-post-error-guidance'

describe('resolveFirstPostErrorGuidance', () => {
  it('maps 402 or INSUFFICIENT_CREDITS to point shortage with channel connect link and business onboarding link', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
      message: '사장님 크레딧이 부족해요. 필요 250 / 보유 0',
    })
    expect(guidance.category).toBe('INSUFFICIENT_CREDITS')
    expect(guidance.title).toBe('첫 포스팅에 쓸 포인트가 없어요')
    expect(guidance.description).toContain('인스타그램이나 스레드를 연결하면 포인트를 드려요')
    expect(guidance.primaryAction).toEqual({
      label: '채널 연결하기',
      href: '/start?step=channels',
      actionType: 'navigate',
      variant: 'default',
    })
    expect(guidance.secondaryAction).toEqual({
      label: '사업자 인증하기',
      href: '/onboarding/business',
      actionType: 'navigate',
      variant: 'outline',
    })
  })

  it('maps 403 TRIAL_FIRST_POST_LIMIT_REACHED to trial limit with business onboarding link', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'TRIAL_FIRST_POST_LIMIT_REACHED',
      status: 403,
      message: '첫 포스팅 2건을 모두 사용했어요. 사업자 인증이 승인되면 계속 쓸 수 있어요.',
    })
    expect(guidance.category).toBe('TRIAL_LIMIT')
    expect(guidance.title).toBe('첫 포스팅 2건을 모두 사용했어요')
    expect(guidance.description).toContain('사업자 인증이 승인되면 계속 쓸 수 있어요')
    expect(guidance.primaryAction).toEqual({
      label: '사업자 인증하기',
      href: '/onboarding/business',
      actionType: 'navigate',
      variant: 'default',
    })
  })

  it('maps DAILY_LIMIT_REACHED to daily quota notification with retry action', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'DAILY_LIMIT_REACHED',
      status: 429,
      message: '하루에 만들 수 있는 게시물 한도를 모두 사용했어요.',
    })
    expect(guidance.category).toBe('DAILY_LIMIT')
    expect(guidance.title).toBe('오늘 작성 한도에 도달했어요')
    expect(guidance.description).toContain('내일 다시 시도해 주세요')
    expect(guidance.primaryAction.actionType).toBe('retry')
  })

  it('maps REVISION_LIMIT_REACHED to revision limit with new post link', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'REVISION_LIMIT_REACHED',
      status: 429,
      message: '수정 요청은 게시물당 3번까지 가능해요.',
    })
    expect(guidance.category).toBe('REVISION_LIMIT')
    expect(guidance.title).toBe('게시물 수정 한도에 도달했어요')
    expect(guidance.primaryAction).toEqual({
      label: '새 글 만들기',
      href: '/start',
      actionType: 'navigate',
      variant: 'default',
    })
  })

  it('maps CHANNEL_NOT_CONNECTED or readiness blocker to channel connection prompt', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'CHANNEL_NOT_CONNECTED',
      status: 403,
      message: '글을 올릴 SNS 채널이 아직 연결되지 않았어요.',
    })
    expect(guidance.category).toBe('CHANNELS_DISCONNECTED')
    expect(guidance.title).toBe('연결된 채널이 없어요')
    expect(guidance.primaryAction).toEqual({
      label: '채널 연결하기',
      href: '/start?step=channels',
      actionType: 'navigate',
      variant: 'default',
    })
  })

  it('maps TIMEOUT to taking long guidance with retry button', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'TIMEOUT',
    })
    expect(guidance.category).toBe('TIMEOUT')
    expect(guidance.title).toBe('조금 오래 걸리고 있어요')
    expect(guidance.primaryAction.actionType).toBe('retry')
  })

  it('maps 503 or transient failure to friendly retry card', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'CREDIT_RESERVE_FAILED',
      status: 503,
      message: '일시적인 연결 지연이 발생했어요.',
    })
    expect(guidance.category).toBe('TRANSIENT')
    expect(guidance.title).toBe('잠시 문제가 생겼어요')
    expect(guidance.description).toBe('작성하신 내용은 그대로예요. 잠시 후 다시 시도해 주세요.')
    expect(guidance.primaryAction).toEqual({
      label: '다시 시도',
      actionType: 'retry',
      variant: 'default',
    })
  })

  it('maps PUBLISH_NOT_ENABLED to service preparation guidance with vault fallback action', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'PUBLISH_NOT_ENABLED',
      status: 403,
      message: '게시 기능을 준비하고 있어요. 글은 보관함에 안전하게 담아 둘게요.',
    })
    expect(guidance.category).toBe('PUBLISH_NOT_ENABLED')
    expect(guidance.title).toBe('게시 기능을 준비하고 있어요')
    expect(guidance.description).toContain('보관함에 안전하게 담아 둘게요')
    expect(guidance.primaryAction).toEqual({
      label: '보관함에 담기',
      actionType: 'vault',
      variant: 'default',
    })
    expect(guidance.secondaryAction).toEqual({
      label: '채널 다시 확인하기',
      href: '/start?step=channels',
      actionType: 'navigate',
      variant: 'outline',
    })
  })

  it('maps WORKSPACE_NOT_IN_LIVE_ROLLOUT to rollout guidance with vault fallback, app navigate action, and no retry action', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      status: 403,
      message: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
    })
    expect(guidance.category).toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
    expect(guidance.title).toBe('실제 게시는 아직 준비 중이에요')
    expect(guidance.description).toBe('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
    expect(guidance.primaryAction).toEqual({
      label: '보관함에 담기',
      actionType: 'vault',
      variant: 'default',
    })
    expect(guidance.secondaryAction).toEqual({
      label: '소희 작업실로 이동',
      href: '/app',
      actionType: 'navigate',
      variant: 'outline',
    })
    // '다시 시도' 액션이 없어야 함
    expect(guidance.primaryAction.actionType).not.toBe('retry')
    expect(guidance.secondaryAction?.actionType).not.toBe('retry')
  })

  it('uses default rollout message when WORKSPACE_NOT_IN_LIVE_ROLLOUT has no custom message', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      status: 403,
    })
    expect(guidance.category).toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
    expect(guidance.description).toBe('실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.')
  })

  it('maps CONNECTION_IDENTITY_MISSING to reconnect guidance with channel specific oauth link', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'CONNECTION_IDENTITY_MISSING',
      status: 403,
      channel: 'instagram',
    })
    expect(guidance.category).toBe('CHANNELS_DISCONNECTED')
    expect(guidance.title).toBe('채널 다시 연결이 필요해요')
    expect(guidance.description).toBe(
      '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.'
    )
    expect(guidance.primaryAction).toEqual({
      label: '다시 연결하기',
      href: '/api/channels/instagram/connect?returnPath=/start/preview',
      actionType: 'navigate',
      variant: 'default',
    })

    const threadsGuidance = resolveFirstPostErrorGuidance({
      code: 'CONNECTION_IDENTITY_MISSING',
      status: 403,
      channel: 'threads',
    })
    expect(threadsGuidance.primaryAction.href).toBe('/api/channels/threads/connect?returnPath=/start/preview')
  })

  it('maps TOKEN_EXPIRED to token expired guidance', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'TOKEN_EXPIRED',
      status: 403,
    })
    expect(guidance.category).toBe('CHANNELS_DISCONNECTED')
    expect(guidance.title).toBe('채널 연결이 만료되었어요')
    expect(guidance.primaryAction).toEqual({
      label: '다시 연결하기',
      href: '/start?step=channels',
      actionType: 'navigate',
      variant: 'default',
    })
  })

  it('maps CHANNEL_NOT_VERIFIED to channel verification check guidance', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'CHANNEL_NOT_VERIFIED',
      status: 403,
      message: '채널 연결 상태를 확인하지 못했어요.',
    })
    expect(guidance.category).toBe('CHANNELS_DISCONNECTED')
    expect(guidance.title).toBe('채널 확인이 필요해요')
    expect(guidance.primaryAction).toEqual({
      label: '채널 다시 확인하기',
      href: '/start?step=channels',
      actionType: 'navigate',
      variant: 'default',
    })
  })

  it('falls back unknown error to transient retry card', () => {
    const guidance = resolveFirstPostErrorGuidance({})
    expect(guidance.category).toBe('TRANSIENT')
    expect(guidance.title).toBe('잠시 문제가 생겼어요')
    expect(guidance.primaryAction.label).toBe('다시 시도')
  })
})
