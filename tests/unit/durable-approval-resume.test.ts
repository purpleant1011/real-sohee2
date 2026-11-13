import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionGraphResumeEngine } from '@/features/tool-runtime/action-graph-resume-engine';
import type { ActionGraph, ActionGraphNode } from '@/features/tool-runtime/agent-loop-engine';

// Mock Supabase Server Client to simulate persistent DB storage
type TableRow = Record<string, any>;
const mockDbTables: {
  agent_runs: Map<string, TableRow>;
  agent_run_steps: Map<string, TableRow>;
  agent_approvals: Map<string, TableRow>;
} = {
  agent_runs: new Map(),
  agent_run_steps: new Map(),
  agent_approvals: new Map(),
};

let mockShouldFailDb = false;
let mockApprovalWriteResult: { data: TableRow | null; error: { message: string } | null } | undefined;
let mockApprovalBeforeUpdate: (() => void) | undefined;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => {
    if (mockShouldFailDb) {
      throw new Error('Supabase DB cluster connection failure');
    }

    return {
      rpc: vi.fn(async (name: string, args: { p_run_id: string; p_workspace_id: string }) => {
        const run = mockDbTables.agent_runs.get(args.p_run_id);
        if (name !== 'car_claim_graph_execution' || !run || run.workspace_id !== args.p_workspace_id) {
          return { data: null, error: null };
        }
        return { data: { planFence: run.plan_data }, error: null };
      }),
      from: (tableName: string) => {
        if (tableName === 'agent_runs') {
          return {
            select: vi.fn(() => ({
              eq: (col1: string, val1: any) => ({
                eq: (col2: string, val2: any) => ({
                  single: vi.fn(async () => {
                    if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                    const run = mockDbTables.agent_runs.get(val1);
                    if (!run || run.workspace_id !== val2) {
                      return { data: null, error: { message: 'Run not found' } };
                    }
                    return { data: run, error: null };
                  }),
                }),
              }),
            })),
            update: vi.fn((updates: TableRow) => ({
              eq: (col: string, val: any) => ({
                eq: (col2: string, val2: any) => {
                  const executeUpdate = () => {
                    if (mockShouldFailDb) return { data: null, error: { message: 'DB update error' } };
                    const existing = mockDbTables.agent_runs.get(val);
                    if (!existing || existing.workspace_id !== val2) {
                      return { data: [], error: null };
                    }
                    mockDbTables.agent_runs.set(val, { ...existing, ...updates });
                    return { data: [{ id: val }], error: null };
                  };

                  return {
                    select: vi.fn(() => Promise.resolve(executeUpdate())),
                    then: (resolve: any, reject: any) => Promise.resolve(executeUpdate()).then(resolve, reject),
                  };
                },
              }),
            })),
            insert: vi.fn(async (row: TableRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB insert error' } };
              mockDbTables.agent_runs.set(row.id, { ...row });
              return { error: null };
            }),
          };
        }

        if (tableName === 'agent_run_steps') {
          return {
            select: vi.fn(() => ({
              eq: (col: string, val: any) => ({
                order: vi.fn(() => {
                  if (mockShouldFailDb) return Promise.resolve({ data: null, error: { message: 'DB step read error' } });
                  const steps = Array.from(mockDbTables.agent_run_steps.values())
                    .filter((s) => s.run_id === val)
                    .sort((a, b) => a.step_index - b.step_index);
                  return Promise.resolve({ data: steps, error: null });
                }),
              }),
            })),
            upsert: vi.fn(async (row: TableRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB upsert error' } };
              const key = `${row.run_id}:${row.step_index}`;
              const existing = mockDbTables.agent_run_steps.get(key) || {};
              mockDbTables.agent_run_steps.set(key, { ...existing, ...row });
              return { error: null };
            }),
          };
        }

        if (tableName === 'agent_approvals') {
          return {
            select: vi.fn(() => ({
              eq: (col: string, val: any) => {
                let filtered = Array.from(mockDbTables.agent_approvals.values()).filter(
                  (a) => a[col] === val
                );

                const chainable = {
                  eq: (col2: string, val2: any) => {
                    filtered = filtered.filter((a) => a[col2] === val2);
                    return chainable;
                  },
                  maybeSingle: vi.fn(async () => {
                    if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                    return { data: filtered[0] ? structuredClone(filtered[0]) : null, error: null };
                  }),
                  single: vi.fn(async () => {
                    if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                    if (!filtered[0]) return { data: null, error: { message: 'Approval not found' } };
                    return { data: filtered[0], error: null };
                  }),
                };
                return chainable;
              },
            })),
            update: vi.fn((updates: TableRow) => ({
              eq: (col: string, val: any) => {
                mockApprovalBeforeUpdate?.();
                let matching = Array.from(mockDbTables.agent_approvals.values()).filter(
                  (a) => a[col] === val
                );
                const updateChain = {
                  eq: (col2: string, val2: any) => {
                    matching = matching.filter((a) => a[col2] === val2);
                    return updateChain;
                  },
                  gt: (column: string, value: any) => {
                    matching = matching.filter((row) => row[column] > value);
                    return updateChain;
                  },
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      if (mockApprovalWriteResult) return mockApprovalWriteResult;
                      if (mockShouldFailDb) return { data: null, error: { message: 'DB update error' } };
                      if (matching.length === 0) return { data: null, error: { message: 'Not found' } };
                      const target = matching[0];
                      const updated = { ...target, ...updates };
                      mockDbTables.agent_approvals.set(target.proposal_id || target.id, updated);
                      return { data: updated, error: null };
                    }),
                  })),
                  then: (resolve: any, reject: any) => {
                    if (mockShouldFailDb) return Promise.reject(new Error('DB update error')).then(resolve, reject);
                    if (mockApprovalWriteResult) return Promise.resolve(mockApprovalWriteResult).then(resolve, reject);
                    for (const target of matching) {
                      mockDbTables.agent_approvals.set(target.proposal_id || target.id, { ...target, ...updates });
                    }
                    return Promise.resolve({ error: null }).then(resolve, reject);
                  },
                };
                return updateChain;
              },
            })),
            upsert: vi.fn(async (row: TableRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB upsert error' } };
              const id = row.id || row.proposal_id;
              mockDbTables.agent_approvals.set(id, { ...row, id });
              return { data: { ...row, id }, error: null };
            }),
            insert: vi.fn(async (row: TableRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB insert error' } };
              const id = row.id || row.proposal_id;
              mockDbTables.agent_approvals.set(id, { ...row, id });
              return { data: { ...row, id }, error: null };
            }),
          };
        }

        return {};
      },
    };
  }),
}));

