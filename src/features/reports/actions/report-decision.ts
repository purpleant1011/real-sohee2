'use server'

import { z } from 'zod'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import type {
  ReportDecisionInput,
  ReportDecisionRepository,
  ReportExperimentInput,
} from '../report-decision-repository'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const changedVariable = z.enum(['opening', 'format', 'cta', 'timing', 'other'])
const decisionSchema = z.object({
  workspaceId: uuid,
  insightKey: z.string().min(1).max(240),
  periodStart: timestamp,
  periodEnd: timestamp,
  observedFacts: z.array(z.string().min(1).max(500)).min(1).max(8),
  hypothesis: z.string().min(1).max(1000),
  changeVariable: changedVariable,
  invariants: z.array(z.string().min(1).max(160)).min(1).max(8),
  customerSignalIds: z.array(uuid).max(20),
  ownerNote: z.string().max(1000).nullable().optional(),
  evidenceVersionIds: z.array(uuid).min(1).max(20),
}).strict().refine((value) => new Date(value.periodEnd) >= new Date(value.periodStart))

const experimentSchema = z.object({
  workspaceId: uuid,
  decisionId: uuid,
  hypothesis: z.string().min(1).max(1000),
  changeVariable: changedVariable,
  invariantKeys: z.array(z.string().min(1).max(160)).min(1).max(8),
  variantAContentVersionId: uuid,
  variantBContentVersionId: uuid,
  variantAScheduledAt: timestamp,
  variantBScheduledAt: timestamp,
  primaryMetric: z.string().min(1).max(80),
  secondaryMetrics: z.array(z.string().min(1).max(80)).max(8),
  guardrailMetrics: z.array(z.string().min(1).max(80)).max(8),
  reviewAt: timestamp,
}).strict().superRefine((value, context) => {
  if (value.variantAContentVersionId === value.variantBContentVersionId) {
    context.addIssue({ code: 'custom', path: ['variantBContentVersionId'], message: 'EXACT_VERSIONS_MUST_DIFFER' })
  }
  if (value.variantAScheduledAt === value.variantBScheduledAt) {
    context.addIssue({ code: 'custom', path: ['variantBScheduledAt'], message: 'SCHEDULES_MUST_DIFFER' })
  }
  if (new Date(value.reviewAt) <= new Date(Math.max(
    new Date(value.variantAScheduledAt).getTime(),
    new Date(value.variantBScheduledAt).getTime(),
  ))) {
    context.addIssue({ code: 'custom', path: ['reviewAt'], message: 'REVIEW_MUST_FOLLOW_VARIANTS' })
  }
})

type Dependencies = Readonly<{
  workspace: typeof getCurrentWorkspaceContext
  repository: Pick<ReportDecisionRepository, 'createReportDecision' | 'createReportExperiment'>
}>

async function dependencies(provided?: Dependencies) {
  if (provided) return provided
  const { createProductionReportDecisionRepository } = await import('../report-decision-repository')
  return {
    workspace: getCurrentWorkspaceContext,
    repository: await createProductionReportDecisionRepository(),
  }
}

export async function startReportConversationAction(value: unknown, provided?: Dependencies) {
  const parsed = decisionSchema.safeParse(value)
  if (!parsed.success) return { ok: false as const, code: 'REPORT_DECISION_INVALID' as const }
  const deps = await dependencies(provided)
  const workspace = await deps.workspace()
  if (!workspace || workspace.workspaceId !== parsed.data.workspaceId || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return { ok: false as const, code: 'REPORT_DECISION_FORBIDDEN' as const }
  }
  const result = await deps.repository.createReportDecision(parsed.data as ReportDecisionInput)
  if (!result.ok) return result
  return { ok: true as const, decisionId: result.decisionId, next: `/app?reportDecision=${result.decisionId}` }
}

export async function createReportExperimentAction(value: unknown, provided?: Dependencies) {
  const parsed = experimentSchema.safeParse(value)
  if (!parsed.success) return { ok: false as const, code: 'REPORT_EXPERIMENT_INVALID' as const }
  const deps = await dependencies(provided)
  const workspace = await deps.workspace()
  if (!workspace || workspace.workspaceId !== parsed.data.workspaceId || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return { ok: false as const, code: 'REPORT_EXPERIMENT_FORBIDDEN' as const }
  }
  const result = await deps.repository.createReportExperiment(parsed.data as ReportExperimentInput)
  if (!result.ok) return result
  return { ok: true as const, experimentId: result.experimentId, next: `/app/schedule?experiment=${result.experimentId}` }
}
