'use client'

import React from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileKakaoView } from './mobile-kakao-view'

export interface R2KakaoHistoryProps {
  workspaceId: string
}

/**
 * 모바일 R2 셸 전용 카카오 안내 내역 화면 (M25 / DETAIL 모드, 하단 고정 없음).
 */
export function R2KakaoHistory({ workspaceId }: R2KakaoHistoryProps) {
  return (
    <MobileAppShell>
      <ShellScreen mode="DETAIL" title="카카오 안내 내역">
        <MobileKakaoView workspaceId={workspaceId} />
      </ShellScreen>
    </MobileAppShell>
  )
}
