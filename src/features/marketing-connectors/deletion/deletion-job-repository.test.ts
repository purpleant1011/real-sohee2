import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueDeletionJob,
  claimDeletionJob,
  completeDeletionJob,
  failDeletionJob,
  createInMemoryDeletionJobGateway,
  type DeletionJobGateway,
} from './deletion-job-repository';

describe('DeletionJobRepository (ANI-2153 F06)', () => {
  let gateway: DeletionJobGateway;

  beforeEach(() => {
    gateway = createInMemoryDeletionJobGateway();
  });

  describe('1. enqueueDeletionJob', () => {
    it('유효한 파라미터로 삭제 작업을 pending 상태로 등록한다', async () => {
      const job = await enqueueDeletionJob(
        {
          workspaceId: 'ws-test-1',
          connectorId: 'google_calendar',
          consentGeneration: 2,
          requestedBy: 'user-owner-1',
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      expect(job.id).toBeDefined();
      expect(job.workspaceId).toBe('ws-test-1');
      expect(job.connectorId).toBe('google_calendar');
      expect(job.consentGeneration).toBe(2);
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);
      expect(job.maxRetries).toBe(5);
      expect(job.lockedBy).toBeNull();
      expect(job.leaseExpiresAt).toBeNull();
      expect(job.createdAt).toBe('2026-11-11T10:00:00.000Z');
      expect(job.updatedAt).toBe('2026-11-11T10:00:00.000Z');

      const saved = await gateway.getJobById(job.id);
      expect(saved).toEqual(job);
    });

    it('위치 인자(positional args) 형태로도 등록이 가능하다', async () => {
      const job = await enqueueDeletionJob(
        'ws-test-2',
        'gmail',
        1,
        gateway,
        { requestedBy: 'user-owner-2', maxRetries: 3, now: '2026-11-11T10:05:00.000Z' }
      );

      expect(job.workspaceId).toBe('ws-test-2');
      expect(job.connectorId).toBe('gmail');
      expect(job.consentGeneration).toBe(1);
      expect(job.maxRetries).toBe(3);
    });

    it('잘못된 workspaceId, connectorId, consentGeneration 입력 시 에러를 던진다', async () => {
      await expect(
        enqueueDeletionJob(
          {
            workspaceId: '',
            connectorId: 'gmail',
            consentGeneration: 1,
          },
          gateway
        )
      ).rejects.toThrow('Invalid workspaceId');

      await expect(
        enqueueDeletionJob(
          {
            workspaceId: 'ws-1',
            connectorId: 'unknown_connector' as any,
            consentGeneration: 1,
          },
          gateway
        )
      ).rejects.toThrow('Invalid connectorId');

      await expect(
        enqueueDeletionJob(
          {
            workspaceId: 'ws-1',
            connectorId: 'gmail',
            consentGeneration: 0,
          },
          gateway
        )
      ).rejects.toThrow('Invalid consentGeneration');
    });
  });

  describe('2. claimDeletionJob', () => {
    it('pending 작업을 선점(claim)하여 running 상태 및 lease 만료를 설정한다', async () => {
      const job = await enqueueDeletionJob(
        {
          workspaceId: 'ws-claim-1',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      const claimed = await claimDeletionJob(
        'worker-1',
        900,
        gateway,
        '2026-11-11T10:00:01.000Z'
      );

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe('running');
      expect(claimed?.lockedBy).toBe('worker-1');
      expect(claimed?.leaseExpiresAt).toBe('2026-11-11T10:15:01.000Z');
      expect(claimed?.attempts).toBe(1);
    });

    it('동일 커넥터에 이미 유효한 running lease가 있으면 다른 작업은 선점되지 않는다', async () => {
      await enqueueDeletionJob(
        {
          workspaceId: 'ws-claim-2',
          connectorId: 'google_docs',
          consentGeneration: 1,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      // Claim first job
      const claimedFirst = await claimDeletionJob(
        'worker-1',
        900,
        gateway,
        '2026-11-11T10:00:01.000Z'
      );
      expect(claimedFirst).not.toBeNull();

      // Enqueue second job for same connector
      await enqueueDeletionJob(
        {
          workspaceId: 'ws-claim-2',
          connectorId: 'google_docs',
          consentGeneration: 2,
          now: '2026-11-11T10:00:02.000Z',
        },
        gateway
      );

      // Attempt to claim while first job is running with active lease
      const secondClaim = await claimDeletionJob(
        'worker-2',
        900,
        gateway,
        '2026-11-11T10:05:00.000Z'
      );
      expect(secondClaim).toBeNull();
    });

    it('lease가 만료된 running 작업은 다시 선점할 수 있다', async () => {
      await enqueueDeletionJob(
        {
          workspaceId: 'ws-claim-3',
          connectorId: 'outlook_mail',
          consentGeneration: 1,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      // Claim with 60s lease
      await claimDeletionJob('worker-dead', 60, gateway, '2026-11-11T10:00:00.000Z');

      // Now at 10:02:00 (lease expired at 10:01:00)
      const reclaimed = await claimDeletionJob('worker-new', 900, gateway, '2026-11-11T10:02:00.000Z');
      expect(reclaimed).not.toBeNull();
      expect(reclaimed?.lockedBy).toBe('worker-new');
      expect(reclaimed?.attempts).toBe(2);
    });

    it('retryAfter가 미래 시각으로 설정된 작업은 지연 시간이 경과할 때까지 선점되지 않는다', async () => {
      const job = await enqueueDeletionJob(
        {
          workspaceId: 'ws-claim-4',
          connectorId: 'google_drive',
          consentGeneration: 1,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      // Claim and fail once with retryAfter
      await claimDeletionJob('worker-1', 900, gateway, '2026-11-11T10:00:00.000Z');
      await failDeletionJob(job.id, new Error('Temporary 503'), gateway, {
        now: '2026-11-11T10:00:05.000Z',
        baseDelayMs: 60000, // retry after 1 minute (10:01:05)
      });

      // At 10:00:30, still before retryAfter
      const prematureClaim = await claimDeletionJob('worker-2', 900, gateway, '2026-11-11T10:00:30.000Z');
      expect(prematureClaim).toBeNull();

      // At 10:01:10, retryAfter passed
      const dueClaim = await claimDeletionJob('worker-2', 900, gateway, '2026-11-11T10:01:10.000Z');
      expect(dueClaim).not.toBeNull();
      expect(dueClaim?.id).toBe(job.id);
    });
  });

  describe('3. completeDeletionJob', () => {
    it('작업을 completed 상태로 전이하고 락 및 lease를 해제한다', async () => {
      const job = await enqueueDeletionJob(
        {
          workspaceId: 'ws-comp-1',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      await claimDeletionJob('worker-1', 900, gateway, '2026-11-11T10:00:01.000Z');

      const completed = await completeDeletionJob(job.id, gateway, {
        now: '2026-11-11T10:00:10.000Z',
      });

      expect(completed.status).toBe('completed');
      expect(completed.lockedBy).toBeNull();
      expect(completed.leaseExpiresAt).toBeNull();
      expect(completed.updatedAt).toBe('2026-11-11T10:00:10.000Z');
    });

    it('존재하지 않는 jobId로 완료 시 에러를 던진다', async () => {
      await expect(
        completeDeletionJob('non-existent-id', gateway)
      ).rejects.toThrow('Deletion job not found');
    });
  });

  describe('4. failDeletionJob', () => {
    it('재시도 횟수가 남아있는 경우 status를 pending으로 되돌리고 지수 백오프를 설정한다', async () => {
      const job = await enqueueDeletionJob(
        {
          workspaceId: 'ws-fail-1',
          connectorId: 'google_sheets',
          consentGeneration: 1,
          maxRetries: 3,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      await claimDeletionJob('worker-1', 900, gateway, '2026-11-11T10:00:00.000Z');

      const failed = await failDeletionJob(
        job.id,
        new Error('Network timeout'),
        gateway,
        {
          baseDelayMs: 1000,
          now: '2026-11-11T10:00:05.000Z',
        }
      );

      expect(failed.status).toBe('pending');
      expect(failed.attempts).toBe(1);
      expect(failed.lockedBy).toBeNull();
      expect(failed.leaseExpiresAt).toBeNull();
      expect(failed.lastError).toMatchObject({ message: 'Network timeout' });
      expect(failed.retryAfter).toBeDefined();
    });

    it('최대 재시도 횟수 초과 시 status를 failed로 영구 마킹한다', async () => {
      const job = await enqueueDeletionJob(
        {
          workspaceId: 'ws-fail-2',
          connectorId: 'google_sheets',
          consentGeneration: 1,
          maxRetries: 1,
          now: '2026-11-11T10:00:00.000Z',
        },
        gateway
      );

      // Attempt 1 (hits maxRetries)
      await claimDeletionJob('worker-1', 900, gateway, '2026-11-11T10:00:00.000Z');

      const permanentlyFailed = await failDeletionJob(
        job.id,
        new Error('Permanent provider failure'),
        gateway,
        { now: '2026-11-11T10:00:05.000Z' }
      );

      expect(permanentlyFailed.status).toBe('failed');
      expect(permanentlyFailed.attempts).toBe(1);
      expect(permanentlyFailed.retryAfter).toBeNull();
      expect(permanentlyFailed.lockedBy).toBeNull();
    });
  });
});
