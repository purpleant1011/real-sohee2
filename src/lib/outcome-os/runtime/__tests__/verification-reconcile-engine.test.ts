import { describe, it, expect } from 'vitest';
import {
  VerificationReconcileEngine,
  type ReconcileCandidate,
  type ProviderRecentObject,
} from '../verification-reconcile-engine';

describe('ANI-758 Verification Reconcile Engine', () => {
  const engine = new VerificationReconcileEngine();

  describe('Canonical State Transition Machine', () => {
    it('transitions along happy path: PLANNED -> SUBMITTED -> ACCEPTED -> VERIFYING -> VERIFIED', () => {
      let state = engine.transitionVerificationState('PLANNED', 'SUBMIT');
      expect(state).toBe('SUBMITTED');

      state = engine.transitionVerificationState(state, 'ACCEPT');
      expect(state).toBe('ACCEPTED');

      state = engine.transitionVerificationState(state, 'START_VERIFY');
      expect(state).toBe('VERIFYING');

      state = engine.transitionVerificationState(state, 'CONFIRM_LIVE');
      expect(state).toBe('VERIFIED');
    });

    it('transitions to RESULT_UNKNOWN on timeout after ACCEPTED (no blind failure)', () => {
      const state = engine.transitionVerificationState('ACCEPTED', 'TIMEOUT');
      expect(state).toBe('RESULT_UNKNOWN');
    });

    it('transitions to RESULT_UNKNOWN on timeout during VERIFYING', () => {
      const state = engine.transitionVerificationState('VERIFYING', 'TIMEOUT');
      expect(state).toBe('RESULT_UNKNOWN');
    });

    it('transitions to VERIFY_FAILED on readback mismatch', () => {
      const state = engine.transitionVerificationState('VERIFYING', 'READBACK_MISMATCH');
      expect(state).toBe('VERIFY_FAILED');
    });

    it('throws on illegal transitions', () => {
      expect(() => engine.transitionVerificationState('PLANNED', 'CONFIRM_LIVE')).toThrow(
        'Invalid canonical verification transition'
      );
      expect(() => engine.transitionVerificationState('VERIFIED', 'TIMEOUT')).toThrow(
        'Invalid canonical verification transition'
      );
    });
  });

  describe('RESULT_UNKNOWN Reconciliation Logic', () => {
    const candidate: ReconcileCandidate = {
      actionId: 'act_001',
      workspaceId: 'ws_test',
      runId: 'run_001',
      attemptId: 'att_001',
      provider: 'instagram',
      providerAccountId: 'act_insta_123',
      state: 'RESULT_UNKNOWN',
      submittedAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
      expectedFingerprint: 'hash_hello_world_123',
      timeoutOccurred: true,
    };

    const dummyHasher = async (text: string) => {
      if (text.includes('Hello World')) return 'hash_hello_world_123';
      return 'hash_other_content';
    };

    it('reconciles RESULT_UNKNOWN to VERIFIED when matching provider object is found', async () => {
      const providerObjects: ProviderRecentObject[] = [
        {
          objectId: 'post_ig_9999',
          permalink: 'https://instagram.com/p/ABC999',
          contentSnippet: 'Hello World - today is a great day!',
          publishedAt: new Date().toISOString(),
        },
      ];

      const res = await engine.reconcileUnknownAction({
        candidate,
        providerRecentObjects: providerObjects,
        computeFingerprint: dummyHasher,
        persistReceipt: async () => true,
      });

      expect(res.resolvedState).toBe('VERIFIED');
      expect(res.receipt).toBeDefined();
      expect(res.receipt?.providerObjectId).toBe('post_ig_9999');
      expect(res.receipt?.externalUrl).toBe('https://instagram.com/p/ABC999');
      expect(res.receipt?.status).toBe('VERIFIED_CANONICAL');
    });

    it('keeps RESULT_UNKNOWN if matching object found but receipt persist fails (Fail-Closed)', async () => {
      const providerObjects: ProviderRecentObject[] = [
        {
          objectId: 'post_ig_9999',
          permalink: 'https://instagram.com/p/ABC999',
          contentSnippet: 'Hello World - today is a great day!',
          publishedAt: new Date().toISOString(),
        },
      ];

      const res = await engine.reconcileUnknownAction({
        candidate,
        providerRecentObjects: providerObjects,
        computeFingerprint: dummyHasher,
        persistReceipt: async () => false, // DB error
      });

      expect(res.resolvedState).toBe('RESULT_UNKNOWN');
      expect(res.reason).toContain('persistence failed');
    });

    it('transitions to VERIFY_FAILED after 2 hours without provider evidence', async () => {
      const staleCandidate: ReconcileCandidate = {
        ...candidate,
        submittedAt: new Date(Date.now() - 8000000).toISOString(), // > 2 hours ago
      };

      const res = await engine.reconcileUnknownAction({
        candidate: staleCandidate,
        providerRecentObjects: [],
        computeFingerprint: dummyHasher,
        persistReceipt: async () => true,
      });

      expect(res.resolvedState).toBe('VERIFY_FAILED');
      expect(res.reason).toContain('2-hour reconciliation window');
    });
  });
});
