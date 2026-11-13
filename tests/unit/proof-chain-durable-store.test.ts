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
                order: vi.fn(() => ({
                  data: Array.from(mockDbTables.proof_chains.values()).filter((r) => r.workspace_id === val),
                  error: null,
                })),
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

describe('ProofChainDurableStore & Fail-Closed Semantics (ANI-966)', () => {
  const TEST_WORKSPACE = '00000000-0000-0000-0000-000000000001';
  const TEST_ACTION_ID = 'act_run_durable_101';
  const TEST_IDEMPOTENCY_KEY = 'idemp_proof_durable_store_1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTables.proof_chains.clear();
    mockShouldFailDb = false;
    ProofChainService.clearMemoryCacheForTesting();
  });

  describe('1. DB SSOT Integration & Worker Restart Recovery (ANI-966)', () => {
    it('restores complete chain from DB SSOT after in-memory process reset', async () => {
      // 1. Initiate proof chain
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        requestPayload: { caption: '지속성 스토어 검증 포스트' },
      });

      expect(proof.evidenceId).toBeDefined();
      expect(mockDbTables.proof_chains.has(proof.evidenceId)).toBe(true);

      // Append provider accepted block
      await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { providerId: 'ig_post_888', status: 'RECEIVED' },
        stage: 'PROVIDER_ACCEPTED',
      });

      // 2. Simulate Worker Restart / Process Memory Wipe
      ProofChainService.clearMemoryCacheForTesting();

      // Memory cache is empty
      expect(ProofChainService.getEvidence(proof.evidenceId)).toBeUndefined();

      // 3. Restore from DB SSOT
      const restored = await ProofChainService.restoreFromDB(proof.evidenceId);
      expect(restored).toBeDefined();
      expect(restored?.evidenceId).toBe(proof.evidenceId);
      expect(restored?.workspaceId).toBe(TEST_WORKSPACE);
      expect(restored?.idempotencyKey).toBe(TEST_IDEMPOTENCY_KEY);
      expect(restored?.blocks.length).toBe(2);

      // Verify chain integrity directly against restored DB truth
      const integrity = await ProofChainService.verifyChain(proof.evidenceId);
      expect(integrity.valid).toBe(true);
    });

    it('idempotent initiateProof returns existing evidenceId from DB SSOT after memory wipe', async () => {
      // 1. Initial creation
      const firstProof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_recovery_across_reset',
        requestPayload: { text: '최초 요청' },
      });

      const originalEvidenceId = firstProof.evidenceId;
      expect(originalEvidenceId).toBeDefined();

      // 2. Memory wiped (Worker crashes and restarts)
      ProofChainService.clearMemoryCacheForTesting();

      // 3. Duplicate initiateProof on same idempotency key
      const secondProof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: 'act_run_different_id_999',
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_recovery_across_reset',
        requestPayload: { text: '재전송된 요청' },
      });

      // Must recover exact same evidenceId from DB without creating a duplicate record
      expect(secondProof.evidenceId).toBe(originalEvidenceId);
      expect(mockDbTables.proof_chains.size).toBe(1);
    });

    it('appends blocks to restored chain after memory reset and preserves hash continuity', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'THREADS',
        idempotencyKey: 'idemp_append_after_restart',
        requestPayload: { text: '스레드 본문 1' },
      });

      // Worker restart: wipe memory
      ProofChainService.clearMemoryCacheForTesting();

      // Append new block using string evidenceId (restores from DB)
      const newBlock = await ProofChainService.appendBlock(proof.evidenceId, {
        actionRunId: TEST_ACTION_ID,
        payload: { text: '스레드 본문 2 (재시작 후 추가)' },
        stage: 'PROVIDER_ACCEPTED',
      });

      expect(newBlock.index).toBe(1);
      expect(newBlock.previousHash).toBe(proof.latestHash);

      // Verify chain integrity against DB SSOT
      const verifyResult = await ProofChainService.verifyChain(proof.evidenceId);
      expect(verifyResult.valid).toBe(true);
    });
  });

  describe('2. Fail-Closed Semantics on DB Failure (ANI-966)', () => {
    it('throws PersistenceError on initiateProof when DB is unreachable', async () => {
      mockShouldFailDb = true;

      await expect(
        ProofChainService.initiateProof({
          workspaceId: TEST_WORKSPACE,
          actionId: TEST_ACTION_ID,
          channel: 'INSTAGRAM',
          idempotencyKey: 'idemp_db_fail_1',
          requestPayload: { text: '실패해야 하는 요청' },
        })
      ).rejects.toThrow(PersistenceError);

      // Must not leave orphaned cache
      ProofChainService.clearMemoryCacheForTesting();
    });

    it('prohibits granting EXTERNAL_VERIFIED when DB write fails during readback verification (Fail-Closed)', async () => {
      // 1. Create proof while DB is healthy
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_verify_fail_closed',
        requestPayload: { text: '검증 전 정상 저장' },
      });

      // 2. Induce DB failure before verification persistence
      mockShouldFailDb = true;

      const mockReadback = vi.fn(async () => ({
        isLive: true,
        authoritativeId: 'ig_authoritative_123',
        permalink: 'https://instagram.com/p/valid123',
        contentSnapshot: '검증 전 정상 저장',
      }));

      // 3. Independent readback verification MUST throw PersistenceError and FAIL-CLOSED
      await expect(
        ProofChainService.verifyWithIndependentReadback(proof.evidenceId, mockReadback)
      ).rejects.toThrow(PersistenceError);

      // 4. In-memory cache must NOT be marked as EXTERNAL_VERIFIED
      const cached = ProofChainService.getEvidence(proof.evidenceId);
      expect(cached?.stage).not.toBe('EXTERNAL_VERIFIED');

      // 5. DB must NOT contain EXTERNAL_VERIFIED
      mockShouldFailDb = false;
      const dbRow = mockDbTables.proof_chains.get(proof.evidenceId);
      expect(dbRow?.stage).not.toBe('EXTERNAL_VERIFIED');
    });

    it('throws PersistenceError on restoreFromDB when DB read fails', async () => {
      mockShouldFailDb = true;

      await expect(ProofChainService.restoreFromDB('any_ev_id')).rejects.toThrow(PersistenceError);
    });

    it('throws PersistenceError on appendBlock when DB write fails', async () => {
      const proof = await ProofChainService.initiateProof({
        workspaceId: TEST_WORKSPACE,
        actionId: TEST_ACTION_ID,
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_append_fail',
        requestPayload: { text: '초기 블록' },
      });

      mockShouldFailDb = true;

      await expect(
        ProofChainService.appendBlock(proof.evidenceId, {
          actionRunId: TEST_ACTION_ID,
          payload: { text: 'DB 실패 중 추가 시도' },
          stage: 'PROVIDER_ACCEPTED',
        })
      ).rejects.toThrow(PersistenceError);
    });
  });
});
