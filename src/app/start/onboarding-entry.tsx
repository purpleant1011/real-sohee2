'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { StartWizard } from '@/components/start/start-wizard'
import {
  MobileOnboardingView,
  type OnboardingActionResult,
  type OnboardingViewSnapshot,
} from '@/features/mobile-onboarding/onboarding-view'
import {
  loadingOnboardingView,
  staleOnboardingView,
  toOnboardingViewSnapshotFromResponse,
} from '@/features/mobile-onboarding/onboarding-source'
import { resolveIndustryPrefill } from '@/features/mobile-onboarding/onboarding-prefill'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import type { TonePresetKey } from '@/features/quick-start/tone-presets'

/**
 * M03 가게 소개 — 플래그 ON + 좁은 화면에서만 R2 화면(ANI-1781 partial).
 *
 * 넓은 화면(PC·노트북)과 플래그 OFF 는 지금과 같은 StartWizard 를 그대로 쓴다.
 * 저장은 모두 기존 온보딩 API(PATCH/POST /api/onboarding/quick-start)를 그대로 호출한다 —
 * 새 쓰기 경로를 만들지 않는다.
 */
export default function OnboardingEntry() {
  const active = useMobileR2Active()
  const router = useRouter()
  const searchParams = useSearchParams()
  // 랜딩 CTA 가 싣는 업종은 읽기만 한다 — 저장 값이 아니라 첫 단계 프리필이다.
  const industryPrefill = resolveIndustryPrefill(searchParams?.get('industry'))
  const [snapshot, setSnapshot] = useState<OnboardingViewSnapshot>(() => loadingOnboardingView())
  // "다시 확인"은 이 값을 올려 같은 조회를 다시 돌린다(조회 로직은 effect 안에 하나만 둔다).
  const [reloadToken, setReloadToken] = useState(0)
  // 마지막으로 서버가 확인해 준 스냅샷. 재조회가 실패해도 이 내용은 지우지 않는다(stale).
  const confirmedRef = useRef<OnboardingViewSnapshot | null>(null)

  function applySnapshot(next: OnboardingViewSnapshot) {
    if (next.loadState === 'ready') confirmedRef.current = next
    setSnapshot(next)
  }

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void readOnboardingSnapshot(confirmedRef.current).then(next => {
      if (cancelled) return
      applySnapshot(next)
    })
    return () => {
      cancelled = true
    }
  }, [active, reloadToken])

  /**
   * 쓰기 2xx 는 "접수"일 뿐 "확인"이 아니다 — 다시 읽은 값이 방금 보낸 내용과 일치할 때만 성공으로 보고한다.
   * `ready` 는 "응답을 해석할 수 있었다"는 뜻이지 "내가 보낸 값이 저장됐다"는 뜻이 아니다.
   * 재조회가 실패하거나 다른 값이 오면(다른 탭이 덮어쓴 경우 등) 이전 확인 내용을 남기고 넘어가지 않는다.
   */
  async function confirmAfterWrite(
    matches: (snapshot: OnboardingViewSnapshot) => boolean,
  ): Promise<OnboardingActionResult> {
    const previous = confirmedRef.current
    const next = await readOnboardingSnapshot(previous)
    if (next.loadState === 'ready' && matches(next)) {
      applySnapshot(next)
      return { ok: true }
    }
    if (previous) {
      // 다른 값이 확인됐다고 그 값을 화면에 그대로 반영하면 단계가 엉뚱하게 넘어간다 — 이전 확인을 stale 로 유지한다.
      setSnapshot(staleOnboardingView(previous))
      return {
        ok: false,
        message:
          next.loadState === 'ready'
            ? '저장은 접수됐지만 다른 곳에서 내용이 바뀐 것 같아요. 다시 확인해 주세요.'
            : '저장은 접수됐지만 최신 상태를 확인하지 못했어요. 다시 확인을 눌러 주세요.',
      }
    }
    applySnapshot(next)
    return { ok: false, message: '저장은 접수됐지만 최신 상태를 확인하지 못했어요. 다시 확인을 눌러 주세요.' }
  }

  async function saveShop(input: {
    businessName: string
    industry: string
    summary: string
  }): Promise<OnboardingActionResult> {
    const workspaceId = snapshot.workspaceId
    if (!workspaceId) return { ok: false, message: '가게 정보를 불러온 뒤 다시 저장해 주세요.' }
    try {
      const response = await fetch('/api/onboarding/quick-start', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          businessName: input.businessName,
          industry: input.industry,
          location: snapshot.profile?.location ?? '',
          summary: input.summary,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        return { ok: false, message: errorMessage(data, '가게 정보를 저장하지 못했어요. 다시 시도해 주세요.') }
      }
      // 재조회 값에 방금 보낸 세 값이 그대로 있어야 "확인"이다.
      return confirmAfterWrite(
        next =>
          next.profile?.business_name === input.businessName &&
          next.profile?.industry === input.industry &&
          next.profile?.summary === input.summary,
      )
    } catch {
      return { ok: false, message: '가게 정보를 저장하지 못했어요. 연결을 확인해 주세요.' }
    }
  }

  async function saveTone(tone: TonePresetKey): Promise<OnboardingActionResult> {
    const workspaceId = snapshot.workspaceId
    const profile = snapshot.profile
    if (!workspaceId) return { ok: false, message: '가게 정보를 불러온 뒤 다시 저장해 주세요.' }
    // 말투 저장은 위저드와 같은 명령(POST)이다. 서버가 확인한 가게 정보로만 부른다.
    if (!profile?.business_name || !profile.industry || !profile.summary) {
      return { ok: false, message: '가게 정보를 먼저 저장해 주세요.' }
    }
    try {
      const response = await fetch('/api/onboarding/quick-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          businessName: profile.business_name,
          industry: profile.industry,
          location: profile.location ?? '',
          summary: profile.summary,
          tone,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        return { ok: false, message: errorMessage(data, '말투를 저장하지 못했어요. 다시 시도해 주세요.') }
      }
      // 재조회 값의 말투가 방금 고른 말투와 같아야 "확인"이다.
      return confirmAfterWrite(next => next.preferences?.tone === tone)
    } catch {
      return { ok: false, message: '말투를 저장하지 못했어요. 연결을 확인해 주세요.' }
    }
  }

  if (!active) return <StartWizard />

  return (
    <MobileOnboardingView
      snapshot={snapshot}
      industryPrefill={industryPrefill}
      actions={{
        saveShop,
        saveTone,
        goChannels: () => router.push('/app/channels'),
        goPreview: () => router.push('/start/preview'),
        reload: () => setReloadToken(value => value + 1),
      }}
    />
  )
}

