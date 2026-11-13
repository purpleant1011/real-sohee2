import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { InteractionDraftCardData } from '@/features/engagement/interaction-draft-contract'
import { ConversationInteractionDraftCard } from './conversation-interaction-draft-card'
const mocks = vi.hoisted(() => ({ workspaceId: '20000000-0000-4000-8000-000000000001', guard: vi.fn() }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => mocks.workspaceId }))
vi.mock('@/features/pwa/use-external-write-guard', () => ({ useExternalWriteGuard: () => mocks.guard }))
const snapshot: InteractionDraftCardData = { id: '40000000-0000-4000-8000-000000000001', kind: 'interaction_draft',
  workspaceId: '20000000-0000-4000-8000-000000000001', targetKind: 'comment', channel: 'threads',
  targetId: '60000000-0000-4000-8000-000000000001', draftId: '70000000-0000-4000-8000-000000000001',
  draftText: '상담 후 안내드릴게요.', fingerprint: 'a'.repeat(64), sourceRef: 'b'.repeat(64), customerLabel: '문의 고객',
  preparedAt: '2026-10-29T12:00:00Z', reused: false, requiresUserApproval: true }
const threadId = '30000000-0000-4000-8000-000000000001'
const review = { snapshot: (({ id: _id, ...value }) => value)(snapshot), sourceText: '가격을 알려주세요.', currentDraftText: snapshot.draftText,
  canSend: true, reason: null, observedAt: '2026-10-30T00:00:00Z' }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
beforeEach(() => {
  mocks.workspaceId = snapshot.workspaceId
  mocks.guard.mockReset().mockImplementation(async (_kind: string, _key: string, task: () => Promise<unknown>) => ({ ran: true, value: await task() }))
})
afterEach(() => { vi.unstubAllGlobals() })
describe('conversation canonical reply draft review card', () => {
  it('does not fetch or send on mount and requires fresh source review before an explicit send', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: review })).mockResolvedValueOnce(response({ ok: true, status: 'SENT' }))
    vi.stubGlobal('fetch', fetcher)
    render(<ConversationInteractionDraftCard snapshot={snapshot} threadId={threadId} />)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '최신 원문과 답안 확인' }))
    await screen.findByText('가격을 알려주세요.')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(mocks.guard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '이 문안으로 발송' }))
    await screen.findByText('발송 요청이 처리됐어요. 최종 결과는 소통함에서 확인할 수 있어요.')
    expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining(`/engagement/comments/${snapshot.targetId}/send`), expect.objectContaining({ method: 'POST',
      body: JSON.stringify({ expectedFingerprint: snapshot.fingerprint, expectedSourceFingerprint: snapshot.sourceRef }) }))
    expect(mocks.guard).toHaveBeenCalledWith('send', `comment:${snapshot.targetId}`, expect.any(Function))
  })
  it('disables old approval when the current source or draft has changed', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: { ...review, canSend: false, reason: 'SOURCE_CHANGED' } }))
    vi.stubGlobal('fetch', fetcher)
    render(<ConversationInteractionDraftCard snapshot={snapshot} threadId={threadId} />)
    fireEvent.click(screen.getByRole('button', { name: '최신 원문과 답안 확인' }))
    await screen.findByText('고객 원문이 바뀌었어요. 최신 문의에 맞춰 답안을 다시 준비해 주세요.')
    expect(screen.getByRole('button', { name: '이 문안으로 발송' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('keeps read-only and foreign-workspace cards from opening approval', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<ConversationInteractionDraftCard snapshot={snapshot} threadId={threadId} readOnly />)
    expect(screen.getByRole('button', { name: '최신 원문과 답안 확인' })).toBeDisabled()
    mocks.workspaceId = '21000000-0000-4000-8000-000000000001'
    rerender(<ConversationInteractionDraftCard snapshot={snapshot} threadId={threadId} />)
    expect(screen.getByRole('button', { name: '최신 원문과 답안 확인' })).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([500, 200])('treats an unconfirmed native send response as unknown: HTTP %s', async status => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: review })).mockResolvedValueOnce(response({ ok: false }, status))
    vi.stubGlobal('fetch', fetcher)
    render(<ConversationInteractionDraftCard snapshot={snapshot} threadId={threadId} />)
    fireEvent.click(screen.getByRole('button', { name: '최신 원문과 답안 확인' }))
    await screen.findByText('가격을 알려주세요.')
    fireEvent.click(screen.getByRole('button', { name: '이 문안으로 발송' }))
    await screen.findByText('발송 결과를 확인하지 못했어요. 다시 보내지 말고 소통함에서 결과를 확인해 주세요.')
    expect(screen.getByRole('button', { name: '이 문안으로 발송' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not retry a send after a lost response or claim delivery completed', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: review })).mockRejectedValueOnce(new Error('connection lost'))
    vi.stubGlobal('fetch', fetcher)
    render(<ConversationInteractionDraftCard snapshot={snapshot} threadId={threadId} />)
    fireEvent.click(screen.getByRole('button', { name: '최신 원문과 답안 확인' }))
    await screen.findByText('가격을 알려주세요.')
    fireEvent.click(screen.getByRole('button', { name: '이 문안으로 발송' }))
    await screen.findByText('발송 결과를 확인하지 못했어요. 다시 보내지 말고 소통함에서 결과를 확인해 주세요.')
    expect(screen.getByRole('button', { name: '이 문안으로 발송' })).toBeDisabled()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getAllByRole('button', { name: '닫기' })[0])
    fetcher.mockResolvedValueOnce(response({ data: review }))
    fireEvent.click(screen.getByRole('button', { name: '최신 원문과 답안 확인' }))
    await screen.findByText('가격을 알려주세요.')
    expect(screen.getByRole('button', { name: '이 문안으로 발송' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
