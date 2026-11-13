'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { authFailureFromStatus, mergeAuthFailure, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { mapChannelsApi, type ChannelsApiPayload } from '@/features/mobile-channels/channels-api-mapper'
import { MobileMoreView, moreScreenConfig } from './more-view'
import { buildMoreSnapshot, countChannels, isMoreSnapshot, type ChannelCounts, type SourceResult } from './server/more-snapshot'
import { MORE_SECTION_HREF, type MoreSectionId, type MoreViewSnapshot } from './more-model'
import { boundedMobileRead } from '@/features/mobile-shell/bounded-mobile-read'

const CHANNEL_KEYS = ['instagram', 'threads', 'naverBlog', 'naverPlace', 'daangn'] as const
const checkedAt = z.string().datetime({ offset: true })
const statusPayloadSchema = z.object({
  workspaceId: z.string().uuid(),
  automation: z.object({ ok: z.boolean(), value: z.object({ mode: z.enum(['OFF', 'PAUSED', 'RUNNING', 'ARMING', 'BLOCKED', 'DEGRADED']), checkedAt }).nullable() }),
  notifications: z.object({ ok: z.boolean(), value: z.object({ recentCount: z.number().int().min(0).max(100), unreadCount: z.number().int().min(0).max(100), checkedAt }).refine(v => v.unreadCount <= v.recentCount).nullable() }),
})

const empty = (workspaceId: string, loadState: MoreViewSnapshot['loadState']): MoreViewSnapshot => ({
  loadState, workspaceId, workspaces: [], sections: [],
  privacy: { export: 'unknown', withdraw: 'unknown' },
  lastReauthAt: null, now: new Date(0).toISOString(), checkedAt: null,
})

type ReadResult = { ok: true; payload: unknown } | { ok: false; authFailure: AuthFailure | null }

async function readJson(url: string, signal: AbortSignal): Promise<ReadResult> {
  try {
    return await boundedMobileRead<ReadResult>(url, async res => {
      // 401/403은 본문 대기 없이 구분한다. 일부 실패를 가게 전체 권한 거부로 바꾸지 않는다.
      const authFailure = authFailureFromStatus(res.status)
      if (authFailure) return { ok: false, authFailure }
      if (!res.ok) return { ok: false, authFailure: null }
      return { ok: true, payload: await res.json() }
    }, signal)
  } catch {
    return { ok: false, authFailure: null }
  }
}

const failed = <T,>(): SourceResult<T> => ({ ok: false, value: null })

/**
 * M25 더보기 — R2 셸 배선(ANI-1771, 플래그 뒤).
 * 기존 가게·채널·크레딧과 읽기 전용 설정 상태를 병렬 조회한다. 쓰기·개인정보 요청은 호출하지 않는다.
 * 모든 응답은 no-store 이며 브라우저 저장소에 남기지 않는다.
 */
export function R2More({ workspaceId }: { workspaceId: string }) {
  return <R2MoreContent key={workspaceId} workspaceId={workspaceId} />
}

