import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalCard, type ApprovalCardTarget } from './approval-card'

const verdicts = (vault: boolean, publish: boolean, schedule: boolean) => ({
  VAULT: { allowed: vault, message: vault ? null : '원고를 확인해 주세요' },
  PUBLISH: { allowed: publish, message: publish ? null : '채널을 연결해 주세요' },
  SCHEDULE: { allowed: schedule, message: schedule ? null : '예약할 시간을 입력해 주세요' },
})
const instagram: ApprovalCardTarget = {
  channel: 'instagram', handle: '@momocafe',
  variant: { handle: '@momocafe', caption: '우리 가게 첫 인사', imageUrl: null },
  specLabel: '규격 확인 완료', actions: verdicts(true, true, false),
}
const threads: ApprovalCardTarget = {
  channel: 'threads', handle: '',
  variant: { handle: '', caption: '새로운 소식', imageUrl: null },
  specLabel: '규격 확인 필요', actions: verdicts(true, false, false),
}
const base = { workspaceId: 'ws-test', contentId: 'content-1', versionId: 'version-1', targets: [instagram, threads], onRevise: vi.fn(), onPublish: vi.fn(), onSchedule: vi.fn(), fetcher: vi.fn() }

function renderCard(overrides: Partial<React.ComponentProps<typeof ApprovalCard>> = {}) {
  return render(<ApprovalCard {...base} {...overrides} />)
}

describe('ApprovalCard', () => {
  it.each([
    [true, true, true], [true, true, false], [true, false, false], [false, false, false],
  ])('uses the server verdicts without choosing an action (vault=%s publish=%s schedule=%s)', (vault, publish, schedule) => {
    renderCard({ targets: [{ ...instagram, actions: verdicts(vault, publish, schedule) }] })
    expect(screen.getByRole('button', { name: '승인하고 보관' }).hasAttribute('disabled')).toBe(!vault)
    expect(screen.getByRole('button', { name: '승인하고 발행' }).hasAttribute('disabled')).toBe(!publish)
    expect(screen.getByRole('button', { name: '승인하고 예약' }).hasAttribute('disabled')).toBe(!schedule)
    expect(base.fetcher).not.toHaveBeenCalled()
  })

  it('shows one preview per channel with account and spec summary; never substitutes business name for missing handle', () => {
    renderCard()
    expect(screen.getByText(/대상 계정 @momocafe · 규격 확인 완료/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '인스타그램 예상 화면' })).toHaveTextContent('실제 게시 화면과 다를 수 있어요.')
    fireEvent.click(screen.getByRole('tab', { name: '스레드' }))
    expect(screen.getByText(/대상 계정 연결 전 · 규격 확인 필요/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '스레드 예상 화면' })).toBeInTheDocument()
    expect(screen.getAllByText(/채널을 연결해 주세요/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '승인하고 발행' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('tab', { name: '스레드' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '인스타그램' })).toHaveAttribute('aria-selected', 'true')
  })

  it('reuses the voice revision callback and never fires an action without explicit input', () => {
    const onRevise = vi.fn()
    const onPublish = vi.fn()
    renderCard({ targets: [instagram], onRevise, onPublish })
    fireEvent.click(screen.getByRole('button', { name: '말투 고치기' }))
    expect(onRevise).toHaveBeenCalledOnce()
    expect(onPublish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '승인하고 발행' }))
    expect(onPublish).toHaveBeenCalledOnce()
  })

  it('posts explicit selected channels, displays partial success and the returned zero count', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: [{ channel: 'instagram', status_label: '발행 준비 완료 · 외부 게시 전', release_gate_label: '채널 연결을 기다리는 중 · 외부 게시 전' }], rejected: [{ channel: 'threads', reason_label: '원고를 확인해 주세요' }], external_posts: 0 }) })
    renderCard({ fetcher })
    fireEvent.click(screen.getByRole('button', { name: '승인하고 보관' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('발행 준비 완료 · 외부 게시 전'))
    expect(screen.getByText('외부 게시 0건')).toBeInTheDocument()
    expect(screen.getByText(/스레드.*원고를 확인해 주세요/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/workspaces/ws-test/vault', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).toMatchObject({ contentId: 'content-1', versionId: 'version-1', channels: ['instagram', 'threads'], targetDate: null })
    expect(body.idempotencyKey).toBeTruthy()
  })

  it('fails closed for missing policy, even when a target handle is present', () => {
    const fetcher = vi.fn()
    renderCard({ targets: [{ ...instagram, actions: undefined }], fetcher })
    expect(screen.getByRole('button', { name: '승인하고 보관' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '승인하고 발행' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '승인하고 예약' })).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a nonzero external post count instead of displaying a false success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: [{ channel: 'instagram', status_label: '발행 준비 완료 · 외부 게시 전', release_gate_label: '발행 준비 완료 · 외부 게시 전' }], rejected: [], external_posts: 1 }) })
    renderCard({ targets: [instagram], fetcher })
    fireEvent.click(screen.getByRole('button', { name: '승인하고 보관' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('보관 결과를 확인할 수 없어요')
    expect(screen.queryByText('외부 게시 0건')).not.toBeInTheDocument()
  })

  it('does not report success for an empty saved array or errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ saved: [], rejected: [{ channel: 'instagram', reason_label: '이미지를 확인해 주세요' }], external_posts: 0 }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: '잠시 후 다시 시도해 주세요.' }) })
    renderCard({ targets: [instagram], fetcher })
    fireEvent.click(screen.getByRole('button', { name: '승인하고 보관' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미지를 확인해 주세요')
    expect(screen.queryByText('발행 준비 완료 · 외부 게시 전')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '승인하고 보관' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.'))
  })

  it('locks actions while saving, retaining the same request key on retry', async () => {
    let complete!: (value: unknown) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: [{ channel: 'instagram', status_label: '발행 준비 완료 · 외부 게시 전', release_gate_label: '발행 준비 완료 · 외부 게시 전' }], rejected: [], external_posts: 0 }) })
    renderCard({ targets: [instagram], fetcher })
    fireEvent.click(screen.getByRole('button', { name: '승인하고 보관' }))
    expect(screen.getByRole('button', { name: '승인하고 보관' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '승인하고 발행' })).toBeDisabled()
    complete({ ok: false, json: async () => ({ error: '다시 시도해 주세요.' }) })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '승인하고 보관' }))
    await screen.findByRole('status')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).idempotencyKey).toBe(JSON.parse(fetcher.mock.calls[1][1].body).idempotencyKey)
  })
})
