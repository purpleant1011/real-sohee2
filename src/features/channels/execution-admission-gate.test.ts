import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionAdmissionGate } from './execution-admission-gate'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

import { createServerSupabaseClient } from '@/lib/supabase/server'

describe('ExecutionAdmissionGate live rollout allowlist', () => {
  const allowedWorkspace = '00000000-0000-4000-8000-0000000000a1'
  const blockedWorkspace = '11111111-2222-3333-4444-555555555555'
  const origEnv = process.env.META_LIVE_WORKSPACE_ALLOWLIST

  beforeEach(() => {
    delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { status: 'connected', webhook_status: 'healthy', last_webhook_at: new Date().toISOString() },
            error: null,
          }),
        }),
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as never)
  })

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origEnv
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
    vi.clearAllMocks()
  })

  it('blocks Meta writes when allowlist is unset (fail closed)', async () => {
    const actions = ['feed_publish', 'comment_reply', 'dm_reply'] as const
    for (const actionKind of actions) {
      const res = await ExecutionAdmissionGate.evaluate({
        workspaceId: allowedWorkspace,
        channel: 'instagram',
        actionKind,
      })
      expect(res.admitted).toBe(false)
      expect(res.status).toBe('BLOCKED')
      expect(res.reasonCode).toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
      expect(res.message).toBe('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
    }

    const threadsRes = await ExecutionAdmissionGate.evaluate({
      workspaceId: allowedWorkspace,
      channel: 'threads',
      actionKind: 'thread_publish',
    })
    expect(threadsRes.admitted).toBe(false)
    expect(threadsRes.reasonCode).toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
  })

  it('allows Meta write when workspace is explicitly in allowlist', async () => {
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = allowedWorkspace

    const res = await ExecutionAdmissionGate.evaluate({
      workspaceId: allowedWorkspace,
      channel: 'instagram',
      actionKind: 'feed_publish',
    })
    // It passes the allowlist check (reasonCode is not WORKSPACE_NOT_IN_LIVE_ROLLOUT)
    expect(res.reasonCode).not.toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')

    const blockedRes = await ExecutionAdmissionGate.evaluate({
      workspaceId: blockedWorkspace,
      channel: 'instagram',
      actionKind: 'feed_publish',
    })
    expect(blockedRes.admitted).toBe(false)
    expect(blockedRes.reasonCode).toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
  })

  it('allows all workspaces when allowlist is "*"', async () => {
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'

    const res = await ExecutionAdmissionGate.evaluate({
      workspaceId: blockedWorkspace,
      channel: 'threads',
      actionKind: 'thread_publish',
    })
    expect(res.reasonCode).not.toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
  })
})
