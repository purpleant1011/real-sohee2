import { describe, expect, it, vi } from 'vitest'
import { getOperationalSettings, type SettingsGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

function gateway(overrides: Partial<SettingsGateway> = {}): SettingsGateway {
  return {
    getCurrentUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
    getBusiness: vi.fn(async () => ({
      data: {
        workspace_id: workspaceId,
        business_name: '소희 카페',
        industry: '카페',
        location: '서울',
        summary: '매일 직접 굽는 디저트를 소개합니다.',
      },
      error: null,
    })),
    getBrand: vi.fn(async () => ({
      data: {
        workspace_id: workspaceId,
        voice: '친절하고 간결하게',
        keywords: ['제철', '수제'],
        prohibited_terms: ['무조건'],
      },
      error: null,
    })),
    listChannels: vi.fn(async () => ({
      data: [{
        workspace_id: workspaceId,
        channel: 'instagram',
        status: 'connected',
        account_label: '@sohee.cafe',
        token_expires_at: '2026-10-12T04:00:00.000Z',
        webhook_status: 'healthy',
        last_webhook_at: '2026-08-13T04:00:00.000Z',
        last_error_code: null,
      }],
      error: null,
    })),
    listMembers: vi.fn(async () => ({
      data: [
        { workspace_id: workspaceId, user_id: userId, role: 'owner', status: 'active' },
        {
          workspace_id: workspaceId,
          user_id: '10000000-0000-4000-8000-000000000002',
          role: 'reviewer',
          status: 'invited',
        },
      ],
      error: null,
    })),
    ...overrides,
  }
}

describe('getOperationalSettings', () => {
  it('loads workspace-scoped business, brand, channel, and member settings in parallel', async () => {
    const result = await getOperationalSettings(workspaceId, 'owner', gateway())

    expect(result).toEqual({
      data: {
        business: {
          businessName: '소희 카페',
          industry: '카페',
          location: '서울',
          summary: '매일 직접 굽는 디저트를 소개합니다.',
        },
        brand: {
          voice: '친절하고 간결하게',
          keywords: ['제철', '수제'],
          prohibitedTerms: ['무조건'],
        },
        channels: [
          { channel: 'instagram', status: 'connected', accountLabel: '@sohee.cafe', tokenExpiresAt: '2026-10-12T04:00:00.000Z', webhookStatus: 'healthy', lastWebhookAt: '2026-08-13T04:00:00.000Z', lastErrorCode: null },
          { channel: 'threads', status: 'disconnected', accountLabel: null, tokenExpiresAt: null, webhookStatus: 'pending', lastWebhookAt: null, lastErrorCode: null },
          { channel: 'naver_blog', status: 'disconnected', accountLabel: null, tokenExpiresAt: null, webhookStatus: 'pending', lastWebhookAt: null, lastErrorCode: null },
          { channel: 'naver_place', status: 'disconnected', accountLabel: null, tokenExpiresAt: null, webhookStatus: 'pending', lastWebhookAt: null, lastErrorCode: null },
        ],
        members: [
          { memberId: userId, label: '나', role: 'owner', status: 'active', current: true },
          {
            memberId: '10000000-0000-4000-8000-000000000002',
            label: '멤버 2',
            role: 'reviewer',
            status: 'invited',
            current: false,
          },
        ],
        permissions: { canEditProfiles: true, canEditMembers: true },
      },
    })
  })

  it('rejects a row from another workspace rather than rendering leaked settings', async () => {
    const result = await getOperationalSettings(workspaceId, 'viewer', gateway({
      getBusiness: vi.fn(async () => ({
        data: {
          workspace_id: '20000000-0000-4000-8000-000000000099',
          business_name: '다른 회사',
          industry: null,
          location: null,
          summary: null,
        },
        error: null,
      })),
    }))

    expect(result).toEqual({ error: { message: '운영 설정을 불러오지 못했어요.' } })
  })

  it('reports profile edit permission without granting member administration to managers', async () => {
    const result = await getOperationalSettings(workspaceId, 'manager', gateway())

    expect(result).toMatchObject({
      data: { permissions: { canEditProfiles: true, canEditMembers: false } },
    })
  })
})
