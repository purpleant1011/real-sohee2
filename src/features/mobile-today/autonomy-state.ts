export interface AutonomyServerState {
  desiredMode: 'OFF' | 'RUNNING' | 'PAUSED'
  actualMode: 'OFF' | 'ARMING' | 'RUNNING' | 'DEGRADED' | 'PAUSED' | 'BLOCKED'
  activeActionRunCount: number
  killSwitchActive: boolean
  version: number
  observedAt: string
}
export interface AutonomyView {
  label: string
  pending: boolean
  primary: 'pause' | 'resume' | null
  expectedVersion: number | null
}

/** 화면 표시는 서버 readback(actual)만 근거로 한다. 로컬 토글 상태는 사용하지 않는다. */
export function describeAutonomy(state: AutonomyServerState | null): AutonomyView {
  if (!state) return { label: '상태를 확인하지 못했어요', pending: false, primary: null, expectedVersion: null }
  const expectedVersion = state.version
  if (state.killSwitchActive || state.actualMode === 'BLOCKED')
    return { label: '안전을 위해 멈춰 있어요', pending: false, primary: null, expectedVersion }
  if (state.desiredMode !== state.actualMode && !(state.desiredMode === 'RUNNING' && state.actualMode === 'DEGRADED'))
    return { label: '변경을 적용하는 중이에요', pending: true, primary: null, expectedVersion }
  if (state.actualMode === 'PAUSED') return { label: '중지됨 · 새 일을 시작하지 않아요', pending: false, primary: 'resume', expectedVersion }
  if (state.actualMode === 'OFF') return { label: '꺼져 있어요', pending: false, primary: null, expectedVersion }
  const label = state.activeActionRunCount > 0 ? `${state.activeActionRunCount}건 진행 중` : '대기 중 · 새 일을 받을 수 있어요'
  return { label, pending: false, primary: 'pause', expectedVersion }
}
