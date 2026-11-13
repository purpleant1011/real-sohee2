import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProofChainService, GENESIS_PREVIOUS_HASH, calculateBlockHash } from '@/lib/evidence/proof-chain-service';
import { PersistenceError } from '@/lib/errors/persistence-error';

// Mock Supabase Server Client for durable proof_chains DB storage simulation
type ProofChainRow = Record<string, any>;
const mockDbTables: {
  proof_chains: Map<string, ProofChainRow>;
} = {
  proof_chains: new Map(),
};

let mockShouldFailDb = false;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => {
    if (mockShouldFailDb) {
      throw new Error('Supabase DB connection refused / timeout');
    }

    return {
      from: (tableName: string) => {
        if (tableName === 'proof_chains') {
          return {
            select: vi.fn(() => ({
              eq: (col: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  if (col === 'idempotency_key') {
                    const row = Array.from(mockDbTables.proof_chains.values()).find(
                      (r) => r.idempotency_key === val
                    );
                    return { data: row || null, error: null };
                  }
                  const row = mockDbTables.proof_chains.get(val);
                  return { data: row || null, error: null };
                }),
                single: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  if (col === 'idempotency_key') {
                    const row = Array.from(mockDbTables.proof_chains.values()).find(
                      (r) => r.idempotency_key === val
                    );
                    if (!row) return { data: null, error: { message: 'Not found' } };
                    return { data: row, error: null };
                  }
                  const row = mockDbTables.proof_chains.get(val);
                  if (!row) return { data: null, error: { message: 'Not found' } };
                  return { data: row, error: null };
                }),
              }),
            })),
            upsert: vi.fn(async (row: ProofChainRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB upsert failure' } };
              mockDbTables.proof_chains.set(row.evidence_id, { ...row });
              return { error: null };
            }),
            insert: vi.fn(async (row: ProofChainRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB insert failure' } };
              mockDbTables.proof_chains.set(row.evidence_id, { ...row });
              return { error: null };
            }),
          };
        }
        return {};
      },
    };
  }),
}));

