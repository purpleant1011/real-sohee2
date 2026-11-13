import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(), getUser: vi.fn(), preferenceUpdate: vi.fn(), preferenceEq: vi.fn(),
  preferenceSelect: vi.fn(), preferenceMaybeSingle: vi.fn(), preferenceInsert: vi.fn(),
  update: vi.fn(), maybeSingle: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: mocks.workspace }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({
  auth: { getUser: mocks.getUser },
  from: vi.fn((table: string) => {
    if (table === 'notification_preferences') return {
      update: mocks.preferenceUpdate,
      insert: mocks.preferenceInsert,
    }
    const query = { update: mocks.update, eq: vi.fn(() => query), select: vi.fn(() => query), maybeSingle: mocks.maybeSingle }
    mocks.update.mockReturnValue(query)
    return query
  }),
})) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { markNotificationReadAction, saveNotificationPreferencesAction } from './manage-notifications'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const notificationId = '90000000-0000-4000-8000-000000000001'

describe('notification actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'owner' })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.preferenceMaybeSingle.mockResolvedValue({ data: { workspace_id: workspaceId }, error: null })
    mocks.preferenceSelect.mockReturnValue({ maybeSingle: mocks.preferenceMaybeSingle })
    mocks.preferenceEq.mockReturnValue({ eq: mocks.preferenceEq, select: mocks.preferenceSelect })
    mocks.preferenceUpdate.mockReturnValue({ eq: mocks.preferenceEq })
    mocks.preferenceInsert.mockResolvedValue({ error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { id: notificationId }, error: null })
  })

  it('updates only the current user preferences without updating identity columns', async () => {
    await expect(saveNotificationPreferencesAction({ approvalEvents: true, scheduleEvents: false, publishEvents: true })).resolves.toEqual({ data: { saved: true } })
    expect(mocks.preferenceUpdate).toHaveBeenCalledWith({ approval_events: true, schedule_events: false, publish_events: true })
    expect(mocks.preferenceEq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(mocks.preferenceEq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mocks.preferenceInsert).not.toHaveBeenCalled()
  })

  it('inserts preferences for the current user when no row exists', async () => {
    mocks.preferenceMaybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(saveNotificationPreferencesAction({ approvalEvents: false, scheduleEvents: true, publishEvents: false })).resolves.toEqual({ data: { saved: true } })
    expect(mocks.preferenceInsert).toHaveBeenCalledWith({
      workspace_id: workspaceId,
      user_id: 'user-1',
      approval_events: false,
      schedule_events: true,
      publish_events: false,
    })
  })

  it('marks only the current user notification as read', async () => {
    await expect(markNotificationReadAction({ notificationId })).resolves.toEqual({ data: { notificationId } })
    expect(mocks.update).toHaveBeenCalledWith({ read_at: expect.any(String) })
  })

  it('rejects a caller-supplied workspace identifier', async () => {
    await expect(saveNotificationPreferencesAction({ workspaceId, approvalEvents: true, scheduleEvents: true, publishEvents: true })).resolves.toMatchObject({ error: expect.any(Object) })
    expect(mocks.preferenceUpdate).not.toHaveBeenCalled()
  })
})
