'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  MessageCircle,
  PauseCircle,
  Save,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InstagramIcon } from './engagement-icons'
import type { CommentClassification, EngagementPolicy, SocialChannel } from './types'

export interface EngagementAutoReplyPanelProps {
  workspaceId: string
  initialPolicies?: {
    instagram?: EngagementPolicy | null
    threads?: EngagementPolicy | null
  }
  onSavePolicy?: (policy: Partial<EngagementPolicy> & { channel: SocialChannel }) => Promise<void>
}

const DEFAULT_POLICY: Omit<EngagementPolicy, 'id' | 'workspace_id' | 'created_at' | 'updated_at'> = {
  channel: 'instagram',
  auto_reply_enabled: false,
  is_paused: false,
  allowed_classes: ['THANKS', 'GREETING'],
  min_confidence: 0.8,
  daily_cap: 20,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  max_comment_age_days: 7,
}

export function EngagementAutoReplyPanel({
  workspaceId,
  initialPolicies,
  onSavePolicy,
}: Readonly<EngagementAutoReplyPanelProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<SocialChannel>('instagram')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Policy state per channel
  const [policies, setPolicies] = useState<Record<SocialChannel, Partial<EngagementPolicy>>>(() => ({
    instagram: initialPolicies?.instagram ?? { ...DEFAULT_POLICY, channel: 'instagram' },
    threads: initialPolicies?.threads ?? { ...DEFAULT_POLICY, channel: 'threads' },
  }))

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const currentPolicy = policies[selectedChannel]

  function updateCurrentPolicy(patch: Partial<EngagementPolicy>) {
    setPolicies((prev) => ({
      ...prev,
      [selectedChannel]: { ...prev[selectedChannel], ...patch },
    }))
    setSaveSuccess(null)
    setSaveError(null)
  }

  function handleMasterToggle(checked: boolean) {
    if (checked) {
      // Must show confirmation dialog
      setShowConfirmModal(true)
    } else {
      updateCurrentPolicy({ auto_reply_enabled: false })
    }
  }

  function handleConfirmAutoReplyOn() {
    updateCurrentPolicy({ auto_reply_enabled: true })
    setShowConfirmModal(false)
  }

  function handleClassChange(cls: CommentClassification, checked: boolean) {
    const current = new Set(currentPolicy.allowed_classes ?? ['THANKS', 'GREETING'])
    if (checked) {
      current.add(cls)
    } else {
      current.delete(cls)
    }
    updateCurrentPolicy({ allowed_classes: Array.from(current) as CommentClassification[] })
  }

  async function handleSave() {
    const errors: Record<string, string> = {}
    const cap = currentPolicy.daily_cap ?? 20

    if (cap < 1 || cap > 100 || !Number.isInteger(cap)) {
      errors.daily_cap = '1에서 100 사이 숫자를 입력해 주세요.'
    }

    if (currentPolicy.quiet_hours_enabled) {
      const timeRegex = /^[0-2][0-9]:[0-5][0-9]$/
      if (currentPolicy.quiet_hours_start && !timeRegex.test(currentPolicy.quiet_hours_start)) {
        errors.quiet_hours_start = '올바른 시간(HH:MM)을 입력해 주세요.'
      }
      if (currentPolicy.quiet_hours_end && !timeRegex.test(currentPolicy.quiet_hours_end)) {
        errors.quiet_hours_end = '올바른 시간(HH:MM)을 입력해 주세요.'
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    setSaving(true)
    setSaveSuccess(null)
    setSaveError(null)

    try {
      if (onSavePolicy) {
        await onSavePolicy({
          ...currentPolicy,
          channel: selectedChannel,
        })
      } else {
        const res = await fetch(`/api/workspaces/${workspaceId}/engagement/policy`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...currentPolicy,
            channel: selectedChannel,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || '정책을 저장하지 못했습니다.')
        }
      }
      setSaveSuccess('규칙을 저장했어요')
    } catch (err: any) {
      setSaveError(err?.message || '규칙을 저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  const allowedSet = new Set(currentPolicy.allowed_classes ?? ['THANKS', 'GREETING'])

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs">
      {/* Toggle header */}
      <button
        aria-controls="auto-reply-panel-content"
        aria-expanded={isOpen}
        className="flex w-full min-h-[48px] items-center justify-between p-4 sm:p-5 text-left font-bold text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="flex items-center gap-2">
          <span className="text-base sm:text-lg">자동 답글 규칙</span>
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
            {currentPolicy.auto_reply_enabled ? '자동 답글 켜짐' : '꺼짐'}
          </span>
          {currentPolicy.is_paused ? (
            <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
              멈춤 상태
            </span>
          ) : null}
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`size-5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen ? (
        <div
          className="border-t border-border p-4 sm:p-6 space-y-6"
          id="auto-reply-panel-content"
        >
          {/* Channel selector */}
          <div className="flex items-center gap-2">
            <button
              aria-pressed={selectedChannel === 'instagram'}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold min-h-[44px] cursor-pointer transition-colors ${
                selectedChannel === 'instagram'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
              onClick={() => {
                setSelectedChannel('instagram')
                setFieldErrors({})
                setSaveSuccess(null)
              }}
              type="button"
            >
              <InstagramIcon aria-hidden="true" className="size-4" />
              인스타그램
            </button>
            <button
              aria-pressed={selectedChannel === 'threads'}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold min-h-[44px] cursor-pointer transition-colors ${
                selectedChannel === 'threads'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
              onClick={() => {
                setSelectedChannel('threads')
                setFieldErrors({})
                setSaveSuccess(null)
              }}
              type="button"
            >
              <MessageCircle aria-hidden="true" className="size-4" />
              스레드
            </button>
          </div>

          {/* Master toggle */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <label
                className="text-sm font-bold text-foreground cursor-pointer flex-1"
                htmlFor={`master-toggle-${selectedChannel}`}
              >
                소희가 간단한 댓글에 알아서 답글 달기
              </label>
              <input
                checked={Boolean(currentPolicy.auto_reply_enabled)}
                className="size-5 rounded border-input text-primary focus:ring-ring cursor-pointer min-h-[24px] min-w-[24px]"
                id={`master-toggle-${selectedChannel}`}
                onChange={(e) => handleMasterToggle(e.target.checked)}
                type="checkbox"
              />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              켜면 감사·인사 같은 간단한 댓글에는 승인 없이 답글을 올려요. 불만·민감한 내용·스팸은 항상 직접 확인해요.
            </p>
          </div>

          {/* Classification checkboxes */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              자동 답글 대상 분류
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 감사 */}
              <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 min-h-[44px]">
                <input
                  checked={allowedSet.has('THANKS')}
                  className="size-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  onChange={(e) => handleClassChange('THANKS', e.target.checked)}
                  type="checkbox"
                />
                <span className="text-sm font-semibold text-foreground">감사</span>
              </label>

              {/* 인사 */}
              <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 min-h-[44px]">
                <input
                  checked={allowedSet.has('GREETING')}
                  className="size-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  onChange={(e) => handleClassChange('GREETING', e.target.checked)}
                  type="checkbox"
                />
                <span className="text-sm font-semibold text-foreground">인사</span>
              </label>

              {/* 질문 */}
              <div className="rounded-lg border border-border p-3 space-y-1">
                <label className="flex items-center gap-3 cursor-pointer min-h-[36px]">
                  <input
                    checked={allowedSet.has('QUESTION')}
                    className="size-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    onChange={(e) => handleClassChange('QUESTION', e.target.checked)}
                    type="checkbox"
                  />
                  <span className="text-sm font-semibold text-foreground">질문</span>
                </label>
                <p className="text-[11px] text-state-warn pl-7">
                  정확하지 않은 답이 나갈 수 있어요
                </p>
              </div>

              {/* 불만 (disabled) */}
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1 opacity-70">
                <label className="flex items-center gap-3 cursor-not-allowed min-h-[36px]">
                  <input
                    checked={false}
                    className="size-4 rounded border-input cursor-not-allowed opacity-50"
                    disabled
                    type="checkbox"
                  />
                  <span className="text-sm font-semibold text-muted-foreground">불만</span>
                </label>
                <p className="text-[11px] text-muted-foreground pl-7">항상 직접 확인해요</p>
              </div>

              {/* 민감한 내용 (disabled) */}
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1 opacity-70">
                <label className="flex items-center gap-3 cursor-not-allowed min-h-[36px]">
                  <input
                    checked={false}
                    className="size-4 rounded border-input cursor-not-allowed opacity-50"
                    disabled
                    type="checkbox"
                  />
                  <span className="text-sm font-semibold text-muted-foreground">민감한 내용</span>
                </label>
                <p className="text-[11px] text-muted-foreground pl-7">항상 직접 확인해요</p>
              </div>

              {/* 스팸 (disabled) */}
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1 opacity-70">
                <label className="flex items-center gap-3 cursor-not-allowed min-h-[36px]">
                  <input
                    checked={false}
                    className="size-4 rounded border-input cursor-not-allowed opacity-50"
                    disabled
                    type="checkbox"
                  />
                  <span className="text-sm font-semibold text-muted-foreground">스팸</span>
                </label>
                <p className="text-[11px] text-muted-foreground pl-7">항상 직접 확인해요</p>
              </div>
            </div>
          </div>

          {/* Daily cap input */}
          <div className="space-y-1.5 max-w-xs">
            <label
              className="text-xs font-bold text-foreground"
              htmlFor={`daily-cap-${selectedChannel}`}
            >
              하루 최대 답글 수 (1-100)
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
              id={`daily-cap-${selectedChannel}`}
              max={100}
              min={1}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                updateCurrentPolicy({ daily_cap: Number.isNaN(val) ? 20 : val })
              }}
              type="number"
              value={currentPolicy.daily_cap ?? 20}
            />
            {fieldErrors.daily_cap ? (
              <p className="text-xs font-medium text-destructive">{fieldErrors.daily_cap}</p>
            ) : null}
          </div>

          {/* Quiet hours */}
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <label
                className="text-sm font-bold text-foreground cursor-pointer"
                htmlFor={`quiet-hours-toggle-${selectedChannel}`}
              >
                방해 금지 시간 설정
              </label>
              <input
                checked={Boolean(currentPolicy.quiet_hours_enabled)}
                className="size-5 rounded border-input text-primary focus:ring-ring cursor-pointer min-h-[24px] min-w-[24px]"
                id={`quiet-hours-toggle-${selectedChannel}`}
                onChange={(e) => updateCurrentPolicy({ quiet_hours_enabled: e.target.checked })}
                type="checkbox"
              />
            </div>

            {currentPolicy.quiet_hours_enabled ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor={`quiet-start-${selectedChannel}`}
                  >
                    시작 시간
                  </label>
                  <input
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm shadow-xs min-h-[44px]"
                    id={`quiet-start-${selectedChannel}`}
                    onChange={(e) => updateCurrentPolicy({ quiet_hours_start: e.target.value })}
                    placeholder="22:00"
                    type="time"
                    value={currentPolicy.quiet_hours_start ?? '22:00'}
                  />
                  {fieldErrors.quiet_hours_start ? (
                    <p className="text-xs text-destructive">{fieldErrors.quiet_hours_start}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor={`quiet-end-${selectedChannel}`}
                  >
                    종료 시간
                  </label>
                  <input
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm shadow-xs min-h-[44px]"
                    id={`quiet-end-${selectedChannel}`}
                    onChange={(e) => updateCurrentPolicy({ quiet_hours_end: e.target.value })}
                    placeholder="08:00"
                    type="time"
                    value={currentPolicy.quiet_hours_end ?? '08:00'}
                  />
                  {fieldErrors.quiet_hours_end ? (
                    <p className="text-xs text-destructive">{fieldErrors.quiet_hours_end}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Emergency pause toggle (Red outline emergency control) */}
          <div className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-bold text-destructive flex items-center gap-1.5">
                <PauseCircle aria-hidden="true" className="size-4" />
                자동 답글 멈추기
              </span>
              <p className="text-xs text-muted-foreground">
                긴급 상황 시 모든 자동 답글 발송을 즉시 멈춥니다.
              </p>
            </div>
            <input
              checked={Boolean(currentPolicy.is_paused)}
              className="size-5 rounded border-destructive text-destructive focus:ring-destructive cursor-pointer min-h-[24px] min-w-[24px]"
              id={`emergency-pause-${selectedChannel}`}
              onChange={(e) => updateCurrentPolicy({ is_paused: e.target.checked })}
              type="checkbox"
            />
          </div>

          {/* Save button and results */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2">
              {saveSuccess ? (
                <span
                  aria-live="polite"
                  className="text-xs font-semibold text-state-ok"
                >
                  {saveSuccess}
                </span>
              ) : null}
              {saveError ? (
                <span
                  aria-live="assertive"
                  className="text-xs font-semibold text-destructive"
                >
                  {saveError}
                </span>
              ) : null}
            </div>

            <Button
              className="min-h-[44px]"
              disabled={saving}
              onClick={handleSave}
              type="button"
              variant="default"
            >
              <Save aria-hidden="true" className="size-4 mr-1.5" />
              규칙 저장
            </Button>
          </div>
        </div>
      ) : null}

      {/* Confirmation Dialog for turning Auto-Reply ON */}
      <Dialog
        onOpenChange={setShowConfirmModal}
        open={showConfirmModal}
        title="자동 답글을 켤까요?"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-foreground">
            켜면 감사·인사 같은 간단한 댓글에는 승인 없이 답글을 올려요. 불만·민감한 내용·스팸은 항상 직접 확인해요.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              onClick={() => setShowConfirmModal(false)}
              type="button"
              variant="outline"
            >
              취소
            </Button>
            <Button
              onClick={handleConfirmAutoReplyOn}
              type="button"
              variant="default"
            >
              켜기
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
