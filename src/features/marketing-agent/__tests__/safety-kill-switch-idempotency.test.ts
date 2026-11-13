import { AgentControlPlaneService } from '../engine/agent-control-state';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyAndCreditEngine } from '../engine/safety-engine';

describe('Safety Engine, Global Kill Switch & Idempotency (V0.8.7 Spec)', () => {
  const sampleWorkspaceId = 'ws-byreum-test';
  beforeEach(async () => { AgentControlPlaneService.resetForTest(sampleWorkspaceId); await AgentControlPlaneService.setDesiredMode(sampleWorkspaceId, 'RUNNING', 'test-owner'); });

  it('Global Kill Switch 활성화 시 모든 신규 외부 write 액션이 즉시 차단된다', async () => {
    const engine = new SafetyAndCreditEngine();

    // 1. 기본 상태에서는 정상 통과
    const normalCheck = await engine.preflightCheck({
      workspaceId: sampleWorkspaceId,
      actionType: 'instagram.publish',
      channelKey: 'instagram',
    });
    expect(normalCheck.allowed).toBe(true);
    expect(normalCheck.isKillSwitched).toBeFalsy();

    // 2. Kill Switch 활성화
    await engine.setGlobalKillSwitch(sampleWorkspaceId, true, 'owner-user-01');
    const pausedCheck = await engine.preflightCheck({
      workspaceId: sampleWorkspaceId,
      actionType: 'instagram.publish',
      channelKey: 'instagram',
    });
    expect(pausedCheck.allowed).toBe(false);
    expect(pausedCheck.isKillSwitched).toBe(true);
    expect(pausedCheck.reason).toContain('일시정지');

    // 3. Kill Switch 비활성화 시 다시 정상 동작
    await engine.setGlobalKillSwitch(sampleWorkspaceId, false, 'owner-user-01');
    const resumedCheck = await engine.preflightCheck({
      workspaceId: sampleWorkspaceId,
      actionType: 'instagram.publish',
      channelKey: 'instagram',
    });
    expect(resumedCheck.allowed).toBe(true);
  });

  it('동일 작업(동일 idempotency_key)을 20회 중복 전달해도 실제 외부 작업은 1회만 실행된다 (LIVE-15)', async () => {
    const engine = new SafetyAndCreditEngine();
    const idempotencyKey = 'idem-rule-ig-20260831-slot-01';

    const mockExternalPublisher = vi.fn().mockResolvedValue({
      status: 'succeeded',
      permalink: 'https://instagram.com/p/byreum-test-123',
      mediaId: '17892301923',
    });

    const results = [];
    for (let i = 0; i < 20; i++) {
      const res = await engine.executeWithIdempotency(
        idempotencyKey,
        'instagram.publish',
        mockExternalPublisher
      );
      results.push(res);
    }

    // 외부 퍼블리셔는 정확히 1회만 호출되어야 함
    expect(mockExternalPublisher).toHaveBeenCalledTimes(1);

    // 첫 번째 결과는 isDuplicateReplay: false
    expect(results[0].isDuplicateReplay).toBe(false);
    expect(results[0].executionCount).toBe(1);
    expect(results[0].result.permalink).toBe('https://instagram.com/p/byreum-test-123');

    // 나머지 19회는 isDuplicateReplay: true
    for (let i = 1; i < 20; i++) {
      expect(results[i].isDuplicateReplay).toBe(true);
      expect(results[i].result.permalink).toBe('https://instagram.com/p/byreum-test-123');
    }
  });

  it('Credit Guardian은 일일 한도 초과 시 비핵심 업무를 차단하고 Revenue-Critical 업무를 우선한다', async () => {
    const engine = new SafetyAndCreditEngine();
    engine.setCreditBudget(sampleWorkspaceId, {
      totalDailyLimit: 20,
      usedDaily: 18, // 잔여 2
      totalWeeklyLimit: 200,
      usedWeekly: 100,
    });

    // 1. 일반 블로그 발행(25 크레딧) - 차단
    const blogCheck = await engine.preflightCheck({
      workspaceId: sampleWorkspaceId,
      actionType: 'naver_blog.publish',
      isRevenueCritical: false,
    });
    expect(blogCheck.allowed).toBe(false);
    expect(blogCheck.isCreditDepleted).toBe(true);

    // 2. 긴급 예약 문의 응대(4 크레딧, isRevenueCritical: true) - weekly 한도 여유로 허용
    const inquiryCheck = await engine.preflightCheck({
      workspaceId: sampleWorkspaceId,
      actionType: 'instagram.reply_dm',
      isRevenueCritical: true,
    });
    expect(inquiryCheck.allowed).toBe(true);
  });
});
