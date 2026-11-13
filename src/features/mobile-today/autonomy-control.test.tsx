import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AutonomyControl } from './autonomy-control'
import type { AutonomyController } from './use-autonomy'
const controller = (load: AutonomyController['load']): AutonomyController => ({
  load, errorMessage: '', conflict: false, refresh: vi.fn(), setPaused: vi.fn(),
  state: { desiredMode: 'RUNNING', actualMode: 'RUNNING', activeActionRunCount: 2, killSwitchActive: false, version: 2, observedAt: '2026-10-25T10:00:00Z' },
})
describe('ANI-1791 모바일 현재 상태 표시', () => {
  it('상태 라벨은 h2 heading 역할을 유지하고 제어 버튼은 min-h-11(44px) 이상이다', () => {
    render(<AutonomyControl controller={controller('ready')} />)
    const heading = screen.getByRole('heading', { level: 2, name: '2건 진행 중' })
    expect(heading).toBeInTheDocument()
    const pauseBtn = screen.getByRole('button', { name: '잠시 멈추기' })
    expect(pauseBtn).toHaveClass('min-h-11')
  })
  it('요청/readback pending에는 과거 RUNNING을 현재 정상처럼 표시하지 않는다', () => {
    render(<AutonomyControl controller={controller('loading')} />)
    expect(screen.getByText('상태를 확인하고 있어요')).toBeInTheDocument()
    expect(screen.queryByText('2건 진행 중')).toBeNull()
    expect(screen.queryByText('소희가 맡은 일을 이어서 하고 있어요.')).toBeNull()
  })
  it('오프라인/오류에는 과거 가동 상태로 재개·중지를 열지 않는다', () => {
    render(<AutonomyControl controller={controller('error')} />)
    expect(screen.queryByText('2건 진행 중')).toBeNull()
    expect(screen.queryByRole('button', { name: '잠시 멈추기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '자율근무 중지' })).toBeNull()
    expect(screen.getByRole('button', { name: '최신 상태 다시 확인' })).toBeEnabled()
  })
  it('변경 적용을 기다릴 때 변경 확인 안내 문구를 표시한다', () => {
    const pendingController: AutonomyController = {
      ...controller('ready'),
      state: {
        desiredMode: 'PAUSED',
        actualMode: 'RUNNING',
        activeActionRunCount: 0,
        killSwitchActive: false,
        version: 3,
        observedAt: '2026-10-25T10:00:00Z',
      },
    }
    render(<AutonomyControl controller={pendingController} />)
    expect(screen.getByText('변경이 확인되면 표시가 바뀌어요.')).toBeInTheDocument()
  })
})
