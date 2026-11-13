import { describe, expect, it } from 'vitest'
import { parseConfirmedPublishAttempt } from './publication-proof'

describe('parseConfirmedPublishAttempt (순수 게시 완료 증거 판정 계약)', () => {
  const ws = 'workspace-f23209fb'
  const scheduleId = 'schedule-1111'
  const attemptId = 'attempt-8add6e3b'

  const validAttempt = {
    id: attemptId,
    workspace_id: ws,
    schedule_id: scheduleId,
    status: 'succeeded',
    error_code: null,
    provider_request_id: 'req-12345',
    provider_reference: 'post-DfjpR8GkveI',
    finished_at: '2026-11-10T12:00:00Z',
  }

  const validTracking = {
    id: 'track-1',
    workspace_id: ws,
    publish_attempt_id: attemptId,
    destination_url: 'https://www.instagram.com/p/DfjpR8GkveI/',
  }

  it('성공 상태, 에러 없음, 요청/참조 ID, 트래킹 permalink 가 모두 정합하면 정상 증거를 반환한다 (Instagram)', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: validTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })

    expect(proof).toEqual({
      evidenceId: attemptId,
      providerReference: 'post-DfjpR8GkveI',
      observedAt: '2026-11-10T12:00:00Z',
      channel: 'instagram',
      permalink: 'https://www.instagram.com/p/DfjpR8GkveI/',
      source: 'publish_attempts.permalink_readback',
    })
  })

  it('Threads 공식 도메인 permalink 도 정상 승인한다', () => {
    const threadsAttempt = { ...validAttempt, id: 'attempt-threads' }
    const threadsTracking = {
      id: 'track-2',
      workspace_id: ws,
      publish_attempt_id: 'attempt-threads',
      destination_url: 'https://www.threads.com/@sohee.ai/post/DfjpoJ0k2hA',
    }

    const proof = parseConfirmedPublishAttempt({
      attempt: threadsAttempt,
      tracking: threadsTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'threads',
    })

    expect(proof).not.toBeNull()
    expect(proof?.channel).toBe('threads')
    expect(proof?.permalink).toBe('https://www.threads.com/@sohee.ai/post/DfjpoJ0k2hA')
  })

  it('raw status가 succeeded여도 error_code가 있으면 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: { ...validAttempt, error_code: 'TIMEOUT' },
      tracking: validTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('provider_request_id가 누락되면 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: { ...validAttempt, provider_request_id: null },
      tracking: validTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('provider_reference가 누락되면 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: { ...validAttempt, provider_reference: '' },
      tracking: validTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('다른 workspace_id 인 경우 테넌트 격리로 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: { ...validAttempt, workspace_id: 'other-ws' },
      tracking: validTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('다른 schedule_id 인 경우 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: { ...validAttempt, schedule_id: 'other-sched' },
      tracking: validTracking,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('tracking이 없으면 permalink 미검증으로 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: null,
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('tracking의 publish_attempt_id가 불일치하면 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: { ...validTracking, publish_attempt_id: 'other-attempt' },
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('채널 도메인과 맞지 않는 URL(피싱/오염)은 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: { ...validTracking, destination_url: 'https://evil.com/fake-post' },
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('단순 Instagram 프로필 URL은 실제 게시물 경로가 아니므로 엄격히 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: { ...validTracking, destination_url: 'https://www.instagram.com/sohee.ai' },
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).toBeNull()
  })

  it('단순 Threads 프로필 URL은 실제 게시물 경로가 아니므로 엄격히 거부한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: { ...validTracking, destination_url: 'https://www.threads.com/@sohee.ai' },
      workspaceId: ws,
      scheduleId,
      channel: 'threads',
    })
    expect(proof).toBeNull()
  })

  it('Instagram 릴스 경로(/reel/:id)는 정상 승인한다', () => {
    const proof = parseConfirmedPublishAttempt({
      attempt: validAttempt,
      tracking: { ...validTracking, destination_url: 'https://www.instagram.com/reel/C_reel123/' },
      workspaceId: ws,
      scheduleId,
      channel: 'instagram',
    })
    expect(proof).not.toBeNull()
    expect(proof?.permalink).toBe('https://www.instagram.com/reel/C_reel123/')
  })

  it('인증정보(username:password) 또는 비표준 포트가 포함된 위장 URL은 거부한다', () => {
    expect(
      parseConfirmedPublishAttempt({
        attempt: validAttempt,
        tracking: { ...validTracking, destination_url: 'https://admin:pass@www.instagram.com/p/DfjpR8GkveI/' },
        workspaceId: ws,
        scheduleId,
        channel: 'instagram',
      }),
    ).toBeNull()

    expect(
      parseConfirmedPublishAttempt({
        attempt: validAttempt,
        tracking: { ...validTracking, destination_url: 'https://www.instagram.com:8443/p/DfjpR8GkveI/' },
        workspaceId: ws,
        scheduleId,
        channel: 'instagram',
      }),
    ).toBeNull()
  })

  it('error_code 필드가 누락(undefined)된 경우 오류 미확인 상태이므로 fail-closed로 거부한다', () => {
    const { error_code: _discard, ...attemptMissingErrorCode } = validAttempt
    void _discard
    expect(
      parseConfirmedPublishAttempt({
        attempt: attemptMissingErrorCode,
        tracking: validTracking,
        workspaceId: ws,
        scheduleId,
        channel: 'instagram',
      }),
    ).toBeNull()
  })

  it('naver_blog 등 Meta 프로버 외 채널은 유효한 네이버 URL이어도 legacy 프로버 증거로 인정하지 않고 거부한다', () => {
    const naverTracking = {
      id: 'track-naver',
      workspace_id: ws,
      publish_attempt_id: attemptId,
      destination_url: 'https://blog.naver.com/my_shop/12345678',
    }
    expect(
      parseConfirmedPublishAttempt({
        attempt: validAttempt,
        tracking: naverTracking,
        workspaceId: ws,
        scheduleId,
        channel: 'naver_blog',
      }),
    ).toBeNull()
  })

  it('row에 error_message가 없거나 undefined인 경우(실제 DB 스키마) error_code가 null이면 정상 승인하며, error_message가 존재할 때만 보조 거부한다', () => {
    // 실제 DB 스키마처럼 error_code는 null이고 error_message 컬럼 자체가 없는 경우
    expect(
      parseConfirmedPublishAttempt({
        attempt: validAttempt,
        tracking: validTracking,
        workspaceId: ws,
        scheduleId,
        channel: 'instagram',
      }),
    ).not.toBeNull()

    // 만약 row에 error_message가 있고 에러 텍스트가 채워져 있다면 거부
    expect(
      parseConfirmedPublishAttempt({
        attempt: { ...validAttempt, error_message: 'UNKNOWN_NETWORK_ERROR' },
        tracking: validTracking,
        workspaceId: ws,
        scheduleId,
        channel: 'instagram',
      }),
    ).toBeNull()
  })
})
