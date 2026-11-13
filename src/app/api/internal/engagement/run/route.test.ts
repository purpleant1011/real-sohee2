import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import * as ingestModule from '@/features/engagement/ingest'
import * as ensureWebhookModule from '@/features/channels/oauth/ensure-webhook-subscription'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/security/channel-credential-crypto', () => ({
  decryptChannelCredential: vi.fn().mockResolvedValue('decrypted-token-abc'),
}))

vi.mock('@/features/engagement/compose', () => ({
  createEngagementService: vi.fn().mockReturnValue({
    repo: {},
    runCycle: vi.fn().mockResolvedValue({
      classifiedCount: 1,
      draftedCount: 1,
      autoSentCount: 0,
      skippedCount: 0,
    }),
  }),
}))

describe('POST /api/internal/engagement/run', () => {
  const secret = 'valid-test-cron-secret-32-chars-long'
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = secret
    process.env.ENGAGEMENT_CYCLE_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = workspaceId
  })

  it('rejects requests with invalid authorization header (404)', async () => {
    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('skips processing if ENGAGEMENT_CYCLE_ENABLED is not 1', async () => {
    process.env.ENGAGEMENT_CYCLE_ENABLED = '0'
    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.skipped).toBe(true)
    expect(json.workspacesProcessed).toBe(0)
  })

  it('calls ingestChannelComments when Instagram connection has instagram_business_manage_comments scope', async () => {
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-1',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).toHaveBeenCalledTimes(1)
    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        channelConnectionId: 'conn-ig-1',
        channel: 'instagram',
        accessToken: 'decrypted-token-abc',
        accountId: '17841441250302004',
        maxCommentAgeDays: 7,
      })
    )
  })

  it('skips ingestChannelComments when Instagram connection lacks instagram_business_manage_comments scope', async () => {
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 0,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-basic-only',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_content_publish',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).not.toHaveBeenCalled()
  })

  it('queries lowercase channels and logs structured [engagement-run] line with stage counts via console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 2,
      comments: [] as any,
    })

    const queriedChannels: string[][] = []
    const queriedStatuses: string[][] = []

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockImplementation((_col: string, channelVals: string[]) => {
                queriedChannels.push(channelVals)
                return {
                  in: vi.fn().mockImplementation((_statusCol: string, statusVals: string[]) => {
                    queriedStatuses.push(statusVals)
                    return Promise.resolve({
                      data: [
                        {
                          id: 'conn-ig-valid',
                          workspace_id: workspaceId,
                          channel: 'instagram',
                          status: 'connected',
                          external_account_id: '17841441250302004',
                        },
                      ],
                      error: null,
                    })
                  }),
                }
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).toHaveBeenCalledTimes(1)
    const json = await res.json()

    // Verified: queried channels reverted to lowercase only
    expect(queriedChannels[0]).toEqual(['instagram', 'threads'])
    expect(queriedStatuses[0]).toEqual(['connected', 'verified', 'authorized'])

    // Stage counts in response body
    expect(json).toMatchObject({
      workspacesProcessed: 1,
      connectionsFound: 1,
      afterAllowlist: 1,
      workspaces: 1,
      perConnection: [
        {
          channel: 'instagram',
          hasCredential: true,
          hasCommentScope: true,
          scopesCount: expect.any(Number),
          ingested: 2,
          skippedReason: null,
        },
      ],
    })

    // ONE structured line per run logged via console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      '[engagement-run]',
      expect.stringContaining('"connectionsFound":1')
    )
    const runLogCall = warnSpy.mock.calls.find((call) => call[0] === '[engagement-run]')
    expect(runLogCall).toBeDefined()
    const parsedLog = JSON.parse(runLogCall![1] as string)
    expect(parsedLog).toMatchObject({
      connectionsFound: 1,
      afterAllowlist: 1,
      workspaces: 1,
      perConnection: [
        {
          channel: 'instagram',
          hasCredential: true,
          hasCommentScope: true,
          scopesCount: expect.any(Number),
          ingested: 2,
          skippedReason: null,
        },
      ],
    })

    warnSpy.mockRestore()
  })

  it('logs empty stats via console.warn when no connections are found', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      '[engagement-run]',
      expect.stringContaining('"connectionsFound":0')
    )
    warnSpy.mockRestore()
  })

  it('records skippedReason: no_credential when credential row is absent', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-no-cred',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.perConnection).toEqual([
      expect.objectContaining({
        channel: 'instagram',
        hasCredential: false,
        hasCommentScope: false,
        scopesCount: 0,
        ingested: 0,
        skippedReason: 'no_credential',
      }),
    ])
    infoSpy.mockRestore()
  })

  it('records skippedReason: missing_comment_scope when comments scope is absent', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-missing-scope',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: ['instagram_business_basic'],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.perConnection).toEqual([
      expect.objectContaining({
        channel: 'instagram',
        hasCredential: true,
        hasCommentScope: false,
        scopesCount: expect.any(Number),
        ingested: 0,
        skippedReason: 'missing_comment_scope',
      }),
    ])
    infoSpy.mockRestore()
  })

  it('calls ensureInstagramWebhookSubscription before ingestChannelComments for Instagram connection', async () => {
    const ensureSpy = vi.spyOn(ensureWebhookModule, 'ensureInstagramWebhookSubscription').mockResolvedValue({
      attempted: true,
      ok: true,
    })
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-ensure',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      webhook_status: 'pending',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ensureSpy).toHaveBeenCalledTimes(1)
    expect(ensureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({
          id: 'conn-ig-ensure',
          channel: 'instagram',
          webhook_status: 'pending',
        }),
        accessToken: 'decrypted-token-abc',
        igUserId: '17841441250302004',
      })
    )
    expect(ingestSpy).toHaveBeenCalledTimes(1)
  })

  it('continues ingestion even if ensureInstagramWebhookSubscription throws an error', async () => {
    const ensureSpy = vi.spyOn(ensureWebhookModule, 'ensureInstagramWebhookSubscription').mockRejectedValue(
      new Error('Webhook subscription failed fatally')
    )
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-err-flow',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      webhook_status: 'pending',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).toHaveBeenCalledTimes(1)
    ensureSpy.mockRestore()
  })

  it('passes accountHandle and accountUsername from account_label to ingestChannelComments', async () => {
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-handle',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      account_label: '@sohee.ai',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '17841441250302004',
        accountHandle: '@sohee.ai',
        accountUsername: '@sohee.ai',
      })
    )
  })

  it('passes undefined for accountHandle/accountUsername when account_label is empty or null', async () => {
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-no-handle',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      account_label: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '17841441250302004',
        accountHandle: undefined,
        accountUsername: undefined,
      })
    )
  })

  it('passes profile_metadata.username as accountUsername when account_label is empty', async () => {
    const ingestSpy = vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-metadata',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      account_label: null,
                      profile_metadata: { username: 'sohee_from_profile' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '17841441250302004',
        accountHandle: undefined,
        accountUsername: 'sohee_from_profile',
      })
    )
  })

  it('does not leak account_label or handle in [engagement-run] logs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(ingestModule, 'ingestChannelComments').mockResolvedValue({
      ingestedCount: 1,
      comments: [] as any,
    })

    const sensitiveHandle = 'sohee.ai.secret'
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-sensitive',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      account_label: `@${sensitiveHandle}`,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const engagementRunLogs = warnSpy.mock.calls.filter((call) => call[0] === '[engagement-run]')
    expect(engagementRunLogs.length).toBeGreaterThan(0)
    for (const logCall of engagementRunLogs) {
      const logBody = typeof logCall[1] === 'string' ? logCall[1] : JSON.stringify(logCall[1])
      expect(logBody).not.toContain(sensitiveHandle)
      expect(logBody).not.toContain(`@${sensitiveHandle}`)
    }

    warnSpy.mockRestore()
  })

  it('integration: skips self-comments matching account_label handle and ingests only others', async () => {
    // Restore ingestChannelComments to test real integration
    vi.spyOn(ingestModule, 'ingestChannelComments').mockRestore()

    const upsertedComments: any[] = []
    const { createEngagementService } = await import('@/features/engagement/compose')
    vi.mocked(createEngagementService).mockReturnValue({
      repo: {
        upsertComment: vi.fn().mockImplementation((comment: any) => {
          upsertedComments.push(comment)
          return Promise.resolve({ ...comment, id: `db-${upsertedComments.length}` })
        }),
      } as any,
      runCycle: vi.fn().mockResolvedValue({
        classifiedCount: 0,
        draftedCount: 0,
        autoSentCount: 0,
        skippedCount: 0,
      }),
    } as any)

    const recentDate = new Date(Date.now() - 60000).toISOString()
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation((url: any) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ id: 'media-1', caption: '게시물', timestamp: recentDate }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      }
      if (urlStr.includes('/media-1/comments')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'comment-self',
                  text: '본인이 남긴 답글입니다 @sohee.ai',
                  timestamp: recentDate,
                  username: 'sohee.ai',
                  from: { id: 'different-writer-id-999', username: 'sohee.ai' },
                },
                {
                  id: 'comment-customer',
                  text: '방문하고 싶어요!',
                  timestamp: recentDate,
                  username: 'happy_customer',
                  from: { id: 'customer-user-123', username: 'happy_customer' },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'conn-ig-self-filter',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'connected',
                      external_account_id: '17841441250302004',
                      account_label: '@sohee.ai',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'meta_channel_credentials') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        encrypted_access_token: 'enc',
                        access_token_iv: 'iv',
                        encryption_algorithm: 'AES-GCM-256',
                        granted_scopes: [
                          'instagram_business_basic',
                          'instagram_business_manage_comments',
                        ],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any)

    try {
      const req = new Request('https://example.com/api/internal/engagement/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const json = await res.json()

      // Only the customer comment was ingested; self comment was skipped
      expect(json.perConnection[0].ingested).toBe(1)
      expect(upsertedComments).toHaveLength(1)
      expect(upsertedComments[0].provider_comment_id).toBe('comment-customer')
      expect(upsertedComments[0].author_handle).toBe('happy_customer')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
