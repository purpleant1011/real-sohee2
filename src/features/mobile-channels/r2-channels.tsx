'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { classifyServerResponse, isFailure } from '@/features/mobile-common/state-linkage'
import { useResumeRevalidation } from '@/features/mobile-resilience/use-resume'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { MobileChannelsView, channelsScreenConfig, type ChannelsViewSnapshot } from './channels-view'
import { mapChannelsApi, type ChannelsApiPayload } from './channels-api-mapper'
import { parseConnectFlow, type ConnectFlow } from './channels-connect'

/** M21 채널 — R2 셸 배선(ANI-1707, 플래그 뒤). 기존 GET /api/channels 읽기만 사용하며 쓰기 경로는 없다. */
export function R2Channels({
  canRequestExtended,
}: {
  canRequestExtended?: boolean
} = {}) {
  const [snapshot, setSnapshot] = useState<ChannelsViewSnapshot>({ loadState: 'loading', channels: [], checkedAt: null })
  // R2 게이트가 SSR 에서 꺼져 있어 이 화면은 클라이언트에서만 마운트된다. 그래서 마운트 시점의 쿼리를 한 번만 읽는다.
  // 연결·게시 상태의 확정은 여전히 아래 readback 몫이다.
  const [connectFlow] = useState<ConnectFlow | null>(() =>
    typeof window === 'undefined' ? null : parseConnectFlow(window.location.search))

  const isMountedRef = useRef(true)

  const loadChannels = useCallback(() => {
    fetch('/api/channels', { cache: 'no-store' })
      .then(async res => {
        let parsedBody: unknown = null
        if (typeof res.json === 'function') {
          parsedBody = await res.json().catch(() => null)
        } else if (typeof res.text === 'function') {
          const bodyText = await res.text().catch(() => '')
          try {
            parsedBody = bodyText ? JSON.parse(bodyText) : null
          } catch {
            parsedBody = bodyText || null
          }
        }

        if (!isMountedRef.current) return

        const state = classifyServerResponse({
          status: res.status ?? (res.ok ? 200 : 500),
          body: parsedBody,
        })

        if (isFailure(state)) {
          setSnapshot({
            loadState: 'error',
            channels: [],
            checkedAt: null,
            accessDenied: state.kind === 'unauthorized' || state.kind === 'session_expired',
          })
          return
        }

        const payload = parsedBody as ChannelsApiPayload
        if (!payload || !payload.instagram || !payload.threads) throw new Error('shape')
        setSnapshot(mapChannelsApi(payload))
      })
      .catch(() => {
        if (!isMountedRef.current) return
        setSnapshot({ loadState: 'error', channels: [], checkedAt: null })
      })
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    loadChannels()
    return () => {
      isMountedRef.current = false
    }
  }, [loadChannels])

  // ANI-1720: 화면 복귀(visibilitychange/pageshow) 및 네트워크 복귀(online) 시 최신 채널 상태를 서버에서 재검증한다.
  useResumeRevalidation(useCallback(() => {
    loadChannels()
  }, [loadChannels]))

  const workspaceContext = useOptionalWorkspaceContext()
  const workspaceId = workspaceContext?.workspaceId

  const effectiveSnapshot =
    canRequestExtended !== undefined
      ? { ...snapshot, extendedScopesAllowed: canRequestExtended }
      : snapshot

  const config = channelsScreenConfig()
  return <MobileAppShell>
    <ShellScreen {...config}>
      <MobileChannelsView snapshot={effectiveSnapshot} connectFlow={connectFlow} workspaceId={workspaceId} />
    </ShellScreen>
  </MobileAppShell>
}
