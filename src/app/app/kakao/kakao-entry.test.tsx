import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { KakaoEntry } from './kakao-entry'
import * as r2GateModule from '@/features/mobile-shell/r2-gate'
import * as workspaceContextModule from '@/hooks/use-workspace-context'

vi.mock('./kakao-view', () => ({
  KakaoView: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="pc-kakao-view">PC Kakao View: {workspaceId}</div>
  ),
}))

vi.mock('@/features/mobile-kakao/r2-kakao', () => ({
  R2KakaoHistory: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="mobile-kakao-view">Mobile Kakao View: {workspaceId}</div>
  ),
}))

describe('KakaoEntry', () => {
  it('useMobileR2Active가 false일 때 PC KakaoView를 렌더한다', async () => {
    vi.spyOn(r2GateModule, 'useMobileR2Active').mockReturnValue(false)
    vi.spyOn(workspaceContextModule, 'useWorkspaceId').mockReturnValue('ws-pc')

    render(<KakaoEntry />)
    expect(await screen.findByTestId('pc-kakao-view')).toHaveTextContent('ws-pc')
    expect(screen.queryByTestId('mobile-kakao-view')).toBeNull()
  })

  it('useMobileR2Active가 true일 때 모바일 R2KakaoHistory를 렌더한다', () => {
    vi.spyOn(r2GateModule, 'useMobileR2Active').mockReturnValue(true)
    vi.spyOn(workspaceContextModule, 'useWorkspaceId').mockReturnValue('ws-mobile')

    render(<KakaoEntry />)
    expect(screen.getByTestId('mobile-kakao-view')).toHaveTextContent('ws-mobile')
    expect(screen.queryByTestId('pc-kakao-view')).toBeNull()
  })
})
