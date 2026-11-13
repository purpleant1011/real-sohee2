import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueSyncJob,
  claimSyncJob,
  completeSyncJob,
  failSyncJob,
  createInMemorySyncJobGateway,
  type SyncJobGateway,
} from './sync-job-repository';

describe('SyncJobRepository (ANI-2152 / F05)', () => {
  let gateway: SyncJobGateway;
  const fixedNow = '2026-11-11T12:00:00.000Z';

  beforeEach(() => {
    gateway = createInMemorySyncJobGateway();
  });

  describe('enqueueSyncJob', () => {
    it('큐에 신규 동기화 작업을 pending 상태로 적재한다 (객체 파라미터)', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: '11111111-1111-1111-1111-111111111111',
          connectorId: 'google_calendar',
          sourceId: 'c_business_primary',
          consentGeneration: 2,
          now: fixedNow,
        },
        gateway,
      );

      expect(job.id).toBeDefined();
      expect(job.workspaceId).toBe('11111111-1111-1111-1111-111111111111');
      expect(job.connectorId).toBe('google_calendar');
      expect(job.sourceId).toBe('c_business_primary');
      expect(job.consentGeneration).toBe(2);
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);
      expect(job.maxRetries).toBe(5);
      expect(job.lockedBy).toBeNull();
      expect(job.leaseExpiresAt).toBeNull();
      expect(job.cursor).toBeNull();
      expect(job.nextSyncToken).toBeNull();
      expect(job.stats).toEqual({});
      expect(job.createdAt).toBe(fixedNow);
      expect(job.updatedAt).toBe(fixedNow);

      const saved = await gateway.getJobById(job.id);
      expect(saved).toEqual(job);
    });

    it('큐에 신규 동기화 작업을 적재한다 (인자 순서 지원)', async () => {
      const job = await enqueueSyncJob(
        '11111111-1111-1111-1111-111111111111',
        'apple_calendar',
        'ics_hash_xyz',
        1,
        gateway,
        { now: fixedNow, maxRetries: 3, cursor: 'token_abc' },
      );

      expect(job.connectorId).toBe('apple_calendar');
      expect(job.maxRetries).toBe(3);
      expect(job.cursor).toBe('token_abc');
    });

    it('필수 입력값 누락 시 에러를 던진다', async () => {
      await expect(
        enqueueSyncJob(
          {
            workspaceId: '',
            connectorId: 'google_calendar',
            sourceId: 'src_1',
            consentGeneration: 1,
          },
          gateway,
        ),
      ).rejects.toThrow('Invalid workspaceId');

      await expect(
        enqueueSyncJob(
          {
            workspaceId: '11111111-1111-1111-1111-111111111111',
            connectorId: 'google_calendar',
            sourceId: '',
            consentGeneration: 1,
          },
          gateway,
        ),
      ).rejects.toThrow('Invalid sourceId');

      await expect(
        enqueueSyncJob(
          {
            workspaceId: '11111111-1111-1111-1111-111111111111',
            connectorId: 'google_calendar',
            sourceId: 'src_1',
            consentGeneration: 0,
          },
          gateway,
        ),
      ).rejects.toThrow('Invalid consentGeneration');
    });
  });

  describe('claimSyncJob', () => {
    it('대기 중(pending)인 작업을 15분 lease lock으로 원자적 선점한다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );

      const claimed = await claimSyncJob('worker-alpha', 900, gateway, fixedNow);

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe('running');
      expect(claimed?.lockedBy).toBe('worker-alpha');
      // 900초(15분) 뒤 만료
      const expectedExpiresAt = new Date(Date.parse(fixedNow) + 900 * 1000).toISOString();
      expect(claimed?.leaseExpiresAt).toBe(expectedExpiresAt);

      // 이미 running인 경우 중복 claim 불가
      const secondClaim = await claimSyncJob('worker-beta', 900, gateway, fixedNow);
      expect(secondClaim).toBeNull();
    });

    it('동일 커넥터에 대해 유효한 running 작업이 있으면 다른 작업의 동시 수집을 방어한다', async () => {
      // 동일 커넥터에 2개 작업 등록
      await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-source-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );
      await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-source-2',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );

      // 첫 번째 작업 선점
      const claimed1 = await claimSyncJob('worker-1', 900, gateway, fixedNow);
      expect(claimed1).not.toBeNull();
      expect(claimed1?.sourceId).toBe('cal-source-1');

      // 동일 커넥터의 두 번째 작업은 첫 번째 작업이 running 중이므로 claim 불가!
      const claimed2 = await claimSyncJob('worker-2', 900, gateway, fixedNow);
      expect(claimed2).toBeNull();

      // 다른 커넥터(apple_calendar)의 작업은 동시 선점 가능
      await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'apple_calendar',
          sourceId: 'apple-cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );
      const claimedApple = await claimSyncJob('worker-2', 900, gateway, fixedNow);
      expect(claimedApple).not.toBeNull();
      expect(claimedApple?.connectorId).toBe('apple_calendar');
    });

    it('lease가 만료된 running 작업은 다른 워커가 재선점(re-claim)할 수 있다', async () => {
      await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );

      // worker-1이 900초 선점
      await claimSyncJob('worker-1', 900, gateway, fixedNow);

      // 901초 후 (lease 만료)
      const afterLeaseExpired = new Date(Date.parse(fixedNow) + 901 * 1000).toISOString();
      const reclaimed = await claimSyncJob('worker-2', 900, gateway, afterLeaseExpired);

      expect(reclaimed).not.toBeNull();
      expect(reclaimed?.lockedBy).toBe('worker-2');
      expect(reclaimed?.status).toBe('running');
    });

    it('retry_after가 아직 지나지 않은 pending 작업은 선점하지 않는다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );

      // 실패 처리로 retryAfter를 60초 뒤로 설정
      await failSyncJob(
        job.id,
        new Error('Temporary network glitch'),
        gateway,
        { now: fixedNow, baseDelayMs: 60000 },
      );

      // 30초 후: 아직 retry_after 이전이므로 claim 불가
      const halfwayNow = new Date(Date.parse(fixedNow) + 30 * 1000).toISOString();
      const prematureClaim = await claimSyncJob('worker-1', 900, gateway, halfwayNow);
      expect(prematureClaim).toBeNull();

      // 61초 후: retry_after 경과 후 선점 가능
      const afterRetryNow = new Date(Date.parse(fixedNow) + 61 * 1000).toISOString();
      const readyClaim = await claimSyncJob('worker-1', 900, gateway, afterRetryNow);
      expect(readyClaim).not.toBeNull();
      expect(readyClaim?.id).toBe(job.id);
    });
  });

  describe('completeSyncJob', () => {
    it('작업을 완료 처리하고 status=completed, cursor/nextSyncToken 및 stats를 갱신한다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );
      await claimSyncJob('worker-1', 900, gateway, fixedNow);

      const completed = await completeSyncJob(
        job.id,
        { itemsProcessed: 42, newItemsCount: 10 },
        gateway,
        {
          nextSyncToken: 'sync_token_v2_xyz',
          cursor: 'cursor_20261111',
          now: fixedNow,
        },
      );

      expect(completed.status).toBe('completed');
      expect(completed.stats).toEqual({ itemsProcessed: 42, newItemsCount: 10 });
      expect(completed.nextSyncToken).toBe('sync_token_v2_xyz');
      expect(completed.cursor).toBe('cursor_20261111');
      expect(completed.lockedBy).toBeNull();
      expect(completed.leaseExpiresAt).toBeNull();

      const inDb = await gateway.getJobById(job.id);
      expect(inDb?.status).toBe('completed');
    });
  });

  describe('failSyncJob', () => {
    it('429 감지 시 retry-after 헤더/파라미터를 감지하여 백오프를 반영한다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );
      await claimSyncJob('worker-1', 900, gateway, fixedNow);

      const error429 = {
        statusCode: 429,
        message: 'Rate limit exceeded',
        retryAfter: 120, // 120 seconds
      };

      const failed = await failSyncJob(job.id, error429, gateway, { now: fixedNow });

      expect(failed.status).toBe('pending');
      expect(failed.attempts).toBe(1);
      const expectedRetryAfter = new Date(Date.parse(fixedNow) + 120 * 1000).toISOString();
      expect(failed.retryAfter).toBe(expectedRetryAfter);
      expect(failed.lockedBy).toBeNull();
      expect(failed.leaseExpiresAt).toBeNull();
      expect(failed.lastError).toEqual({
        message: 'Rate limit exceeded',
        statusCode: 429,
        retryAfter: 120,
      });
    });

    it('일반 에러 시 지수 백오프(exponential backoff)를 계산한다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );

      // 1번째 실패 (attempts: 0 -> 1): 2^0 * baseDelay = 1 * 5000 = 5000ms
      const fail1 = await failSyncJob(
        job.id,
        new Error('Socket timeout'),
        gateway,
        { now: fixedNow, baseDelayMs: 5000 },
      );
      expect(fail1.attempts).toBe(1);
      expect(fail1.status).toBe('pending');
      expect(fail1.retryAfter).toBe(new Date(Date.parse(fixedNow) + 5000).toISOString());

      // 2번째 실패 (attempts: 1 -> 2): 2^1 * baseDelay = 2 * 5000 = 10000ms
      const fail2 = await failSyncJob(
        job.id,
        new Error('Socket timeout again'),
        gateway,
        { now: fixedNow, baseDelayMs: 5000 },
      );
      expect(fail2.attempts).toBe(2);
      expect(fail2.status).toBe('pending');
      expect(fail2.retryAfter).toBe(new Date(Date.parse(fixedNow) + 10000).toISOString());
    });

    it('max_retries 초과 시 status=failed로 전이한다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          maxRetries: 2,
          now: fixedNow,
        },
        gateway,
      );

      await failSyncJob(job.id, new Error('Fail 1'), gateway, { now: fixedNow });
      const finalFail = await failSyncJob(job.id, new Error('Fail 2'), gateway, { now: fixedNow });

      expect(finalFail.attempts).toBe(2);
      expect(finalFail.status).toBe('failed');
      expect(finalFail.lockedBy).toBeNull();
      expect(finalFail.leaseExpiresAt).toBeNull();
    });

    it('동의가 이미 철회된 경우(CONSENT_REVOKED) 즉시 status=cancelled로 전이한다', async () => {
      const job = await enqueueSyncJob(
        {
          workspaceId: 'ws-1',
          connectorId: 'google_calendar',
          sourceId: 'cal-1',
          consentGeneration: 1,
          now: fixedNow,
        },
        gateway,
      );

      const revokedError = {
        code: 'CONSENT_REVOKED',
        message: 'Consent has been revoked for this connector',
      };

      const cancelled = await failSyncJob(job.id, revokedError, gateway, { now: fixedNow });

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.lockedBy).toBeNull();
      expect(cancelled.leaseExpiresAt).toBeNull();
      expect(cancelled.retryAfter).toBeNull();
    });
  });
});
