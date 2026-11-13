import { describe, expect, it } from 'vitest';
import {
  validateGmailScopeRequest,
  GmailPolicyViolationError,
  GMAIL_READONLY_SCOPE,
} from './gmail-policy-gate';

describe('validateGmailScopeRequest (Restricted Scope Gate)', () => {
  describe('Valid readonly requests', () => {
    it('allows https://www.googleapis.com/auth/gmail.readonly', () => {
      const result = validateGmailScopeRequest([
        'https://www.googleapis.com/auth/gmail.readonly',
      ]);
      expect(result).toEqual([GMAIL_READONLY_SCOPE]);
    });

    it('trims whitespace and deduplicates the scope', () => {
      const result = validateGmailScopeRequest([
        '  https://www.googleapis.com/auth/gmail.readonly  ',
        'https://www.googleapis.com/auth/gmail.readonly',
      ]);
      expect(result).toEqual([GMAIL_READONLY_SCOPE]);
    });
  });

  describe('Missing or empty scope lists (MISSING_SCOPE)', () => {
    it('throws MISSING_SCOPE for empty array', () => {
      expect(() => validateGmailScopeRequest([])).toThrow(
        GmailPolicyViolationError
      );
      try {
        validateGmailScopeRequest([]);
      } catch (err: any) {
        expect(err.code).toBe('MISSING_SCOPE');
      }
    });

    it('throws MISSING_SCOPE for array with only empty/whitespace strings', () => {
      expect(() => validateGmailScopeRequest(['', '   ', '\t'])).toThrow(
        GmailPolicyViolationError
      );
      try {
        validateGmailScopeRequest(['', '   ']);
      } catch (err: any) {
        expect(err.code).toBe('MISSING_SCOPE');
      }
    });

    it('throws MISSING_SCOPE for null or non-array input', () => {
      expect(() => validateGmailScopeRequest(null as any)).toThrow(
        GmailPolicyViolationError
      );
      expect(() => validateGmailScopeRequest(undefined as any)).toThrow(
        GmailPolicyViolationError
      );
      try {
        validateGmailScopeRequest(undefined as any);
      } catch (err: any) {
        expect(err.code).toBe('MISSING_SCOPE');
      }
    });
  });

  describe('Prohibited scopes (PROHIBITED_SCOPE)', () => {
    const prohibitedScopes = [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/gmail.insert',
      'https://www.googleapis.com/auth/gmail.settings.basic',
      'https://www.googleapis.com/auth/gmail.settings.sharing',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ];

    prohibitedScopes.forEach((prohibitedScope) => {
      it(`rejects prohibited scope: ${prohibitedScope}`, () => {
        expect(() => validateGmailScopeRequest([prohibitedScope])).toThrow(
          GmailPolicyViolationError
        );
        try {
          validateGmailScopeRequest([prohibitedScope]);
        } catch (err: any) {
          expect(err.code).toBe('PROHIBITED_SCOPE');
          expect(err.scope).toBe(prohibitedScope);
        }
      });
    });

    it('rejects combination of valid readonly scope and prohibited scope', () => {
      const mixed = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
      ];
      expect(() => validateGmailScopeRequest(mixed)).toThrow(
        GmailPolicyViolationError
      );
      try {
        validateGmailScopeRequest(mixed);
      } catch (err: any) {
        expect(err.code).toBe('PROHIBITED_SCOPE');
        expect(err.scope).toBe('https://www.googleapis.com/auth/gmail.send');
      }
    });

    it('rejects partial scope tampering or wildcard scopes', () => {
      const invalid = ['https://www.googleapis.com/auth/gmail.*', 'gmail.readonly'];
      invalid.forEach((scope) => {
        expect(() => validateGmailScopeRequest([scope])).toThrow(
          GmailPolicyViolationError
        );
        try {
          validateGmailScopeRequest([scope]);
        } catch (err: any) {
          expect(err.code).toBe('PROHIBITED_SCOPE');
        }
      });
    });
  });
});
