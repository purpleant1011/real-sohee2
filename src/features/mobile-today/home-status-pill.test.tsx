// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HomeStatusPill } from './home-status-pill'
import type { AutonomyController } from './use-autonomy'
import type { AutonomyServerState } from './autonomy-state'

function createMockState(override: Partial<AutonomyServerState> = {}): AutonomyServerState {
  return {
    desiredMode: 'RUNNING',
    actualMode: 'RUNNING',
    activeActionRunCount: 0,
    killSwitchActive: false,
    version: 1,
    observedAt: '2026-10-23T09:00:00.000Z',
    ...override,
  }
}

function createMockController(override: Partial<AutonomyController> = {}): AutonomyController {
  return {
    state: createMockState(),
    load: 'ready',
    errorMessage: '',
    conflict: false,
    refresh: vi.fn(),
    setPaused: vi.fn().mockResolvedValue({ ok: true }),
    ...override,
  }
}

describe('HomeStatusPill', () => {
  it.each([
    { label: '일하는 중', token: 'bg-state-ok', override: {} },
    { label: '확인 중', token: 'bg-state-warn', override: { load: 'loading' as const, state: null } },
    { label: '확인 필요', token: 'bg-state-warn', override: { load: 'error' as const } },
    { label: '확인 필요', token: 'bg-state-warn', override: { state: createMockState({ killSwitchActive: true }) } },
  ])('$label 상태 점은 시맨틱 토큰 $token을 쓴다', ({ label, token, override }) => {
    render(<HomeStatusPill controller={createMockController(override)} autonomyHref="/app/account/automation" />)
    const trigger = screen.getByRole('button', { name: `소희 일하기 상태: ${label}` })
    expect(trigger.querySelector('[aria-hidden="true"]')).toHaveClass(token)
  })

  it('변경 적용을 기다릴 때 확인 중 표시와 변경 확인 안내를 유지한다', () => {
    const controller = createMockController({ state: createMockState({ desiredMode: 'PAUSED' }) })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)
    fireEvent.click(screen.getByRole('button', { name: '소희 일하기 상태: 확인 중' }))
    expect(screen.getByText('변경이 확인되면 표시가 바뀌어요.')).toBeVisible()
    expect(screen.queryByRole('button', { name: '잠시 멈추기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시작' })).toBeNull()
  })

  it('정상 RUNNING 상태에서는 알약에 "일하는 중"과 초록 점을 표시한다', () => {
    const controller = createMockController()
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    expect(screen.getByRole('button', { name: /소희 일하기 상태: 일하는 중/ })).toBeTruthy()
    expect(screen.getByText('일하는 중')).toBeTruthy()
  })

  it('PAUSED 상태에서는 알약에 "잠시 멈춤"을 표시한다', () => {
    const controller = createMockController({
      state: createMockState({ desiredMode: 'PAUSED', actualMode: 'PAUSED' }),
    })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    expect(screen.getByRole('button', { name: /소희 일하기 상태: 잠시 멈춤/ })).toBeTruthy()
    expect(screen.getByText('잠시 멈춤')).toBeTruthy()
  })

  it('로딩 중이거나 pending 상태에서는 알약에 "확인 중"을 표시한다', () => {
    const controller = createMockController({
      load: 'loading',
      state: null,
    })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    expect(screen.getByRole('button', { name: /소희 일하기 상태: 확인 중/ })).toBeTruthy()
    expect(screen.getByText('확인 중')).toBeTruthy()
  })

  it('에러 상태나 killSwitch인 경우 "확인 필요"를 표시한다', () => {
    const controller = createMockController({
      load: 'error',
      errorMessage: '서버 에러',
    })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    expect(screen.getByRole('button', { name: /소희 일하기 상태: 확인 필요/ })).toBeTruthy()
    expect(screen.getByText('확인 필요')).toBeTruthy()
  })

  it('알약 클릭 시 바텀시트가 열리고 SheetTitle "소희 일하기", 상태 설명, 시각, 링크가 보인다', () => {
    const controller = createMockController()
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    // 시트 열기 전에는 다이얼로그가 없음
    expect(screen.queryByRole('heading', { name: '소희 일하기' })).toBeNull()

    // 알약 클릭
    fireEvent.click(screen.getByRole('button', { name: /소희 일하기 상태:/ }))

    // 시트가 열림
    expect(screen.getByRole('heading', { name: '소희 일하기' })).toBeTruthy()
    expect(screen.getByText('소희가 일하는 상태를 확인하고 켜거나 멈출 수 있어요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '소희가 일할 준비가 됐어요' })).toBeInTheDocument()
    expect(screen.getByText(/마지막 확인/)).toBeTruthy()
    const link = screen.getByRole('link', { name: /일하는 방식 보기/ })
    expect(link).toHaveAttribute('href', '/app/account/automation')
  })

  it('일하는 중일 때 시트에서 "잠시 멈추기" 버튼을 누르면 setPaused(true)를 호출한다', async () => {
    const setPaused = vi.fn().mockResolvedValue({ ok: true })
    const controller = createMockController({ setPaused })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    fireEvent.click(screen.getByRole('button', { name: /소희 일하기 상태:/ }))

    const pauseBtn = screen.getByRole('button', { name: /잠시 멈추기/ })
    fireEvent.click(pauseBtn)

    expect(setPaused).toHaveBeenCalledWith(true)
    await waitFor(() => {
      expect(screen.getByText('멈춤 요청을 보냈어요. 적용 상태를 확인하고 있어요.')).toBeTruthy()
    })
  })

  it('잠시 멈춤 상태일 때 시트에서 "다시 시작" 버튼을 누르면 setPaused(false)를 호출한다', async () => {
    const setPaused = vi.fn().mockResolvedValue({ ok: true })
    const controller = createMockController({
      state: createMockState({ desiredMode: 'PAUSED', actualMode: 'PAUSED' }),
      setPaused,
    })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    fireEvent.click(screen.getByRole('button', { name: /소희 일하기 상태:/ }))

    const resumeBtn = screen.getByRole('button', { name: /다시 시작/ })
    fireEvent.click(resumeBtn)

    expect(setPaused).toHaveBeenCalledWith(false)
    await waitFor(() => {
      expect(screen.getByText('시작 요청을 보냈어요. 적용 상태를 확인하고 있어요.')).toBeTruthy()
    })
  })

  it('에러 상태에서 최신 상태 다시 확인 버튼을 누르면 refresh()를 호출한다', () => {
    const refresh = vi.fn()
    const controller = createMockController({
      load: 'error',
      errorMessage: '네트워크 연결 오류',
      refresh,
    })
    render(<HomeStatusPill controller={controller} autonomyHref="/app/account/automation" />)

    fireEvent.click(screen.getByRole('button', { name: /소희 일하기 상태:/ }))

    expect(screen.getByText('소희 일하기 상태를 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.')).toBeTruthy()
    const retryBtn = screen.getByRole('button', { name: /최신 상태 다시 확인/ })
    fireEvent.click(retryBtn)
    expect(refresh).toHaveBeenCalled()
  })
})
