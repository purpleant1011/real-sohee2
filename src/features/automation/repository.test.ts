import { describe, expect, it, vi } from 'vitest'
import { getAutomationDashboard, type AutomationGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('getAutomationDashboard', () => {
  it('joins the latest run to each workspace-scoped rule without inventing history', async () => {
    const gateway: AutomationGateway = {
      listRules: vi.fn(async () => ({
        data: [
          {
            id: '70000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            kind: 'content_draft',
            active: true,
            approval_required: true,
            updated_at: '2026-08-09T04:00:00.000Z',
          },
          {
            id: '70000000-0000-4000-8000-000000000002',
            workspace_id: workspaceId,
            kind: 'faq_safe_reply',
            active: false,
            approval_required: false,
            updated_at: '2026-08-09T03:00:00.000Z',
          },
        ],
        error: null,
      })),
      listRuns: vi.fn(async () => ({
        data: [
          {
            id: '80000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            rule_id: '70000000-0000-4000-8000-000000000001',
            status: 'awaiting_approval',
            output_summary: { mode: 'mock', summary: '모의 초안을 준비했습니다.' },
            error_code: null,
            created_at: '2026-08-09T05:00:00.000Z',
            finished_at: '2026-08-09T05:00:01.000Z',
          },
        ],
        error: null,
      })),
    }

    const result = await getAutomationDashboard(workspaceId, gateway)

    expect(result).toMatchObject({
      data: {
        rules: [
          { kind: 'content_draft', lastRun: { status: 'awaiting_approval', mode: 'mock' } },
          { kind: 'faq_safe_reply', lastRun: null },
        ],
      },
    })
  })

  it('rejects a foreign workspace run instead of leaking it into the panel', async () => {
    const gateway: AutomationGateway = {
      listRules: vi.fn(async () => ({ data: [], error: null })),
      listRuns: vi.fn(async () => ({
        data: [{
          id: '80000000-0000-4000-8000-000000000001',
          workspace_id: '20000000-0000-4000-8000-000000000099',
          rule_id: '70000000-0000-4000-8000-000000000001',
          status: 'failed',
          output_summary: { mode: 'mock' },
          error_code: 'mock_provider_unavailable',
          created_at: '2026-08-09T05:00:00.000Z',
          finished_at: '2026-08-09T05:00:01.000Z',
        }], error: null,
      })),
    }

    await expect(getAutomationDashboard(workspaceId, gateway)).resolves.toMatchObject({
      error: { requestId: 'automation-dashboard' },
    })
  })
})
