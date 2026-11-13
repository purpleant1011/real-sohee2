import { describe, expect, it } from 'vitest';
import {
  isConnectorUsageAllowed,
  POLICY_DISCLOSURE,
  type ConnectorUsagePolicyInput,
} from './usage-policy';

describe('isConnectorUsageAllowed', () => {
  it('allows ordinary marketing and booking purposes for non-Google sources', () => {
    const marketingInput: ConnectorUsagePolicyInput = {
      derivedFromGoogle: false,
      purpose: 'marketing',
    };
    expect(isConnectorUsageAllowed(marketingInput)).toBe(true);

    const bookingInput: ConnectorUsagePolicyInput = {
      derivedFromGoogle: false,
      purpose: 'booking',
    };
    expect(isConnectorUsageAllowed(bookingInput)).toBe(true);
  });

  it('allows advertising purpose for non-Google sources', () => {
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: false,
        purpose: 'advertising',
      })
    ).toBe(true);
  });

  it('allows ordinary marketing and booking for Google sources only under local business-assistance policy (not provider launch permission)', () => {
    // Both marketing and booking are permitted under local business-assistance policy
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: true,
        purpose: 'marketing',
      })
    ).toBe(true);

    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: true,
        purpose: 'booking',
      })
    ).toBe(true);

    // Verify disclosure explicitly states this is local business-assistance only, not provider launch permission
    expect(POLICY_DISCLOSURE.googleAssistanceOnly).toBe(true);
    expect(POLICY_DISCLOSURE.notice).toContain('로컬 업무보조');
    expect(POLICY_DISCLOSURE.notice).toContain('출시허가');
  });

  it('strictly denies model_training regardless of provider (both non-Google and Google)', () => {
    // Universal policy: 범용 모델 가중치 학습은 공급자 무관 금지
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: false,
        purpose: 'model_training',
      })
    ).toBe(false);

    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: true,
        purpose: 'model_training',
      })
    ).toBe(false);

    // Verify disclosure does not list model_training in allowedPurposes
    expect(POLICY_DISCLOSURE.allowedPurposes).not.toContain('model_training');
  });

  it('strictly denies advertising and model_training when derivedFromGoogle is true', () => {
    // Google-derived advertising must be rejected
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: true,
        purpose: 'advertising',
      })
    ).toBe(false);

    // Google-derived model_training must be rejected
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: true,
        purpose: 'model_training',
      })
    ).toBe(false);
  });

  it('fails closed on unknown or invalid runtime purpose values', () => {
    const invalidPurposes = [
      'personal_assistant',
      'general_intelligence',
      'surveillance',
      'unknown',
      '',
      'MARKETING',
      'Booking',
    ];

    for (const invalidPurpose of invalidPurposes) {
      expect(
        isConnectorUsageAllowed({
          derivedFromGoogle: false,
          purpose: invalidPurpose,
        })
      ).toBe(false);

      expect(
        isConnectorUsageAllowed({
          derivedFromGoogle: true,
          purpose: invalidPurpose,
        })
      ).toBe(false);
    }
  });

  it('fails closed on invalid input shapes, types, nulls, and missing fields', () => {
    expect(isConnectorUsageAllowed(null)).toBe(false);
    expect(isConnectorUsageAllowed(undefined)).toBe(false);
    expect(isConnectorUsageAllowed(123)).toBe(false);
    expect(isConnectorUsageAllowed('marketing')).toBe(false);
    expect(isConnectorUsageAllowed([])).toBe(false);
    expect(isConnectorUsageAllowed({})).toBe(false);

    // Missing derivedFromGoogle
    expect(isConnectorUsageAllowed({ purpose: 'marketing' })).toBe(false);

    // Non-boolean derivedFromGoogle
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: 'true',
        purpose: 'marketing',
      })
    ).toBe(false);

    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: 1,
        purpose: 'marketing',
      })
    ).toBe(false);

    // Missing purpose
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: false,
      })
    ).toBe(false);

    // Non-string purpose
    expect(
      isConnectorUsageAllowed({
        derivedFromGoogle: false,
        purpose: 100,
      })
    ).toBe(false);
  });
});
