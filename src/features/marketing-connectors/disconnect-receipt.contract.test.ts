import { describe, expect, it } from 'vitest';
import { CONNECTOR_CATALOG, type ConnectorId } from './catalog';
import { isKnownConnectorId, isValidDisconnectReceipt } from './disconnect-receipt';

describe('disconnect-receipt contract tests', () => {
  const ALL_CONNECTOR_IDS = CONNECTOR_CATALOG.map((c) => c.id);

  const createValidReceipt = (connectorId: ConnectorId, overrides: Record<string, unknown> = {}) => ({
    ok: true,
    connectorId,
    pendingDeletion: false,
    consentGeneration: 1,
    ...overrides,
  });

  describe('isKnownConnectorId boundary', () => {
    it('known catalog connectors (11개)는 모두 true를 반환한다', () => {
      expect(ALL_CONNECTOR_IDS).toHaveLength(11);
      for (const id of ALL_CONNECTOR_IDS) {
        expect(isKnownConnectorId(id)).toBe(true);
      }
    });

    it('알 수 없는 connectorId, 빈 문자열, 비문자열 값은 false를 반환한다', () => {
      expect(isKnownConnectorId('unknown_service')).toBe(false);
      expect(isKnownConnectorId('facebook_pages')).toBe(false);
      expect(isKnownConnectorId('')).toBe(false);
      expect(isKnownConnectorId(null)).toBe(false);
      expect(isKnownConnectorId(undefined)).toBe(false);
      expect(isKnownConnectorId(123)).toBe(false);
      expect(isKnownConnectorId({})).toBe(false);
      expect(isKnownConnectorId([])).toBe(false);
    });
  });

  describe('배열 입력 거부 (Array rejection)', () => {
    it('receipt가 빈 배열이면 거부한다 (false)', () => {
      expect(isValidDisconnectReceipt([], 'gmail')).toBe(false);
    });

    it('receipt가 유효한 영수증 객체를 담은 배열이어도 거부한다 (false)', () => {
      const arrayReceipt = [createValidReceipt('gmail')];
      expect(isValidDisconnectReceipt(arrayReceipt, 'gmail')).toBe(false);
    });

    it('receipt가 문자열 배열이나 기타 배열 형태여도 거부한다 (false)', () => {
      expect(isValidDisconnectReceipt(['ok', 'gmail'], 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt([true], 'gmail')).toBe(false);
    });
  });

  describe('NaN / Infinity 거부', () => {
    it('consentGeneration이 NaN이면 거부한다 (false)', () => {
      const receipt = createValidReceipt('gmail', { consentGeneration: NaN });
      expect(isValidDisconnectReceipt(receipt, 'gmail')).toBe(false);
    });

    it('consentGeneration이 Infinity 또는 -Infinity이면 거부한다 (false)', () => {
      const posInf = createValidReceipt('gmail', { consentGeneration: Infinity });
      const negInf = createValidReceipt('gmail', { consentGeneration: -Infinity });
      expect(isValidDisconnectReceipt(posInf, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(negInf, 'gmail')).toBe(false);
    });
  });

  describe('Unsafe Integer 및 부동소수점/음수 거부', () => {
    it('Number.MAX_SAFE_INTEGER를 초과하는 unsafe integer는 거부한다 (false)', () => {
      const unsafeReceipt1 = createValidReceipt('gmail', {
        consentGeneration: Number.MAX_SAFE_INTEGER + 1,
      });
      const unsafeReceipt2 = createValidReceipt('gmail', {
        consentGeneration: 2 ** 53,
      });
      const unsafeReceipt3 = createValidReceipt('gmail', {
        consentGeneration: Number.MAX_VALUE,
      });
      expect(isValidDisconnectReceipt(unsafeReceipt1, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(unsafeReceipt2, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(unsafeReceipt3, 'gmail')).toBe(false);
    });

    it('Number.MAX_SAFE_INTEGER 경계값은 정상 허용한다 (true)', () => {
      const boundaryReceipt = createValidReceipt('gmail', {
        consentGeneration: Number.MAX_SAFE_INTEGER,
      });
      expect(isValidDisconnectReceipt(boundaryReceipt, 'gmail')).toBe(true);
    });

    it('0, 음수 정수, 부동소수점(float)은 거부한다 (false)', () => {
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { consentGeneration: 0 }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { consentGeneration: -1 }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { consentGeneration: 1.0001 }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { consentGeneration: Math.PI }), 'gmail')).toBe(false);
    });
  });

  describe('Unknown Connector 거부', () => {
    it('receipt의 connectorId가 카탈로그에 없는 unknown connector이면 expectedId와 일치하더라도 거부한다 (false)', () => {
      const unknownReceipt = {
        ok: true,
        connectorId: 'unknown_connector',
        pendingDeletion: false,
        consentGeneration: 1,
      };
      expect(isValidDisconnectReceipt(unknownReceipt, 'unknown_connector' as never)).toBe(false);
    });

    it('expectedId가 unknown connector이면 receipt가 정상이더라도 거부한다 (false)', () => {
      const validReceipt = createValidReceipt('gmail');
      expect(isValidDisconnectReceipt(validReceipt, 'invalid_connector' as never)).toBe(false);
    });

    it('receipt의 connectorId와 expectedId가 서로 다르면 거부한다 (false)', () => {
      const receipt = createValidReceipt('gmail');
      // 런타임 invalid input 및 known mismatch 검증
      expect(isValidDisconnectReceipt(receipt, 'notion' as unknown as ConnectorId)).toBe(false);
      expect(isValidDisconnectReceipt(receipt, 'google_calendar')).toBe(false);
    });
  });

  describe('Non-object 및 필드 무결성 거부', () => {
    it('null, undefined, primitive 값은 거부한다 (false)', () => {
      expect(isValidDisconnectReceipt(null, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(undefined, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt('{"ok":true}', 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(12345, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(true, 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(Symbol('receipt'), 'gmail')).toBe(false);
    });

    it('ok가 boolean true가 아니거나(false, 문자열 "true", 1) pendingDeletion이 boolean이 아니면 거부한다 (false)', () => {
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { ok: false }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { ok: 'true' }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { ok: 1 }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { pendingDeletion: 'true' }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { pendingDeletion: null }), 'gmail')).toBe(false);
      expect(isValidDisconnectReceipt(createValidReceipt('gmail', { pendingDeletion: 1 }), 'gmail')).toBe(false);
    });
  });
});
