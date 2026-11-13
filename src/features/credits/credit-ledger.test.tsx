import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditLedger } from './credit-ledger'

describe('CreditLedger', () => {
  it('separates grant, use, temporary reserve, and return or adjustment rows with filters', () => {
    render(<CreditLedger entries={[
      { id: '1', workspaceId: 'w', accountId: 'a', reservationId: null, kind: 'grant', action: null, amount: 100, idempotencyKey: 'g', occurredAt: '2026-08-19T00:00:00.000Z' },
      { id: '2', workspaceId: 'w', accountId: 'a', reservationId: 'r', kind: 'reserve', action: 'chat_turn', amount: 5, idempotencyKey: 'r', occurredAt: '2026-08-19T01:00:00.000Z' },
      { id: '3', workspaceId: 'w', accountId: 'a', reservationId: 'r', kind: 'consume', action: 'chat_turn', amount: 5, idempotencyKey: 'c', occurredAt: '2026-08-19T01:01:00.000Z' },
      { id: '4', workspaceId: 'w', accountId: 'a', reservationId: 'r', kind: 'release', action: 'chat_turn', amount: 2, idempotencyKey: 'l', occurredAt: '2026-08-19T01:02:00.000Z' },
    ]} />)
    expect(screen.getAllByText('제공')).toHaveLength(2)
    expect(screen.getAllByText('임시 확보')).toHaveLength(2)
    expect(screen.getAllByText('사용')).toHaveLength(2)
    expect(screen.getAllByText('반환 또는 조정')).toHaveLength(4)
    expect(screen.getByLabelText('기간 필터')).toBeInTheDocument()
    expect(screen.getByLabelText('작업 종류 필터')).toBeInTheDocument()
  })

  it('renders friendly Korean descriptions without credit amount numbers or signs', () => {
    render(<CreditLedger entries={[
      { id: '1', workspaceId: 'w', accountId: 'a', reservationId: null, kind: 'consume', action: 'text_generation', amount: 100, idempotencyKey: 'c1', occurredAt: '2026-08-19T00:00:00.000Z' },
      { id: '2', workspaceId: 'w', accountId: 'a', reservationId: null, kind: 'consume', action: 'image_generation', amount: 150, idempotencyKey: 'c2', occurredAt: '2026-08-19T01:00:00.000Z' },
      { id: '3', workspaceId: 'w', accountId: 'a', reservationId: null, kind: 'release', action: null, amount: 150, idempotencyKey: 'r1', occurredAt: '2026-08-19T02:00:00.000Z' },
    ]} />)

    expect(screen.getByText('인스타그램 글 생성')).toBeInTheDocument()
    expect(screen.getByText('고화질 이미지 렌더링')).toBeInTheDocument()
    expect(screen.getByText('실패 작업 반환 및 잔여 환급')).toBeInTheDocument()
    expect(screen.queryByText(/-100 크레딧/)).toBeNull()
    expect(screen.queryByText(/-150 크레딧/)).toBeNull()
    expect(screen.queryByText(/\+150 크레딧/)).toBeNull()
    expect(screen.queryByText(/기록 수치/)).toBeNull()
  })
})
