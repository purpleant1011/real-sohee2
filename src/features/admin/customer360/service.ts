import 'server-only'
import crypto from 'node:crypto'
import { UnifiedMissionAuditWriter } from '@/features/observability/unified-mission-audit-writer'
import { buildCustomer360Timeline } from './timeline'
import type { Customer360Timeline, DbRead } from './types'

/** Read-only view. The admin view itself is recorded in the existing audit_events trail (reusing UnifiedMissionAuditWriter). */
export async function readCustomer360(
  db: DbRead & { from(table: string): any },
  input: { workspaceId: string; operatorId: string; traceId?: string },
): Promise<Customer360Timeline> {
  const timeline = await buildCustomer360Timeline(db, input.workspaceId)
  await new UnifiedMissionAuditWriter(db as never).writeAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'operator',
    actorId: input.operatorId,
    eventType: 'admin.customer360.viewed',
    entityType: 'workspace',
    entityId: input.workspaceId,
    traceId: input.traceId ?? crypto.randomUUID(),
    result: 'SUCCESS',
    details: { eventCount: timeline.events.length, sourceErrors: timeline.sources.filter(s => s.status === 'error').map(s => s.source) },
  })
  return timeline
}
