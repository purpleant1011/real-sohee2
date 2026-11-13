'use client'

import { useState, useEffect } from 'react'
import { Bot, Pause, Play, CheckCircle2, ShieldCheck, Zap } from 'lucide-react'
import type { AutonomyLevel, EngagementPolicy } from './types'

export interface EngagementAutonomyDialProps {
  workspaceId: string
  initialPolicy?: EngagementPolicy | null
  onPolicyChange?: (policy: EngagementPolicy) => void
}

export function EngagementAutonomyDial({
  workspaceId,
  initialPolicy,
  onPolicyChange,
}: Readonly<EngagementAutonomyDialProps>) {
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>(
    initialPolicy?.autonomy_level ?? 'L1_MANUAL'
  )
  const [defaultTone, setDefaultTone] = useState<'witty' | 'polite' | 'friendly'>(
    initialPolicy?.default_tone ?? 'friendly'
  )
  const [isPaused, setIsPaused] = useState<boolean>(initialPolicy?.is_paused ?? false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (initialPolicy) {
      if (initialPolicy.autonomy_level) setAutonomyLevel(initialPolicy.autonomy_level)
      if (initialPolicy.default_tone) setDefaultTone(initialPolicy.default_tone)
      if (initialPolicy.is_paused !== undefined) setIsPaused(initialPolicy.is_paused)
    } else if (workspaceId) {
      let cancelled = false
      try {
        const req = fetch(`/api/workspaces/${workspaceId}/engagement/policy`, { cache: 'no-store' })
        if (req && typeof req.then === 'function') {
          req
            .then((r) => (r && r.ok ? r.json() : null))
            .then((data) => {
              if (cancelled || !data?.policies) return
              const pol = data.policies.instagram || data.policies.threads
              if (pol) {
                if (pol.autonomy_level) setAutonomyLevel(pol.autonomy_level)
                if (pol.default_tone) setDefaultTone(pol.default_tone)
                if (pol.is_paused !== undefined) setIsPaused(pol.is_paused)
              }
            })
            .catch(() => {})
        }
      } catch {}
      return () => {
        cancelled = true
      }
    }
  }, [workspaceId, initialPolicy])

  async function updatePolicy(patch: Partial<EngagementPolicy>) {
    setIsSaving(true)
    setErrorMsg(null)
    try {
      const channel = 'all'
      const payload = {
        channel,
        autonomy_level: patch.autonomy_level ?? autonomyLevel,
        default_tone: patch.default_tone ?? defaultTone,
        is_paused: patch.is_paused !== undefined ? patch.is_paused : isPaused,
        auto_reply_enabled: (patch.autonomy_level ?? autonomyLevel) !== 'L1_MANUAL',
      }

      const res = await fetch(`/api/workspaces/${workspaceId}/engagement/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error('자율 운영 정책을 저장하지 못했습니다.')
      }

      const json = await res.json()
      if (json.policy) {
        if (patch.autonomy_level) setAutonomyLevel(patch.autonomy_level)
        if (patch.default_tone) setDefaultTone(patch.default_tone)
        if (patch.is_paused !== undefined) setIsPaused(patch.is_paused)
        if (onPolicyChange) onPolicyChange(json.policy)
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '정책 변경 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  function handleSelectLevel(level: AutonomyLevel) {
    if (level === autonomyLevel) return
    updatePolicy({ autonomy_level: level })
  }

  function handleSelectTone(tone: 'witty' | 'polite' | 'friendly') {
    if (tone === defaultTone) return
    updatePolicy({ default_tone: tone })
  }

  function handleTogglePause() {
    updatePolicy({ is_paused: !isPaused })
  }

  const isL1 = autonomyLevel === 'L1_MANUAL'
  const isL2 = autonomyLevel === 'L2_ASSISTED'
  const isL3 = autonomyLevel === 'L3_AUTONOMOUS'

  return (
    <section
      aria-label="소희 자율운영 모드 설정"
      className="rounded-2xl border border-zinc-200/90 dark:border-zinc-800/80 bg-card p-4 sm:p-5 shadow-xs space-y-4"
    >
      {/* 헤더 & 상태 배지 & 마스터 킬스위치 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-2xs shrink-0">
            <Bot aria-hidden="true" className="size-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-foreground">
                소희 자율운영 모드
              </h2>
              {/* 상태 뱃지 */}
              {isPaused ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-state-warn-soft text-state-warn flex items-center gap-1">
                  일시정지됨 ⏸️
                </span>
              ) : isL1 ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-state-quiet-soft text-state-quiet">
                  수동 승인 모드 (L1)
                </span>
              ) : isL2 ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-state-ok-soft text-state-ok flex items-center gap-1">
                  안심 자율 가동 중 (L2) ●
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary flex items-center gap-1">
                  풀 자율 가동 중 (L3) ⚡
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              소희가 고객 소통 및 응대 초안을 작성할 자율성 범위를 지정하세요.
            </p>
          </div>
        </div>

        {/* 킬스위치 일시정지 버튼 */}
        <button
          type="button"
          disabled={isSaving}
          onClick={handleTogglePause}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
            isPaused
              ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-border hover:bg-zinc-200'
          }`}
        >
          {isPaused ? (
            <>
              <Play aria-hidden="true" className="size-3.5" />
              <span>자율모드 재개</span>
            </>
          ) : (
            <>
              <Pause aria-hidden="true" className="size-3.5" />
              <span>자율모드 일시정지</span>
            </>
          )}
        </button>
      </div>

      {errorMsg ? (
        <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium">
          {errorMsg}
        </div>
      ) : null}

      {/* 3단계 자율성 다이얼 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
        {/* L1. 비서형 */}
        <button
          type="button"
          disabled={isSaving}
          onClick={() => handleSelectLevel('L1_MANUAL')}
          className={`p-3.5 sm:p-4 rounded-xl text-left border transition-all cursor-pointer space-y-2 relative ${
            isL1
              ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-xs'
              : 'border-border/80 hover:border-border bg-muted/20 hover:bg-muted/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-extrabold text-foreground flex items-center gap-1.5">
              <ShieldCheck aria-hidden="true" className="size-4 text-zinc-500" />
              <span>L1. 비서형</span>
            </span>
            {isL1 ? (
              <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            모든 댓글과 DM을 사장님이 확인하고 승인해야 발송돼요. 처음 시작할 때 추천해요.
          </p>
        </button>

        {/* L2. 협업형 (추천) */}
        <button
          type="button"
          disabled={isSaving}
          onClick={() => handleSelectLevel('L2_ASSISTED')}
          className={`p-3.5 sm:p-4 rounded-xl text-left border transition-all cursor-pointer space-y-2 relative ${
            isL2
              ? 'border-state-ok bg-state-ok-soft/60 ring-1 ring-state-ok shadow-xs'
              : 'border-border/80 hover:border-border bg-muted/20 hover:bg-muted/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-extrabold text-foreground flex items-center gap-1.5">
              <Bot aria-hidden="true" className="size-4 text-state-ok" />
              <span>L2. 협업형</span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-state-ok-soft text-state-ok">
                추천 🌟
              </span>
            </span>
            {isL2 ? (
              <CheckCircle2 aria-hidden="true" className="size-4 text-state-ok" />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            가벼운 칭찬/인사 댓글은 소희가 센스있게 답글 초안을 준비하고, 중요한 예약/불만만 사장님께 여쭤봐요.
          </p>
        </button>

        {/* L3. 점장형 */}
        <button
          type="button"
          disabled={isSaving}
          onClick={() => handleSelectLevel('L3_AUTONOMOUS')}
          className={`p-3.5 sm:p-4 rounded-xl text-left border transition-all cursor-pointer space-y-2 relative ${
            isL3
              ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-xs'
              : 'border-border/80 hover:border-border bg-muted/20 hover:bg-muted/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-extrabold text-foreground flex items-center gap-1.5">
              <Zap aria-hidden="true" className="size-4 text-primary" />
              <span>L3. 점장형</span>
            </span>
            {isL3 ? (
              <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            정기 포스팅 초안부터 칭찬/인사 답글까지 소희가 신속하게 준비해요. 환불·클레임만 SOS 호출해요.
          </p>
        </button>
      </div>

      {/* L2 또는 L3일 때: 대표 답글 톤 선택 칩 */}
      {!isL1 ? (
        <div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-foreground">
            소희의 답글 초안 대표 톤:
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => handleSelectTone('witty')}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer border ${
                defaultTone === 'witty'
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
              }`}
            >
              🎯 센스/위트형
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => handleSelectTone('polite')}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer border ${
                defaultTone === 'polite'
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
              }`}
            >
              💼 정중/전문가형
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => handleSelectTone('friendly')}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer border ${
                defaultTone === 'friendly'
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
              }`}
            >
              ☕ 다정/이웃형
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
