'use client'

import React, { useEffect, useState } from 'react'
import { Check, Lock, ShieldAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AutonomyEnvelopeCard } from '@/components/v088/sohee/autonomy-envelope-card'
import { HarnessLibraryView } from '@/components/v088/harness/harness-library-view'
import { HarnessDetailView } from '@/components/v088/harness/harness-detail-view'
import { HarnessCreateModal } from '@/components/v088/harness/harness-create-modal'
import { CampaignBrainWorkspace } from '@/features/campaigns/CampaignBrainWorkspace'
import { AutomationWorkspace } from '@/features/automation/automation-workspace'
import { SoheeJudgment } from '@/components/v088/command/sohee-judgment'
import { AttributionOutcomeConsole } from '@/features/attribution/AttributionOutcomeConsole'
import { TONE_PRESETS } from '@/features/quick-start/tone-presets'
import type { WorkSection } from '@/features/sohee-menu/legacy-tab-map'
import type { useWorkspaceProfileForm } from '@/features/sohee-menu/use-workspace-profile-form'

const PROHIBITED_SUGGESTIONS = ['최저가', '100% 보장', '완치/효과 보장', '부작용 없음', '업계 1위', '환불 불가'] as const

interface WorkTabProps {
  workspaceId: string
  form: ReturnType<typeof useWorkspaceProfileForm>
  openSection?: WorkSection
}

