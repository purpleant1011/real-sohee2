import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActionGraphResumeEngine } from '@/features/tool-runtime/action-graph-resume-engine'
import type { ActionGraph, ActionGraphNode } from '@/features/tool-runtime/agent-loop-engine'
import { CompletionEvaluator } from '@/features/tool-runtime/completion-evaluator'
import { PersistenceError } from '@/lib/errors/persistence-error'

// Mock Supabase Server Client to simulate persistent DB storage
type TableRow = Record<string, any>
const mockDbTables: {
  agent_runs: Map<string, TableRow>
  agent_run_steps: Map<string, TableRow>
} = {
  agent_runs: new Map(),
  agent_run_steps: new Map(),
}

let mockShouldFailDb = false

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => {
    if (mockShouldFailDb) {
      throw new Error('Supabase DB cluster connection failure')
    }

    return {
      rpc: vi.fn(async (name: string, args: { p_run_id: string; p_workspace_id: string }) => {
        const run = mockDbTables.agent_runs.get(args.p_run_id)
        if (name !== 'car_claim_graph_execution' || !run || run.workspace_id !== args.p_workspace_id) {
          return { data: null, error: null }
        }
        return { data: { planFence: run.plan_data }, error: null }
      }),
      from: (tableName: string) => {
        if (tableName === 'agent_runs') {
          return {
            select: vi.fn(() => ({
              eq: (col1: string, val1: any) => ({
                eq: (col2: string, val2: any) => ({
                  single: vi.fn(async () => {
                    if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } }
                    const run = mockDbTables.agent_runs.get(val1)
                    if (!run || run.workspace_id !== val2) {
                      return { data: null, error: { message: 'Run not found' } }
                    }
                    return { data: run, error: null }
                  }),
                }),
              }),
            })),
            update: vi.fn((updates: TableRow) => ({
              eq: (col: string, val: any) => ({
                eq: (col2: string, val2: any) => {
                  const executeUpdate = () => {
                    if (mockShouldFailDb) return { data: null, error: { message: 'DB update error' } }
                    const existing = mockDbTables.agent_runs.get(val)
                    if (!existing || existing.workspace_id !== val2) {
                      return { data: [], error: null }
                    }
                    mockDbTables.agent_runs.set(val, { ...existing, ...updates })
                    return { data: [{ id: val }], error: null }
                  }

                  return {
                    select: vi.fn(() => Promise.resolve(executeUpdate())),
                    then: (resolve: any, reject: any) => Promise.resolve(executeUpdate()).then(resolve, reject),
                  }
                },
              }),
            })),
            insert: vi.fn(async (row: TableRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB insert error' } }
              mockDbTables.agent_runs.set(row.id, { ...row })
              return { error: null }
            }),
          }
        }

        if (tableName === 'agent_run_steps') {
          return {
            select: vi.fn(() => ({
              eq: (col: string, val: any) => ({
                order: vi.fn(() => {
                  if (mockShouldFailDb) return Promise.resolve({ data: null, error: { message: 'DB step read error' } })
                  const steps = Array.from(mockDbTables.agent_run_steps.values())
                    .filter((s) => s.run_id === val)
                    .sort((a, b) => a.step_index - b.step_index)
                  return Promise.resolve({ data: steps, error: null })
                }),
              }),
            })),
            upsert: vi.fn(async (row: TableRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB upsert error' } }
              const key = `${row.run_id}:${row.step_index}`
              const existing = mockDbTables.agent_run_steps.get(key) || {}
              mockDbTables.agent_run_steps.set(key, { ...existing, ...row })
              return { error: null }
            }),
          }
        }

        return {}
      },
    }
  }),
}))

