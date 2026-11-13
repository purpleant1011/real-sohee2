import type { ChannelId } from '@/lib/channels/channel-registry';

export type ProofChainStage =
  | 'TRANSPORT_SUCCESS'
  | 'PROVIDER_ACCEPTED'
  | 'VERIFICATION_LIMITED'
  | 'VERIFYING'
  | 'EXTERNAL_VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'VERIFY_FAILED';

export interface EvidenceBlock {
  index: number;
  previousHash: string;
  timestamp: string;
  payloadDigest: string;
  actionRunId: string;
  currentHash: string;
  stage: ProofChainStage | string;
  payload?: unknown;
}

export interface CanonicalProofChain {
  evidenceId: string;
  workspaceId: string;
  actionId: string;
  channel: ChannelId | string;
  idempotencyKey: string;
  stage: ProofChainStage;
  requestDigest: string;
  responseDigest?: string;
  readbackDigest?: string;
  providerObjectId?: string;
  providerUrl?: string;
  verifierVersion: string;
  timestamps: {
    requestedAt: string;
    transportSuccessAt?: string;
    acceptedAt?: string;
    verifyingAt?: string;
    verifiedAt?: string;
    failedAt?: string;
    reconciledAt?: string;
  };
  reconcileStatus: 'NONE' | 'QUEUED' | 'RECONCILED' | 'MANUAL_INTERVENTION';
  mismatchDetail?: string;
  rawEvidencePayload?: Record<string, unknown>;
  blocks: EvidenceBlock[];
  genesisHash?: string;
  latestHash?: string;
}

export interface IndependentReadbackResult {
  isLive: boolean;
  authoritativeId?: string;
  permalink?: string;
  contentSnapshot?: string;
  error?: string;
  readbackRequestId?: string;
  observedAt?: string;
  captionDigest?: string;
  statusCode?: string;
  rawResponse?: unknown;
}

export interface InitiateProofParams {
  workspaceId: string;
  actionId: string;
  channel: ChannelId | string;
  idempotencyKey: string;
  requestPayload: Record<string, unknown> | string;
}

export interface AppendBlockParams {
  actionRunId?: string;
  payload: unknown;
  stage?: ProofChainStage | string;
  timestamp?: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  errorReason?: 'TAMPERED_BLOCK_DETECTED' | 'EMPTY_CHAIN' | string;
  blockIndex?: number;
  details?: string;
}

