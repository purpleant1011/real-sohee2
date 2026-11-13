'use client'

import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { NotificationList } from '@/features/mobile-notifications/notification-list'
import { NotificationPreferences } from '@/features/mobile-notifications/notification-preferences'
import { PushSettings } from '@/features/pwa/push-settings'
import type { PushTokenLookup } from '@/features/pwa/push-token-status'
import { NotificationCenter } from '@/features/notifications/notification-center'
import { NotificationsRealtime } from '@/features/notifications/notifications-realtime'
import type { NotificationCenterData } from '@/features/notifications/repository'

/**
 * M23 알림함 배선(ANI-1770). 플래그 OFF(기본)·넓은 화면은 기존 알림 센터 그대로.
 * 서버 조회(getNotificationCenter)는 page 에서 한 번만 하고, 여기서는 표시만 고른다.
 * R2 화면도 같은 서버 값을 쓰며, 새 알림은 Realtime 수신 뒤 서버를 다시 읽는다.
 */
export function NotificationsEntry({
  data,
  workspaceId,
  pushTokenLookup,
}: {
  data: NotificationCenterData
  workspaceId: string
  /**
   * ANI-1724: 푸시 구독 조회 결과. `page.tsx` 가 서버에서 한 번 조회해 넘긴다.
   * 이 배포에는 아직 구독 테이블이 없어 조회가 `undefined` 를 돌려주므로 토큰 상태 줄은 그려지지 않는다.
   * 테이블이 생기면 같은 배선으로 그대로 켜지고, 조회 실패는 `{ ok: false }` 로 구분해 넘어온다.
   */
  pushTokenLookup?: PushTokenLookup
}) {
  if (useMobileR2Active()) {
    return (
      <MobileAppShell>
        <NotificationsRealtime userId={data.userId} workspaceId={workspaceId} />
        <NotificationList data={data} workspaceId={workspaceId} />
        <NotificationPreferences preferences={data.preferences} />
        {/* ANI-1724 partial: 권한 동의는 클라이언트, 구독 조회는 page 가 서버에서 읽어 넘긴다. */}
        <PushSettings lookup={pushTokenLookup} />
      </MobileAppShell>
    )
  }

  return (
    <V088AppShell workspaceId={workspaceId}>
      <NotificationCenter data={data} workspaceId={workspaceId} />
    </V088AppShell>
  )
}
