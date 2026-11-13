import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeDeterministicAction,
  engageKillSwitch,
  releaseKillSwitch,
} from '../deterministic-executor-gateway';
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(),
}));

vi.mock('@/lib/agent-os/executors/publishing-executor', () => ({
  PublishingExecutor: {
    executePublish: vi.fn(),
  },
}));

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(),
}));

describe('DeterministicExecutorGateway (ANI-703, ANI-747)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  let mockSupabase: any;
  let ledgerUpdateFn: any;

  beforeEach(() => {
    vi.clearAllMocks();
    releaseKillSwitch('GLOBAL', 'ALL');
    releaseKillSwitch('CHANNEL', 'instagram');

    ledgerUpdateFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'agent_energy_ledgers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    remaining_available_energy: 50,
                    reserved_energy_active_runs: 0,
                    budget_alert_stage: 'NORMAL',
                  },
                  error: null,
                }),
              }),
            }),
            update: ledgerUpdateFn,
          };
        }
        return {};
      }),
    };

    (createServerSupabaseClient as any).mockResolvedValue(mockSupabase);
    (checkKillSwitchPreflight as any).mockResolvedValue({ blocked: false });
  });

  it('blocks execution if local kill switch is engaged', async () => {
    engageKillSwitch('CHANNEL', 'instagram', 'Local channel pause');

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_kill_1',
      estimatedEnergyCost: 5,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PREFLIGHT_BLOCKED');
    expect(result.errorReason).toContain('로컬 킬스위치');
    expect(PublishingExecutor.executePublish).not.toHaveBeenCalled();
  });

  it('blocks execution if durable database kill switch is active', async () => {
    (checkKillSwitchPreflight as any).mockResolvedValue({
      blocked: true,
      reason: '전사 긴급 킬스위치가 활성화되어 있습니다.',
    });

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_kill_db_1',
      estimatedEnergyCost: 5,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PREFLIGHT_BLOCKED');
    expect(result.errorReason).toContain('전사 긴급 킬스위치');
    expect(PublishingExecutor.executePublish).not.toHaveBeenCalled();
  });

  it('blocks execution if agent energy is insufficient', async () => {
    mockSupabase.from = vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              remaining_available_energy: 2,
              reserved_energy_active_runs: 0,
            },
            error: null,
          }),
        }),
      }),
      update: ledgerUpdateFn,
    }));

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_low_energy_1',
      estimatedEnergyCost: 5,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PREFLIGHT_BLOCKED');
    expect(result.errorReason).toContain('잔여 Agent Energy 부족');
    expect(PublishingExecutor.executePublish).not.toHaveBeenCalled();
  });

  it('rejects duplicate requests with same idempotency key', async () => {
    (PublishingExecutor.executePublish as any).mockResolvedValue({
      success: true,
      verified: true,
      channel: 'INSTAGRAM',
      publishedUrl: 'https://instagram.com/p/real_post_123',
      externalPostId: 'real_post_123',
      statusMessage: '정상 실발행되었습니다.',
    });

    const first = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_dup_test_1',
      estimatedEnergyCost: 5,
    });

    expect(first.success).toBe(true);
    expect(first.status).toBe('SUBMITTED');

    const second = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_dup_test_1',
      estimatedEnergyCost: 5,
    });

    expect(second.status).toBe('DUPLICATE_IGNORED');
    expect(second.energyReserved).toBe(0);
    expect(PublishingExecutor.executePublish).toHaveBeenCalledTimes(1);
  });

  it('refunds energy and blocks if channel is not connected', async () => {
    (PublishingExecutor.executePublish as any).mockResolvedValue({
      success: false,
      verified: false,
      channel: 'INSTAGRAM',
      errorCode: 'CHANNEL_NOT_CONNECTED',
      statusMessage: '인스타그램 채널이 아직 공식 연동되지 않았습니다.',
    });

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_not_conn_1',
      estimatedEnergyCost: 5,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PREFLIGHT_BLOCKED');
    expect(result.errorReason).toContain('채널이 아직 공식 연동되지 않았습니다');
    expect(ledgerUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        remaining_available_energy: 50,
      })
    );
  });

  it('refunds energy and fails if provider rejects', async () => {
    (PublishingExecutor.executePublish as any).mockResolvedValue({
      success: false,
      verified: false,
      channel: 'INSTAGRAM',
      errorCode: 'PROVIDER_REJECTED',
      statusMessage: 'Meta API가 게시물 생성을 거부했습니다.',
    });

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Test post' },
      idempotencyKey: 'idemp_prov_rej_1',
      estimatedEnergyCost: 5,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PROVIDER_REJECTED');
    expect(result.errorReason).toContain('Meta API가 게시물 생성을 거부했습니다');
    expect(ledgerUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        remaining_available_energy: 50,
      })
    );
  });

  it('successfully submits via real PublishingExecutor with authoritative post ID and URL', async () => {
    (PublishingExecutor.executePublish as any).mockResolvedValue({
      success: true,
      verified: true,
      channel: 'INSTAGRAM',
      publishedUrl: 'https://instagram.com/p/authoritative_post_999',
      externalPostId: 'authoritative_post_999',
      statusMessage: '공식 INSTAGRAM 채널에 정상 실발행되었습니다.',
    });

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'PUBLISH_CONTENT',
      channel: 'instagram',
      contentPayload: { body: 'Actual commercial post' },
      idempotencyKey: 'idemp_real_publish_999',
      estimatedEnergyCost: 5,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('SUBMITTED');
    expect(result.providerObjectId).toBe('authoritative_post_999');
    expect(result.providerPostUrl).toBe('https://instagram.com/p/authoritative_post_999');
    expect(result.energyReserved).toBe(5);
  });

  it('checks channel connection for non-publish actions and refunds if unconnected', async () => {
    (loadChannelCredentialByChannel as any).mockRejectedValue(new Error('채널 연결 정보를 확인할 수 없습니다.'));

    const result = await executeDeterministicAction({
      workspaceId,
      actionType: 'REPLY_COMMENT',
      channel: 'instagram',
      contentPayload: { body: 'Thank you!' },
      idempotencyKey: 'idemp_reply_unconn',
      estimatedEnergyCost: 2,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PREFLIGHT_BLOCKED');
    expect(result.errorReason).toContain('채널이 연동되지 않아');
  });
});
