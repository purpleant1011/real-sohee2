import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { SameTruthSnapshotService } from '@/lib/runtime-truth/same-truth-snapshot-service'

describe('Workspace-Scoped Tenant Isolation Contract (ANI-1030)', () => {
  const WORKSPACE_A = '11111111-1111-4111-8111-111111111111'
  const WORKSPACE_B = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    SameTruthSnapshotService.resetForTest()
  })

  afterEach(() => {
    SameTruthSnapshotService.resetForTest()
    vi.restoreAllMocks()
  })

  it('strictly filters conversation threads by workspace_id and never returns cross-tenant data', async () => {
    const mockDbData = [
      { id: 'thread-a1', workspace_id: WORKSPACE_A, title: 'Workspace A Thread', status: 'active' },
      { id: 'thread-a2', workspace_id: WORKSPACE_A, title: 'Workspace A Thread 2', status: 'active' },
      { id: 'thread-b1', workspace_id: WORKSPACE_B, title: 'Workspace B Thread (LEAK!)', status: 'active' },
    ]

    const selectMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockImplementation((col, val) => {
      if (col === 'workspace_id') {
        const filtered = mockDbData.filter(d => d.workspace_id === val)
        return {
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: filtered, error: null })
          })
        }
      }
      return { order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: selectMock,
        eq: eqMock,
      })
    }

    const serverModule = await import('@/lib/supabase/server')
    vi.spyOn(serverModule, 'createServerSupabaseClient').mockResolvedValue(mockSupabase as any)

    const threadsA = await ConversationRepository.getThreads(WORKSPACE_A)

    expect(threadsA.length).toBe(2)
    threadsA.forEach(t => {
      expect(t.workspaceId).toBe(WORKSPACE_A)
      expect(t.workspaceId).not.toBe(WORKSPACE_B)
    })
    expect(mockSupabase.from).toHaveBeenCalledWith('conversation_threads')
    expect(eqMock).toHaveBeenCalledWith('workspace_id', WORKSPACE_A)
  })

  it('strictly isolates runtime action runs by workspaceId in SameTruthSnapshotService', async () => {
    // Inject mock action runs for two distinct workspaces
    SameTruthSnapshotService.setActionRunsForTest(WORKSPACE_A, [
      {
        id: 'run-a1',
        workspace_id: WORKSPACE_A,
        status: 'RUNNING',
        channel: 'instagram',
        action_kind: 'feed_publish',
        created_at: new Date(Date.now() - 5000).toISOString(),
        updated_at: new Date().toISOString(),
      }
    ])

    SameTruthSnapshotService.setActionRunsForTest(WORKSPACE_B, [
      {
        id: 'run-b1',
        workspace_id: WORKSPACE_B,
        status: 'SUCCEEDED',
        channel: 'threads',
        action_kind: 'thread_publish',
        created_at: new Date(Date.now() - 10000).toISOString(),
        updated_at: new Date().toISOString(),
      }
    ])

    // Mock control plane service with actual_mode: 'RUNNING'
    const { AgentControlPlaneService } = await import('@/features/marketing-agent/engine/agent-control-state')
    vi.spyOn(AgentControlPlaneService, 'getControlState').mockImplementation((wsId: string) => {
      const state = {
        workspaceId: wsId,
        workspace_id: wsId,
        desiredMode: 'RUNNING',
        desired_mode: 'RUNNING',
        actualMode: 'RUNNING',
        actual_mode: 'RUNNING',
        statusReason: 'Testing',
        policyVersion: '1.0',
        budgetVersion: '1.0',
        pausedScopes: [],
        lastHeartbeatAt: new Date().toISOString(),
        workerVersion: '1.0',
        killSwitchActive: false,
        updatedBy: 'system',
        updatedAt: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        active_plan_id: null,
        active_action_run_count: 1,
        blocker_code: null,
        pause_reason: null,
        transition_id: 'trans-1',
        snapshot_version: 1,
        version: 1,
      } as any
      const promise = Promise.resolve(state)
      return Object.assign(promise, state) as any
    })

    const snapshotA = await SameTruthSnapshotService.getCanonicalSnapshot(WORKSPACE_A)
    expect(snapshotA.workspaceId).toBe(WORKSPACE_A)
    expect(snapshotA.activeActionRunCount).toBe(1) // 1 active in A

    const snapshotB = await SameTruthSnapshotService.getCanonicalSnapshot(WORKSPACE_B)
    expect(snapshotB.workspaceId).toBe(WORKSPACE_B)
    expect(snapshotB.activeActionRunCount).toBe(0) // 0 active in B (status is SUCCEEDED)
  })

  it('rejects cross-tenant getAgentRun queries when workspace_id does not match', async () => {
    const mockDbData = [
      { id: 'run-target', workspace_id: WORKSPACE_B, status: 'RUNNING', goal: 'Confidential B Goal' }
    ]

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col1, val1) => ({
            eq: vi.fn().mockImplementation((col2, val2) => {
              const matched = mockDbData.find(d => {
                const match1 = (d as any)[col1] === val1
                const match2 = (d as any)[col2] === val2
                return match1 && match2
              })
              return {
                single: vi.fn().mockResolvedValue({
                  data: matched || null,
                  error: matched ? null : { message: 'Row not found', code: 'PGRST116' }
                })
              }
            })
          }))
        })
      })
    }

    const serverModule = await import('@/lib/supabase/server')
    vi.spyOn(serverModule, 'createServerSupabaseClient').mockResolvedValue(mockSupabase as any)

    const result = await ConversationRepository.getAgentRun(WORKSPACE_A, 'run-target')
    expect(result).toBeNull()
  })
})
