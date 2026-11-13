import { describe, expect, it } from 'vitest'
import {
  parseConfirmedPublishAttempt,
  type ConfirmedPublishAttemptProof,
} from './publication-proof'

describe('parseConfirmedPublishAttempt (Adversarial Publication Proof)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const scheduleId = '22222222-2222-4222-8222-222222222222'

  // 실제 DB publish_attempts 테이블 row (channel, error_message 컬럼 없음, error_code 명시적 null)
  const validInstagramAttempt = {
    id: 'attempt-ig-1',
    workspace_id: workspaceId,
    schedule_id: scheduleId,
    status: 'succeeded',
    error_code: null,
    provider_request_id: 'req-ig-1',
    provider_reference: '17988888888888888',
    finished_at: '2026-11-10T10:00:00.000Z',
  }

  const validInstagramTracking = {
    id: 'track-ig-1',
    workspace_id: workspaceId,
    publish_attempt_id: 'attempt-ig-1',
    destination_url: 'https://www.instagram.com/p/DBcxyz123/',
  }

  const validThreadsAttempt = {
    id: 'attempt-th-1',
    workspace_id: workspaceId,
    schedule_id: scheduleId,
    status: 'succeeded',
    error_code: null,
    provider_request_id: 'req-th-1',
    provider_reference: '18099999999999999',
    finished_at: '2026-11-10T10:05:00.000Z',
  }

  const validThreadsTracking = {
    id: 'track-th-1',
    workspace_id: workspaceId,
    publish_attempt_id: 'attempt-th-1',
    destination_url: 'https://www.threads.net/@studio_byreum/post/Cxyz123',
  }

  describe('1. Valid Cases: 정본 permalink readback 증거 파싱', () => {
    it('Instagram 성공 시 정확한 permalink proof를 반환한다', () => {
      const proof: ConfirmedPublishAttemptProof | null = parseConfirmedPublishAttempt({
        attempt: validInstagramAttempt,
        tracking: validInstagramTracking,
        workspaceId,
        scheduleId,
        channel: 'instagram',
      })

      expect(proof).toEqual({
        evidenceId: 'attempt-ig-1',
        providerReference: '17988888888888888',
        observedAt: '2026-11-10T10:00:00.000Z',
        channel: 'instagram',
        permalink: 'https://www.instagram.com/p/DBcxyz123/',
        source: 'publish_attempts.permalink_readback',
      })
    })

    it('Threads 성공 시 정확한 permalink proof를 반환한다', () => {
      const proof: ConfirmedPublishAttemptProof | null = parseConfirmedPublishAttempt({
        attempt: validThreadsAttempt,
        tracking: validThreadsTracking,
        workspaceId,
        scheduleId,
        channel: 'threads',
      })

      expect(proof).toEqual({
        evidenceId: 'attempt-th-1',
        providerReference: '18099999999999999',
        observedAt: '2026-11-10T10:05:00.000Z',
        channel: 'threads',
        permalink: 'https://www.threads.net/@studio_byreum/post/Cxyz123',
        source: 'publish_attempts.permalink_readback',
      })
    })
  })

  describe('2. State & Error Guard: 상태 미충족 및 모순 에러 차단', () => {
    it('status가 succeeded가 아닌 경우(accepted, in_progress, pending) null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, status: 'accepted' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, status: 'in_progress' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('status가 failed인데 tracking에 destination_url이 있어도 null을 반환한다 (모순 차단)', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, status: 'failed' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('error_code 또는 error_message가 존재하면 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, error_code: 'META_API_RATE_LIMIT' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, error_message: '권한 검증 실패' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('error_code 필드가 삭제(undefined)된 경우 proof 없음으로 null을 반환한다', () => {
      const attemptWithoutErrorCode: Record<string, unknown> = { ...validInstagramAttempt }
      delete attemptWithoutErrorCode.error_code
      expect(
        parseConfirmedPublishAttempt({
          attempt: attemptWithoutErrorCode,
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('provider_reference 또는 provider_request_id가 없거나 빈 문자열이면 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, provider_reference: null },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, provider_reference: '   ' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, provider_request_id: null },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })
  })

  describe('3. URL & Security Guard: 위장 호스트, 비보안 스킴, 프로필 URL 차단', () => {
    it('tracking이 없거나 destination_url이 없으면 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: null,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: '' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('HTTP 비보안 URL은 거부한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: 'http://www.instagram.com/p/DBcxyz123/' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('javascript: 스킴이나 특수 스킴은 거부한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: 'javascript:alert(1)' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('위장 호스트(spoofed / phishing)는 거부한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: 'https://fake-instagram.com/p/123' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: 'https://instagram.com.evil.com/p/123' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: validThreadsAttempt,
          tracking: { ...validThreadsTracking, destination_url: 'https://threads.evil.com/post/123' },
          workspaceId,
          scheduleId,
          channel: 'threads',
        }),
      ).toBeNull()
    })

    it('포스트 permalink가 아닌 단순 프로필 URL은 거부한다', () => {
      // Instagram 프로필 URL (포스트 식별자 /p/ 또는 /reel/ 없음)
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: 'https://www.instagram.com/studio_byreum/' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      // Threads 프로필 URL (/post/ 없음)
      expect(
        parseConfirmedPublishAttempt({
          attempt: validThreadsAttempt,
          tracking: { ...validThreadsTracking, destination_url: 'https://www.threads.net/@studio_byreum' },
          workspaceId,
          scheduleId,
          channel: 'threads',
        }),
      ).toBeNull()
    })
  })

  describe('4. Isolation & Lineage Guard: 매장, 스케줄, 채널, 시각 정합성', () => {
    it('다른 매장(workspaceId 불일치) 시 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, workspace_id: 'other-workspace' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('다른 scheduleId 시 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, schedule_id: 'other-schedule' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('attempt와 tracking의 publish_attempt_id가 불일치하면 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, publish_attempt_id: 'mismatched-attempt-id' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })

    it('채널과 URL 도메인이 불일치하면 null을 반환한다 (인스타에 스레드 URL 오주입 등)', () => {
      // 채널은 instagram인데 URL은 threads.net
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: { ...validInstagramTracking, destination_url: 'https://www.threads.net/@studio_byreum/post/Cxyz123' },
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      // 채널은 threads인데 URL은 instagram.com
      expect(
        parseConfirmedPublishAttempt({
          attempt: validThreadsAttempt,
          tracking: { ...validThreadsTracking, destination_url: 'https://www.instagram.com/p/DBcxyz123/' },
          workspaceId,
          scheduleId,
          channel: 'threads',
        }),
      ).toBeNull()
    })

    it('naver_blog 및 유효 blog.naver.com 포스트 URL은 Meta permalink readback 원천이 아니므로 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: validInstagramAttempt,
          tracking: {
            ...validInstagramTracking,
            destination_url: 'https://blog.naver.com/sohee_beauty/223612345678',
          },
          workspaceId,
          scheduleId,
          channel: 'naver_blog',
        }),
      ).toBeNull()
    })

    it('finished_at 시각이 유효하지 않으면 null을 반환한다', () => {
      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, finished_at: 'invalid-date' },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()

      expect(
        parseConfirmedPublishAttempt({
          attempt: { ...validInstagramAttempt, finished_at: null },
          tracking: validInstagramTracking,
          workspaceId,
          scheduleId,
          channel: 'instagram',
        }),
      ).toBeNull()
    })
  })
})
