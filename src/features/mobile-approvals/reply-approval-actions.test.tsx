import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplyApprovalActions } from './reply-approval-actions'
const mocks = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('@/features/agent-dock/chat-panel-store', () => ({ useOptionalChatPanel: () => ({ sendFromBar: mocks.chat }) }))
vi.mock('@/features/pwa/use-external-write-guard', () => ({ useExternalWriteGuard: () => async (_kind: string, _id: string, action: () => Promise<void>) => ({ ran: true, value: await action() }) }))
const id = 'comment:11111111-1111-4111-8111-111111111111'
const detail = { thread: { id, workspaceId: 'ws', channel: 'instagram_comment', customerName: '고객님', sendBlockers: ['NO_SEND_SCOPE'], draft: { text: '저장된 답안', sources: [] } }, messages: [{ id: 'source', fromCustomer: true, text: '문의', at: '2026-10-28T00:00:00Z' }], complete: true, version: 1, fingerprint: 'a'.repeat(64), targetLabel: '인스타 댓글 → 고객님', delivery: 'none' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
describe('답안 검토에서 실제 전송까지', () => {
  beforeEach(() => { vi.restoreAllMocks(); mocks.chat.mockClear() })
  it('저장된 정확한 내용의 최종 승인 후에만 한 번 전송한다', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST' ? response({ ok: true, status: 'SENT' }) : response(detail))
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 답안 보내기' }))
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '승인하고 전송' }))
    await screen.findByText('전송 접수됨 · 도착 확인 전')
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))).toMatchObject({ expectedFingerprint: detail.fingerprint })
    expect(screen.queryByRole('button', { name: '이 답안 보내기' })).not.toBeInTheDocument()
  })
  it('편집 중에는 기존 문안 전송을 잠근다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(detail))
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    const input = await screen.findByLabelText('답안 내용')
    fireEvent.change(input, { target: { value: '수정한 답안' } })
    expect(screen.getByRole('button', { name: '이 답안 보내기' })).toBeDisabled()
  })
  it('저장 후 상세 재조회가 실패하면 이전 답안을 다시 승인할 수 없다', async () => {
    const saved = { ...detail, version: 2, fingerprint: 'b'.repeat(64), thread: { ...detail.thread, draft: { text: '수정한 답안', sources: [] } } }
    let reads = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') return response({ saved: true, fingerprint: saved.fingerprint })
      reads += 1
      if (reads === 1) return response(detail)
      if (reads === 2) return response(saved)
      throw new Error('detail unavailable')
    })
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    fireEvent.change(await screen.findByLabelText('답안 내용'), { target: { value: '수정한 답안' } })
    fireEvent.click(screen.getByRole('button', { name: '답안 저장' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: '이 답안 보내기' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('답안 내용')).not.toBeInTheDocument()
  })
  it('불확실한 전송은 재시도하지 않는다', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => { if (init?.method === 'POST') throw new Error('timeout'); return response(detail) })
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 답안 보내기' }))
    fireEvent.click(screen.getByRole('button', { name: '승인하고 전송' }))
    await screen.findByText(/전송 여부를 확인하지 못했어요/)
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '이 답안 보내기' })).not.toBeInTheDocument()
  })
  it.each([{ fingerprint: 'b'.repeat(64) }, { complete: false }, { delivery: 'unknown' }])('최종 확인 이후 검토 조건이 바뀌면 전송하지 않는다: %j', async changed => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(detail)).mockResolvedValue(response({ ...detail, ...changed }))
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 답안 보내기' }))
    fireEvent.click(screen.getByRole('button', { name: '승인하고 전송' }))
    await screen.findByText(/고객 대화나 답안이 바뀌었어요/)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
  it('항목 전환 시 이전 수정안과 최종 확인을 유지하지 않는다', async () => {
    const other = 'dm:22222222-2222-4222-8222-222222222222'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => response(String(url).includes(encodeURIComponent(other)) ? { ...detail, thread: { ...detail.thread, id: other, draft: { text: '새 고객 답안', sources: [] } } } : detail))
    const view = render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 답안 보내기' }))
    view.rerender(<ReplyApprovalActions workspaceId="ws" item={other} />)
    await waitFor(() => expect(screen.getByLabelText('답안 내용')).toHaveValue('새 고객 답안'))
    expect(screen.queryByRole('button', { name: '승인하고 전송' })).not.toBeInTheDocument()
  })
  it('최종 승인을 연속 클릭해도 전송은 한 번만 시작한다', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST' ? response({ ok: true }) : response(detail))
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 답안 보내기' }))
    const button = screen.getByRole('button', { name: '승인하고 전송' })
    fireEvent.click(button); fireEvent.click(button)
    await screen.findByText('전송 접수됨 · 도착 확인 전')
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('다른 workspace 응답을 실행하지 않는다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...detail, thread: { ...detail.thread, workspaceId: 'other' } }))
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: '이 답안 보내기' })).not.toBeInTheDocument()
  })
  it('맥락 변경 지시로 생성된 답안을 편집기에 적용하고 저장·전송하지 않는다', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST' ? response({ draftText: '오후 방문을 안내하는 수정안', basedOnFingerprint: detail.fingerprint }) : response(detail))
    render(<ReplyApprovalActions workspaceId="ws" item={id} />)
    await screen.findByRole('button', { name: '이 답안 보내기' })
    fireEvent.change(screen.getByLabelText('소희에게 수정 요청'), { target: { value: '방문 시간이 오후라고 반영해 줘' } })
    fireEvent.click(screen.getByRole('button', { name: '대화로 다시 쓰기' }))
    await waitFor(() => expect(screen.getByLabelText('답안 내용')).toHaveValue('오후 방문을 안내하는 수정안'))
    expect(screen.getByRole('button', { name: '이 답안 보내기' })).toBeDisabled()
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]).endsWith('/rewrite')).toBe(true)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })
})
