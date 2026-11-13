import { z } from 'zod'

export const autonomyLevelEnum = z.enum(['L1_MANUAL', 'L2_ASSISTED', 'L3_AUTONOMOUS'])
export type OperatorAutonomyLevel = z.infer<typeof autonomyLevelEnum>

export const autonomyDistributionSchema = z.object({
  l1Manual: z.number().int().nonnegative(),
  l2Assisted: z.number().int().nonnegative(),
  l3Autonomous: z.number().int().nonnegative(),
  totalConfigured: z.number().int().nonnegative(),
  pausedCount: z.number().int().nonnegative(),
}).strict()
export type AutonomyDistribution = z.infer<typeof autonomyDistributionSchema>

export const expiringDmUrgencyEnum = z.enum(['CRITICAL', 'WARNING', 'SAFE', 'EXPIRED'])
export type ExpiringDmUrgency = z.infer<typeof expiringDmUrgencyEnum>

export const expiringDmThreadSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable().default('알 수 없는 매장'),
  customerHandle: z.string(),
  lastMessageText: z.string(),
  lastMessageAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  remainingMinutes: z.number().int(),
  status: z.string(),
  urgency: expiringDmUrgencyEnum,
}).strict()
export type ExpiringDmThread = z.infer<typeof expiringDmThreadSchema>

export const autoReplyStatsSchema = z.object({
  windowHours: z.number().int().positive(),
  totalAttempts: z.number().int().nonnegative(),
  successfulReplies: z.number().int().nonnegative(),
  failedReplies: z.number().int().nonnegative(),
  successRatePercent: z.number().min(0).max(100).nullable(),
}).strict()
export type AutoReplyStats = z.infer<typeof autoReplyStatsSchema>

export const recentAuditLogItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable().default('알 수 없는 매장'),
  channel: z.string(),
  action: z.string(),
  actor: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict()
export type RecentAuditLogItem = z.infer<typeof recentAuditLogItemSchema>

export const operatorEngagementOverviewSchema = z.object({
  autonomy: autonomyDistributionSchema,
  expiringDms: z.array(expiringDmThreadSchema),
  expiringCriticalCount: z.number().int().nonnegative(),
  stats24h: autoReplyStatsSchema,
  recentAudits: z.array(recentAuditLogItemSchema),
  asOf: z.string().datetime({ offset: true }),
}).strict()
export type OperatorEngagementOverview = z.infer<typeof operatorEngagementOverviewSchema>

export const engagementKillSwitchRequestSchema = z.object({
  scope: z.enum(['all', 'workspace']),
  workspaceId: z.string().uuid().optional(),
  action: z.enum(['downgrade_to_l1', 'pause']),
  reason: z.string().min(2, '사유를 2자 이상 입력해 주세요.').max(500, '사유는 최대 500자까지 가능합니다.'),
}).strict().refine((data) => {
  if (data.scope === 'workspace') {
    return Boolean(data.workspaceId)
  }
  return true
}, {
  message: '특정 매장 차단 시 매장 ID(workspaceId)가 필요합니다.',
  path: ['workspaceId'],
})
export type EngagementKillSwitchRequest = z.infer<typeof engagementKillSwitchRequestSchema>

export const engagementKillSwitchResultSchema = z.object({
  success: z.boolean(),
  scope: z.enum(['all', 'workspace']),
  action: z.enum(['downgrade_to_l1', 'pause']),
  affectedWorkspaces: z.number().int().nonnegative(),
  updatedPolicies: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
}).strict()
export type EngagementKillSwitchResult = z.infer<typeof engagementKillSwitchResultSchema>