describe('Durable Approval Resume Engine (ANI-949)', () => {
  const TEST_WORKSPACE = 'ws-approval-durability-1';
  const TEST_RUN_ID = 'run-approval-901';
  const TEST_PROPOSAL_ID = 'prop-approval-publish-77';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTables.agent_runs.clear();
    mockDbTables.agent_run_steps.clear();
    mockDbTables.agent_approvals.clear();
    mockShouldFailDb = false;
    mockApprovalWriteResult = undefined;
    mockApprovalBeforeUpdate = undefined;

    // Seed initial agent_runs row
    mockDbTables.agent_runs.set(TEST_RUN_ID, {
      id: TEST_RUN_ID,
      workspace_id: TEST_WORKSPACE,
      status: 'executing',
      goal: 'Autonomous campaign with human approval gate',
      plan_data: {},
      created_at: new Date().toISOString(),
    });
  });

  describe('1. Resume from Approval within same ActionRun without new run (ANI-949)', () => {
    it('resumes from approved node, skips completed node, and executes remaining nodes on same runId', async () => {
      // 3 Nodes:
      // Node 1: search_trends (COMPLETED)
      // Node 2: publish_post (External Mutation, AWAITING_APPROVAL)
      // Node 3: notify_slack (PENDING)
      const initialNodes: ActionGraphNode[] = [
        {
          nodeId: 'node-1-search',
          title: 'Search Market Trends',
          toolName: 'knowledge.search',
          capabilityId: 'knowledge.search',
          status: 'COMPLETED',
          isMandatory: true,
          output: { query: 'summer campaign', found: 12 },
          executedAt: '2026-09-07T00:01:00.000Z',
        },
        {
          nodeId: 'node-2-publish',
          title: 'Publish Instagram Campaign Post',
          toolName: 'publish.create',
          capabilityId: 'publish.create',
          status: 'AWAITING_APPROVAL',
          isMandatory: true,
          isExternalMutation: true,
          requiresApproval: true,
          idempotencyKey: 'idem-post-pub-999',
          proposalId: TEST_PROPOSAL_ID,
          input: { caption: '여름 특별 이벤트' },
        },
        {
          nodeId: 'node-3-notify',
          title: 'Dispatch Slack Confirmation',
          toolName: 'notification.slack',
          capabilityId: 'notification.slack',
          status: 'PENDING',
          isMandatory: true,
          input: { channel: '#marketing-alerts' },
        },
      ];

      const initialGraph: ActionGraph = {
        runId: TEST_RUN_ID,
        workspaceId: TEST_WORKSPACE,
        status: 'AWAITING_APPROVAL',
        iterations: 1,
        totalSteps: 3,
        steps: [],
        nodes: initialNodes,
        graphRevision: 1,
      };

      // Save initial paused checkpoint in DB
      await ActionGraphResumeEngine.saveCheckpoint(initialGraph, TEST_WORKSPACE);

      // Create durable approval proposal in DB
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour future
      mockDbTables.agent_approvals.set(TEST_PROPOSAL_ID, {
        id: 'appr-uuid-001',
        workspace_id: TEST_WORKSPACE,
        proposal_id: TEST_PROPOSAL_ID,
        session_id: 'sess-approval-1',
        action_run_id: TEST_RUN_ID,
        proposal_type: 'PUBLISH_APPROVAL',
        title: 'Instagram Post Publish Approval',
        description: 'Publish summer campaign post to Instagram',
        status: 'PENDING',
        version: 1,
        graph_revision: 1,
        policy_version: 'v1.0-commercial',
        cost_delta: 25,
        expires_at: expiresAt,
        proposed_value: {
          caption: '여름 특별 이벤트 (승인됨)',
          nodeId: 'node-2-publish',
          graph_revision: 1,
          policy_version: 'v1.0-commercial',
          cost_delta: 25,
        },
        created_at: new Date().toISOString(),
      });

      // Track executions
      const executedNodeIds: string[] = [];
      const mockExecutor = vi.fn(async (node: ActionGraphNode) => {
        executedNodeIds.push(node.nodeId);
        return {
          status: 'COMPLETED',
          output: { result: `${node.nodeId} completed successfully` },
        };
      });

      // Simulate worker restart: discard memory, resume from approval
      const resumedGraph = await ActionGraphResumeEngine.resumeFromApproval({
        workspaceId: TEST_WORKSPACE,
        runId: TEST_RUN_ID,
        approvalId: TEST_PROPOSAL_ID,
        expectedRevision: 1,
        executor: mockExecutor,
      });

      // 1. Same runId is preserved (NO new run spawned)
      expect(resumedGraph.runId).toBe(TEST_RUN_ID);
      expect(mockDbTables.agent_runs.size).toBe(1);

      // 2. Node 1 was skipped (already COMPLETED)
      expect(executedNodeIds).not.toContain('node-1-search');

      // 3. Node 2 was approved and marked COMPLETED
      const node2 = resumedGraph.nodes?.find((n) => n.nodeId === 'node-2-publish');
      expect(node2?.status).toBe('COMPLETED');
      expect(node2?.approvalStatus).toBe('APPROVED');
      expect(node2?.idempotencyKey).toBe('idem-post-pub-999'); // Idempotency preserved!

      // 4. Node 3 was executed and completed
      expect(executedNodeIds).toContain('node-3-notify');
      const node3 = resumedGraph.nodes?.find((n) => n.nodeId === 'node-3-notify');
      expect(node3?.status).toBe('COMPLETED');

      // 5. ActionGraph reaches COMPLETED
      expect(resumedGraph.status).toBe('COMPLETED');

      // 6. Approval record updated to APPROVED in DB
      const approvalRow = mockDbTables.agent_approvals.get(TEST_PROPOSAL_ID);
      expect(approvalRow?.status).toBe('APPROVED');
    });
  });

  describe('approval consumption fences', () => {
    async function seedApproval(targetNodeId = 'gate') {
      const graph: ActionGraph = {
        runId: TEST_RUN_ID, workspaceId: TEST_WORKSPACE, status: 'AWAITING_APPROVAL',
        iterations: 1, totalSteps: 2, steps: [], nodes: [
          { nodeId: 'gate', title: '승인', status: 'AWAITING_APPROVAL', requiresApproval: true },
          { nodeId: 'next', title: '다음 작업', status: 'PENDING' },
        ],
      };
      await ActionGraphResumeEngine.saveCheckpoint(graph, TEST_WORKSPACE);
      mockDbTables.agent_approvals.set('approval', {
        id: 'approval', proposal_id: 'approval', workspace_id: TEST_WORKSPACE,
        action_run_id: TEST_RUN_ID, status: 'PENDING', version: 1,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        proposed_value: { nodeId: targetNodeId },
      });
    }

    it.each([
      { data: null, error: { message: 'write failed' } },
      { data: null, error: null },
      { data: { id: 'other', workspace_id: TEST_WORKSPACE, status: 'APPROVED', version: 2 }, error: null },
      { data: { id: 'approval', workspace_id: TEST_WORKSPACE, status: 'PENDING', version: 1 }, error: null },
    ])('does not resume without a confirmed approval CAS: %j', async (result) => {
      await seedApproval();
      mockApprovalWriteResult = result;
      const executor = vi.fn();
      await expect(ActionGraphResumeEngine.resumeFromApproval({
        workspaceId: TEST_WORKSPACE, runId: TEST_RUN_ID, approvalId: 'approval', executor,
      })).rejects.toThrow();
      expect(executor).not.toHaveBeenCalled();
      expect(mockDbTables.agent_runs.get(TEST_RUN_ID)?.plan_data.actionGraph.nodes[0].status).toBe('AWAITING_APPROVAL');
    });

    it.each([
      { version: 2 },
      { status: 'REJECTED' },
      { expires_at: '2000-01-01T00:00:00.000Z' },
      { workspace_id: 'other-workspace' },
    ])('rejects an approval changed between read and write: %j', async (change) => {
      await seedApproval();
      mockApprovalBeforeUpdate = () => {
        const row = mockDbTables.agent_approvals.get('approval')!;
        mockDbTables.agent_approvals.set('approval', { ...row, ...change });
      };
      const executor = vi.fn();
      await expect(ActionGraphResumeEngine.resumeFromApproval({
        workspaceId: TEST_WORKSPACE, runId: TEST_RUN_ID, approvalId: 'approval', executor,
      })).rejects.toThrow('STALE_APPROVAL_REJECTED');
      expect(executor).not.toHaveBeenCalled();
      expect(mockDbTables.agent_approvals.get('approval')).toMatchObject(change);
    });

    it('rejects an approval whose explicit target was removed without approving another node', async () => {
      await seedApproval('removed');
      const graph = mockDbTables.agent_runs.get(TEST_RUN_ID)?.plan_data.actionGraph;
      graph.nodes[0].proposalId = 'approval';
      const executor = vi.fn();
      await expect(ActionGraphResumeEngine.resumeFromApproval({
        workspaceId: TEST_WORKSPACE, runId: TEST_RUN_ID, approvalId: 'approval', executor,
      })).rejects.toThrow('STALE_APPROVAL_REJECTED');
      expect(executor).not.toHaveBeenCalled();
      expect(mockDbTables.agent_approvals.get('approval')?.status).toBe('PENDING');
    });
  });

  describe('2. Stale Approval & Version Conflict Rejection (Fail-Closed) (ANI-949)', () => {
    it('rejects expired approval with STALE_APPROVAL_REJECTED', async () => {
      const pastExpiresAt = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago
      mockDbTables.agent_approvals.set('prop-expired', {
        id: 'appr-uuid-expired',
        workspace_id: TEST_WORKSPACE,
        proposal_id: 'prop-expired',
        action_run_id: TEST_RUN_ID,
        status: 'PENDING',
        version: 1,
        graph_revision: 1,
        expires_at: pastExpiresAt,
        proposed_value: {},
      });

      await expect(
        ActionGraphResumeEngine.resumeFromApproval({
          workspaceId: TEST_WORKSPACE,
          runId: TEST_RUN_ID,
          approvalId: 'prop-expired',
        })
      ).rejects.toThrow('STALE_APPROVAL_REJECTED');
    });

    it('rejects graph revision mismatch with STALE_APPROVAL_REJECTED', async () => {
      mockDbTables.agent_approvals.set('prop-rev-conflict', {
        id: 'appr-uuid-rev',
        workspace_id: TEST_WORKSPACE,
        proposal_id: 'prop-rev-conflict',
        action_run_id: TEST_RUN_ID,
        status: 'PENDING',
        version: 1,
        graph_revision: 1, // Approval was granted for revision 1
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        proposed_value: {},
      });

      // Expected revision is 2, or graph was updated to revision 2
      await expect(
        ActionGraphResumeEngine.resumeFromApproval({
          workspaceId: TEST_WORKSPACE,
          runId: TEST_RUN_ID,
          approvalId: 'prop-rev-conflict',
          expectedRevision: 2, // Conflict!
        })
      ).rejects.toThrow('STALE_APPROVAL_REJECTED');
    });

    it('rejects when approval belongs to a different action_run_id (Fail-Closed isolation)', async () => {
      mockDbTables.agent_approvals.set('prop-other-run', {
        id: 'appr-uuid-other-run',
        workspace_id: TEST_WORKSPACE,
        proposal_id: 'prop-other-run',
        action_run_id: 'run-different-user-999', // Different run
        status: 'PENDING',
        version: 1,
        graph_revision: 1,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        proposed_value: {},
      });

      await expect(
        ActionGraphResumeEngine.resumeFromApproval({
          workspaceId: TEST_WORKSPACE,
          runId: TEST_RUN_ID,
          approvalId: 'prop-other-run',
        })
      ).rejects.toThrow('STALE_APPROVAL_REJECTED');
    });

    it('rejects already REJECTED approval', async () => {
      mockDbTables.agent_approvals.set('prop-rejected', {
        id: 'appr-uuid-rejected',
        workspace_id: TEST_WORKSPACE,
        proposal_id: 'prop-rejected',
        action_run_id: TEST_RUN_ID,
        status: 'REJECTED',
        version: 2,
        graph_revision: 1,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        proposed_value: {},
      });

      await expect(
        ActionGraphResumeEngine.resumeFromApproval({
          workspaceId: TEST_WORKSPACE,
          runId: TEST_RUN_ID,
          approvalId: 'prop-rejected',
        })
      ).rejects.toThrow('STALE_APPROVAL_REJECTED');
    });
  });
});
