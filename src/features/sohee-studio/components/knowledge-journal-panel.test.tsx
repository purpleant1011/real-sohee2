import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { journalSourceKinds, journalSourceTypes, KNOWLEDGE_JOURNAL_NOTICE } from '../knowledge-journal'
import { KnowledgeJournalPanel } from './knowledge-journal-panel'
const scope = vi.hoisted(() => ({ workspaceId: '20000000-0000-4000-8000-000000000001' }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => scope.workspaceId }))
const ws = '20000000-0000-4000-8000-000000000001'
const record = { id: 'message:30000000-0000-4000-8000-000000000001', sourceId: '30000000-0000-4000-8000-000000000001', sourceType: 'message', kind: 'instruction',
  title: '대화 지시·요청', summary: '매주 월요일 성과를 보고해줘', statusLabel: '원문 기록됨', occurredAt: '2026-10-30T00:00:00Z', href: '/app/conversations/40000000-0000-4000-8000-000000000001' }
const value = { workspaceId: ws, observedAt: '2026-10-30T00:00:00Z', entries: [record],
  sources: journalSourceTypes.map(sourceType => ({ sourceType, kind: journalSourceKinds[sourceType], state: sourceType === 'message' ? 'ready' : 'confirmed_empty', returnedCount: sourceType === 'message' ? 1 : 0 })), partial: false, notice: KNOWLEDGE_JOURNAL_NOTICE }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); scope.workspaceId = ws })
describe('knowledge and work journal panel', () => {
  it('shows durable instruction records with source links without writing or claiming approval', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: value })); vi.stubGlobal('fetch', fetcher)
    render(<KnowledgeJournalPanel workspaceId={ws} />)
    expect(await screen.findByText(record.summary)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '원본 보기' })).toHaveAttribute('href', record.href)
    expect(screen.getByText('원문 기록됨')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/workspaces/${ws}/sohee-studio/journal`, expect.objectContaining({ method: 'GET', cache: 'no-store' }))
  })
  it('reports failed source access instead of pretending the journal is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'private error' }, 503)))
    render(<KnowledgeJournalPanel workspaceId={ws} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('기록을 불러오지 못했어요')
    expect(screen.queryByText('아직 연결된 기록이 없어요.')).not.toBeInTheDocument()
  })
  it('retains available entries and distinguishes partial source failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: { ...value, partial: true,
      sources: value.sources.map(source => source.sourceType === 'agent_memory' ? { ...source, state: 'unavailable', returnedCount: null } : source) } })))
    render(<KnowledgeJournalPanel workspaceId={ws} />)
    expect(await screen.findByText(record.summary)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('일부 자료를 확인하지 못했어요')
  })
  it('hides prior-workspace records immediately and rejects foreign API results', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: value })).mockResolvedValueOnce(response({ data: value }))
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<KnowledgeJournalPanel workspaceId={ws} />)
    await screen.findByText(record.summary)
    scope.workspaceId = '21000000-0000-4000-8000-000000000001'
    rerender(<KnowledgeJournalPanel workspaceId={scope.workspaceId} />)
    expect(screen.queryByText(record.summary)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('기록을 불러오지 못했어요'))
  })
})
