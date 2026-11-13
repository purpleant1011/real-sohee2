import { describe, expect, it, vi } from 'vitest'
import { recordManualHandoff, readManualHandoff, type ManualHandoffRepository } from './manual-handoff'

const input = { workspaceId: 'workspace-a', actorId: 'owner-a', contentId: 'content-a', versionId: 'version-a', channel: 'threads' as const, confirmed: true }
function repository() {
  const events = new Map<string, any>()
  const repo: ManualHandoffRepository = {
    loadApprovedVersion: vi.fn(async () => ({ itemId: 'item-a', versionId: input.versionId, fingerprint: 'approved-v1' })),
    readEvent: vi.fn(async (_workspaceId, id) => events.get(id) ?? null),
    putEvent: vi.fn(async (event) => { if (!events.has(event.id)) events.set(event.id, { ...event, occurredAt: '2026-10-21T00:00:00Z' }) }),
  }
  return { repo, events }
}

describe('owner-reported manual handoff ledger', () => {
  it('requires an explicit owner confirmation and an approved persisted version', async () => {
    const { repo } = repository()
    await expect(recordManualHandoff({ ...input, confirmed: false }, repo)).rejects.toMatchObject({ status: 422 })
    expect(repo.putEvent).not.toHaveBeenCalled()
    vi.mocked(repo.loadApprovedVersion).mockResolvedValue(null)
    await expect(recordManualHandoff(input, repo)).rejects.toMatchObject({ status: 409 })
    expect(repo.putEvent).not.toHaveBeenCalled()
  })

  it('persists a stable idempotent owner report, never a verified provider publication', async () => {
    const { repo, events } = repository()
    const first = await recordManualHandoff(input, repo)
    const repeated = await recordManualHandoff(input, repo)
    expect(events.size).toBe(1)
    expect(first).toEqual(repeated)
    expect(first.state).toBe('MANUAL_DELIVERED')
    expect(first.providerVerified).toBe(false)
    expect(first.source).toBe('OWNER_REPORTED')
    expect(first.label).toBe('수동 전달 완료 · 게시 미확인')
    expect(await readManualHandoff(input, repo)).toEqual(first)
  })

  it('does not turn a write without independent database readback into a completed report', async () => {
    const { repo } = repository()
    vi.mocked(repo.putEvent).mockResolvedValue(undefined)
    await expect(recordManualHandoff(input, repo)).rejects.toMatchObject({ status: 503 })
  })

  it('does not return another workspace or version event', async () => {
    const { repo } = repository()
    vi.mocked(repo.readEvent).mockResolvedValue({ id: 'other', workspaceId: 'workspace-b', itemId: 'item-a', versionId: 'version-b', fingerprint: 'other', actorId: 'other', occurredAt: '2026-10-21T00:00:00Z' })
    await expect(readManualHandoff(input, repo)).rejects.toMatchObject({ status: 503 })
  })

  it('distinguishes no record from a read error', async () => {
    const { repo } = repository()
    expect(await readManualHandoff(input, repo)).toMatchObject({ state: 'NOT_RECORDED', providerVerified: false, recordedAt: null })
    vi.mocked(repo.readEvent).mockRejectedValue(new Error('database unavailable'))
    await expect(readManualHandoff(input, repo)).rejects.toThrow('database unavailable')
  })
})