export function WorkTab({ workspaceId, form, openSection }: WorkTabProps) {
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (openSection) {
      if (['campaigns', 'routines', 'briefing', 'evaluation', 'reports'].includes(openSection)) {
        setOpenDetails((prev) => ({ ...prev, [openSection]: true }))
      }
      const el = document.getElementById(openSection)
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }, [openSection])

  return (
    <div className="space-y-6">
      {form.status.proposalAlert && (
        <div
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs font-semibold text-primary"
        >
          {form.status.proposalAlert}
        </div>
      )}

      {/* 1. 말투 */}
      <Card id="voice" className="p-6 rounded-[20px] bg-card border border-border shadow-xs space-y-4">
        <div className="space-y-1">
          <h3 className="font-extrabold text-base text-foreground">말투</h3>
          <p className="text-xs text-muted-foreground">소희가 고객과 대화할 때 사용하는 어조와 스타일입니다.</p>
        </div>
        <div className="space-y-2.5">
          <Label htmlFor="voice" className="text-xs font-bold">
            소희의 말투
          </Label>
          <div className="flex flex-wrap gap-1.5 pb-1">
            {TONE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => form.setField('voice', `${preset.label} (${preset.description})`)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                  form.values.voice.includes(preset.label)
                    ? 'border-primary bg-primary/10 text-primary font-bold'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted font-medium'
                }`}
                title={preset.sample}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Input
            id="voice"
            type="text"
            value={form.values.voice}
            onChange={(e) => form.setField('voice', e.target.value)}
            placeholder="예: 친절하고 다정한 어조"
          />
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void form.save()} disabled={form.status.isSaving}>
            {form.status.isSaving ? '저장 중...' : '저장하기'}
          </Button>
        </div>
      </Card>

      {/* 2. 조심할 표현 */}
      <Card id="caution" className="p-6 rounded-[20px] bg-card border border-border shadow-xs space-y-4">
        <div className="space-y-1">
          <h3 className="font-extrabold text-base text-foreground">조심할 표현</h3>
          <p className="text-xs text-muted-foreground">소희가 마케팅 콘텐츠나 답변을 작성할 때 쓰지 말아야 할 단어입니다.</p>
        </div>
        <div className="space-y-2.5">
          <Label htmlFor="prohibited-terms" className="text-xs font-bold">
            쓰지 말아야 할 표현(쉼표로 구분)
          </Label>
          <div className="flex flex-wrap items-center gap-1.5 pb-1">
            <span className="text-[11px] font-semibold text-muted-foreground">추천 금지어:</span>
            {PROHIBITED_SUGGESTIONS.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  const current = form.values.prohibitedTerms.trim()
                  if (!current) {
                    form.setField('prohibitedTerms', term)
                  } else if (!current.split(',').map((s) => s.trim()).includes(term)) {
                    form.setField('prohibitedTerms', `${current}, ${term}`)
                  }
                }}
                className="text-xs px-2.5 py-0.5 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer font-medium"
              >
                + {term}
              </button>
            ))}
          </div>
          <Input
            id="prohibited-terms"
            type="text"
            value={form.values.prohibitedTerms}
            onChange={(e) => form.setField('prohibitedTerms', e.target.value)}
            placeholder="예: 완치, 100% 보장, 부작용 전혀 없음"
          />
          <p className="text-[11px] text-muted-foreground">
            우측 소희 Dock에서 제안이 승인될 경우 이 입력창에 자동으로 추가·반영됩니다.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void form.save()} disabled={form.status.isSaving}>
            {form.status.isSaving ? '저장 중...' : '저장하기'}
          </Button>
        </div>
      </Card>

      {/* 3. 혼자 해도 되는 범위 */}
      <div id="autonomy" className="space-y-4">
        <div id="rules" className="space-y-4">
          <h3 className="font-extrabold text-base text-foreground">혼자 해도 되는 범위</h3>
          <AutonomyEnvelopeCard workspaceId={workspaceId} />

          <Card className="p-6 rounded-[20px] bg-card border border-border shadow-xs space-y-4">
            <h4 className="font-extrabold text-sm text-foreground">업무 실행 기준</h4>
            <p className="text-xs text-muted-foreground">
              소희가 스스로 집행할 수 있는 업무와 반드시 사장님의 승인을 거쳐야 하는 업무의 기준입니다.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              <div className="p-4 rounded-2xl bg-muted/40 border border-border space-y-2">
                <span className="text-xs font-extrabold text-state-ok flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> 바로 해요
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                  상권 기회 탐지, 주간 콘텐츠 기획 수립, 이미지 분석, 예약 슬롯 현황 점검
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 space-y-2">
                <span className="text-xs font-extrabold text-primary flex items-center gap-1.5">
                  <Lock className="w-4 h-4" /> 물어보고 해요
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                  인스타그램 피드 및 스토리 초안 작성, 1:1 예약 문의 답변 초안 생성
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-state-warn-soft border border-state-warn/30 space-y-2">
                <span className="text-xs font-extrabold text-state-warn flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" /> 하지 않아요
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                  네이버 블로그 실제 공개 발행, 가격 15% 이상 할인 쿠폰 발급, 부정 피드백 응대
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 4. 글 쓰는 기준과 이미지 스타일 */}
      <div id="recipes" className="space-y-4">
        <h3 className="font-extrabold text-base text-foreground">글 쓰는 기준과 이미지 스타일</h3>
        {selectedHarnessId ? (
          <HarnessDetailView
            harnessId={selectedHarnessId}
            onBack={() => setSelectedHarnessId(null)}
          />
        ) : (
          <HarnessLibraryView
            onSelectHarness={(id) => setSelectedHarnessId(id)}
            onOpenCreateModal={() => setIsCreateModalOpen(true)}
          />
        )}
      </div>

      {/* 5. 고급 도구 */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="font-extrabold text-base text-foreground">고급 도구</h3>

        <details
          id="campaigns"
          open={openSection === 'campaigns' || !!openDetails.campaigns}
          onToggle={(e) => setOpenDetails((prev) => ({ ...prev, campaigns: e.currentTarget.open }))}
          className="rounded-[20px] border border-border bg-card p-4 transition-all"
        >
          <summary className="cursor-pointer font-bold text-sm text-foreground">캠페인 브레인 & 액션 그래프</summary>
          <div className="pt-4">
            <CampaignBrainWorkspace
              workspaceId={workspaceId}
              businessName={form.values.businessName}
              industry={form.values.industry}
            />
          </div>
        </details>

        <details
          id="routines"
          open={openSection === 'routines' || !!openDetails.routines}
          onToggle={(e) => setOpenDetails((prev) => ({ ...prev, routines: e.currentTarget.open }))}
          className="rounded-[20px] border border-border bg-card p-4 transition-all"
        >
          <summary className="cursor-pointer font-bold text-sm text-foreground">업무 루틴 자동화 세팅</summary>
          <div className="pt-4">
            <AutomationWorkspace />
          </div>
        </details>

        <details
          id="briefing"
          open={openSection === 'briefing' || !!openDetails.briefing}
          onToggle={(e) => setOpenDetails((prev) => ({ ...prev, briefing: e.currentTarget.open }))}
          className="rounded-[20px] border border-border bg-card p-4 transition-all"
        >
          <summary className="cursor-pointer font-bold text-sm text-foreground">아침 사장님 브리핑 & 6단계 진단</summary>
          <div className="pt-4">
            <SoheeJudgment />
          </div>
        </details>

        <details
          id="evaluation"
          open={openSection === 'evaluation' || !!openDetails.evaluation}
          onToggle={(e) => setOpenDetails((prev) => ({ ...prev, evaluation: e.currentTarget.open }))}
          className="rounded-[20px] border border-border bg-card p-4 transition-all"
        >
          <summary className="cursor-pointer font-bold text-sm text-foreground">주간 업무 평가표</summary>
          <div className="pt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              소희가 직접 실행한 마케팅 미션의 품질, 결재 준수율, 유휴 슬롯 소진 및 매출 창출 기여 실적입니다.
            </p>
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              아직 평가할 업무가 없어요. 첫 업무가 끝나면 주간 평가가 쌓여요.
            </div>
          </div>
        </details>

        <details
          id="reports"
          open={openSection === 'reports' || !!openDetails.reports}
          onToggle={(e) => setOpenDetails((prev) => ({ ...prev, reports: e.currentTarget.open }))}
          className="rounded-[20px] border border-border bg-card p-4 transition-all"
        >
          <summary className="cursor-pointer font-bold text-sm text-foreground">성과 기여도 & 폐쇄루프 콘솔</summary>
          <div className="pt-4">
            <AttributionOutcomeConsole workspaceId={workspaceId} />
          </div>
        </details>
      </div>

      <HarnessCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(id) => {
          setIsCreateModalOpen(false)
          setSelectedHarnessId(id)
        }}
      />
    </div>
  )
}