/**
 * 서버 진행을 읽어 화면 스냅샷으로 만든다.
 * 실패·형식 불일치는 빈 프로필이 아니라 error/unknown 스냅샷이다(처음부터 다시 입력으로 위장하지 않는다).
 * 이미 확인한 내용이 있으면 실패해도 그 내용을 stale 로 유지한다 — 조회 실패가 화면을 지우지 않는다.
 */
async function readOnboardingSnapshot(previous: OnboardingViewSnapshot | null): Promise<OnboardingViewSnapshot> {
  const checkedAt = new Date().toISOString()
  let status: number | null = null
  let payload: unknown = null
  try {
    const response = await fetch('/api/onboarding/quick-start', { cache: 'no-store' })
    status = typeof response.status === 'number' ? response.status : null
    payload = await response.json().catch(() => null)
  } catch {
    status = null
  }

  const next = toOnboardingViewSnapshotFromResponse({ status, payload }, checkedAt)
  const confirmed =
    previous && (previous.loadState === 'ready' || previous.loadState === 'stale') ? previous : null
  if (next.loadState !== 'ready' && confirmed) return staleOnboardingView(confirmed)
  return next
}

function errorMessage(payload: unknown, fallback: string): string {
  const error = typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null
  return typeof error === 'string' && error.trim() !== '' ? error : fallback
}
