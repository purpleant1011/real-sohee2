/** Persisted channel identifiers. `daangn_business` matches the existing content model. */
export type VaultChannel = 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'

/** NULL means the item is not held; this is not a publishing lifecycle status. */
export type VaultReleaseGate =
  | 'HELD_PROVIDER_PENDING'
  | 'HELD_CONNECTION_PENDING'
  | 'HELD_USER'
  | 'RELEASE_REQUESTED'
  | null

export type VaultHoldReason =
  | 'META_REVIEW_PENDING'
  | 'CHANNEL_NOT_CONNECTED'
  | 'USER_HELD'
  | 'RELEASE_REQUESTED'
  | 'REAPPROVAL_REQUIRED'
  | null

export type VaultApprovalState = 'APPROVED' | 'INVALIDATED' | 'NEEDS_REAPPROVAL'
export type VaultPreflightOverall = 'PASS' | 'FAIL' | 'UNKNOWN'

/** One persisted row per approved channel variant; date changes do not change the fingerprint. */
export interface VaultItem {
  id: string
  workspaceId: string
  contentId: string
  versionId: string
  channel: VaultChannel
  releaseGate: VaultReleaseGate
  holdReason: VaultHoldReason
  heldAt: string | null
  heldBy: string | null
  targetDate: string | null
  approvedFingerprint: string | null
  fingerprintSchemaVersion: 1 | 2 | 3 | null
  policyVersion: string
  specVersion: string
  approvalState: VaultApprovalState
  approvedBy: string | null
  bundleId: string | null
  idempotencyKey: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type VaultJson = null | boolean | number | string | VaultJson[] | { [key: string]: VaultJson }

export interface VaultVariantPayload {
  id: string
  workspaceId: string
  vaultItemId: string
  payload: Record<string, VaultJson>
  /** A separate rendered artifact, linked to the approval; never fingerprint input. */
  previewArtifacts: Record<string, VaultJson>
  createdAt: string
  updatedAt: string
}

export interface VaultEvent {
  id: string
  workspaceId: string
  vaultItemId: string
  eventType: string
  actorId: string | null
  payload: Record<string, VaultJson>
  occurredAt: string
}

export interface VaultPreflightRun {
  id: string
  workspaceId: string
  vaultItemId: string
  runAt: string
  overall: VaultPreflightOverall
  items: VaultJson[]
  triggeredBy: string | null
}
