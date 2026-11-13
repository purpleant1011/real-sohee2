// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill, StateChip } from './index'

describe('StatusPill — 세로 깨짐 방지 및 컴팩트 계약', () => {
  it('줄바꿈 방지(whitespace-nowrap)와 축소 방지(shrink-0), 24px 고정 높이(h-6)를 갖는다', () => {
    const { container } = render(<StatusPill kind="verified" />)
    const pill = container.firstElementChild as HTMLElement
    expect(pill.className).toContain('whitespace-nowrap')
    expect(pill.className).toContain('shrink-0')
    expect(pill.className).toContain('leading-none')
    expect(pill.className).toMatch(/h-6|min-h-6/)
  })

  it('색만으로 상태를 전달하지 않고 아이콘을 항상 포함한다', () => {
    const { container } = render(<StatusPill kind="action_needed" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('조치 필요')).toBeTruthy()
  })

  it('긴 라벨(게시 확인 전, 승인 완료 · 게시 확인 전)은 자동으로 짧은 라벨로 매핑된다', () => {
    render(<StatusPill kind="checking_external" label="게시 확인 전" />)
    expect(screen.getByText('확인 전')).toBeTruthy()
  })

  it('compact 변형은 핵심 단어로 단축하고 전체 문구를 title 및 aria-label로 제공한다', () => {
    const { container } = render(<StatusPill kind="awaiting_approval" compact />)
    expect(screen.getByText('승인 대기')).toBeTruthy()
    const pill = container.firstElementChild as HTMLElement
    expect(pill.getAttribute('aria-label') || pill.getAttribute('title')).toContain('사용자 승인 대기')
  })

  it('compact 변형에서 외부 확인 중은 확인 중으로 단축된다', () => {
    render(<StatusPill kind="checking_external" compact />)
    expect(screen.getByText('확인 중')).toBeTruthy()
  })

  it('검토 중 등 5자 이하 표준 라벨은 compact가 아닐 때 그대로 유지된다', () => {
    render(<StatusPill kind="review" label="검토 중" />)
    expect(screen.getByText('검토 중')).toBeTruthy()
  })

  it('StateChip도 whitespace-nowrap과 shrink-0을 갖는다', () => {
    const { container } = render(<StateChip kind="loading" />)
    const chip = container.firstElementChild as HTMLElement
    expect(chip.className).toContain('whitespace-nowrap')
    expect(chip.className).toContain('shrink-0')
  })
})

describe('모바일 카드 전수 방지 정적 계약', () => {
  it('StatusPill 소스에 whitespace-nowrap, shrink-0, leading-none, h-6이 반드시 포함된다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/mobile-ui/status-pill.tsx', 'utf8')
    expect(src).toContain('whitespace-nowrap')
    expect(src).toContain('shrink-0')
    expect(src).toContain('leading-none')
    expect(src).toMatch(/h-6|min-h-6/)
  })

  it('StateChip 소스에 whitespace-nowrap, shrink-0이 반드시 포함된다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/mobile-ui/state-chip.tsx', 'utf8')
    expect(src).toContain('whitespace-nowrap')
    expect(src).toContain('shrink-0')
  })

  it('작업 목록 카드(hub-view.tsx)의 제목 컨테이너가 min-w-0 flex-1을 갖고 StatusPill이 shrink-0을 갖는다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/features/mobile-hub/hub-view.tsx', 'utf8')
    expect(src).toMatch(/min-w-0 flex-1/)
    expect(src).toMatch(/truncate/)
    expect(src).toMatch(/StatusPill[^>]*shrink-0/)
  })

  it('승인 카드(r2-approval-view.tsx)의 제목 컨테이너가 min-w-0 flex-1을 갖는다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/features/mobile-approvals/r2-approval-view.tsx', 'utf8')
    expect(src).toMatch(/min-w-0 flex-1/)
    expect(src).toMatch(/truncate/)
  })

  it('소통함 카드(inbox-view.tsx)의 제목 컨테이너가 min-w-0 flex-1을 갖는다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/features/mobile-inbox/inbox-view.tsx', 'utf8')
    expect(src).toMatch(/min-w-0 flex-1/)
    expect(src).toMatch(/truncate/)
  })

  it('compact 에서도 매핑에 없는 라벨은 글자를 자르지 않는다("답안 준비됨"이 "답안 준"이 되면 안 된다)', () => {
    render(<StatusPill kind="verified" label="답안 준비됨" compact />)
    expect(screen.getByText('답안 준비됨')).toBeInTheDocument()
  })
})