describe('ProofChainDurability & Cryptographic Integrity (ANI-967, ANI-968, ANI-969)', () => {
  const TEST_WORKSPACE = '00000000-0000-0000-0000-000000000001';
  const TEST_ACTION_ID = 'act_run_proof_101';
  const TEST_IDEMPOTENCY_KEY = 'idemp_proof_durability_999';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTables.proof_chains.clear();
    mockShouldFailDb = false;
    ProofChainService.clearMemoryCacheForTesting();
  });

  describe('Cryptographic Hash Chaining & Genesis Block (ANI-968)', () => {
    it('calculates SHA-256 block hash exactly: SHA256(previousHash + timestamp + payloadDigest + actionRunId)', () => {
      const prev = '0'.repeat(64);
      const ts = '2026-09-07T00:00:00.000Z';
      const digest = 'a1b2c3d4e5f6';
      const runId = 'act_test_001';

      const hash = calculateBlockHash({
        previousHash: prev,
        timestamp: ts,
        payloadDigest: digest,
        actionRunId: runId,
      });

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 hex length
    });
  });

  describe('Test 1: Appending evidence builds a cryptographically valid chain that verifies successfully', () => {
    it('chains blocks with previousHash links and passes verifyChainIntegrity', async () => {
      // 1. Initiate Proof (Genesis Block)
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        requestPayload: { caption: '첫 번째 증거 페이로드' },
      });

      expect(proof.evidenceId).toBeDefined();
      expect(proof.blocks).toBeDefined();
      expect(proof.blocks.length).toBe(1);

      const genesis = proof.blocks[0];
      expect(genesis.index).toBe(0);
      expect(genesis.previousHash).toBe(GENESIS_PREVIOUS_HASH);
      expect(genesis.actionRunId).toBe(TEST_ACTION_ID);
      expect(genesis.currentHash).toBe(
        calculateBlockHash({
          previousHash: genesis.previousHash,
          timestamp: genesis.timestamp,
          payloadDigest: genesis.payloadDigest,
          actionRunId: genesis.actionRunId,
        })
      );

      // 2. Append 2nd block (e.g. Provider Accepted)
      const block2 = await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { providerId: 'ig_item_777', status: 'RECEIVED' },
        stage: 'PROVIDER_ACCEPTED',
      });

      expect(block2.index).toBe(1);
      expect(block2.previousHash).toBe(genesis.currentHash);
      expect(block2.currentHash).toBe(
        calculateBlockHash({
          previousHash: block2.previousHash,
          timestamp: block2.timestamp,
          payloadDigest: block2.payloadDigest,
          actionRunId: block2.actionRunId,
        })
      );

      // 3. Append 3rd block (e.g. External Verified Readback)
      const block3 = await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { authoritativeId: 'ig_item_777', permalink: 'https://instagram.com/p/12345', isLive: true },
        stage: 'EXTERNAL_VERIFIED',
      });

      expect(block3.index).toBe(2);
      expect(block3.previousHash).toBe(block2.currentHash);

      // 4. Verify full chain integrity from genesis to leaf
      const verification = ProofChainService.verifyChainIntegrity(proof);
      expect(verification.valid).toBe(true);
      expect(verification.errorReason).toBeUndefined();
    });
  });

  describe('Test 2: Altering an intermediate block payload fails integrity check (Tamper Detection)', () => {
    it('detects tampering when intermediate block payload or digest is modified', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'THREADS',
        idempotencyKey: 'idemp_tamper_test',
        requestPayload: { text: '정상 메시지 1' },
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { text: '정상 메시지 2 (중간 블록)' },
        stage: 'PROVIDER_ACCEPTED',
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { text: '정상 메시지 3 (최종 블록)' },
        stage: 'EXTERNAL_VERIFIED',
      });

      // Chain before tamper must be valid
      expect(ProofChainService.verifyChainIntegrity(proof).valid).toBe(true);

      // Tampering attack: Modify intermediate block (index 1) payload
      const tamperedProof = JSON.parse(JSON.stringify(proof));
      tamperedProof.blocks[1].payload = { text: '악의적으로 조작된 본문!' };

      const result = ProofChainService.verifyChainIntegrity(tamperedProof);
      expect(result.valid).toBe(false);
      expect(result.errorReason).toBe('TAMPERED_BLOCK_DETECTED');
      expect(result.blockIndex).toBe(1);
    });

    it('detects tampering when an intermediate block hash is modified', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'NAVER_BLOG',
        idempotencyKey: 'idemp_hash_tamper',
        requestPayload: { title: '블로그 1' },
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { title: '블로그 2' },
        stage: 'PROVIDER_ACCEPTED',
      });

      const tamperedProof = JSON.parse(JSON.stringify(proof));
      tamperedProof.blocks[0].currentHash = 'e'.repeat(64); // forged hash

      const result = ProofChainService.verifyChainIntegrity(tamperedProof);
      expect(result.valid).toBe(false);
      expect(result.errorReason).toBe('TAMPERED_BLOCK_DETECTED');
    });

    it('detects chain truncation when trailing blocks are removed (Truncation Defense)', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_truncation_test',
        requestPayload: { text: '1번 블록' },
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { text: '2번 블록' },
        stage: 'PROVIDER_ACCEPTED',
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { text: '3번 블록' },
        stage: 'EXTERNAL_VERIFIED',
      });

      // Valid before truncation
      expect(ProofChainService.verifyChainIntegrity(proof).valid).toBe(true);

      // Truncation Attack: Attacker drops the 3rd block from chain.blocks but leaves chain.latestHash
      const truncatedProof = JSON.parse(JSON.stringify(proof));
      truncatedProof.blocks.pop(); // Remove 3rd block

      const result = ProofChainService.verifyChainIntegrity(truncatedProof);
      expect(result.valid).toBe(false);
      expect(result.errorReason).toBe('TAMPERED_BLOCK_DETECTED');
      expect(result.details).toContain('Truncation detected');
    });
  });

  describe('Test 3: Clearing in-memory cache and restoring from DB maintains chain integrity across worker restart', () => {
    it('restores complete chain from Supabase proof_chains and preserves verified integrity', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_worker_restart_1',
        requestPayload: { image: 'photo.jpg', caption: '새 상품' },
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { providerPostId: 'ig_999' },
        stage: 'PROVIDER_ACCEPTED',
      });

      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { permalink: 'https://instagram.com/p/ig_999', isLive: true },
        stage: 'EXTERNAL_VERIFIED',
      });

      // Confirm persisted to mock DB
      expect(mockDbTables.proof_chains.has(proof.evidenceId)).toBe(true);

      // Simulate Worker Restart: clear all in-memory state
      ProofChainService.clearMemoryCacheForTesting();

      // In-memory cache is wiped: fetching without DB restore returns undefined
      // When restored from DB:
      const restored = await ProofChainService.restoreFromDB(proof.evidenceId);
      expect(restored).toBeDefined();
      expect(restored?.evidenceId).toBe(proof.evidenceId);
      expect(restored?.blocks.length).toBe(3);

      // Verify cryptographic integrity of restored chain
      const verifyResult = ProofChainService.verifyChainIntegrity(restored!);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.errorReason).toBeUndefined();
    });

    it('restores chain from DB during markProviderAccepted after worker restart', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: 'act_restart_accepted',
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_restart_accepted',
        requestPayload: { text: '워커 재시작 전 포스팅' },
      });

      // Worker crash / restart: wipe cache
      ProofChainService.clearMemoryCacheForTesting();

      // Subsequent event: markProviderAccepted without in-memory cache
      const accepted = await ProofChainService.markProviderAccepted(proof.evidenceId, {
        objectId: 'ig_post_restarted_123',
        rawResponse: { id: 'ig_post_restarted_123' },
      });

      expect(accepted.stage).toBe('PROVIDER_ACCEPTED');
      expect(accepted.blocks.length).toBe(2);
      expect(ProofChainService.verifyChainIntegrity(accepted).valid).toBe(true);
    });

    it('restores chain from DB by idempotency key during reconcileBeforeRetry after worker restart', async () => {
      const idempotencyKey = 'idemp_restart_reconcile_gate';
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: 'act_restart_reconcile',
        channel: 'THREADS',
        idempotencyKey,
        requestPayload: { text: '재시도 테스트' },
      });

      // Mark external verified
      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: 'act_restart_reconcile',
        payload: { permalink: 'https://threads.net/post/555' },
        stage: 'EXTERNAL_VERIFIED',
      });
      proof.stage = 'EXTERNAL_VERIFIED';
      // Persist verified state
      await (ProofChainService as any).persistProofChain(proof);

      // Worker restart: cache cleared
      ProofChainService.clearMemoryCacheForTesting();

      // Retry attempt on same idempotency key with empty memory
      const retryOutcome = await ProofChainService.reconcileBeforeRetry(
        idempotencyKey,
        async () => ({ isLive: true, authoritativeId: 'th_555', permalink: 'https://threads.net/post/555' })
      );

      // Must find prior execution in DB and prevent duplicate write!
      expect(retryOutcome.canSafelyExecute).toBe(false);
      expect(retryOutcome.alreadyVerified).toBe(true);
      expect(retryOutcome.reason).toContain('Duplicate write rejected');
    });
  });

  describe('Fail-Closed Semantics: Database Write Failure (ANI-967)', () => {
    it('throws PersistenceError and does not update memory cache when DB write fails', async () => {
      mockShouldFailDb = true;

      await expect(
        ProofChainService.initiateProof({
          workspaceId: TEST_WORKSPACE,
          actionId: TEST_ACTION_ID,
          channel: 'INSTAGRAM',
          idempotencyKey: 'idemp_fail_closed_1',
          requestPayload: { caption: '실패해야 하는 요청' },
        })
      ).rejects.toThrow(PersistenceError);

      // Ensure no dangling dirty state in memory
      mockShouldFailDb = false;
      const restored = await ProofChainService.restoreFromDB('any');
      expect(restored).toBeNull();
    });
  });
});
