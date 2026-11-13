import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })
const severity = z.enum(['critical', 'high', 'medium', 'low', 'unknown'])
const factKind = z.enum(['observed', 'inference', 'unknown'])
const freshness = z.enum(['fresh', 'stale', 'unknown'])

export const riskItemSchema = z.object({
  id: z.string().min(1).max(200),
  workspace_id: z.string().uuid().nullable(),
  workspace_name: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(500),
  severity,
  fact_kind: factKind,
  source_timestamp: timestamp.nullable(),
  freshness,
  href: z.string().regex(/^\/admin(?:\/|$)/u),
}).strict()

export const riskCardMetadataSchema = z.object({
  sourceLabel: z.string().min(1).max(120),
  windowLabel: z.string().min(1).max(80),
  observedAt: timestamp.nullable(),
  freshness,
}).strict()

export type RiskItem = z.infer<typeof riskItemSchema>
export type RiskWorkspaceEvidence = Readonly<{
  workspaceId: string
  workspaceName: string
  workspaceStatus?: string | null
  lifecycle: Readonly<{ state: 'ready' | 'empty' | 'forbidden' | 'out_of_scope' | 'unavailable' | 'unknown'; missing: readonly string[]; sourceTimestamp: string | null }>
  channels: readonly Readonly<{ channel: string; status: string; updatedAt: string | null }>[] | null
  publishing: readonly Readonly<{ channel: string; displayState: string; freshness: 'fresh' | 'stale' | 'unknown'; approvalStatus?: string | null; currentVersionId?: string | null; approvedVersionId?: string | null }>[] | null
  billing: Readonly<{ state: string; balanceState: string; available: number | null; sourceTimestamp: string | null }> | null
  audit: readonly Readonly<{ action: string; result: string; createdAt: string; freshness: 'fresh' | 'stale' | 'unknown' }>[] | null
  support: readonly Readonly<{ status: string; startedAt: string; expiresAt: string }>[] | null
}>

export type OperatorRiskOverview = Readonly<{
  items: readonly RiskItem[]
  summary: Readonly<{ state: 'fresh' | 'stale' | 'unknown' | 'empty'; critical: number | null; high: number | null; medium: number | null; activeCount: number | null; pendingApprovalCount: number | null; creditRiskCount: number | null; sourceTimestamp: string | null; cardMetadata: Readonly<{ critical: z.infer<typeof riskCardMetadataSchema>; activeCustomers: z.infer<typeof riskCardMetadataSchema>; pendingApprovals: z.infer<typeof riskCardMetadataSchema>; creditRisk: z.infer<typeof riskCardMetadataSchema>; overall: z.infer<typeof riskCardMetadataSchema> }> }>
}>
