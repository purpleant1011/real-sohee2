import { describe, expect, it, vi } from 'vitest'
import type { WorkSummaryGateway } from './work-summary'
import { getWorkSummary } from './work-summary'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const foreignWorkspaceId = '10000000-0000-4000-8000-000000000002'
const content1 = '20000000-0000-4000-8000-000000000001'
const content2 = '20000000-0000-4000-8000-000000000002'
const content3 = '20000000-0000-4000-8000-000000000003'
const content4 = '20000000-0000-4000-8000-000000000004'
const version1 = '30000000-0000-4000-8000-000000000001'
const version2 = '30000000-0000-4000-8000-000000000002'
const version3 = '30000000-0000-4000-8000-000000000003'
const version4 = '30000000-0000-4000-8000-000000000004'

function gateway(overrides: Partial<WorkSummaryGateway> = {}): WorkSummaryGateway {
  return {
    listContentItems: vi.fn(async () => ({
      data: [
        { id: content1, workspace_id: workspaceId, status: 'draft', current_version_id: version1 },
        { id: content2, workspace_id: workspaceId, status: 'approved', current_version_id: version2 },
        { id: content3, workspace_id: workspaceId, status: 'scheduled', current_version_id: version3 },
        { id: content4, workspace_id: workspaceId, status: 'review', current_version_id: version4 },
      ],
      count: 4,
      error: null,
    })),
    listWorkItems: vi.fn(async () => ({
      data: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          workspace_id: workspaceId,
          status: 'drafting',
          content_item_id: content1,
        },
        {
          id: '40000000-0000-4000-8000-000000000002',
          workspace_id: workspaceId,
          status: 'researching',
          content_item_id: content4,
        },
      ],
      count: 2,
      error: null,
    })),
    listFailedSchedules: vi.fn(async () => ({
      data: [
        { workspace_id: workspaceId, content_id: content3 },
        { workspace_id: foreignWorkspaceId, content_id: content1 },
      ],
      count: 2,
      error: null,
    })),
    listApprovedVersions: vi.fn(async () => ({
      data: [
        {
          workspace_id: workspaceId,
          content_id: content2,
          version_id: version2,
          status: 'approved',
        },
      ],
      count: 1,
      error: null,
    })),
    ...overrides,
  }
}

describe('getWorkSummary', () => {
  it('deduplicates linked content work and returns one list-aligned workspace summary', async () => {
    await expect(getWorkSummary(workspaceId, gateway())).resolves.toEqual({
      all: 4,
      inProgress: 2,
      recovery: 1,
      approved: 1,
    })
  })

  it('does not disguise a failed or truncated source as zero work', async () => {
    const failed = gateway({
      listWorkItems: vi.fn(async () => ({ data: null, count: null, error: new Error('private') })),
    })
    await expect(getWorkSummary(workspaceId, failed)).resolves.toEqual({ available: false })

    const truncated = gateway({
      listContentItems: vi.fn(async () => ({
        data: [{ id: content1, workspace_id: workspaceId, status: 'draft', current_version_id: version1 }],
        count: 2,
        error: null,
      })),
    })
    await expect(getWorkSummary(workspaceId, truncated)).resolves.toEqual({ available: false })
  })
})
