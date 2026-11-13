import { describe, expect, it, vi } from 'vitest'
import { configureBookingDestination, type BookingConfigurationRepository, type BookingConfigurationVersion } from './booking-configuration'

const input = {
  workspaceId: 'workspace-a', actorId: 'owner-a', datasetMode: 'TEST' as const,
  commandId: 'command-a', expectedRevision: 0, confirmed: true,
  bookingUrl: 'https://booking.example.com/shop-a', bookingExpiresAt: null,
}
const now = new Date('2026-10-22T00:00:00Z')
function repository() {
  const rows: BookingConfigurationVersion[] = []
  const repo: BookingConfigurationRepository = {
    findCommand: vi.fn(async (workspaceId, mode, commandId) => rows.find(row => row.workspaceId === workspaceId && row.datasetMode === mode && row.commandId === commandId) ?? null),
    latest: vi.fn(async (workspaceId, mode) => rows.filter(row => row.workspaceId === workspaceId && row.datasetMode === mode).sort((a, b) => b.revision - a.revision)[0] ?? null),
    append: vi.fn(async (row) => {
      if (rows.some(r => r.workspaceId === row.workspaceId && r.datasetMode === row.datasetMode && (r.commandId === row.commandId || r.revision === row.revision))) return 'CONFLICT' as const
      rows.push(row)
      return 'INSERTED' as const
    }),
  }
  return { rows, repo }
}

describe('versioned owner booking destination command', () => {
  it('records an owner confirmation and independently reads its immutable version', async () => {
    const { rows, repo } = repository()
    const result = await configureBookingDestination(input, repo, now)
    expect(result.revision).toBe(1)
    expect(result.bookingUrl).toBe(input.bookingUrl)
    expect(result.confirmedAt).toBe(now.toISOString())
    expect(result.datasetMode).toBe('TEST')
    expect(rows).toHaveLength(1)
    expect(repo.findCommand).toHaveBeenCalledTimes(2)
  })

  it('settles retries with the same command to one version and rejects changed command contents', async () => {
    const { rows, repo } = repository()
    const first = await configureBookingDestination(input, repo, now)
    expect(await configureBookingDestination(input, repo, new Date('2026-10-22T00:01:00Z'))).toEqual(first)
    expect(rows).toHaveLength(1)
    await expect(configureBookingDestination({ ...input, bookingUrl: 'https://booking.example.com/shop-b' }, repo, now)).rejects.toMatchObject({ status: 409 })
    expect(rows).toHaveLength(1)
  })

  it('requires explicit confirmation and does not append unsafe URLs', async () => {
    const { repo } = repository()
    await expect(configureBookingDestination({ ...input, confirmed: false }, repo, now)).rejects.toMatchObject({ status: 422 })
    await expect(configureBookingDestination({ ...input, bookingUrl: 'https://owner:secret@booking.example.com/a' }, repo, now)).rejects.toMatchObject({ status: 422 })
    expect(repo.append).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer version or silently accept two competing edits', async () => {
    const { rows, repo } = repository()
    const attempts = await Promise.allSettled([
      configureBookingDestination(input, repo, now),
      configureBookingDestination({ ...input, commandId: 'command-b', bookingUrl: 'https://booking.example.com/shop-b' }, repo, now),
    ])
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(rows).toHaveLength(1)
    await expect(configureBookingDestination({ ...input, commandId: 'command-c' }, repo, now)).rejects.toMatchObject({ status: 409 })
  })

  it('does not claim a save if its database readback is absent', async () => {
    const { repo } = repository()
    vi.mocked(repo.append).mockResolvedValue('INSERTED')
    await expect(configureBookingDestination(input, repo, now)).rejects.toMatchObject({ status: 503 })
  })

  it('checks workspace and dataset on a returned command, even if the repository is faulty', async () => {
    const { rows, repo } = repository()
    await configureBookingDestination(input, repo, now)
    vi.mocked(repo.findCommand).mockResolvedValue({ ...rows[0], workspaceId: 'workspace-b' })
    await expect(configureBookingDestination(input, repo, now)).rejects.toMatchObject({ status: 503 })
  })
})