function R2MoreContent({ workspaceId }: { workspaceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const context = useOptionalWorkspaceContext()
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<MoreViewSnapshot>(() => empty(workspaceId, 'loading'))

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`
    Promise.all([readJson(`${base}/profile`, controller.signal), readJson('/api/channels', controller.signal), readJson(`${base}/agent/energy`, controller.signal), readJson(`${base}/settings/status`, controller.signal)])
      .then(([profileRead, channelsRead, energyRead, statusRead]) => {
        // 세 원천이 모두 인증·권한 거부면 이 가게를 볼 수 없는 것이다. 하나라도 401 이면 '로그인 만료'가 우선이다.
        // 일부만 거부면 지금처럼 확인하지 못한 섹션으로 남긴다(가게 전체 권한으로 단정하지 않는다).
        const reads = [profileRead, channelsRead, energyRead]
        if (reads.every(read => !read.ok && read.authFailure)) {
          const authFailure = mergeAuthFailure(reads.map(read => (read.ok ? null : read.authFailure)))
          if (!cancelled) setSnapshot({ ...empty(workspaceId, 'error'), ...(authFailure ? { authFailure } : {}) })
          return
        }
        const profilePayload = profileRead.ok ? profileRead.payload : null
        const channelsPayload = channelsRead.ok ? channelsRead.payload : null
        const energyPayload = energyRead.ok ? energyRead.payload : null

        const profile = (profilePayload as { profile?: { business?: { businessName?: unknown } } } | null)?.profile?.business
        const businessName = typeof profile?.businessName === 'string' && profile.businessName.trim()
          ? profile.businessName.trim() : null
        const profileResult: SourceResult<{ businessName: string | null }> =
          profilePayload === null ? failed() : { ok: true, value: { businessName } }

        // 채널 응답은 기존 매퍼로만 해석한다.
        // 다른 가게 응답이거나 아는 채널 키가 하나도 없으면 형식 불일치로 보고 실패 처리한다.
        let channelsResult: SourceResult<ChannelCounts> = failed()
        if (channelsPayload && typeof channelsPayload === 'object') {
          const payload = channelsPayload as ChannelsApiPayload & { workspaceId?: unknown }
          const sameWorkspace = payload.workspaceId === undefined || payload.workspaceId === workspaceId
          if (sameWorkspace && CHANNEL_KEYS.some(key => key in payload)) {
            const { channels } = mapChannelsApi(payload)
            // 게시 가능 여부는 기존 게시 가능성 계약 하나로만 판단한다(레벨을 다시 해석하지 않는다).
            // 확인하지 못한 채널은 '게시 가능 0개'와 구분해야 한다.
            channelsResult = { ok: true, value: countChannels(channels) }
          }
        }

        const energy = z.object({
          workspaceId: z.literal(workspaceId),
          status: z.enum(['ACTIVE', 'DEPLETED', 'CRITICAL', 'CONSERVE']),
          budgetAlertStage: z.enum(['NORMAL', 'EXHAUSTED', 'STAGE_95_RESTRICT', 'STAGE_85_DEFER', 'STAGE_70_OPTIMIZE']),
          balanceSC: z.number().finite().nonnegative(),
        }).safeParse(energyPayload)
        const billingResult: SourceResult<{ needsAttention: boolean }> = energy.success
          ? { ok: true, value: { needsAttention: energy.data.budgetAlertStage !== 'NORMAL' || energy.data.status !== 'ACTIVE' } }
          : failed()

        const parsedStatus = statusPayloadSchema.safeParse(statusRead.ok ? statusRead.payload : null)
        const status = parsedStatus.success && parsedStatus.data.workspaceId === workspaceId ? parsedStatus.data : null
        const next = buildMoreSnapshot({
          workspaceId,
          workspaceName: context?.workspaceName ?? null,
          membershipRole: context?.membershipRole ?? '',
          now: new Date().toISOString(),
          profile: profileResult,
          channels: channelsResult,
          billing: billingResult,
          automation: status?.automation,
          notifications: status?.notifications,
        })
        if (!cancelled) setSnapshot(isMoreSnapshot(next, workspaceId) ? next : empty(workspaceId, 'error'))
      })
      .catch(() => { if (!cancelled) setSnapshot(empty(workspaceId, 'error')) })
    return () => { cancelled = true; controller.abort() }
  }, [workspaceId, context?.workspaceName, context?.membershipRole, refreshKey])

  const { mode, title } = moreScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileMoreView
          snapshot={snapshot}
          onRetry={() => { setSnapshot(empty(workspaceId, 'loading')); setRefreshKey(value => value + 1) }}
          onOpenSection={(id: MoreSectionId) => {
            const href = MORE_SECTION_HREF[id]
            if (href) router.push(href)
          }}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}
