/**
 * Same Canonical Entity Validator & Drift Guard (ANI-1127)
 * Ensures Chat and Content interfaces share the exact same MediaAsset, ContentVersion, and CreativeBundle identities.
 * Prohibits mock IDs, local component states, and cross-surface drifts.
 */

export class SameEntityMismatchError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'SameEntityMismatchError'
    this.code = 'SAME_CANONICAL_ENTITY_MISMATCH'
    this.details = details
    Object.setPrototypeOf(this, SameEntityMismatchError.prototype)
  }
}

export interface AssertSameCanonicalEntityParams {
  chatAssetId: string
  contentAssetId: string
  bundleAssetId?: string
  chatVersionId?: string
  contentVersionId?: string
}

/**
 * Validates that Chat and Content point to the identical canonical entities.
 * Fails closed if any identifier differs.
 */
export function assertSameCanonicalEntity(params: AssertSameCanonicalEntityParams): void {
  const { chatAssetId, contentAssetId, bundleAssetId, chatVersionId, contentVersionId } = params

  if (!chatAssetId || !contentAssetId) {
    throw new SameEntityMismatchError(
      'Both chatAssetId and contentAssetId are strictly required to verify entity parity',
      { chatAssetId, contentAssetId }
    )
  }

  if (chatAssetId !== contentAssetId) {
    throw new SameEntityMismatchError(
      `Canonical MediaAsset mismatch between Chat and Content: chat=${chatAssetId}, content=${contentAssetId}`,
      { chatAssetId, contentAssetId }
    )
  }

  if (bundleAssetId && bundleAssetId !== chatAssetId) {
    throw new SameEntityMismatchError(
      `CreativeBundle primary media asset (${bundleAssetId}) does not match canonical media asset (${chatAssetId})`,
      { chatAssetId, bundleAssetId }
    )
  }

  if (chatVersionId && contentVersionId && chatVersionId !== contentVersionId) {
    throw new SameEntityMismatchError(
      `Canonical ContentVersion mismatch between Chat and Content: chat=${chatVersionId}, content=${contentVersionId}`,
      { chatVersionId, contentVersionId }
    )
  }
}
