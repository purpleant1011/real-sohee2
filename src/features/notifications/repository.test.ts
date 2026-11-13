import { describe, expect, it, vi } from 'vitest'
import { getNotificationCenter, type NotificationGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

describe('getNotificationCenter', () => {
  it('returns safe workspace-scoped notifications and default preferences', async () => {
    const gateway: NotificationGateway = {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      getPreferences: vi.fn(async () => ({ data: null, error: null })),
      listNotifications: vi.fn(async () => ({ data: [{
        id: '90000000-0000-4000-8000-000000000001',
        workspace_id: workspaceId,
        user_id: userId,
        kind: 'publish',
        body: '게시 access_token=unsafe',
        href: '/app/schedule',
        read_at: null,
        created_at: '2026-08-09T05:00:00.000Z',
      }], error: null })),
    }

    await expect(getNotificationCenter(workspaceId, gateway)).resolves.toEqual({
      data: {
        userId,
        preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true },
        notifications: [{
          id: '90000000-0000-4000-8000-000000000001',
          kind: 'publish',
          body: '게시 처리 상태를 확인해 주세요.',
          href: '/app/schedule',
          readAt: null,
          createdAt: '2026-08-09T05:00:00.000Z',
        }],
      },
    })
  })

  it('does not promote a legacy publish notification body to verified publication', async () => {
    const gateway: NotificationGateway = {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      getPreferences: async () => ({ data: null, error: null }),
      listNotifications: async () => ({ data: [{
        id: '90000000-0000-4000-8000-000000000001',
        workspace_id: workspaceId, user_id: userId, kind: 'publish',
        body: '승인된 콘텐츠가 채널에 게시되었습니다.',
        href: '/app/work/30000000-0000-4000-8000-000000000001',
        read_at: null, created_at: '2026-11-02T10:00:00.000Z',
      }], error: null }),
    }
    const result = await getNotificationCenter(workspaceId, gateway)
    expect(result.data?.notifications[0]).toMatchObject({
      body: '게시 처리 상태를 확인해 주세요.',
      href: '/app/work/30000000-0000-4000-8000-000000000001',
    })
  })

  it('rejects another user or external href instead of leaking it', async () => {
    const gateway: NotificationGateway = {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      getPreferences: vi.fn(async () => ({ data: null, error: null })),
      listNotifications: vi.fn(async () => ({ data: [{
        id: '90000000-0000-4000-8000-000000000001',
        workspace_id: workspaceId,
        user_id: '10000000-0000-4000-8000-000000000099',
        kind: 'system', body: '확인', href: 'https://outside.test', read_at: null,
        created_at: '2026-08-09T05:00:00.000Z',
      }], error: null })),
    }
    await expect(getNotificationCenter(workspaceId, gateway)).resolves.toMatchObject({
      error: { requestId: 'notification-center' },
    })
  })
})
