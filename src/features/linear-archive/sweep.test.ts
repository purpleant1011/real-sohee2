import { describe, expect, it, vi } from 'vitest'
import { sweepLinearDoneIssues } from './sweep'

const TEAM_ID = 'fe9ce92a-6944-441c-8c02-6791df6e8061'
const NOW = Date.parse('2026-09-02T00:30:00.000Z')

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Linear Done sweep', () => {
  it('archives every non-archived Done issue older than 15 minutes', async () => {
    const archivedIds: string[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> }
      if (request.query?.includes('SoheeLinearDoneSweep')) {
        return jsonResponse({
          data: {
            team: {
              issues: {
                nodes: [
                  { id: 'old-1', identifier: 'ANI-1', archivedAt: null, completedAt: '2026-09-02T00:14:59.000Z', state: { type: 'completed' } },
                  { id: 'fresh-1', identifier: 'ANI-2', archivedAt: null, completedAt: '2026-09-02T00:20:00.000Z', state: { type: 'completed' } },
                  { id: 'open-1', identifier: 'ANI-3', archivedAt: null, completedAt: null, state: { type: 'started' } },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        })
      }

      if (request.query?.includes('SoheeLinearArchiveOne')) {
        archivedIds.push(String(request.variables?.id))
        return jsonResponse({ data: { issueArchive: { success: true } } })
      }

      return jsonResponse({ errors: [{ message: 'unexpected query' }] })
    })

    const result = await sweepLinearDoneIssues({
      apiKey: 'linear-api-key-at-least-20-characters',
      teamId: TEAM_ID,
      now: () => NOW,
      fetcher: fetcher as typeof fetch,
    })

    expect(archivedIds).toEqual(['old-1'])
    expect(result).toMatchObject({ scanned: 3, eligible: 1, archived: 1, failed: 0 })
  })

  it('paginates through the team before archiving so the backlog can be cleared safely', async () => {
    const archivedIds: string[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> }
      if (request.query?.includes('SoheeLinearDoneSweep')) {
        const after = request.variables?.after
        if (!after) {
          return jsonResponse({ data: { team: { issues: {
            nodes: [{ id: 'old-1', identifier: 'ANI-1', archivedAt: null, completedAt: '2026-09-01T20:00:00.000Z', state: { type: 'completed' } }],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          } } } })
        }
        return jsonResponse({ data: { team: { issues: {
          nodes: [{ id: 'old-2', identifier: 'ANI-2', archivedAt: null, completedAt: '2026-09-01T21:00:00.000Z', state: { type: 'completed' } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } } })
      }
      if (request.query?.includes('SoheeLinearArchiveOne')) {
        archivedIds.push(String(request.variables?.id))
        return jsonResponse({ data: { issueArchive: { success: true } } })
      }
      return jsonResponse({ errors: [{ message: 'unexpected query' }] })
    })

    const result = await sweepLinearDoneIssues({
      apiKey: 'linear-api-key-at-least-20-characters',
      teamId: TEAM_ID,
      now: () => NOW,
      fetcher: fetcher as typeof fetch,
    })

    expect(archivedIds).toEqual(['old-1', 'old-2'])
    expect(result).toMatchObject({ scanned: 2, eligible: 2, archived: 2, failed: 0 })
  })

  it('continues when one archive mutation fails so the next minute can retry only what remains', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> }
      if (request.query?.includes('SoheeLinearDoneSweep')) {
        return jsonResponse({ data: { team: { issues: {
          nodes: [
            { id: 'old-1', identifier: 'ANI-1', archivedAt: null, completedAt: '2026-09-01T20:00:00.000Z', state: { type: 'completed' } },
            { id: 'old-2', identifier: 'ANI-2', archivedAt: null, completedAt: '2026-09-01T20:01:00.000Z', state: { type: 'completed' } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } } })
      }
      if (request.query?.includes('SoheeLinearArchiveOne')) {
        const id = String(request.variables?.id)
        if (id === 'old-1') return jsonResponse({ errors: [{ message: 'rate limited' }] })
        return jsonResponse({ data: { issueArchive: { success: true } } })
      }
      return jsonResponse({ errors: [{ message: 'unexpected query' }] })
    })

    const result = await sweepLinearDoneIssues({
      apiKey: 'linear-api-key-at-least-20-characters',
      teamId: TEAM_ID,
      now: () => NOW,
      fetcher: fetcher as typeof fetch,
    })

    expect(result).toMatchObject({ eligible: 2, archived: 1, failed: 1 })
  })
})
