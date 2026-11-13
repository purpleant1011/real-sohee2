import { describe, it, expect } from 'vitest';
import {
  RECOVERY_CAPABILITY_TOOLS,
  evaluateRecoveryCapabilityReadiness,
  isAllowedRecoveryModelTool,
} from '../capabilities';

describe('Booking Recovery Capabilities & Safety Gates (Task 2)', () => {
  it('도구 목록은 6가지 안전 제안/조회 도구로 엄격히 제한된다', () => {
    expect(RECOVERY_CAPABILITY_TOOLS).toEqual([
      'recovery.list',
      'recovery.open',
      'recovery.prepare',
      'recovery.get',
      'recovery.request_send_approval',
      'recovery.request_booking_approval',
    ]);
  });

  it('모델에게 approve/send/book 실행 권한을 직접 노출하지 않는다', () => {
    expect(isAllowedRecoveryModelTool('recovery.approve_send')).toBe(false);
    expect(isAllowedRecoveryModelTool('recovery.send_dm')).toBe(false);
    expect(isAllowedRecoveryModelTool('recovery.confirm_booking')).toBe(false);
    expect(isAllowedRecoveryModelTool('recovery.approve_booking')).toBe(false);

    expect(isAllowedRecoveryModelTool('recovery.prepare')).toBe(true);
    expect(isAllowedRecoveryModelTool('recovery.request_send_approval')).toBe(true);
    expect(isAllowedRecoveryModelTool('recovery.request_booking_approval')).toBe(true);
  });

  it('킬스위치가 활성화되어 있으면 readiness는 false이다', () => {
    const result = evaluateRecoveryCapabilityReadiness('recovery.request_send_approval', {
      connected: true,
      hasScope: true,
      policyAllowed: true,
      killSwitchActive: true,
      sourceFreshness: 'FRESH',
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('KILL_SWITCH_ACTIVE');
  });

  it('채널 연결이나 스코프가 누락되면 readiness는 false이다', () => {
    const disconnected = evaluateRecoveryCapabilityReadiness('recovery.request_send_approval', {
      connected: false,
      hasScope: true,
      policyAllowed: true,
      killSwitchActive: false,
      sourceFreshness: 'FRESH',
    });
    expect(disconnected.ready).toBe(false);
    expect(disconnected.reason).toBe('NOT_CONNECTED');

    const noScope = evaluateRecoveryCapabilityReadiness('recovery.request_send_approval', {
      connected: true,
      hasScope: false,
      policyAllowed: true,
      killSwitchActive: false,
      sourceFreshness: 'FRESH',
    });
    expect(noScope.ready).toBe(false);
    expect(noScope.reason).toBe('SCOPE_MISSING');
  });

  it('source freshness가 UNKNOWN 또는 STALE이면 쓰기/요청 불가 (fail-closed)', () => {
    const unknownFreshness = evaluateRecoveryCapabilityReadiness('recovery.request_send_approval', {
      connected: true,
      hasScope: true,
      policyAllowed: true,
      killSwitchActive: false,
      sourceFreshness: 'UNKNOWN',
    });
    expect(unknownFreshness.ready).toBe(false);
    expect(unknownFreshness.reason).toBe('SOURCE_NOT_FRESH');

    const staleFreshness = evaluateRecoveryCapabilityReadiness('recovery.request_send_approval', {
      connected: true,
      hasScope: true,
      policyAllowed: true,
      killSwitchActive: false,
      sourceFreshness: 'STALE',
    });
    expect(staleFreshness.ready).toBe(false);
    expect(staleFreshness.reason).toBe('SOURCE_NOT_FRESH');
  });

  it('모든 조건이 충족되면 readiness는 true이다', () => {
    const ready = evaluateRecoveryCapabilityReadiness('recovery.request_send_approval', {
      connected: true,
      hasScope: true,
      policyAllowed: true,
      killSwitchActive: false,
      sourceFreshness: 'FRESH',
    });
    expect(ready.ready).toBe(true);
    expect(ready.reason).toBeUndefined();
  });

  it('읽기 도구(recovery.list, recovery.get)는 킬스위치나 연결 해제 시에도 대사를 위해 조회가 잠기지 않는다', () => {
    const readUnderKillSwitch = evaluateRecoveryCapabilityReadiness('recovery.list', {
      connected: false,
      hasScope: false,
      policyAllowed: false,
      killSwitchActive: true,
      sourceFreshness: 'STALE',
    });
    expect(readUnderKillSwitch.ready).toBe(true);
    expect(readUnderKillSwitch.isStaleObservation).toBe(true);

    const getUnderDisconnected = evaluateRecoveryCapabilityReadiness('recovery.get', {
      connected: false,
      hasScope: false,
      policyAllowed: false,
      killSwitchActive: false,
      sourceFreshness: 'UNKNOWN',
    });
    expect(getUnderDisconnected.ready).toBe(true);
    expect(getUnderDisconnected.isStaleObservation).toBe(true);
  });
});
