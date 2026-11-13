import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectorEntry } from './connector-entry'

const context = vi.hoisted(() => ({ workspaceId: 'workspace-a' }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => context.workspaceId }))
afterEach(() => { vi.unstubAllGlobals(); context.workspaceId = 'workspace-a' })
function snapshot(workspaceId: string) {
  return { workspaceId, storageReady: true, connections: [{ connectorId: 'instagram', status: 'connected', lastSyncAt: null, capabilities: [] }] }
}
const response = (workspaceId: string) => new Response(JSON.stringify(snapshot(workspaceId)), { status: 200, headers: { 'content-type': 'application/json' } })

describe('connector entry active workspace boundary', () => {
  it('hides old workspace results while the new workspace loads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('workspace-a')).mockImplementationOnce(() => new Promise(() => {})))
    const view = render(<ConnectorEntry />)
    await screen.findByRole('tab', { name: '사용 가능' })
    context.workspaceId = 'workspace-b'
    view.rerender(<ConnectorEntry />)
    expect(await screen.findByRole('status', { name: '불러오는 중' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '사용 가능' })).not.toBeInTheDocument()
  })
  it('rejects a successful response scoped to a different workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('workspace-b')))
    render(<ConnectorEntry />)
    expect(await screen.findByText('오류가 발생했어요')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '사용 가능' })).not.toBeInTheDocument()
  })
})
