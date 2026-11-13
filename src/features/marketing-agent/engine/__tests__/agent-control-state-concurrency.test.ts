import { describe, it, expect, beforeEach } from 'vitest'
import { AgentControlPlaneService } from '../agent-control-state'

describe('AgentControlPlaneService Concurrency & Idempotency (ANI-909)', () => {
  const workspaceId = 'ws-test-concurrency-123'

  beforeEach(() => {
    AgentControlPlaneService.resetForTest()
  })

  it('does not fabricate a fresh heartbeat from a row update timestamp', async () => {
    AgentControlPlaneService.setDbClientForTest({ from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: {
        workspace_id: workspaceId, desired_mode: 'RUNNING', actual_mode: 'RUNNING',
        updated_at: '2026-11-02T12:00:00Z', version: 1, snapshot_version: 1,
      }, error: null }),
    }) }) }) })
    const state = await AgentControlPlaneService.getControlState(workspaceId)
    expect(state.lastHeartbeatAt).toBe('')
  })

  it('uses upsert with onConflict workspace_id during first-time getControlState initialization to avoid unique constraint violations', async () => {
    let upsertCalled = false
    let upsertConflictOption: any = null

    const mockClient = {
      from: (table: string) => {
        if (table === 'workspace_runtime_control_states') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            upsert: (row: any, opts: any) => {
              upsertCalled = true
              upsertConflictOption = opts
              const singleResult = async () => ({
                data: {
                  workspace_id: workspaceId,
                  desired_mode: 'RUNNING',
                  actual_mode: 'RUNNING',
                  version: 1,
                  snapshot_version: 1,
                  kill_switch_active: false,
                },
                error: null,
              })
              return {
                select: () => ({
                  maybeSingle: singleResult,
                  single: singleResult,
                }),
              }
            },
          }
        }
        return {}
      },
    }

    AgentControlPlaneService.setDbClientForTest(mockClient)

    const state = await AgentControlPlaneService.getControlState(workspaceId)

    expect(state).toBeDefined()
    expect(upsertCalled).toBe(true)
    expect(upsertConflictOption).toEqual({ onConflict: 'workspace_id', ignoreDuplicates: true })
  })
})
