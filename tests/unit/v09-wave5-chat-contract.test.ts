/**
 * Sohee V0.9 5th Update · Wave 5 Chat Contract Unit Tests
 * Marketing Employee Scenario-Tool-Evidence Matrix Verification
 * 
 * Traceability: ANI-937
 */

import { describe, it, expect } from 'vitest';
import { ChatContractRegistry } from '@/features/chat-contract/chat-contract-registry';

describe('V0.9 Wave 5 · ChatContractRegistry (ANI-937)', () => {
  const registry = new ChatContractRegistry();

  it('registers all 7 core marketing employee scenario contracts', () => {
    const contracts = registry.listAllContracts();
    expect(contracts.length).toBe(7);

    const types = contracts.map(c => c.scenarioType);
    expect(types).toContain('CONTENT_PUBLISH');
    expect(types).toContain('AD_BUDGET_OPTIMIZE');
    expect(types).toContain('CUSTOMER_BOOKING');
    expect(types).toContain('ATTRIBUTION_REVENUE');
    expect(types).toContain('KNOWLEDGE_GOAL_MUTATION');
    expect(types).toContain('CONNECTION_TRUST_AUDIT');
    expect(types).toContain('AUTONOMY_REPLAN');
  });

  it('accurately routes natural language user commands to the correct scenario contract', () => {
    expect(registry.matchScenarioFromText('인스타 봄맞이 피드 발행해줘')?.scenarioType).toBe('CONTENT_PUBLISH');
    expect(registry.matchScenarioFromText('효율 안 나오는 광고 꺼줘')?.scenarioType).toBe('AD_BUDGET_OPTIMIZE');
    expect(registry.matchScenarioFromText('내일 오후 3시 예약 잡아줘')?.scenarioType).toBe('CUSTOMER_BOOKING');
    expect(registry.matchScenarioFromText('돈 된 마케팅 성과 보여줘')?.scenarioType).toBe('ATTRIBUTION_REVENUE');
    expect(registry.matchScenarioFromText('우리 병원 원칙과 목표 수정해줘')?.scenarioType).toBe('KNOWLEDGE_GOAL_MUTATION');
    expect(registry.matchScenarioFromText('인스타 연동 권한 끊어줘')?.scenarioType).toBe('CONNECTION_TRUST_AUDIT');
    expect(registry.matchScenarioFromText('공실 생기면 알아서 재계획 세워줘')?.scenarioType).toBe('AUTONOMY_REPLAN');
  });

  it('fails closed with UNSUPPORTED when domain tool is not supported (No Synthetic Success)', () => {
    const trace = registry.evaluatePreconditionsAndExecute({
      scenarioType: 'CONTENT_PUBLISH',
      conversationId: 'conv_test_01',
      actionRunId: 'act_test_01',
      context: {
        creditBalanceKrw: 100000,
        isChannelConnected: true,
        isTokenExpired: false,
        isToolSupported: false, // 도구 미지원
      },
    });

    expect(trace.status).toBe('UNSUPPORTED');
    expect(trace.failureReason).toBe('UNSUPPORTED_CAPABILITY');
    expect(trace.evidenceId).toBeUndefined();
  });

  it('fails closed with BLOCKED when credit balance is zero for mutation action', () => {
    const trace = registry.evaluatePreconditionsAndExecute({
      scenarioType: 'CONTENT_PUBLISH',
      conversationId: 'conv_test_02',
      actionRunId: 'act_test_02',
      context: {
        creditBalanceKrw: 0, // 크레딧 소진
        isChannelConnected: true,
        isTokenExpired: false,
        isToolSupported: true,
      },
    });

    expect(trace.status).toBe('BLOCKED');
    expect(trace.failureReason).toBe('ZERO_CREDIT');
  });

  it('fails closed with BLOCKED when channel is disconnected', () => {
    const trace = registry.evaluatePreconditionsAndExecute({
      scenarioType: 'AD_BUDGET_OPTIMIZE',
      conversationId: 'conv_test_03',
      actionRunId: 'act_test_03',
      context: {
        creditBalanceKrw: 50000,
        isChannelConnected: false, // 미연결
        isTokenExpired: false,
        isToolSupported: true,
      },
    });

    expect(trace.status).toBe('BLOCKED');
    expect(trace.failureReason).toBe('PROVIDER_DISCONNECTED');
  });

  it('fails closed with BLOCKED when auth token is expired', () => {
    const trace = registry.evaluatePreconditionsAndExecute({
      scenarioType: 'CONTENT_PUBLISH',
      conversationId: 'conv_test_04',
      actionRunId: 'act_test_04',
      context: {
        creditBalanceKrw: 50000,
        isChannelConnected: true,
        isTokenExpired: true, // 토큰 만료
        isToolSupported: true,
      },
    });

    expect(trace.status).toBe('BLOCKED');
    expect(trace.failureReason).toBe('EXPIRED_AUTH_TOKEN');
  });

  it('routes to RESULT_UNKNOWN queue upon timeout to avoid duplicate writes or false green', () => {
    const trace = registry.evaluatePreconditionsAndExecute({
      scenarioType: 'CONTENT_PUBLISH',
      conversationId: 'conv_test_05',
      actionRunId: 'act_test_05',
      context: {
        creditBalanceKrw: 50000,
        isChannelConnected: true,
        isTokenExpired: false,
        isToolSupported: true,
        isTimedOut: true, // 외부 타임아웃
      },
    });

    expect(trace.status).toBe('RESULT_UNKNOWN');
    expect(trace.failureReason).toBe('TIMEOUT_RESULT_UNKNOWN');
    expect(trace.evidenceId).toBeUndefined();
  });

  it('issues cryptographic evidence digest only when provider execution and readback succeed', () => {
    const trace = registry.evaluatePreconditionsAndExecute({
      scenarioType: 'CONTENT_PUBLISH',
      conversationId: 'conv_test_06',
      actionRunId: 'act_test_06',
      context: {
        creditBalanceKrw: 50000,
        isChannelConnected: true,
        isTokenExpired: false,
        isToolSupported: true,
        isTimedOut: false,
      },
    });

    expect(trace.status).toBe('VERIFIED');
    expect(trace.evidenceId).toBe('ev_proof_act_test_06');
    expect(trace.evidenceDigest).toContain('sha256_act_test_06_ev_proof_act_test_06_verified');
  });
});
