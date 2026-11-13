import { describe, expect, it } from 'vitest';
import {
  AppleRemindersUnsupportedError,
  getAppleRemindersSupportStatus,
  validateRemindersConnectAttempt,
} from './apple-reminders-gate';

describe('apple-reminders-gate (MC/A04 - ANI-2173)', () => {
  describe('getAppleRemindersSupportStatus', () => {
    it('readiness는 unsupported이고 reason은 OFFICIAL_WEB_API_UNAVAILABLE을 반환해야 한다', () => {
      const status = getAppleRemindersSupportStatus();

      expect(status.connectorId).toBe('apple_reminders');
      expect(status.providerId).toBe('apple');
      expect(status.readiness).toBe('unsupported');
      expect(status.reason).toBe('OFFICIAL_WEB_API_UNAVAILABLE');
      expect(status.canConnect).toBe(false);
      expect(typeof status.message).toBe('string');
      expect(status.message.length).toBeGreaterThan(0);
    });

    it('비공식 스크래핑 금지 및 대안 상태가 명시되어야 한다', () => {
      const status = getAppleRemindersSupportStatus();

      expect(status.alternatives).toBeDefined();
      expect(status.alternatives.icloudScraping).toBe('PROHIBITED');
      expect(status.alternatives.appleShortcutsExport).toBe('UNDER_EVALUATION');
      expect(status.alternatives.nativeCompanionApp).toBe('FUTURE_CONSIDERATION');
      expect(Object.isFrozen(status)).toBe(true);
    });
  });

  describe('validateRemindersConnectAttempt', () => {
    it('인자 없이 호출 시 AppleRemindersUnsupportedError(REMINDERS_NOT_SUPPORTED)를 throw해야 한다', () => {
      expect(() => validateRemindersConnectAttempt()).toThrow(
        AppleRemindersUnsupportedError
      );

      try {
        validateRemindersConnectAttempt();
      } catch (error) {
        expect(error).toBeInstanceOf(AppleRemindersUnsupportedError);
        const err = error as AppleRemindersUnsupportedError;
        expect(err.name).toBe('AppleRemindersUnsupportedError');
        expect(err.code).toBe('REMINDERS_NOT_SUPPORTED');
        expect(err.message).toContain('Apple');
      }
    });

    it('임의의 payload나 설정 객체를 전달해도 fail-closed로 예외를 던져야 한다', () => {
      expect(() =>
        validateRemindersConnectAttempt({
          workspaceId: 'ws_test_123',
          connectorId: 'apple_reminders',
        })
      ).toThrow(AppleRemindersUnsupportedError);
    });

    it('Apple ID나 비밀번호/쿠키 등 비공식 수집 시도가 포함된 경우에도 원천 거부되어야 한다', () => {
      expect(() =>
        validateRemindersConnectAttempt({
          appleId: 'user@icloud.com',
          password: 'super-secret-password',
        })
      ).toThrow(AppleRemindersUnsupportedError);

      try {
        validateRemindersConnectAttempt({
          appleId: 'user@icloud.com',
          password: 'super-secret-password',
        });
      } catch (error) {
        const err = error as AppleRemindersUnsupportedError;
        expect(err.code).toBe('REMINDERS_NOT_SUPPORTED');
      }
    });
  });
});
