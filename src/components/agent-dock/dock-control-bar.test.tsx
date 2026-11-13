import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DockControlBar } from './dock-control-bar'
describe('ANI-1791 Dock 실제 상태 안내', () => {
  it('UNKNOWN은 일시 정지로 확정하지 않고 상태 미확인으로 표시하며 재개를 잠근다', () => {
    render(<DockControlBar actualMode="UNKNOWN" isRunning={false} killSwitchActive={false} onPause={vi.fn()} onResume={vi.fn()} onEmergencyStop={vi.fn()} />)
    expect(screen.getByText('상태 확인 안 됨')).toBeInTheDocument()
    expect(screen.queryByText('일시 정지')).toBeNull()
    expect(screen.getByRole('button', { name: '소희 자율근무 재개' })).toBeDisabled()
  })
  it('pending은 현재 RUNNING을 확정해서 표시하지 않는다', () => {
    render(<DockControlBar actualMode="UNKNOWN" isRunning={false} killSwitchActive={false} isLoading onPause={vi.fn()} onResume={vi.fn()} onEmergencyStop={vi.fn()} />)
    expect(screen.getByText('상태 확인 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '소희 자율근무 재개' })).toBeDisabled()
  })
})
