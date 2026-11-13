import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidDatasetMode } from '@/lib/dataset/dataset-guard'
import type { BookingConfigurationRepository, BookingConfigurationVersion } from './booking-configuration'

const FIELDS = 'workspace_id,dataset_mode,revision,command_id,command_digest,booking_url,booking_expires_at,confirmed_at,confirmed_by'
function map(row: Record<string, any>): BookingConfigurationVersion {
  if (!isValidDatasetMode(row.dataset_mode) || !Number.isInteger(row.revision) || row.revision < 1 ||
      !row.workspace_id || !row.command_id || !row.command_digest || !Number.isFinite(Date.parse(row.confirmed_at))) throw new Error('CONVERSION_ROW_INVALID')
  return {
    workspaceId: row.workspace_id, datasetMode: row.dataset_mode, revision: row.revision,
    commandId: row.command_id, commandDigest: row.command_digest,
    bookingUrl: row.booking_url, bookingExpiresAt: row.booking_expires_at ? new Date(row.booking_expires_at).toISOString() : null,
    confirmedAt: new Date(row.confirmed_at).toISOString(), confirmedBy: row.confirmed_by,
  }
}

export function createBookingConfigurationRepository(admin: Pick<SupabaseClient, 'from'>): BookingConfigurationRepository {
  return {
    async findCommand(workspaceId, mode, commandId) {
      const { data, error } = await admin.from('workspace_conversion_versions').select(FIELDS)
        .eq('workspace_id', workspaceId).eq('dataset_mode', mode).eq('command_id', commandId).maybeSingle()
      if (error) throw new Error('CONVERSION_READ_FAILED')
      return data ? map(data) : null
    },
    async latest(workspaceId, mode) {
      const { data, error } = await admin.from('workspace_conversion_versions').select(FIELDS)
        .eq('workspace_id', workspaceId).eq('dataset_mode', mode)
        .order('revision', { ascending: false }).limit(1).maybeSingle()
      if (error) throw new Error('CONVERSION_READ_FAILED')
      return data ? map(data) : null
    },
    async append(row) {
      const { error } = await admin.from('workspace_conversion_versions').insert({
        workspace_id: row.workspaceId, dataset_mode: row.datasetMode, revision: row.revision,
        command_id: row.commandId, command_digest: row.commandDigest,
        booking_url: row.bookingUrl, booking_expires_at: row.bookingExpiresAt,
        confirmed_at: row.confirmedAt, confirmed_by: row.confirmedBy,
      })
      if (error?.code === '23505') return 'CONFLICT'
      if (error) throw new Error('CONVERSION_WRITE_FAILED')
      return 'INSERTED'
    },
  }
}
