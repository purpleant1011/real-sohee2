import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { buildVaultMonitor, parseStaleAfterDays } from '@/features/admin/vault-monitor/monitor'
import { SupabaseVaultMonitorRepository } from '@/features/admin/vault-monitor/repository'
import { VaultMonitorView } from '@/features/admin/vault-monitor/vault-monitor-view'

export const dynamic = 'force-dynamic'

export default async function AdminVaultMonitorPage() {
  // Fingerprints and action IDs are exposed here, so require the audit permission across all workspaces.
  const operator = await requireOperator('audit.read')
  const repository = new SupabaseVaultMonitorRepository(createAdminSupabaseClient() as never)
  const result = await buildVaultMonitor({
    repository,
    actorId: operator.userId,
    staleAfterDays: parseStaleAfterDays(process.env.VAULT_MONITOR_STALE_AFTER_DAYS),
  })
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <VaultMonitorView result={result} />
    </main>
  )
}
