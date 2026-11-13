import { z } from 'zod'
import { createHash } from 'node:crypto'

export type WorkspaceIndustry = 'bakery' | 'beauty' | 'cafe' | 'general'

export class CrossTenantAccessError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(message: string, code = 'CROSS_TENANT_ACCESS_DENIED', statusCode = 403) {
    super(message)
    this.name = 'CrossTenantAccessError'
    this.code = code
    this.statusCode = statusCode
  }
}

export const WorkspaceMembershipSchema = z.object({
  role: z.enum(['owner', 'manager', 'reviewer', 'viewer']),
  status: z.literal('active'),
})

export const WorkspaceContextEnvelopeSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().min(1),
  membership: WorkspaceMembershipSchema,
  businessProfileVersion: z.number().int().nonnegative(),
  brandVersion: z.number().int().nonnegative(),
  catalogSourceIds: z.array(z.string().min(1)),
  channelConnectionIds: z.array(z.string().min(1)),
  businessName: z.string().min(1),
  industry: z.enum(['bakery', 'beauty', 'cafe', 'general']),
  location: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  brandVoice: z.string().nullable().optional(),
  keywords: z.array(z.string()),
  prohibitedTerms: z.array(z.string()),
  contextFingerprint: z.string().length(64),
  resolvedAt: z.string().datetime(),
})

export type WorkspaceContextEnvelope = z.infer<typeof WorkspaceContextEnvelopeSchema>

export type ComputeContextFingerprintInput = Omit<WorkspaceContextEnvelope, 'contextFingerprint'>

/**
 * Computes deterministic SHA-256 fingerprint from canonical workspace envelope properties.
 */
export function computeContextFingerprint(input: ComputeContextFingerprintInput): string {
  const sortedCatalog = [...(input.catalogSourceIds || [])].sort()
  const sortedChannels = [...(input.channelConnectionIds || [])].sort()

  const payload = [
    input.workspaceId,
    input.businessProfileVersion,
    input.brandVersion,
    input.businessName,
    input.industry,
    sortedCatalog.join(','),
    sortedChannels.join(','),
  ].join(':')

  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/**
 * Verifies envelope integrity. Throws if schema is invalid or fingerprint has been tampered with.
 */
export function validateWorkspaceContextEnvelope(envelope: WorkspaceContextEnvelope): void {
  WorkspaceContextEnvelopeSchema.parse(envelope)
  const expectedFingerprint = computeContextFingerprint(envelope)

  if (envelope.contextFingerprint !== expectedFingerprint) {
    throw new CrossTenantAccessError(
      `WorkspaceContextEnvelope context fingerprint mismatch: expected ${expectedFingerprint}, received ${envelope.contextFingerprint}`,
      'WORKSPACE_ENVELOPE_FINGERPRINT_MISMATCH',
      403
    )
  }
}

/**
 * Asserts that a target resource belongs strictly to the envelope's workspace.
 * Fails closed with 403 if there is any cross-workspace leakage.
 */
export function assertNoCrossTenantResourceAccess(
  envelope: WorkspaceContextEnvelope,
  resourceId: string,
  resourceWorkspaceId: string
): void {
  if (!resourceWorkspaceId || resourceWorkspaceId !== envelope.workspaceId) {
    throw new CrossTenantAccessError(
      `Cross-tenant access forbidden: resource "${resourceId}" belongs to workspace "${resourceWorkspaceId}", but actor holds envelope for "${envelope.workspaceId}".`,
      'CROSS_TENANT_ACCESS_DENIED',
      403
    )
  }
}

/**
 * Generates an isolated, version-anchored cache key for tenant queries and cached artifacts.
 */
export function createWorkspaceCacheKey(
  envelope: WorkspaceContextEnvelope,
  domain: string,
  resourceId?: string
): string {
  const baseKey = `workspace:${envelope.workspaceId}:bp:${envelope.businessProfileVersion}:bv:${envelope.brandVersion}:${domain}`
  return resourceId ? `${baseKey}:${resourceId}` : baseKey
}
