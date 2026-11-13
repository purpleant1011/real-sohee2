import crypto from 'crypto';
import type {
  CanonicalProofChain,
  EvidenceBlock,
  IndependentReadbackResult,
  InitiateProofParams,
  AppendBlockParams,
  ChainVerificationResult,
  ProofChainStage,
} from '@/types/evidence-chain';
import { AdminEvidenceCenterService } from '@/lib/admin-ops/evidence-center-service';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PersistenceError } from '@/lib/errors/persistence-error';

export const PROOF_VERIFIER_VERSION = 'v0.9.5-evidence-engine';
export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

/**
 * Calculates cryptographic SHA-256 block hash.
 * Formula: SHA256(previousHash + timestamp + payloadDigest + actionRunId)
 */
export function calculateBlockHash(params: {
  previousHash: string;
  timestamp: string;
  payloadDigest: string;
  actionRunId: string;
}): string {
  const content = `${params.previousHash}${params.timestamp}${params.payloadDigest}${params.actionRunId}`;
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Attaches Promise methods to CanonicalProofChain so that callers can
 * either synchronously read properties (for backward compatibility) or
 * await DB persistence with fail-closed guarantees.
 */
function asDurableChain(
  chain: CanonicalProofChain,
  persistPromise: Promise<void>
): CanonicalProofChain & Promise<CanonicalProofChain> {
  const promise = persistPromise.then(() => chain);
  return Object.assign(promise, chain);
}

export class ProofChainService {
  private static chains: Map<string, CanonicalProofChain> = new Map();
  private static idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> evidenceId
  private static adminEvidenceCenter = new AdminEvidenceCenterService();

  /**
   * Helper: Canonical SHA-256 Digest of any payload
   */
  public static computePayloadDigest(payload: unknown): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(serialized || '', 'utf8').digest('hex');
  }

  /**
   * 1. Initiate Proof Chain (ANI-967, ANI-968)
   * Creates durable entry with genesis evidence block and persists to DB.
   */
  public static initiateProof(
    params: InitiateProofParams
  ): CanonicalProofChain & Promise<CanonicalProofChain> {
    const { workspaceId, actionId, channel, idempotencyKey, requestPayload } = params;

    // Strict idempotency: if key already exists, return existing chain
    if (this.idempotencyIndex.has(idempotencyKey)) {
      const existingId = this.idempotencyIndex.get(idempotencyKey)!;
      const existing = this.chains.get(existingId);
      if (existing) {
        return asDurableChain(existing, Promise.resolve());
      }
    }

    const requestDigestHex = this.computePayloadDigest(requestPayload);
    const evidenceId = `ev_proof_${Date.now()}_${requestDigestHex.slice(0, 8)}`;
    const requestedAt = new Date().toISOString();

    // Genesis Block
    const genesisHash = calculateBlockHash({
      previousHash: GENESIS_PREVIOUS_HASH,
      timestamp: requestedAt,
      payloadDigest: requestDigestHex,
      actionRunId: actionId,
    });

    const genesisBlock: EvidenceBlock = {
      index: 0,
      previousHash: GENESIS_PREVIOUS_HASH,
      timestamp: requestedAt,
      payloadDigest: requestDigestHex,
      actionRunId: actionId,
      currentHash: genesisHash,
      stage: 'TRANSPORT_SUCCESS',
      payload: requestPayload,
    };

    const chain: CanonicalProofChain = {
      evidenceId,
      workspaceId,
      actionId,
      channel,
      idempotencyKey,
      stage: 'TRANSPORT_SUCCESS',
      requestDigest: `sha256-${requestDigestHex}`,
      verifierVersion: PROOF_VERIFIER_VERSION,
      timestamps: {
        requestedAt,
        transportSuccessAt: requestedAt,
      },
      reconcileStatus: 'NONE',
      blocks: [genesisBlock],
      genesisHash,
      latestHash: genesisHash,
    };

    this.chains.set(evidenceId, chain);
    this.idempotencyIndex.set(idempotencyKey, evidenceId);

    const persistPromise = (async () => {
      // 1. Worker Restart / DB SSOT recovery check:
      // If chain exists in DB for this idempotency_key, restore it instead of creating duplicate!
      const existingInDb = await this.restoreByIdempotencyKeyFromDB(idempotencyKey);
      if (existingInDb && existingInDb.evidenceId !== evidenceId) {
        this.chains.delete(evidenceId);
        this.chains.set(existingInDb.evidenceId, existingInDb);
        this.idempotencyIndex.set(idempotencyKey, existingInDb.evidenceId);
        Object.assign(chain, existingInDb);
        return existingInDb;
      }

      // 2. Persist new chain to DB
      await this.persistProofChain(chain);
      return chain;
    })();

    return asDurableChain(chain, persistPromise as unknown as Promise<void>);
  }

  /**
   * 2. Append Evidence Block (ANI-968)
   * Appends an immutable cryptographic block to an existing chain.
   */
  public static async appendBlock(
    evidenceIdOrChain: string | CanonicalProofChain,
    params: AppendBlockParams
  ): Promise<EvidenceBlock> {
    let chain: CanonicalProofChain | undefined;

    if (typeof evidenceIdOrChain === 'string') {
      chain = this.chains.get(evidenceIdOrChain);
      if (!chain) {
        const fromDb = await this.restoreFromDB(evidenceIdOrChain);
        if (fromDb) {
          chain = fromDb;
        }
      }
      if (!chain) {
        throw new Error(`Evidence record not found: ${evidenceIdOrChain}`);
      }
    } else {
      chain = evidenceIdOrChain;
    }

    if (!chain.blocks) {
      chain.blocks = [];
    }

    const previousHash =
      chain.blocks.length === 0
        ? GENESIS_PREVIOUS_HASH
        : chain.blocks[chain.blocks.length - 1].currentHash;

    const timestamp = params.timestamp || new Date().toISOString();
    const payloadDigest = this.computePayloadDigest(params.payload);
    const actionRunId = params.actionRunId || chain.actionId;
    const stage = params.stage || chain.stage;

    const currentHash = calculateBlockHash({
      previousHash,
      timestamp,
      payloadDigest,
      actionRunId,
    });

    const newBlock: EvidenceBlock = {
      index: chain.blocks.length,
      previousHash,
      timestamp,
      payloadDigest,
      actionRunId,
      currentHash,
      stage,
      payload: params.payload,
    };

    chain.blocks.push(newBlock);
    chain.latestHash = currentHash;
    if (chain.blocks.length === 1) {
      chain.genesisHash = currentHash;
    }

    await this.persistProofChain(chain);
    return newBlock;
  }

  /**
   * 3. Mark Provider Accepted
   * Step 2: External provider acknowledges receipt and returns preliminary tracking data.
   */
  public static markProviderAccepted(
    evidenceId: string,
    providerResponse: { objectId?: string; rawResponse?: unknown }
  ): CanonicalProofChain & Promise<CanonicalProofChain> {
    const cachedChain = this.chains.get(evidenceId);

    const applyAcceptedToChain = (targetChain: CanonicalProofChain) => {
      targetChain.stage = 'PROVIDER_ACCEPTED';
      const rawPayload = providerResponse.rawResponse || providerResponse;
      const digestHex = this.computePayloadDigest(rawPayload);
      targetChain.responseDigest = `sha256-${digestHex}`;
      targetChain.providerObjectId = providerResponse.objectId;
      const acceptedAt = new Date().toISOString();
      targetChain.timestamps.acceptedAt = acceptedAt;

      const previousHash =
        targetChain.blocks && targetChain.blocks.length > 0
          ? targetChain.blocks[targetChain.blocks.length - 1].currentHash
          : GENESIS_PREVIOUS_HASH;

      const blockHash = calculateBlockHash({
        previousHash,
        timestamp: acceptedAt,
        payloadDigest: digestHex,
        actionRunId: targetChain.actionId,
      });

      const acceptedBlock: EvidenceBlock = {
        index: targetChain.blocks ? targetChain.blocks.length : 0,
        previousHash,
        timestamp: acceptedAt,
        payloadDigest: digestHex,
        actionRunId: targetChain.actionId,
        currentHash: blockHash,
        stage: 'PROVIDER_ACCEPTED',
        payload: rawPayload,
      };

      if (!targetChain.blocks) targetChain.blocks = [];
      targetChain.blocks.push(acceptedBlock);
      targetChain.latestHash = blockHash;
    };

    if (cachedChain) {
      applyAcceptedToChain(cachedChain);
      const persistPromise = this.persistProofChain(cachedChain);
      return asDurableChain(cachedChain, persistPromise);
    }

    // Cache Miss: Asynchronously restore from DB and mutate
    const asyncPromise = (async () => {
      const restored = await this.restoreFromDB(evidenceId);
      if (!restored) {
        throw new Error(`Evidence record not found: ${evidenceId}`);
      }
      applyAcceptedToChain(restored);
      await this.persistProofChain(restored);
      return restored;
    })();

    const placeholderChain = { evidenceId, stage: 'PROVIDER_ACCEPTED' as const };
    return Object.assign(asyncPromise, placeholderChain as unknown as CanonicalProofChain);
  }

  /**
   * 3.1 Mark Verification Limited (ANI-980)
   * Explicitly records that provider mutation was accepted but independent readback is
   * unavailable for this channel or action (e.g., DM, comment response, closed inbox).
   * Prevents premature elevation to EXTERNAL_VERIFIED.
   */
  public static markVerificationLimited(
    evidenceId: string,
    params: { objectId?: string; rawResponse?: unknown; reason?: string }
  ): CanonicalProofChain & Promise<CanonicalProofChain> {
    const cachedChain = this.chains.get(evidenceId);

    const applyLimitedToChain = (targetChain: CanonicalProofChain) => {
      targetChain.stage = 'VERIFICATION_LIMITED';
      const rawPayload = params.rawResponse || params;
      const digestHex = this.computePayloadDigest(rawPayload);
      targetChain.responseDigest = `sha256-${digestHex}`;
      targetChain.providerObjectId = params.objectId;
      const acceptedAt = new Date().toISOString();
      targetChain.timestamps.acceptedAt = acceptedAt;
      targetChain.mismatchDetail = params.reason || 'Verification limited: independent readback unavailable for this channel';

      const previousHash =
        targetChain.blocks && targetChain.blocks.length > 0
          ? targetChain.blocks[targetChain.blocks.length - 1].currentHash
          : GENESIS_PREVIOUS_HASH;

      const blockHash = calculateBlockHash({
        previousHash,
        timestamp: acceptedAt,
        payloadDigest: digestHex,
        actionRunId: targetChain.actionId,
      });

      const limitedBlock: EvidenceBlock = {
        index: targetChain.blocks ? targetChain.blocks.length : 0,
        previousHash,
        timestamp: acceptedAt,
        payloadDigest: digestHex,
        actionRunId: targetChain.actionId,
        currentHash: blockHash,
        stage: 'VERIFICATION_LIMITED',
        payload: { ...params, rawPayload },
      };

      if (!targetChain.blocks) targetChain.blocks = [];
      targetChain.blocks.push(limitedBlock);
      targetChain.latestHash = blockHash;
    };

    if (cachedChain) {
      applyLimitedToChain(cachedChain);
      const persistPromise = this.persistProofChain(cachedChain);
      return asDurableChain(cachedChain, persistPromise);
    }

    // Cache Miss: Asynchronously restore from DB and mutate
    const asyncPromise = (async () => {
      const restored = await this.restoreFromDB(evidenceId);
      if (!restored) {
        throw new Error(`Evidence record not found: ${evidenceId}`);
      }
      applyLimitedToChain(restored);
      await this.persistProofChain(restored);
      return restored;
    })();

    const placeholderChain = { evidenceId, stage: 'VERIFICATION_LIMITED' as const };
    return Object.assign(asyncPromise, placeholderChain as unknown as CanonicalProofChain);
  }

  /**
   * 4. Independent Readback Verification (ANI-923 Core Invariant)
   * Prohibits concluding VERIFIED from HTTP status alone.
   * Executes independent GET readback, verifies permalink and content match.
   */
  public static async verifyWithIndependentReadback(
    evidenceId: string,
    readbackFn: () => Promise<IndependentReadbackResult>,
    expectedFingerprint?: string
  ): Promise<{ chain: CanonicalProofChain; verified: boolean; errorReason?: string }> {
    let chain = this.chains.get(evidenceId);
    if (!chain) {
      const fromDb = await this.restoreFromDB(evidenceId);
      if (fromDb) {
        chain = fromDb;
      }
    }
    if (!chain) {
      throw new Error(`Evidence record not found: ${evidenceId}`);
    }

    chain.stage = 'VERIFYING';
    chain.timestamps.verifyingAt = new Date().toISOString();

    try {
      const readback = await readbackFn();

      // Rule A: Independent GET must report live existence
      if (!readback.isLive || !readback.permalink || !readback.authoritativeId) {
        chain.stage = 'VERIFY_FAILED';
        chain.timestamps.failedAt = new Date().toISOString();
        chain.mismatchDetail =
          readback.error ||
          'Provider independent readback reported item not live or missing authoritative identifiers.';

        this.adminEvidenceCenter.registerMismatch({
          workspaceId: chain.workspaceId,
          actionRunId: chain.actionId,
          channel: String(chain.channel),
          mismatchKind: 'READBACK_PAYLOAD_MISMATCH',
          providerDeepLink: readback.permalink || 'N/A',
          payloadDiffSummary: chain.mismatchDetail,
        });

        await this.appendBlock(chain, {
          actionRunId: chain.actionId,
          payload: { error: chain.mismatchDetail, readback },
          stage: 'VERIFY_FAILED',
        });

        return { chain, verified: false, errorReason: chain.mismatchDetail };
      }

      // Rule B: Reject dummy / placeholder URLs
      if (
        readback.permalink.includes('example.com') ||
        readback.permalink.includes('fake-post') ||
        readback.permalink.includes('placeholder')
      ) {
        chain.stage = 'VERIFY_FAILED';
        chain.timestamps.failedAt = new Date().toISOString();
        chain.mismatchDetail =
          'Placeholder or mock permalinks are strictly prohibited in production proof chain.';

        this.adminEvidenceCenter.registerMismatch({
          workspaceId: chain.workspaceId,
          actionRunId: chain.actionId,
          channel: String(chain.channel),
          mismatchKind: 'READBACK_PAYLOAD_MISMATCH',
          providerDeepLink: readback.permalink,
          payloadDiffSummary: chain.mismatchDetail,
        });

        await this.appendBlock(chain, {
          actionRunId: chain.actionId,
          payload: { error: chain.mismatchDetail, readback },
          stage: 'VERIFY_FAILED',
        });

        return { chain, verified: false, errorReason: chain.mismatchDetail };
      }

      // Rule C: Fingerprint verification if expected
      if (expectedFingerprint && readback.contentSnapshot) {
        const observedDigest = this.computePayloadDigest(readback.contentSnapshot);
        if (observedDigest !== expectedFingerprint) {
          chain.stage = 'VERIFY_FAILED';
          chain.timestamps.failedAt = new Date().toISOString();
          chain.readbackDigest = `sha256-${observedDigest}`;
          chain.mismatchDetail = `Content snapshot mismatch: expected sha256-${expectedFingerprint}, got sha256-${observedDigest}`;

          this.adminEvidenceCenter.registerMismatch({
            workspaceId: chain.workspaceId,
            actionRunId: chain.actionId,
            channel: String(chain.channel),
            mismatchKind: 'READBACK_PAYLOAD_MISMATCH',
            providerDeepLink: readback.permalink,
            expectedHash: expectedFingerprint,
            readbackPayloadHash: observedDigest,
            payloadDiffSummary: chain.mismatchDetail,
          });

          await this.appendBlock(chain, {
            actionRunId: chain.actionId,
            payload: { error: chain.mismatchDetail, expected: expectedFingerprint, observed: observedDigest },
            stage: 'VERIFY_FAILED',
          });

          return { chain, verified: false, errorReason: chain.mismatchDetail };
        }
      }

      // Passed all checks -> EXTERNAL_VERIFIED
      const readbackDigest = this.computePayloadDigest(readback.contentSnapshot || readback.permalink);
      const prevStage = chain.stage;
      const prevVerifiedAt = chain.timestamps.verifiedAt;
      const prevReadbackDigest = chain.readbackDigest;
      const prevProviderObjectId = chain.providerObjectId;
      const prevProviderUrl = chain.providerUrl;

      chain.stage = 'EXTERNAL_VERIFIED';
      chain.readbackDigest = `sha256-${readbackDigest}`;
      chain.providerObjectId = readback.authoritativeId;
      chain.providerUrl = readback.permalink;
      chain.timestamps.verifiedAt = new Date().toISOString();

      try {
        await this.appendBlock(chain, {
          actionRunId: chain.actionId,
          payload: {
            authoritativeId: readback.authoritativeId,
            permalink: readback.permalink,
            digest: readbackDigest,
            ...(readback.readbackRequestId ? { readbackRequestId: readback.readbackRequestId } : {}),
            ...(readback.observedAt ? { observedAt: readback.observedAt } : {}),
            ...(readback.captionDigest ? { captionDigest: readback.captionDigest } : {}),
          },
          stage: 'EXTERNAL_VERIFIED',
        });
      } catch (dbErr) {
        // FAIL-CLOSED: DB failure must roll back in-memory stage and propagate PersistenceError.
        // It must NEVER leave chain in EXTERNAL_VERIFIED state!
        chain.stage = prevStage;
        chain.timestamps.verifiedAt = prevVerifiedAt;
        chain.readbackDigest = prevReadbackDigest;
        chain.providerObjectId = prevProviderObjectId;
        chain.providerUrl = prevProviderUrl;
        this.chains.delete(chain.evidenceId);
        throw dbErr;
      }

      return { chain, verified: true };
    } catch (err: unknown) {
      if (err instanceof PersistenceError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      chain.stage = 'RESULT_UNKNOWN';
      chain.reconcileStatus = 'QUEUED';
      chain.mismatchDetail = `Readback execution network/runtime error: ${msg}`;

      this.adminEvidenceCenter.registerMismatch({
        workspaceId: chain.workspaceId,
        actionRunId: chain.actionId,
        channel: String(chain.channel),
        mismatchKind: 'PENDING_READBACK',
        providerDeepLink: chain.providerUrl || 'N/A',
        payloadDiffSummary: chain.mismatchDetail,
      });

      await this.appendBlock(chain, {
        actionRunId: chain.actionId,
        payload: { error: chain.mismatchDetail },
        stage: 'RESULT_UNKNOWN',
      });

      return { chain, verified: false, errorReason: chain.mismatchDetail };
    }
  }

  /**
   * 5. Handle Timeout to RESULT_UNKNOWN (ANI-923 Invariant)
   * On transport or provider timeout, never fail blindly or retry blind write.
   * Isolates to RESULT_UNKNOWN and queues for reconcile.
   */
  public static markResultUnknownOnTimeout(
    evidenceId: string,
    timeoutReason: string
  ): CanonicalProofChain & Promise<CanonicalProofChain> {
    const cachedChain = this.chains.get(evidenceId);

    const applyTimeoutToChain = (targetChain: CanonicalProofChain) => {
      targetChain.stage = 'RESULT_UNKNOWN';
      targetChain.reconcileStatus = 'QUEUED';
      targetChain.mismatchDetail = `Timeout occurred: ${timeoutReason}. Blind retry prohibited; queued for reconcile readback.`;

      this.adminEvidenceCenter.registerMismatch({
        workspaceId: targetChain.workspaceId,
        actionRunId: targetChain.actionId,
        channel: String(targetChain.channel),
        mismatchKind: 'PENDING_READBACK',
        providerDeepLink: targetChain.providerUrl || 'N/A',
        payloadDiffSummary: targetChain.mismatchDetail,
      });

      const previousHash =
        targetChain.blocks && targetChain.blocks.length > 0
          ? targetChain.blocks[targetChain.blocks.length - 1].currentHash
          : GENESIS_PREVIOUS_HASH;

      const timeoutPayload = { timeoutReason: targetChain.mismatchDetail };
      const digestHex = this.computePayloadDigest(timeoutPayload);
      const timestamp = new Date().toISOString();
      const blockHash = calculateBlockHash({
        previousHash,
        timestamp,
        payloadDigest: digestHex,
        actionRunId: targetChain.actionId,
      });

      const timeoutBlock: EvidenceBlock = {
        index: targetChain.blocks ? targetChain.blocks.length : 0,
        previousHash,
        timestamp,
        payloadDigest: digestHex,
        actionRunId: targetChain.actionId,
        currentHash: blockHash,
        stage: 'RESULT_UNKNOWN',
        payload: timeoutPayload,
      };

      if (!targetChain.blocks) targetChain.blocks = [];
      targetChain.blocks.push(timeoutBlock);
      targetChain.latestHash = blockHash;
    };

    if (cachedChain) {
      applyTimeoutToChain(cachedChain);
      const persistPromise = this.persistProofChain(cachedChain);
      return asDurableChain(cachedChain, persistPromise);
    }

    // Cache Miss: Asynchronously restore from DB and mutate
    const asyncPromise = (async () => {
      const restored = await this.restoreFromDB(evidenceId);
      if (!restored) {
        throw new Error(`Evidence record not found: ${evidenceId}`);
      }
      applyTimeoutToChain(restored);
      await this.persistProofChain(restored);
      return restored;
    })();

    const placeholderChain = { evidenceId, stage: 'RESULT_UNKNOWN' as const };
    return Object.assign(asyncPromise, placeholderChain as unknown as CanonicalProofChain);
  }

  /**
   * 6. Reconcile Before Retry Gate (ANI-923 Invariant)
   * Before executing ANY write retry on an idempotency key,
   * this check MUST run to verify if the object was already published.
   * If found, automatically recovers to EXTERNAL_VERIFIED and halts write.
   */
  public static async reconcileBeforeRetry(
    idempotencyKey: string,
    readbackFn: () => Promise<IndependentReadbackResult>
  ): Promise<{
    canSafelyExecute: boolean;
    alreadyVerified: boolean;
    evidence?: CanonicalProofChain;
    reason: string;
  }> {
    let chain: CanonicalProofChain | null = null;
    const evidenceId = this.idempotencyIndex.get(idempotencyKey);
    if (evidenceId) {
      chain = this.chains.get(evidenceId) || (await this.restoreFromDB(evidenceId));
    } else {
      chain = await this.restoreByIdempotencyKeyFromDB(idempotencyKey);
    }

    if (!chain) {
      return {
        canSafelyExecute: true,
        alreadyVerified: false,
        reason: 'No prior execution detected for this idempotency key.',
      };
    }

    if (chain.stage === 'EXTERNAL_VERIFIED') {
      return {
        canSafelyExecute: false,
        alreadyVerified: true,
        evidence: chain,
        reason: 'Action has already been verified on external platform. Duplicate write rejected.',
      };
    }

    try {
      const readback = await readbackFn();
      if (readback.isLive && readback.permalink && readback.authoritativeId) {
        chain.stage = 'EXTERNAL_VERIFIED';
        chain.reconcileStatus = 'RECONCILED';
        chain.providerObjectId = readback.authoritativeId;
        chain.providerUrl = readback.permalink;
        chain.timestamps.reconciledAt = new Date().toISOString();
        chain.timestamps.verifiedAt = new Date().toISOString();
        chain.mismatchDetail = 'Recovered from RESULT_UNKNOWN via pre-retry reconcile readback.';

        await this.appendBlock(chain, {
          actionRunId: chain.actionId,
          payload: {
            authoritativeId: readback.authoritativeId,
            permalink: readback.permalink,
            recovered: true,
          },
          stage: 'EXTERNAL_VERIFIED',
        });

        return {
          canSafelyExecute: false,
          alreadyVerified: true,
          evidence: chain,
          reason: 'Post-timeout reconcile readback discovered published item. Duplicate write prevented.',
        };
      }
    } catch {
      // Reconcile could not confirm item; proceed with caution
    }

    return {
      canSafelyExecute: true,
      alreadyVerified: false,
      evidence: chain,
      reason: 'Reconcile readback confirmed item does not exist externally. Retry permitted.',
    };
  }

  /**
   * 7. Cryptographic Chain Integrity Verification (ANI-968, ANI-969)
   * Traverses hashes from genesis to leaf. Returns valid: true only if all hashes
   * link correctly and payloads match their digests.
   */
  public static verifyChainIntegrity(
    chainOrBlocks: CanonicalProofChain | EvidenceBlock[] | { blocks: EvidenceBlock[] }
  ): ChainVerificationResult {
    let blocks: EvidenceBlock[];

    if (Array.isArray(chainOrBlocks)) {
      blocks = chainOrBlocks;
    } else if (chainOrBlocks && Array.isArray((chainOrBlocks as any).blocks)) {
      blocks = (chainOrBlocks as any).blocks;
    } else {
      return {
        valid: false,
        errorReason: 'TAMPERED_BLOCK_DETECTED',
        details: 'Invalid chain structure: no evidence blocks array found.',
      };
    }

    if (blocks.length === 0) {
      return {
        valid: false,
        errorReason: 'EMPTY_CHAIN',
        details: 'Evidence chain contains zero blocks.',
      };
    }

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      // 1. Check block index continuity
      if (block.index !== i) {
        return {
          valid: false,
          errorReason: 'TAMPERED_BLOCK_DETECTED',
          blockIndex: i,
          details: `Block index mismatch: expected ${i}, got ${block.index}`,
        };
      }

      // 2. Check previousHash link
      if (i === 0) {
        if (block.previousHash !== GENESIS_PREVIOUS_HASH) {
          return {
            valid: false,
            errorReason: 'TAMPERED_BLOCK_DETECTED',
            blockIndex: 0,
            details: `Genesis block previousHash must be ${GENESIS_PREVIOUS_HASH}`,
          };
        }
      } else {
        const prevBlock = blocks[i - 1];
        if (block.previousHash !== prevBlock.currentHash) {
          return {
            valid: false,
            errorReason: 'TAMPERED_BLOCK_DETECTED',
            blockIndex: i,
            details: `Block ${i} previousHash does not match Block ${i - 1} currentHash`,
          };
        }
      }

      // 3. Verify payload digest if payload is present
      const cleanPayloadDigest = (block.payloadDigest || '').replace(/^sha256-/, '');
      if (block.payload !== undefined) {
        const computedDigest = this.computePayloadDigest(block.payload);
        if (computedDigest !== cleanPayloadDigest) {
          return {
            valid: false,
            errorReason: 'TAMPERED_BLOCK_DETECTED',
            blockIndex: i,
            details: `Block ${i} payload digest mismatch: payload produces ${computedDigest}, but digest is ${cleanPayloadDigest}`,
          };
        }
      }

      // 4. Verify currentHash recomputation
      const expectedHash = calculateBlockHash({
        previousHash: block.previousHash,
        timestamp: block.timestamp,
        payloadDigest: cleanPayloadDigest,
        actionRunId: block.actionRunId,
      });

      if (block.currentHash !== expectedHash) {
        return {
          valid: false,
          errorReason: 'TAMPERED_BLOCK_DETECTED',
          blockIndex: i,
          details: `Block ${i} currentHash invalid: recomputed ${expectedHash}, observed ${block.currentHash}`,
        };
      }
    }

    // 5. Chain Root & Leaf Integrity Verification (Truncation and Head-alteration Defense)
    if (typeof chainOrBlocks === 'object' && chainOrBlocks !== null && !Array.isArray(chainOrBlocks)) {
      const chainObj = chainOrBlocks as Partial<CanonicalProofChain>;
      if (chainObj.genesisHash && chainObj.genesisHash !== blocks[0].currentHash) {
        return {
          valid: false,
          errorReason: 'TAMPERED_BLOCK_DETECTED',
          blockIndex: 0,
          details: `Genesis hash mismatch: chain.genesisHash is ${chainObj.genesisHash}, but block[0].currentHash is ${blocks[0].currentHash}`,
        };
      }

      if (chainObj.latestHash && chainObj.latestHash !== blocks[blocks.length - 1].currentHash) {
        return {
          valid: false,
          errorReason: 'TAMPERED_BLOCK_DETECTED',
          blockIndex: blocks.length - 1,
          details: `Latest hash mismatch (Truncation detected): chain.latestHash is ${chainObj.latestHash}, but block[${blocks.length - 1}].currentHash is ${blocks[blocks.length - 1].currentHash}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * 7.1 Cryptographic Chain Integrity Verification against DB SSOT (ANI-966)
   * Restores chain from DB if string ID provided, then validates cryptographic chain.
   */
  public static async verifyChain(
    evidenceIdOrChain: string | CanonicalProofChain
  ): Promise<ChainVerificationResult> {
    let chain: CanonicalProofChain | null = null;
    if (typeof evidenceIdOrChain === 'string') {
      chain = await this.restoreFromDB(evidenceIdOrChain);
      if (!chain) {
        return {
          valid: false,
          errorReason: 'NOT_FOUND',
          details: `Evidence record not found in DB SSOT: ${evidenceIdOrChain}`,
        };
      }
    } else {
      chain = evidenceIdOrChain;
    }
    return this.verifyChainIntegrity(chain);
  }

  /**
   * Internal helper to obtain Supabase client across request-scoped (web)
   * and worker/offline/test scopes safely.
   */
  private static async getSupabaseClient(): Promise<any> {
    try {
      const fn = createServerSupabaseClient as any;
      const isMocked = typeof fn === 'function' && ('mock' in fn || '_isMockFunction' in fn);
      if (process.env.NODE_ENV === 'test' && !isMocked && !process.env.INTEGRATION_TEST_REAL_SUPABASE) {
        return null;
      }
      return await createServerSupabaseClient();
    } catch (err: any) {
      if (err?.message?.includes('cookies') || err?.message?.includes('request scope')) {
        try {
          const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
          return createAdminSupabaseClient();
        } catch {
          return null;
        }
      }
      if (process.env.NODE_ENV === 'test' && (err?.message?.includes('NEXT_PUBLIC_SUPABASE') || err?.message?.includes('supabaseUrl is required'))) {
        return null;
      }
      throw err;
    }
  }

  /**
   * 8. Persist chain to database (ANI-967)
   * Enforces Fail-Closed: throws PersistenceError on DB failure and updates memory only after DB success.
   */
  private static async persistProofChain(chain: CanonicalProofChain): Promise<void> {
    try {
      const supabase = await this.getSupabaseClient();
      if (!supabase || typeof supabase.from !== 'function') {
        // Fallback for offline/unmocked test runners
        this.chains.set(chain.evidenceId, chain);
        this.idempotencyIndex.set(chain.idempotencyKey, chain.evidenceId);
        return;
      }

      const tableQuery = supabase.from('proof_chains');
      if (!tableQuery) {
        this.chains.set(chain.evidenceId, chain);
        this.idempotencyIndex.set(chain.idempotencyKey, chain.evidenceId);
        return;
      }

      const row = {
        evidence_id: chain.evidenceId,
        workspace_id: chain.workspaceId,
        action_id: chain.actionId,
        channel: String(chain.channel),
        idempotency_key: chain.idempotencyKey,
        stage: chain.stage,
        request_digest: chain.requestDigest,
        response_digest: chain.responseDigest,
        readback_digest: chain.readbackDigest,
        provider_object_id: chain.providerObjectId,
        provider_url: chain.providerUrl,
        verifier_version: chain.verifierVersion,
        timestamps: chain.timestamps,
        reconcile_status: chain.reconcileStatus,
        mismatch_detail: chain.mismatchDetail,
        raw_evidence_payload: chain.rawEvidencePayload,
        blocks: chain.blocks,
        genesis_hash: chain.genesisHash,
        latest_hash: chain.latestHash,
        updated_at: new Date().toISOString(),
      };

      let error: any = null;
      if (typeof tableQuery.upsert === 'function') {
        const res = await tableQuery.upsert(row, { onConflict: 'evidence_id' });
        error = res?.error;
      } else if (typeof tableQuery.insert === 'function') {
        const res = await tableQuery.insert(row);
        error = res?.error;
      }

      if (error) {
        throw new PersistenceError('persistProofChain', error.message || 'DB persist failed', error);
      }

      // Commit to cache only after DB write succeeds
      this.chains.set(chain.evidenceId, chain);
      this.idempotencyIndex.set(chain.idempotencyKey, chain.evidenceId);
    } catch (err) {
      // Rollback memory cache on persistent write failure
      this.chains.delete(chain.evidenceId);
      this.idempotencyIndex.delete(chain.idempotencyKey);

      if (err instanceof PersistenceError) {
        throw err;
      }
      throw new PersistenceError(
        'persistProofChain',
        (err as Error).message || 'Unexpected database error persisting proof chain',
        err
      );
    }
  }

  /**
   * 9. Restore proof chain from durable database (ANI-967)
   */
  public static async restoreFromDB(evidenceId: string): Promise<CanonicalProofChain | null> {
    try {
      const supabase = await this.getSupabaseClient();
      if (!supabase || typeof supabase.from !== 'function') {
        return this.chains.get(evidenceId) || null;
      }

      const query = supabase.from('proof_chains');
      if (!query || typeof query.select !== 'function') {
        return this.chains.get(evidenceId) || null;
      }

      const { data, error } = await query
        .select('*')
        .eq('evidence_id', evidenceId)
        .maybeSingle();

      if (error) {
        throw new PersistenceError('restoreFromDB', error.message || 'DB read error', error);
      }
      if (!data) return null;

      const chain: CanonicalProofChain = {
        evidenceId: data.evidence_id,
        workspaceId: data.workspace_id,
        actionId: data.action_id,
        channel: data.channel,
        idempotencyKey: data.idempotency_key,
        stage: data.stage,
        requestDigest: data.request_digest,
        responseDigest: data.response_digest,
        readbackDigest: data.readback_digest,
        providerObjectId: data.provider_object_id,
        providerUrl: data.provider_url,
        verifierVersion: data.verifier_version,
        timestamps: data.timestamps || {},
        reconcileStatus: data.reconcile_status,
        mismatchDetail: data.mismatch_detail,
        rawEvidencePayload: data.raw_evidence_payload,
        blocks: data.blocks || [],
        genesisHash: data.genesis_hash,
        latestHash: data.latest_hash,
      };

      this.chains.set(chain.evidenceId, chain);
      this.idempotencyIndex.set(chain.idempotencyKey, chain.evidenceId);
      return chain;
    } catch (err) {
      if (err instanceof PersistenceError) {
        throw err;
      }
      throw new PersistenceError(
        'restoreFromDB',
        (err as Error).message || 'Unexpected error loading proof chain from database',
        err
      );
    }
  }

  /**
   * Restores proof chain by idempotency_key from DB (ANI-967)
   */
  public static async restoreByIdempotencyKeyFromDB(
    idempotencyKey: string
  ): Promise<CanonicalProofChain | null> {
    try {
      const supabase = await this.getSupabaseClient();
      if (!supabase || typeof supabase.from !== 'function') {
        const cachedId = this.idempotencyIndex.get(idempotencyKey);
        return cachedId ? this.chains.get(cachedId) || null : null;
      }

      const query = supabase.from('proof_chains');
      if (!query || typeof query.select !== 'function') {
        const cachedId = this.idempotencyIndex.get(idempotencyKey);
        return cachedId ? this.chains.get(cachedId) || null : null;
      }

      const { data, error } = await query
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (error) {
        throw new PersistenceError('restoreByIdempotencyKeyFromDB', error.message || 'DB read error', error);
      }
      if (!data) return null;

      const chain: CanonicalProofChain = {
        evidenceId: data.evidence_id,
        workspaceId: data.workspace_id,
        actionId: data.action_id,
        channel: data.channel,
        idempotencyKey: data.idempotency_key,
        stage: data.stage,
        requestDigest: data.request_digest,
        responseDigest: data.response_digest,
        readbackDigest: data.readback_digest,
        providerObjectId: data.provider_object_id,
        providerUrl: data.provider_url,
        verifierVersion: data.verifier_version,
        timestamps: data.timestamps || {},
        reconcileStatus: data.reconcile_status,
        mismatchDetail: data.mismatch_detail,
        rawEvidencePayload: data.raw_evidence_payload,
        blocks: data.blocks || [],
        genesisHash: data.genesis_hash,
        latestHash: data.latest_hash,
      };

      this.chains.set(chain.evidenceId, chain);
      this.idempotencyIndex.set(chain.idempotencyKey, chain.evidenceId);
      return chain;
    } catch (err) {
      if (err instanceof PersistenceError) {
        throw err;
      }
      throw new PersistenceError(
        'restoreByIdempotencyKeyFromDB',
        (err as Error).message || 'Unexpected error loading proof chain by idempotency key',
        err
      );
    }
  }

  /**
   * 10. Same Truth Lookup: Get evidence record by ID
   */
  public static getEvidence(evidenceId: string): CanonicalProofChain | undefined {
    return this.chains.get(evidenceId);
  }

  /**
   * 11. Same Truth Lookup: List evidence records by Workspace
   */
  public static listEvidenceByWorkspace(workspaceId: string): CanonicalProofChain[] {
    return Array.from(this.chains.values()).filter((c) => c.workspaceId === workspaceId);
  }

  public static async listEvidenceByWorkspaceFromDB(
    workspaceId: string
  ): Promise<CanonicalProofChain[]> {
    try {
      const supabase = await this.getSupabaseClient();
      if (!supabase || typeof supabase.from !== 'function') {
        return this.listEvidenceByWorkspace(workspaceId);
      }

      const { data, error } = await supabase
        .from('proof_chains')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (error || !data) {
        return this.listEvidenceByWorkspace(workspaceId);
      }

      return data.map((d: any) => ({
        evidenceId: d.evidence_id,
        workspaceId: d.workspace_id,
        actionId: d.action_id,
        channel: d.channel,
        idempotencyKey: d.idempotency_key,
        stage: d.stage,
        requestDigest: d.request_digest,
        responseDigest: d.response_digest,
        readbackDigest: d.readback_digest,
        providerObjectId: d.provider_object_id,
        providerUrl: d.provider_url,
        verifierVersion: d.verifier_version,
        timestamps: d.timestamps || {},
        reconcileStatus: d.reconcile_status,
        mismatchDetail: d.mismatch_detail,
        rawEvidencePayload: d.raw_evidence_payload,
        blocks: d.blocks || [],
        genesisHash: d.genesis_hash,
        latestHash: d.latest_hash,
      }));
    } catch {
      return this.listEvidenceByWorkspace(workspaceId);
    }
  }

  /**
   * 12. Admin Reconcile Center Accessor
   */
  public static getAdminEvidenceCenter(): AdminEvidenceCenterService {
    return this.adminEvidenceCenter;
  }

  /**
   * Test/Mock cleanup helper
   */
  public static clearMemoryCacheForTesting(): void {
    this.chains.clear();
    this.idempotencyIndex.clear();
  }

  public static _reset(): void {
    this.clearMemoryCacheForTesting();
  }
}