describe('ActionGraphResumeEngine Durability & Idempotency (ANI-964, ANI-965, ANI-966, ANI-962, ANI-967)', () => {
  const TEST_WORKSPACE = 'ws-durability-test-1'
  const TEST_RUN_ID = 'run-graph-100'

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbTables.agent_runs.clear()
    mockDbTables.agent_run_steps.clear()
    mockShouldFailDb = false

    // Seed agent_runs table
    mockDbTables.agent_runs.set(TEST_RUN_ID, {
      id: TEST_RUN_ID,
      workspace_id: TEST_WORKSPACE,
      status: 'executing',
      goal: 'Multi-step durable marketing campaign',
      plan_data: {},
      created_at: new Date().toISOString(),
    })
  })

  it.each(['RESULT_UNKNOWN', 'RUNNING', 'AWAITING_APPROVAL', 'BLOCKED', 'FAILED'])('CAR-04: refuses to replay unresolved %s nodes or their successors', async (status) => {
    const graph: ActionGraph = {
      runId: TEST_RUN_ID, workspaceId: TEST_WORKSPACE, status: 'BLOCKED', iterations: 1, totalSteps: 2, steps: [],
      nodes: [
        { nodeId: 'uncertain', title: '게시', status, isExternalMutation: true, idempotencyKey: 'stable-key' },
        { nodeId: 'next', title: '후속 작업', status: 'PENDING' },
      ],
    }
    const executor = vi.fn()
    const result = await ActionGraphResumeEngine.executeGraph(graph, { workspaceId: TEST_WORKSPACE, executor })
    expect(executor).not.toHaveBeenCalled()
    expect(result.status).toBe('BLOCKED')
    expect(result.nodes?.[0].status).toBe(status)
  })

  it('CAR-04: a returned unknown write stops all subsequent nodes', async () => {
    const graph: ActionGraph = {
      runId: TEST_RUN_ID, workspaceId: TEST_WORKSPACE, status: 'RUNNING', iterations: 1, totalSteps: 2, steps: [],
      nodes: [
        { nodeId: 'write', title: '게시', status: 'PENDING', isExternalMutation: true },
        { nodeId: 'next', title: '후속 작업', status: 'PENDING' },
      ],
    }
    const executor = vi.fn(async () => ({ status: 'RESULT_UNKNOWN' }))
    const result = await ActionGraphResumeEngine.executeGraph(graph, { workspaceId: TEST_WORKSPACE, executor })
    expect(executor).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('BLOCKED')
    expect(result.nodes?.[1].status).toBe('PENDING')
  })

  it('Test 1: interrupted external writes remain blocked after clearing memory, without replaying completed or ambiguous nodes', async () => {
    // 3 Nodes:
    // Node 1: search_insights (read)
    // Node 2: generate_draft (mutation)
    // Node 3: publish_campaign (mutation)
    const initialNodes: ActionGraphNode[] = [
      {
        nodeId: 'node-1',
        title: 'Search Market Insights',
        toolName: 'knowledge.search',
        capabilityId: 'knowledge.search',
        status: 'PENDING',
        isMandatory: true,
      },
      {
        nodeId: 'node-2',
        title: 'Generate Ad Creative Draft',
        toolName: 'ads.creative.generate',
        capabilityId: 'ads.creative.generate',
        status: 'PENDING',
        isMandatory: true,
        isExternalMutation: true,
        idempotencyKey: 'idem-ad-draft-1',
      },
      {
        nodeId: 'node-3',
        title: 'Publish Campaign',
        toolName: 'ads.campaigns.create',
        capabilityId: 'ads.campaigns.create',
        status: 'PENDING',
        isMandatory: true,
        isExternalMutation: true,
        idempotencyKey: 'idem-publish-campaign-1',
      },
    ]

    let actionGraph: ActionGraph = {
      runId: TEST_RUN_ID,
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 3,
      steps: [],
      nodes: initialNodes,
    }

    // Save initial checkpoint
    await ActionGraphResumeEngine.saveCheckpoint(actionGraph, TEST_WORKSPACE)

    // Setup execution tracker
    const executedNodeIds: string[] = []
    let shouldInterruptAtNode2 = true

    const mockExecutor = vi.fn(async (node: ActionGraphNode) => {
      executedNodeIds.push(node.nodeId)
      if (node.nodeId === 'node-2' && shouldInterruptAtNode2) {
        // Simulate worker shutdown / edge interruption during Node 2
        throw new Error('WORKER_TIMEOUT_INTERRUPT: Worker edge lifetime exceeded')
      }
      return {
        status: 'COMPLETED',
        output: { result: `${node.nodeId} completed successfully` },
      }
    })

    // 1st Execution attempt: Node 1 completes, Node 2 interrupted
    await expect(
      ActionGraphResumeEngine.executeGraph(actionGraph, {
        workspaceId: TEST_WORKSPACE,
        executor: mockExecutor,
      })
    ).rejects.toThrow('WORKER_TIMEOUT_INTERRUPT')

    expect(executedNodeIds).toEqual(['node-1', 'node-2'])
    expect(mockExecutor).toHaveBeenCalledTimes(2)

    // Verify DB Checkpoint reflects Node 1 COMPLETED and Node 2 as interrupted/RESULT_UNKNOWN
    const storedRun = mockDbTables.agent_runs.get(TEST_RUN_ID)
    expect(storedRun).toBeDefined()
    const storedGraph = storedRun?.plan_data?.actionGraph as ActionGraph
    expect(storedGraph).toBeDefined()
    expect(storedGraph.nodes?.[0].status).toBe('COMPLETED')
    // Node 2 was interrupted external mutation: must preserve RESULT_UNKNOWN status
    expect(storedGraph.nodes?.[1].status).toBe('RESULT_UNKNOWN')
    expect(storedGraph.nodes?.[2].status).toBe('PENDING')

    // CLEAR MEMORY: Discard in-memory actionGraph & execution state
    actionGraph = null as any
    executedNodeIds.length = 0
    mockExecutor.mockClear()
    shouldInterruptAtNode2 = false // Second invocation worker runs cleanly

    // RESUME from Supabase DB
    const resumedGraph = await ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    expect(resumedGraph).toBeDefined()
    expect(resumedGraph.runId).toBe(TEST_RUN_ID)
    expect(resumedGraph.nodes?.[0].status).toBe('COMPLETED')

    // Recovery is not permission to resend an ambiguous provider write.
    const finalGraph = await ActionGraphResumeEngine.executeGraph(resumedGraph, {
      workspaceId: TEST_WORKSPACE,
      executor: mockExecutor,
    })

    expect(executedNodeIds).toEqual([])
    expect(mockExecutor).not.toHaveBeenCalled()
    expect(finalGraph.status).toBe('BLOCKED')
    expect(finalGraph.nodes?.map(n => n.status)).toEqual(['COMPLETED', 'RESULT_UNKNOWN', 'PENDING'])
  })

  it('Test 2: Double-resume does not re-dispatch completed external writes', async () => {
    const externalDispatchMock = vi.fn()

    const nodes: ActionGraphNode[] = [
      {
        nodeId: 'node-ext-1',
        title: 'Charge Advertising Credits',
        toolName: 'credits.deduct',
        capabilityId: 'credits.deduct',
        status: 'PENDING',
        isMandatory: true,
        isExternalMutation: true,
        idempotencyKey: 'idem-credit-charge-999',
      },
      {
        nodeId: 'node-ext-2',
        title: 'Dispatch External SNS Push',
        toolName: 'sns.push',
        capabilityId: 'sns.push',
        status: 'PENDING',
        isMandatory: true,
        isExternalMutation: true,
        idempotencyKey: 'idem-sns-push-999',
      },
    ]

    const graph: ActionGraph = {
      runId: TEST_RUN_ID,
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 2,
      steps: [],
      nodes,
    }

    await ActionGraphResumeEngine.saveCheckpoint(graph, TEST_WORKSPACE)

    const executor = vi.fn(async (node: ActionGraphNode) => {
      if (node.isExternalMutation) {
        externalDispatchMock(node.nodeId, node.idempotencyKey)
      }
      return {
        status: 'COMPLETED',
        output: { txId: `tx-${node.nodeId}` },
      }
    })

    // 1st Run: completes both external mutations
    const completedGraph = await ActionGraphResumeEngine.executeGraph(graph, {
      workspaceId: TEST_WORKSPACE,
      executor,
    })

    expect(completedGraph.status).toBe('COMPLETED')
    expect(externalDispatchMock).toHaveBeenCalledTimes(2)
    expect(externalDispatchMock).toHaveBeenCalledWith('node-ext-1', 'idem-credit-charge-999')
    expect(externalDispatchMock).toHaveBeenCalledWith('node-ext-2', 'idem-sns-push-999')

    // Clear call counts
    externalDispatchMock.mockClear()
    executor.mockClear()

    // 1st Resume from DB
    const resumed1 = await ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    const secondExecution = await ActionGraphResumeEngine.executeGraph(resumed1, {
      workspaceId: TEST_WORKSPACE,
      executor,
    })

    // Neither node re-dispatched
    expect(secondExecution.status).toBe('COMPLETED')
    expect(externalDispatchMock).toHaveBeenCalledTimes(0)
    expect(executor).toHaveBeenCalledTimes(0)

    // 2nd Resume from DB (Double-resume verification)
    const resumed2 = await ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    const thirdExecution = await ActionGraphResumeEngine.executeGraph(resumed2, {
      workspaceId: TEST_WORKSPACE,
      executor,
    })

    // Still 0 external dispatches
    expect(thirdExecution.status).toBe('COMPLETED')
    expect(externalDispatchMock).toHaveBeenCalledTimes(0)
    expect(executor).toHaveBeenCalledTimes(0)
  })

  it('Test 3: Preserves RESULT_UNKNOWN state on ambiguous mutation failure and halts completion evaluation', async () => {
    const nodes: ActionGraphNode[] = [
      {
        nodeId: 'node-mutation-uncertain',
        title: 'External Payment Gateway Capture',
        toolName: 'payments.capture',
        capabilityId: 'payments.capture',
        status: 'PENDING',
        isMandatory: true,
        isExternalMutation: true,
        idempotencyKey: 'idem-pay-unk-1',
      },
    ]

    const graph: ActionGraph = {
      runId: TEST_RUN_ID,
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 1,
      steps: [],
      nodes,
      contract: {
        mandatoryNodeIds: ['node-mutation-uncertain'],
        replanOnFailure: true,
      },
    }

    await ActionGraphResumeEngine.saveCheckpoint(graph, TEST_WORKSPACE)

    // Executor simulates gateway network timeout leaving state unknown
    const executor = vi.fn(async () => {
      const err = new Error('ECONNRESET: Gateway connection reset during socket write')
      ;(err as any).isUnknownResult = true
      throw err
    })

    await expect(
      ActionGraphResumeEngine.executeGraph(graph, {
        workspaceId: TEST_WORKSPACE,
        executor,
      })
    ).rejects.toThrow('ECONNRESET')

    // Reconstitute from DB: check status is preserved as RESULT_UNKNOWN
    const resumed = await ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    expect(resumed.nodes?.[0].status).toBe('RESULT_UNKNOWN')

    // CompletionEvaluator MUST fail-closed on this unresolved RESULT_UNKNOWN node
    const evaluation = CompletionEvaluator.evaluate(resumed, resumed.contract)
    expect(evaluation.passed).toBe(false)
    expect(evaluation.errorCode).toBe('RESULT_UNKNOWN_UNRESOLVED')
    expect(evaluation.unresolvedNodes).toContain('node-mutation-uncertain')
  })

  it('Test 4: Fail-Closed on DB persistence errors without silent memory fallback', async () => {
    const graph: ActionGraph = {
      runId: TEST_RUN_ID,
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 1,
      steps: [],
      nodes: [],
    }

    // Induce DB failure
    mockShouldFailDb = true

    await expect(
      ActionGraphResumeEngine.saveCheckpoint(graph, TEST_WORKSPACE)
    ).rejects.toThrow(PersistenceError)

    await expect(
      ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    ).rejects.toThrow(PersistenceError)
  })

  it('Test 5: Cross-tenant isolation - rejects resuming graph belonging to another workspace', async () => {
    const graph: ActionGraph = {
      runId: TEST_RUN_ID,
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 1,
      steps: [],
      nodes: [],
    }

    await ActionGraphResumeEngine.saveCheckpoint(graph, TEST_WORKSPACE)

    // Attempting to resume under a different workspace tenant MUST fail-closed
    await expect(
      ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, 'other-tenant-ws-evil')
    ).rejects.toThrow(PersistenceError)
  })

  it('Test 6: Gate 2 Fix #1 - saveCheckpoint detects 0 rows updated and throws PersistenceError (Fail-Closed)', async () => {
    const nonExistentGraph: ActionGraph = {
      runId: 'run-not-found-999',
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 1,
      steps: [],
      nodes: [],
    }

    // Attempting to save checkpoint for non-existent run ID should detect 0 rows updated
    await expect(
      ActionGraphResumeEngine.saveCheckpoint(nonExistentGraph, TEST_WORKSPACE)
    ).rejects.toThrow(PersistenceError)
  })

  it('Test 7: Gate 2 Fix #2 - Guards external_receipt_id column against non-UUID types while preserving raw receipt in output_payload', async () => {
    const uuidReceipt = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    const nonUuidReceipt = 'rcpt-kakaopay-order-20260907-991'

    const graphWithReceipts: ActionGraph = {
      runId: TEST_RUN_ID,
      workspaceId: TEST_WORKSPACE,
      status: 'RUNNING',
      iterations: 1,
      totalSteps: 2,
      steps: [],
      nodes: [
        {
          nodeId: 'node-uuid-rcpt',
          title: 'Stripe Payment Capture',
          status: 'COMPLETED',
          evidence: { receiptId: uuidReceipt },
        },
        {
          nodeId: 'node-str-rcpt',
          title: 'Custom Webhook Dispatch',
          status: 'COMPLETED',
          evidence: { receiptId: nonUuidReceipt },
        },
      ],
    }

    await ActionGraphResumeEngine.saveCheckpoint(graphWithReceipts, TEST_WORKSPACE)

    // Inspect underlying agent_run_steps storage
    const step1 = mockDbTables.agent_run_steps.get(`${TEST_RUN_ID}:1`)
    const step2 = mockDbTables.agent_run_steps.get(`${TEST_RUN_ID}:2`)

    expect(step1).toBeDefined()
    expect(step1?.external_receipt_id).toBe(uuidReceipt) // Valid UUID passed to column

    expect(step2).toBeDefined()
    expect(step2?.external_receipt_id).toBeNull() // Non-UUID filtered out to prevent DB cast failure
    expect(step2?.output_payload?.receiptId).toBe(nonUuidReceipt) // Preserved in JSONB

    // Reconstitute from DB: both receipts correctly restored to evidence.receiptId
    const resumed = await ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    expect(resumed.nodes?.[0].evidence?.receiptId).toBe(uuidReceipt)
    expect(resumed.nodes?.[1].evidence?.receiptId).toBe(nonUuidReceipt)
  })

  it('Test 8: Gate 2 Fix #3 - Prioritizes DB completed status during reconcile to avoid false RESULT_UNKNOWN', async () => {
    // Simulate node that completed in DB step ledger before worker crashed
    mockDbTables.agent_run_steps.set(`${TEST_RUN_ID}:1`, {
      run_id: TEST_RUN_ID,
      step_index: 1,
      capability_id: 'ads.campaigns.create',
      status: 'completed',
      completed_at: new Date().toISOString(),
      output_payload: { campaignId: 'cmp-123' },
    })

    // In-memory graph snapshot in agent_runs plan_data was still RUNNING at crash
    mockDbTables.agent_runs.set(TEST_RUN_ID, {
      id: TEST_RUN_ID,
      workspace_id: TEST_WORKSPACE,
      status: 'executing',
      plan_data: {
        actionGraph: {
          runId: TEST_RUN_ID,
          workspaceId: TEST_WORKSPACE,
          status: 'RUNNING',
          iterations: 1,
          totalSteps: 1,
          steps: [],
          nodes: [
            {
              nodeId: 'node-crash-after-commit',
              status: 'RUNNING',
              isExternalMutation: true,
              idempotencyKey: 'idem-crash-1',
            },
          ],
        },
      },
    })

    // Reconcile: must prioritize DB completed status over in-memory RUNNING, NOT mark as RESULT_UNKNOWN
    const resumed = await ActionGraphResumeEngine.resumeGraph(TEST_RUN_ID, TEST_WORKSPACE)
    expect(resumed.nodes?.[0].status).toBe('COMPLETED')
  })
})

