import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';

// content.generate 는 4채널 스튜디오(DB 의존)를 호출하므로 실DB 없이 도구 경로를 검증하도록 서비스를 대체한다.
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule());
vi.mock('@/features/channel-studio/compose', async () => (await import('./helpers/fake-channel-studio')).fakeComposeModule());
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resolve({ data: [], error: null })),
    })),
  })),
}));

describe('ANI-920: Real Domain Tool Dispatcher & Synthetic Success Elimination', () => {
  const WORKSPACE_ID = 'ws-test-byreum';

  beforeEach(() => {
    AgentControlPlaneService.resetForTest(WORKSPACE_ID);
  });

  it('handler 시작 직전 원장 기록을 기다리고 기록 실패면 실행하지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = false;
    const pending = ToolDispatcher.dispatch('content.generate', { topic: '봄', channel: 'INSTAGRAM' }, {
      workspaceId: WORKSPACE_ID, correlationId: 'activity-gate',
      onExecutionStarting: async () => { started = true; await gate; },
    });
    await vi.waitFor(() => expect(started).toBe(true));
    let finished = false;
    void pending.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    expect((await pending).success).toBe(true);

    const denied = await ToolDispatcher.dispatch('content.generate', { topic: '봄' }, {
      workspaceId: WORKSPACE_ID, correlationId: 'activity-denied',
      onExecutionStarting: async () => { throw new Error('ACTIVITY_UNAVAILABLE'); },
    });
    expect(denied.status).toBe('FAILED');
    expect(denied.data?.draftId).toBeUndefined();
  });

  it('preflight 거부는 handler 시작 활동을 만들지 않는다', async () => {
    const starting = vi.fn();
    const result = await ToolDispatcher.dispatch('unimplemented.capability', {}, {
      workspaceId: WORKSPACE_ID, correlationId: 'activity-no-handler', onExecutionStarting: starting,
    });
    expect(result.status).toBe('NOT_IMPLEMENTED');
    expect(starting).not.toHaveBeenCalled();
  });

  it('fails closed with NOT_IMPLEMENTED when an unmapped capability is called (eliminates synthetic mock success)', async () => {
    const result = await ToolDispatcher.dispatch(
      'unimplemented.capability',
      { foo: 'bar' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-1',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('NOT_IMPLEMENTED');
    expect(result.error?.code).toBe('NOT_IMPLEMENTED');
  });

  it('blocks cost-bearing and external write tools when Kill Switch is active', async () => {
    // 1. Engage kill switch
    AgentControlPlaneService.toggleKillSwitch(
      WORKSPACE_ID,
      true,
      'owner',
      '테스트 긴급 차단'
    );

    // 2. Try to dispatch image.generate
    const result = await ToolDispatcher.dispatch(
      'image.generate',
      { prompt: '눈썹 시술 사진' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-2',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.error?.code).toBe('KILLSWITCH_ACTIVE');
  });

  it('fails closed on ads readback when ad accounts are not connected (zero fake ROAS/spend)', async () => {
    const result = await ToolDispatcher.dispatch(
      'ads.list',
      {},
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-3',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.error?.code).toBe('CONNECT_REQUIRED');
    expect(result.data?.connectRequired).toBe(true);
    expect(result.data?.totalSpend).toBe(0);
  });

  it('dispatches content.generate with argument validation and real draft ID', async () => {
    // Empty topic should fail argument check
    const invalidRes = await ToolDispatcher.dispatch(
      'content.generate',
      { topic: '' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-4',
      }
    );
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error?.code).toBe('INVALID_ARGUMENT');

    // Valid topic creates draft
    const validRes = await ToolDispatcher.dispatch(
      'content.generate',
      { topic: '봄맞이 속눈썹 펌 이벤트', channel: 'INSTAGRAM' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-5',
      }
    );
    expect(validRes.success).toBe(true);
    expect(validRes.status).toBe('COMPLETED');
    expect(validRes.data?.draftId).toMatch(/^(draft_|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))/);
    // 스튜디오 정산 규칙(글 100 SC)과 같은 값을 보고한다. 예전 표시용 10은 장부에 기록되지 않던 가짜 값이었다.
    expect(validRes.creditDeducted).toBe(100);
  });

  it('returns AWAITING_APPROVAL proposal for comment.reply in DRAFT mode', async () => {
    const result = await ToolDispatcher.dispatch(
      'comment.reply',
      { commentId: 'c_123', replyText: '예약 문의 감사합니다!' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-6',
        intentMode: 'DRAFT',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(result.proposal?.proposalType).toBe('COMMENT_REPLY_APPROVAL');
    expect(result.proposal?.title).toContain('승인');
  });

  it('returns empty-verified semantics on results performance.summary (zero fabricated revenue)', async () => {
    const result = await ToolDispatcher.dispatch(
      'performance.summary',
      {},
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-7',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    const data = result.data as any;
    expect(data?.metrics?.revenueKrw?.value).toBeNull();
    expect(data?.metrics?.revenueKrw?.state).toBe('UNAVAILABLE');
    expect(data?.metrics?.publishedPosts?.total).toBe(0);
    expect(data?.summaryText).toBeDefined();
  });

  it('dispatches app.navigate with route whitelist protection', async () => {
    const result = await ToolDispatcher.dispatch(
      'app.navigate',
      { target: 'content' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-8',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(result.data?.navigatedUrl).toBe('/app/content');
  });

  it('updates autonomy mode in runtime control state via autonomy.update', async () => {
    const result = await ToolDispatcher.dispatch(
      'autonomy.update',
      { action: 'start' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-9',
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.desiredMode).toBe('RUNNING');

    const canonicalState = await AgentControlPlaneService.getControlState(WORKSPACE_ID);
    expect(canonicalState.desired_mode).toBe('RUNNING');
  });
});
