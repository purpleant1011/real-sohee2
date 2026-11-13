'use client'

import React from 'react'
import '../operator-workspaces/admin-console.css'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { OperatorOnboardingOverview } from './lifecycle-schemas'
import type { DocumentReconsentOverview } from './document-reconsent-schemas'

const stages = [
  { label: '가입 신청', statuses: ['applied'] },
  { label: '정보 확인', statuses: ['information_pending'] },
  { label: '계약 검토', statuses: ['contract_review'] },
  { label: '게시 위임 동의', statuses: ['consent_pending'] },
  { label: '채널 연결', statuses: ['channel_pending', 'payment_pending'] },
  { label: '활성화', statuses: ['ready_for_activation', 'active'] },
] as const

export type OnboardingBoardProps = Readonly<{
  overviews?: readonly OperatorOnboardingOverview[]
  reconsentTargets?: readonly DocumentReconsentOverview[]
}>

export default function OnboardingBoard({ overviews = [], reconsentTargets = [] }: OnboardingBoardProps) {
  const stageItems = stages.map((stage) => ({
    ...stage,
    items: overviews.filter((overview) => overview.lifecycle.data && (stage.statuses as readonly string[]).includes(overview.lifecycle.data.status))
  }))
  const stageCount = (statuses: readonly string[]) => overviews.filter((overview) => overview.lifecycle.data && statuses.includes(overview.lifecycle.data.status)).length

  return (
    <section aria-labelledby="onboarding-board-title" className="admin-page admin-onboarding-page space-y-6">
      <header>
        <h1 id="onboarding-board-title" className="text-2xl font-bold">가입·계약</h1>
        <p className="text-xs text-muted-foreground">고객사 가입부터 계약, 게시 위임 동의, 서비스 활성화까지 관리합니다.</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5" aria-label="가입·계약 요약">
        <Card className="p-4"><span className="text-xs text-muted-foreground">신규 가입</span><div className="text-2xl font-bold mt-1">{stageCount(['applied'])}</div></Card>
        <Card className="p-4"><span className="text-xs text-muted-foreground">서류 검토</span><div className="text-2xl font-bold mt-1">{stageCount(['information_pending'])}</div></Card>
        <Card className="p-4"><span className="text-xs text-muted-foreground">계약 협의</span><div className="text-2xl font-bold mt-1">{stageCount(['contract_review'])}</div></Card>
        <Card className="p-4"><span className="text-xs text-muted-foreground">동의 대기</span><div className="text-2xl font-bold mt-1">{stageCount(['consent_pending'])}</div></Card>
        <Card className="p-4"><span className="text-xs text-muted-foreground">활성화 완료</span><div className="text-2xl font-bold mt-1">{stageCount(['active'])}</div></Card>
      </div>

      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold">온보딩 파이프라인</CardTitle>
          <span className="text-xs text-muted-foreground">{overviews.length}개 고객사</span>
        </CardHeader>
        <CardContent className="p-4">
          <div className="admin-kanban grid grid-cols-2 md:grid-cols-6 gap-3" aria-label="가입·계약 단계">
            {stageItems.map((stage) => (
              <article key={stage.label} className="p-3 bg-muted/30 rounded-lg border">
                <h3 className="text-xs font-semibold">{stage.label}</h3>
                <strong className="text-lg font-bold block my-1">{stage.items.length}개사</strong>
                {stage.items.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">대기 고객사 없음</p>
                ) : (
                  stage.items.map((overview) => (
                    <div key={overview.workspaceId} className="space-y-1 border-b py-1 last:border-0">
                      <Link href={`/admin/onboarding?workspace=${overview.workspaceId}`} className="block min-h-11 py-3 text-xs font-medium text-primary hover:underline">
                        {overview.workspaceName}
                      </Link>
                      {stage.label === '가입 신청' ? <Link href={`/admin/workspaces/${overview.workspaceId}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline">크레딧 지급</Link> : null}
                    </div>
                  ))
                )}
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. 약관·동의 문서 관리 및 검토 항목 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">약관·동의 문서 관리</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-muted-foreground">서비스 이용약관</span>
              <span className="font-mono text-emerald-600">v2.1 (유효)</span>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-muted-foreground">개인정보 처리방침</span>
              <span className="font-mono text-emerald-600">v2.1 (유효)</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">SNS 대행 게시 위임 동의서</span>
              <span className="font-mono text-purple-600">v1.4 (유효)</span>
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">검토 항목</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b">
              <span>서비스 계약</span>
              <span className="text-amber-600 font-medium">검토 대기</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span>상세 정보</span>
              <span className="text-muted-foreground">확인 완료</span>
            </div>
          </div>
        </Card>
      </div>

      {/* 5. 재동의 대상 관리 (Reconsent Targets) */}
      {reconsentTargets.length > 0 && (
        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">재동의 대상</h2>
          <div className="space-y-2">
            {reconsentTargets.flatMap((target) => target.items).map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
                <span className="font-bold">{item.workspace_name}</span>
                <span className="font-mono text-amber-700 dark:text-amber-400">{item.reason}</span>
                <span className="text-muted-foreground">{item.document_type}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  )
}
