'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { LiveRegion } from '@/components/mobile-ui'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { MobileCampaignsView, campaignsScreenConfig, type CampaignsViewSnapshot } from './campaigns-view'

const LOAD_STATES: LoadState[] = ['loading', 'ready', 'error', 'unknown', 'stale']

/** 계약이 어긋나거나 다른 가게 응답이면 그리지 않는다(빈 목록으로 단정하지 않음). */
function toSnapshot(value: unknown, workspaceId: string): CampaignsViewSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    v.workspaceId !== workspaceId ||
    typeof v.loadState !== 'string' || !LOAD_STATES.includes(v.loadState as LoadState) ||
    !Array.isArray(v.candidates) || !Array.isArray(v.customers) ||
    (v.now !== null && typeof v.now !== 'string') ||
    (v.checkedAt !== null && typeof v.checkedAt !== 'string')
  ) return null
  return {
    loadState: v.loadState as LoadState,
    candidates: v.candidates as CampaignsViewSnapshot['candidates'],
    customers: v.customers as CampaignsViewSnapshot['customers'],
    now: v.now as string | null,
    checkedAt: v.checkedAt as string | null,
  }
}

const FAILED: CampaignsViewSnapshot = { loadState: 'error', candidates: [], customers: [], now: null, checkedAt: null }

/** 재전송 잠금 키. 승인 요청마다 새로 만들고, 같은 요청을 두 번 보내지 않게 막는 용도다. */
function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 409는 '지금은 안 되고, 다시 보면 풀릴 수 있음'. 503은 '지금 확인 자체가 안 됨'.
 * 409 안에서도 사유가 다르다 — 자리가 찬 것과 내용이 바뀐 것을 같은 문구로 뭉개지 않는다.
 */
function approvalFailureMessage(status: number, errorCode: unknown): string {
  if (status === 409) {
    if (errorCode === 'FINGERPRINT_MISMATCH') return '확인한 내용이 달라졌어요. 목록을 다시 불러올게요.'
    if (errorCode === 'ALREADY_RESOLVED') return '이미 처리된 제안이에요. 목록을 다시 불러올게요.'
    return '그 자리는 이미 찼어요. 목록을 다시 불러올게요.'
  }
  if (status === 401) return '로그인이 풀렸어요. 다시 로그인해 주세요.'
  if (status === 403) return '이 작업은 매장 대표나 관리자만 할 수 있어요.'
  return '지금은 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요.'
}

/**
 * M18 제안 — R2 셸 배선(ANI-1697, 플래그 뒤). 목록 조회와 승인 저장만 한다.
 * 승인은 발송이 아니다: 외부 게시 0건이며, 발송 전 확인은 별도 단계다.
 */
export function R2Campaigns({ workspaceId }: { workspaceId: string }) {
  const [snapshot, setSnapshot] = useState<CampaignsViewSnapshot>({ ...FAILED, loadState: 'loading' })
  const [approvalNotice, setApprovalNotice] = useState('')
  const /** 진행 중 중복 클릭 잠금. 상태 갱신보다 먼저 잠가야 연타가 두 번 나가지 않는다. */ pending = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-campaigns`, { cache: 'no-store' })
      const payload: unknown = await res.json().catch(() => null)
      if (!mounted.current) return
      setSnapshot(toSnapshot(payload, workspaceId) ?? FAILED)
    } catch {
      if (mounted.current) setSnapshot(FAILED)
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    const apply = (next: CampaignsViewSnapshot) => { if (!cancelled) setSnapshot(next) }
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-campaigns`, { cache: 'no-store' })
      .then(async res => {
        const payload: unknown = await res.json().catch(() => null)
        apply(toSnapshot(payload, workspaceId) ?? FAILED)
      })
      .catch(() => apply(FAILED))
    return () => { cancelled = true }
  }, [workspaceId])

  const approve = useCallback(async (proposalId: string, slotId: string, expectedFingerprint: string) => {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-campaigns/approve`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': newIdempotencyKey(),
      },
      body: JSON.stringify({ proposalId, slotId, expectedFingerprint }),
    })
    const body: unknown = await res.json().catch(() => null)
    return { status: res.status, body }
  }, [workspaceId])

  const onApprove = useCallback((proposal: { id: string; slotId: string | null }) => {
    if (pending.current) return
    const candidate = snapshot.candidates.find(c => c.proposal.id === proposal.id && c.proposal.workspaceId === workspaceId)
    // 지문이 없으면 서버가 대조할 기준이 없다. 승인 요청을 보내지 않고 다시 확인한다.
    if (!candidate || !proposal.slotId || !candidate.fingerprint) {
      setApprovalNotice('제안 정보를 다시 확인하지 못했어요. 목록을 새로 불러올게요.')
      void load()
      return
    }

    const slotId = proposal.slotId
    const fingerprint = candidate.fingerprint
    pending.current = true
    void (async () => {
      try {
        const { status, body } = await approve(proposal.id, slotId, fingerprint)
        if (!mounted.current) return
        if (status === 200) {
          const decidedAt = body && typeof body === 'object' && typeof (body as Record<string, unknown>).decidedAt === 'string'
            ? (body as Record<string, unknown>).decidedAt as string
            : null
          if (!decidedAt) {
            setApprovalNotice('승인은 됐지만 확인 값을 받지 못했어요. 목록을 다시 불러올게요.')
            void load()
            return
          }
          setSnapshot(prev => ({
            ...prev,
            candidates: prev.candidates.map(c => c.proposal.id === proposal.id
              ? { ...c, proposal: { ...c.proposal, approvedAt: decidedAt } }
              : c),
          }))
          setApprovalNotice('승인했어요. 소희가 바로 보내지 않고, 보내기 전에 한 번 더 확인해요.')
          return
        }
        const errorCode = body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>).error
          : undefined
        setApprovalNotice(approvalFailureMessage(status, errorCode))
        if (status === 409) void load()
      } catch {
        if (mounted.current) setApprovalNotice('지금은 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요.')
      } finally {
        pending.current = false
      }
    })()
  }, [approve, load, snapshot.candidates, workspaceId])

  const { mode, title } = campaignsScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        {approvalNotice ? (
          <LiveRegion
            message={approvalNotice}
            visible
            className="rounded-xl bg-state-quiet-soft px-3 py-2 text-sm text-state-quiet"
          />
        ) : null}
        <MobileCampaignsView
          snapshot={snapshot}
          onApprove={onApprove}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}
