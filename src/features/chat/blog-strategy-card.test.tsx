import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlogStrategyCard } from './blog-strategy-card'
import type { BlogStrategyProposal } from './blog-strategy-proposal'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

const proposal: BlogStrategyProposal = {
  id: '10000000-0000-4000-8000-000000000001', revision: 1, status: 'proposed',
  topics: ['첫 이용 안내', '상담 준비 안내', '선택 확인 사항'].map(title => ({ title, evidence: ['승인된 가게 정보'], questionSource: 'inferred' })),
  goal: { description: '서비스 상담 문의' }, unknowns: ['아직 측정하지 않았어요.'], selectedIndex: null, audience: '서비스 이용을 검토하는 분', constraints: '',
}
const reference = { missionId: '40000000-0000-4000-8000-000000000001', runId: '50000000-0000-4000-8000-000000000001',
  briefId: proposal.id, revision: 1 }
afterEach(() => vi.restoreAllMocks())
describe('blog topic decision card', () => {
  it('offers an explicit existing-interview path only when a business goal cannot be linked', async () => {
    const onGenerate = vi.fn()
    const onPrepareOnly = vi.fn(async () => true)
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => options?.method === 'GET'
      ? Response.json({ data: null })
      : Response.json({ error: { code: 'MARKETING_STRATEGY_GOAL_REQUIRED' } }, { status: 409 }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} onPrepareOnly={onPrepareOnly} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    fireEvent.click(await screen.findByRole('button', { name: '목표 없이 원고 준비 질문 시작' }))
    await waitFor(() => expect(onPrepareOnly).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('원고 준비 질문을 요청했어요')
    expect(onGenerate).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/blog-strategy'))).toBe(true)
  })

  it.each(['MARKETING_STRATEGY_FORBIDDEN', 'MARKETING_STRATEGY_CONTROL_BLOCKED', 'MARKETING_STRATEGY_STALE'])('does not offer preparation as a bypass for %s', async code => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { code } }, { status: 409 }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} onPrepareOnly={vi.fn()} />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: '목표 없이 원고 준비 질문 시작' })).toBeNull()
  })
  it('restores the saved selection on reentry without writing or generating', async () => {
    const onGenerate = vi.fn()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      data: { ...proposal, revision: 4, selectedIndex: 1, constraints: '할인 내용 제외' }, generationCredits: 30,
    }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} />)
    expect(await screen.findByRole('radio', { name: '상담 준비 안내' })).toBeChecked()
    expect(screen.getByLabelText('반영할 조건')).toHaveValue('할인 내용 제외')
    expect(screen.getByRole('button', { name: '이 전략 승인' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(onGenerate).not.toHaveBeenCalled()
  })
  it('승인한 뒤에는 원고가 따를 핵심 키워드를 보여주고 검색 수요 측정 전임을 숨기지 않는다', async () => {
    const topics = proposal.topics.map((topic, index) => index === 1
      ? { ...topic, primaryKeyword: '강남 눈썹문신 상담', keywordStatus: 'NOT_OBSERVED' as const }
      : { ...topic, primaryKeyword: '다른 키워드', keywordStatus: 'NOT_OBSERVED' as const })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      data: { ...proposal, topics, revision: 3, status: 'approved', selectedIndex: 1, reference }, generationCredits: 30,
    }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('원고 핵심 키워드: 강남 눈썹문신 상담')
    expect(status).toHaveTextContent('검색 수요 측정 전')
    expect(status).not.toHaveTextContent('다른 키워드')
  })
  it('키워드 없는 주제를 승인하면 키워드 문구를 만들어 보여주지 않는다', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      data: { ...proposal, revision: 3, status: 'approved', selectedIndex: 1, reference }, generationCredits: 30,
    }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    expect(await screen.findByRole('status')).not.toHaveTextContent('원고 핵심 키워드')
  })
  it('does not overwrite an explicit open with a late reentry read', async () => {
    let finishRead!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'GET') return new Promise<Response>(resolve => { finishRead = resolve })
      return Response.json({ data: { ...proposal, revision: 5, selectedIndex: 2 } })
    })
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    expect(await screen.findByRole('radio', { name: '선택 확인 사항' })).toBeChecked()
    await act(async () => finishRead(Response.json({ data: { ...proposal, revision: 4, selectedIndex: 0 } })))
    expect(screen.getByRole('radio', { name: '선택 확인 사항' })).toBeChecked()
  })
  it('keeps an empty reentry read read-only across ordinary rerenders', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: null }))
    const onGenerate = vi.fn()
    const { rerender } = render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} />)
    await act(async () => {})
    rerender(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} disabled />)
    expect(screen.getByRole('button', { name: '블로그 주제 정하기' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(onGenerate).not.toHaveBeenCalled()
  })
  it('shows a failed reentry read as an error rather than an empty saved strategy', async () => {
    const onGenerate = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: { code: 'CHAT_STRATEGY_UNAVAILABLE' } }, { status: 503 }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('저장한 전략을 확인하지 못했어요')
    expect(onGenerate).not.toHaveBeenCalled()
  })
  it('aborts the restoration request when leaving the conversation', () => {
    let signal: AbortSignal | null | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      signal = options?.signal
      return new Promise<Response>(() => {})
    })
    const { unmount } = render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
  it('shows saved evidence and requires saving edits before the briefing recommends approval', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: { ...proposal, selectedIndex: 1 } }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    await screen.findByRole('region', { name: '현재 상황' })
    expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('전략만 승인')
    fireEvent.change(screen.getByLabelText('반영할 조건'), { target: { value: '가격 안내 제외' } })
    expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('먼저 저장')
    expect(screen.getByRole('region', { name: '제안 기회' })).not.toHaveTextContent('가격 안내 제외')
    expect(screen.getByRole('button', { name: '이 전략 승인' })).toBeDisabled()
  })
  it('persists a selection and conditions, then requires explicit owner approval before generation', async () => {
    const onGenerate = vi.fn(async () => true)
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'GET') return Response.json({ data: null })
      const body = JSON.parse(String(options?.body))
      if (body.action === 'open') return Response.json({ data: proposal })
      if (body.action === 'select') return Response.json({ data: { ...proposal, revision: 2, selectedIndex: 1,
        audience: body.audience, constraints: body.constraints } })
      return Response.json({ data: { ...proposal, revision: 3, status: 'approved', selectedIndex: 1, reference }, generationCredits: 30 })
    })
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} />)
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET')
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    await screen.findByText('상담 준비 안내')
    expect(screen.getByRole('button', { name: '이 전략 승인' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('상담 준비 안내'))
    fireEvent.change(screen.getByLabelText('반영할 조건'), { target: { value: '할인 내용 제외' } })
    fireEvent.click(screen.getByRole('button', { name: '선택·조건 저장' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toMatchObject({ action: 'select', selectedIndex: 1, constraints: '할인 내용 제외' })
    expect(onGenerate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('가게 사실과 목표를 확인했으며 이 전략을 승인해요.'))
    fireEvent.click(screen.getByRole('button', { name: '이 전략 승인' }))
    await screen.findByRole('button', { name: '승인한 전략으로 원고 준비' })
    expect(onGenerate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '승인한 전략으로 원고 준비' }))
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(reference))
  })
  it('hides credit numbers and credit phrases before approval without executing generation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: proposal, generationCredits: 30 }))
    const onGenerate = vi.fn()
    const { container } = render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    expect(await screen.findByText('원고와 이미지를 준비할 수 있어요. 실행 직전 적용 기준을 다시 확인해요.')).toBeVisible()
    expect(screen.getByText('승인은 선택한 전략만 저장해요. 원고·이미지 생성이나 외부 게시는 실행하지 않아요.')).toBeVisible()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('차감')
    expect(container.textContent).not.toContain('SC')
    expect(screen.getByRole('button', { name: '이 전략 승인' })).toBeDisabled()
    expect(onGenerate).not.toHaveBeenCalled()
  })
  it('hides credit cost numbers and phrasing on mobile R2', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: proposal, generationCredits: 30 }))
    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />
      </MobileR2Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    expect(await screen.findByText('원고와 이미지를 준비할 수 있어요. 실행 직전 적용 기준을 다시 확인해요.')).toBeVisible()
    expect(screen.getByText('승인은 선택한 전략만 저장해요. 원고·이미지 생성이나 외부 게시는 실행하지 않아요.')).toBeVisible()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('차감')
    expect(container.textContent).not.toContain('SC')
  })
  it('does not treat an offline read as an empty or successful proposal', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: { code: 'CHAT_STRATEGY_UNAVAILABLE' } }, { status: 503 }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('불러오지 못했어요')
    expect(screen.queryByRole('button', { name: '이 전략 승인' })).not.toBeInTheDocument()
  })
  it('shows the required preparation without inventing mission IDs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: { code: 'MARKETING_STRATEGY_RUN_REQUIRED' } }, { status: 409 }))
    render(<BlogStrategyCard workspaceId="workspace" threadId="thread" onGenerate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결할 업무')
  })
})
