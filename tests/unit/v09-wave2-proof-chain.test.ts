import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProofChainService,
  PROOF_VERIFIER_VERSION,
} from '@/lib/evidence/proof-chain-service';
import { evaluateExternalEvidence } from '@/lib/channels/external-evidence-verifier';

describe('ANI-923: External Readback, RESULT_UNKNOWN, Reconcile & Proof Chain', () => {
  beforeEach(() => {
    ProofChainService._reset();
  });

  describe('1. Normal Write Full Lineage (Transport -> Accepted -> Verifying -> External Verified)', () => {
    it('should track entire 4-stage lifecycle with canonical digests', async () => {
      const idempotencyKey = 'idemp_test_normal_123';
      const requestPayload = {
        title: '신메뉴 출시 안내',
        caption: '이번 주말 한정 디저트를 만나보세요!',
        mediaUrls: ['https://cdn.sohee.app/images/menu1.jpg'],
      };

      // Step 1: Transport Initiation
      const proof = ProofChainService.initiateProof({
        workspaceId: 'ws_demo',
        actionId: 'act_publish_001',
        channel: 'INSTAGRAM',
        idempotencyKey,
        requestPayload,
      });

      expect(proof.evidenceId.startsWith('ev_proof_')).toBe(true);
      expect(proof.stage).toBe('TRANSPORT_SUCCESS');
      expect(proof.requestDigest.startsWith('sha256-')).toBe(true);
      expect(proof.verifierVersion).toBe(PROOF_VERIFIER_VERSION);
      expect(proof.timestamps.requestedAt).toBeDefined();

      // Step 2: Provider Accepted
      const accepted = ProofChainService.markProviderAccepted(proof.evidenceId, {
        objectId: 'ig_post_987654321',
        rawResponse: { id: 'ig_post_987654321', status: 'ok' },
      });

      expect(accepted.stage).toBe('PROVIDER_ACCEPTED');
      expect(accepted.providerObjectId).toBe('ig_post_987654321');
      expect(accepted.responseDigest?.startsWith('sha256-')).toBe(true);
      expect(accepted.timestamps.acceptedAt).toBeDefined();

      // Step 3 & 4: Independent GET Readback -> EXTERNAL_VERIFIED
      const outcome = await ProofChainService.verifyWithIndependentReadback(
        proof.evidenceId,
        async () => ({
          isLive: true,
          authoritativeId: 'ig_post_987654321',
          permalink: 'https://instagram.com/p/Cxyz12345/',
          contentSnapshot: '이번 주말 한정 디저트를 만나보세요!',
        })
      );

      expect(outcome.verified).toBe(true);
      expect(outcome.chain.stage).toBe('EXTERNAL_VERIFIED');
      expect(outcome.chain.providerUrl).toBe('https://instagram.com/p/Cxyz12345/');
      expect(outcome.chain.readbackDigest?.startsWith('sha256-')).toBe(true);
      expect(outcome.chain.timestamps.verifiedAt).toBeDefined();
    });
  });

  describe('2. Timeout Injection, RESULT_UNKNOWN & Pre-Retry Reconcile Gate', () => {
    it('should transition to RESULT_UNKNOWN on timeout and recover via reconcile before retry', async () => {
      const idempotencyKey = 'idemp_timeout_case_456';
      const proof = ProofChainService.initiateProof({
        workspaceId: 'ws_demo',
        actionId: 'act_publish_timeout',
        channel: 'THREADS',
        idempotencyKey,
        requestPayload: { text: '스레드 긴급 포스팅' },
      });

      // Provider accepts but network times out during verification
      ProofChainService.markProviderAccepted(proof.evidenceId, { objectId: 'th_item_111' });

      // Invariant: Timeout transitions to RESULT_UNKNOWN (blind failure/retry forbidden)
      const unknownChain = ProofChainService.markResultUnknownOnTimeout(
        proof.evidenceId,
        'Gateway 30000ms timeout waiting for provider ack'
      );

      expect(unknownChain.stage).toBe('RESULT_UNKNOWN');
      expect(unknownChain.reconcileStatus).toBe('QUEUED');
      expect(unknownChain.mismatchDetail).toContain('Blind retry prohibited');

      // Admin Evidence Center must have registered the pending item
      const adminCenter = ProofChainService.getAdminEvidenceCenter();
      const openMismatches = adminCenter.listItems('OPEN');
      expect(openMismatches.some((m) => m.actionRunId === 'act_publish_timeout')).toBe(true);

      // Client attempts RETRY on the same idempotency key:
      // Invariant: reconcileBeforeRetry MUST be invoked before duplicate write
      const retryCheck = await ProofChainService.reconcileBeforeRetry(
        idempotencyKey,
        async () => ({
          isLive: true,
          authoritativeId: 'th_item_111',
          permalink: 'https://threads.net/@store/post/111',
          contentSnapshot: '스레드 긴급 포스팅',
        })
      );

      // Successfully discovered existing provider object -> write blocked, recovered to EXTERNAL_VERIFIED!
      expect(retryCheck.canSafelyExecute).toBe(false);
      expect(retryCheck.alreadyVerified).toBe(true);
      expect(retryCheck.evidence?.stage).toBe('EXTERNAL_VERIFIED');
      expect(retryCheck.evidence?.reconcileStatus).toBe('RECONCILED');
      expect(retryCheck.reason).toContain('Duplicate write prevented');
    });
  });

  describe('3. Provider Mismatch Lineage (Fingerprint Mismatch -> VERIFY_FAILED)', () => {
    it('should fail verification and register mismatch in Admin Evidence Center if content diverges', async () => {
      const proof = ProofChainService.initiateProof({
        workspaceId: 'ws_demo',
        actionId: 'act_publish_mismatch',
        channel: 'NAVER_BLOG',
        idempotencyKey: 'idemp_mismatch_789',
        requestPayload: { content: '기대된 본문' },
      });

      ProofChainService.markProviderAccepted(proof.evidenceId, { objectId: 'naver_blog_post_999' });

      const expectedDigest = ProofChainService.computePayloadDigest('정상 원본 본문');

      // Independent readback returns modified/divergent content
      const outcome = await ProofChainService.verifyWithIndependentReadback(
        proof.evidenceId,
        async () => ({
          isLive: true,
          authoritativeId: 'naver_blog_post_999',
          permalink: 'https://blog.naver.com/store/999',
          contentSnapshot: '다른 제3자의 엉뚱한 본문',
        }),
        expectedDigest
      );

      expect(outcome.verified).toBe(false);
      expect(outcome.chain.stage).toBe('VERIFY_FAILED');
      expect(outcome.chain.mismatchDetail).toContain('Content snapshot mismatch');

      // Verified in Admin Evidence Center
      const adminCenter = ProofChainService.getAdminEvidenceCenter();
      const openMismatches = adminCenter.listItems('OPEN');
      const mismatchItem = openMismatches.find((m) => m.actionRunId === 'act_publish_mismatch');
      expect(mismatchItem).toBeDefined();
      expect(mismatchItem?.mismatchKind).toBe('READBACK_PAYLOAD_MISMATCH');
      expect(mismatchItem?.expectedHash).toBe(expectedDigest);
    });
  });

  describe('4. False-Green & Synthetic Mock Rejection (Fail-Closed)', () => {
    it('should reject placeholder/mock permalinks during independent readback', async () => {
      const proof = ProofChainService.initiateProof({
        workspaceId: 'ws_demo',
        actionId: 'act_placeholder_test',
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_mock_test',
        requestPayload: { text: 'test' },
      });

      const outcome = await ProofChainService.verifyWithIndependentReadback(
        proof.evidenceId,
        async () => ({
          isLive: true,
          authoritativeId: 'mock_123',
          permalink: 'https://example.com/fake-post/123',
        })
      );

      expect(outcome.verified).toBe(false);
      expect(outcome.chain.stage).toBe('VERIFY_FAILED');
      expect(outcome.chain.mismatchDetail).toContain('Placeholder or mock permalinks are strictly prohibited');
    });

    it('evaluateExternalEvidence should fail-close on synthetic input', () => {
      const receipt = evaluateExternalEvidence({
        requestId: 'req_123',
        channelId: 'INSTAGRAM',
        externalContentId: 'dummy_id',
        externalUrl: 'https://example.com/placeholder-image',
      });

      expect(receipt.status).toBe('FAILED');
      expect(receipt.verificationMethod).toBe('SYNTHETIC_MOCK_DISALLOWED');
    });

    it('evaluateExternalEvidence should remain ACCEPTED_BY_PROVIDER when host is invalid', () => {
      const receipt = evaluateExternalEvidence({
        requestId: 'req_456',
        channelId: 'INSTAGRAM',
        externalContentId: 'valid_object_id_12345',
        externalUrl: 'https://unauthorized-attacker.com/post/1',
      });

      expect(receipt.status).toBe('ACCEPTED_BY_PROVIDER');
    });
  });

  describe('5. Same Truth: Consistent evidence across Service Dock and Admin', () => {
    it('should allow fetching the exact same evidence chain by evidenceId', () => {
      const proof = ProofChainService.initiateProof({
        workspaceId: 'ws_canonical_truth',
        actionId: 'act_canonical_001',
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_canonical_key',
        requestPayload: { data: 'test canonical' },
      });

      const fetched = ProofChainService.getEvidence(proof.evidenceId);
      expect(fetched).toBeDefined();
      expect(fetched?.evidenceId).toBe(proof.evidenceId);
      expect(fetched?.requestDigest).toBe(proof.requestDigest);

      const workspaceList = ProofChainService.listEvidenceByWorkspace('ws_canonical_truth');
      expect(workspaceList.length).toBe(1);
      expect(workspaceList[0].evidenceId).toBe(proof.evidenceId);
    });
  });
});
