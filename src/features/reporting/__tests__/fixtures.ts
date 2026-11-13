import { WeeklyCeoReportService } from '../weekly-ceo-report-service'

/** Test-only successful empty source reads, not a production fallback. */
export function emptyObservedReport(workspaceId: string) {
  const client = { from(table: string) {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'lt', 'order', 'range', 'maybeSingle']) query[method] = () => query
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
      data: table === 'workspace_registry' ? { workspace_id: workspaceId, dataset_mode: 'ACTUAL' }
        : table === 'channel_connections' ? [{ workspace_id: workspaceId, id: 'connection-fixture', channel: 'instagram', status: 'connected' }] : [],
      error: null,
    }))
    return query
  } }
  return new WeeklyCeoReportService(client as never).generateReport(workspaceId, new Date('2026-10-16T00:00:00Z'))
}
