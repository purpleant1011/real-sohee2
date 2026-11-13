'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { ArrowLeft, Building2, ExternalLink } from 'lucide-react'
import { EmptyNotice, MetricTile } from '@/components/admin-ui/data-state'
import {
  channelLabel, connectionLabel, formatCount, formatKst, formatRelativeKst, lifecycleLabel, planLabel,
  publishStateLabel, referenceCode, sourceToKorean, workspaceKindLabel,
} from '@/components/admin-ui/labels'
import type { OperatorWorkspaceDetailReads, DetailReadState } from './detail-read-orchestrator'
import type { OperatorWorkspaceDetail } from './schemas'
import type { ResolvedBusinessInfo } from './business-info-types'

export type WorkspaceDetailProps = Readonly<{
  summary: OperatorWorkspaceDetail
  reads?: OperatorWorkspaceDetailReads
  businessInfo?: ResolvedBusinessInfo
}>

const TAB_ITEMS = [
  { key: 'summary', label: '요약' },
  { key: 'knowledge', label: '매장 지식·플레이스' },
  { key: 'lifecycle', label: '가입·계약' },
  { key: 'channels', label: '채널' },
  { key: 'publishing', label: '게시' },
  { key: 'billing', label: '크레딧·결제' },
  { key: 'support', label: '지원 기록' },
  { key: 'audit', label: '감사 기록' },
] as const

const SELF_REPORTED_FIELDS: ReadonlyArray<{
  key: keyof NonNullable<ResolvedBusinessInfo['selfReported']>
  label: string
}> = [
  { key: 'businessNumber', label: '사업자등록번호' },
  { key: 'representativeName', label: '대표자명' },
  { key: 'businessStartDate', label: '개업일자' },
  { key: 'businessType', label: '업태' },
  { key: 'businessItem', label: '종목' },
  { key: 'phone', label: '가게 전화번호' },
  { key: 'businessHours', label: '영업시간' },
  { key: 'closedDays', label: '휴무일' },
  { key: 'parkingInfo', label: '주차 안내' },
  { key: 'reservationMethod', label: '예약 방법' },
  { key: 'priceRange', label: '가격대' },
  { key: 'websiteUrl', label: '웹사이트' },
  { key: 'naverPlaceUrl', label: '네이버 플레이스' },
]

/** 사장님이 가입 첫 화면에서 직접 적은 사업자·운영 정보. 검증 정본과 절대 섞이지 않게 별도 카드로 보여준다. */
function SelfReportedBusinessCard({ businessInfo }: { businessInfo?: ResolvedBusinessInfo }) {
  const details = businessInfo?.selfReported
  const filled = SELF_REPORTED_FIELDS.filter(({ key }) => {
    const value = details?.[key]
    return typeof value === 'string' && value.length > 0
  })

  if (!details || filled.length === 0) {
    return (
      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-bold">사업자·운영 정보 (사장님 직접 입력)</h2>
        <EmptyNotice title="사장님이 아직 입력하지 않았어요" />
      </Card>
    )
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold">사업자·운영 정보 (사장님 직접 입력)</h2>
          <p className="text-xs text-muted-foreground">가입 첫 화면에서 사장님이 직접 적은 값이에요.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">미검증 · 국세청 확인 전</Badge>
          <Badge variant="outline">
            {details.intakeSource === 'naver_sync' ? '플레이스 정보 직접 입력' : '직접 입력'}
          </Badge>
        </div>
      </div>

      <div role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        이 값은 사장님이 직접 적은 자가 입력이며, 국세청 확인이나 운영팀 승인을 거치지 않았습니다. 사업자 인증 정본은 위 「가입·제출 기록」 탭의 사업자 인증 신청서를 확인하세요.
      </div>

      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        {filled.map(({ key, label }) => {
          const raw = details[key] as string
          const display = key === 'businessNumber' ? formatBrn(raw) : key === 'businessStartDate' ? formatStartDate(raw) : raw
          const isUrl = key === 'websiteUrl' || key === 'naverPlaceUrl'
          return (
            <Row key={key} label={label}>
              {isUrl ? (
                <a href={raw} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-purple-600 hover:underline break-all">
                  {raw} <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
              ) : (
                display
              )}
            </Row>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">입력 시각: {formatKst(details.updatedAt)}</p>
    </Card>
  )
}

const RESULT_LABEL = { succeeded: '성공', failed: '실패', denied: '거부됨' } as const
const MEMBER_ROLE_LABEL: Record<string, string> = { owner: '대표', admin: '관리자', member: '멤버', viewer: '열람자' }
const MEMBER_STATUS_LABEL: Record<string, string> = { active: '사용 중', invited: '초대함', suspended: '정지', removed: '제거됨' }

/** Why a section has no data to show; null means data is ready to render. */
export function sectionProblem(state: DetailReadState<unknown> | { kind: string; message?: string } | undefined): string | null {
  if (!state) return '이 자료는 아직 불러오지 않았어요.'
  switch (state.kind) {
    case 'ready': return null
    case 'empty': return null
    case 'forbidden': return '이 자료를 볼 권한이 없어요.'
    case 'out_of_scope': return '이 고객사는 내 담당 범위가 아니에요.'
    case 'not_connected': return '이 자료는 아직 연결되지 않았어요.'
    case 'unknown': return '자료를 확인할 수 없어요.'
    default: return '자료를 불러오지 못했어요. 표시된 값은 확인되지 않은 값이에요.'
  }
}

function Problem({ text }: { text: string }) {
  return <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-900">{text}</div>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  )
}

function Section({ state, emptyTitle, children }: { state: DetailReadState<unknown> | undefined; emptyTitle: string; children: () => React.ReactNode }) {
  const problem = sectionProblem(state)
  if (problem) return <Problem text={problem} />
  if (state?.kind === 'empty') return <EmptyNotice title={emptyTitle} />
  return <>{children()}</>
}

function formatBrn(raw: string | null | undefined): string {
  if (!raw) return '미등록'
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`
}

function formatStartDate(raw: string | null | undefined): string {
  if (!raw) return '미제출'
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return raw
  return `${digits.slice(0, 4)}년 ${digits.slice(4, 6)}월 ${digits.slice(6, 8)}일`
}

export default function WorkspaceDetail({ summary, reads, businessInfo }: WorkspaceDetailProps) {
  const [activeTab, setActiveTab] = useState('summary')
  const channelsRead = reads?.channels
  const channelRows = channelsRead && channelsRead.kind === 'ready' ? channelsRead.data : null
  const connectedCount = channelRows ? channelRows.filter((c) => c.connectionStatus === 'connected').length : null

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 border-b pb-6">
        <Link href="/admin/workspaces" className="inline-flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-purple-600">
          <ArrowLeft className="size-4" aria-hidden /> 고객사 목록
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-purple-500/20 bg-purple-600/10 p-2.5 text-purple-700"><Building2 className="size-6" aria-hidden /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">{summary.workspaceName}</h1>
              <Badge variant="purple">{planLabel(summary.planCode)}</Badge>
              <Badge variant={summary.lifecycleStatus === 'active' ? 'success' : 'outline'}>{lifecycleLabel(summary.lifecycleStatus)}</Badge>
              {summary.workspaceKind !== 'production' ? <Badge variant="warning">{workspaceKindLabel(summary.workspaceKind)}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.businessName ?? '사업자 정보 미등록'} · 시간대 {summary.timezone} · 참조번호 {referenceCode(summary.workspaceId)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/workspaces/${summary.workspaceId}/timeline`} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-purple-600">고객 타임라인</Link>
          <Link href="/admin/interventions" className="inline-flex min-h-11 items-center rounded-md border border-red-600/40 px-4 text-sm font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600">긴급 개입 화면</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="남은 크레딧" value={summary.availableCredits === null ? null : `${summary.availableCredits.toLocaleString('ko-KR')} 크레딧`} tone={summary.availableCredits !== null && summary.availableCredits <= 0 ? 'warn' : 'default'} />
        <MetricTile
          label="채널 연결"
          value={connectedCount === null ? null : `${connectedCount} / ${channelRows?.length ?? 0}개 연결`}
          hint={connectedCount === null ? '채널 탭에서 사유를 확인하세요' : undefined}
        />
        <MetricTile label="이번 달 게시" value={formatCount(summary.publishedThisMonth)} hint={`실패 ${formatCount(summary.failedThisMonth)}`} tone={summary.failedThisMonth > 0 ? 'bad' : 'default'} />
        <MetricTile label="멤버" value={formatCount(summary.memberCount, '명')} hint={`최근 활동 ${formatRelativeKst(summary.lastActivityAt)}`} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap gap-1 rounded-xl border bg-muted/40 p-1">
          {TAB_ITEMS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} className="min-h-11 px-3 py-1.5 text-sm">{tab.label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="space-y-2 p-5">
              <h2 className="text-sm font-bold">기본 정보</h2>
              <Row label="고객사">{summary.workspaceName}</Row>
              <Row label="상호">{summary.businessName ?? '미등록'}</Row>
              <Row label="가입 단계">{lifecycleLabel(summary.lifecycleStatus)}</Row>
              <Row label="요금제">{planLabel(summary.planCode)}</Row>
              <Row label="약관 동의">{{ accepted: '동의 완료', partial: '일부 동의', missing: '동의 없음', unknown: '확인할 수 없어요' }[summary.agreementStatus]}</Row>
              <Row label="등록일">{formatKst(summary.createdAt)}</Row>
            </Card>
            <Card className="space-y-2 p-5">
              <h2 className="text-sm font-bold">채널 연결 요약</h2>
              <Row label="인스타그램">{summary.instagramStatus === 'unknown' ? '연결 기록 없음' : connectionLabel(summary.instagramStatus)}</Row>
              <Row label="스레드">{summary.threadsStatus === 'unknown' ? '연결 기록 없음' : connectionLabel(summary.threadsStatus)}</Row>
              <h2 className="pt-3 text-sm font-bold">멤버 구성</h2>
              {summary.memberAggregates.length === 0 ? <p className="text-sm text-muted-foreground">멤버 정보가 없어요.</p> : summary.memberAggregates.map((m) => (
                <Row key={`${m.role}-${m.status}`} label={`${MEMBER_ROLE_LABEL[m.role] ?? '기타 권한'} · ${MEMBER_STATUS_LABEL[m.status] ?? '상태 미확인'}`}>{formatCount(m.count, '명')}</Row>
              ))}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="space-y-4">
          {/* 사장님 자가 입력은 네이버 연동 여부와 무관하게 항상 보여준다. */}
          <SelfReportedBusinessCard businessInfo={businessInfo} />
          <Section state={reads?.knowledge} emptyTitle="네이버 플레이스 연동 정보가 없어요">{() => {
            const k = reads?.knowledge.data
            if (!k || (!k.placeUrl && !k.businessName && !k.location && !k.placeStatus && !k.industry && !k.summary && !k.readiness)) {
              return <EmptyNotice title="네이버 플레이스 연동 정보가 없어요" />
            }
            return (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {k.readiness ? (
                  <Card className="space-y-3 p-5 md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                      <div>
                        <h2 className="text-sm font-bold text-foreground">지식 준비 현황</h2>
                        <p className="text-xs text-muted-foreground">실제 매장 지식베이스 및 상품·서비스 구조화 상태예요.</p>
                      </div>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        텔레메트리: 수집하지 않음
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <span className="text-xs text-muted-foreground">사용 중인 지식</span>
                        <p className="mt-1 text-lg font-bold text-foreground">
                          {k.readiness.factsConfirmedCount !== null ? formatCount(k.readiness.factsConfirmedCount, '건') : '확인 불가'}
                        </p>
                        <span className="text-[11px] text-muted-foreground">활성 지식</span>
                      </div>
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <span className="text-xs text-muted-foreground">대기 중 지식</span>
                        <p className="mt-1 text-lg font-bold text-foreground">
                          {k.readiness.factsPendingCount !== null ? formatCount(k.readiness.factsPendingCount, '건') : '확인 불가'}
                        </p>
                        <span className="text-[11px] text-muted-foreground">검토 대기 항목</span>
                      </div>
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <span className="text-xs text-muted-foreground">학습 자료</span>
                        <p className="mt-1 text-lg font-bold text-foreground">
                          {k.readiness.materialsExtractedCount !== null ? formatCount(k.readiness.materialsExtractedCount, '건 완료') : '확인 불가'}
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {k.readiness.materialsProcessingCount !== null ? `처리중 ${k.readiness.materialsProcessingCount} · 실패 ${k.readiness.materialsFailedCount}` : '확인 불가'}
                        </span>
                      </div>
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <span className="text-xs text-muted-foreground">서비스·가격 지식</span>
                        <p className="mt-1 text-lg font-bold text-foreground">
                          {k.readiness.structuredFactsCount !== null ? formatCount(k.readiness.structuredFactsCount, '건') : '확인 불가'}
                        </p>
                        <span className="text-[11px] text-muted-foreground">구조화 카탈로그: 집계 미지원</span>
                      </div>
                    </div>

                    {k.readiness.errors && k.readiness.errors.length > 0 ? (
                      <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900">
                        일부 지식 지표를 조회하지 못했어요. (확인 불가 항목 참조)
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                      <span>원문 지식과 대화 내용은 고객 프라이버시 보호를 위해 집계 수치만 제공해요.</span>
                      <span>마지막 수정: {formatKst(k.readiness.lastUpdatedAt ?? k.updatedAt)}</span>
                    </div>
                  </Card>
                ) : null}

                <Card className="space-y-2 p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">네이버 스마트플레이스 직접 등록 상태</h2>
                    <Badge variant={k.placeStatus === 'connected' ? 'success' : k.placeStatus ? 'warning' : 'outline'}>
                      {k.placeStatus === 'connected' ? '직접 등록' : connectionLabel(k.placeStatus ?? 'disconnected')}
                    </Badge>
                  </div>
                  <Row label="플레이스 링크">
                    {k.placeUrl ? (
                      <a
                        href={k.placeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-purple-600 hover:underline break-all"
                      >
                        {k.placeUrl} <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    ) : (
                      '미등록'
                    )}
                  </Row>
                  <Row label="등록 상태">{k.placeStatus === 'connected' ? '직접 등록' : connectionLabel(k.placeStatus ?? 'disconnected')}</Row>
                  <Row label="최근 갱신 시각">{formatKst(k.updatedAt)}</Row>
                </Card>

                <Card className="space-y-2 p-5">
                  <h2 className="text-sm font-bold">매장 지식</h2>
                  <Row label="상호명">{k.businessName ?? '미등록'}</Row>
                  <Row label="업종">{k.industry ?? '미등록'}</Row>
                  <Row label="주소">{k.location ?? '미등록'}</Row>
                  <div className="pt-2">
                    <span className="text-sm text-muted-foreground">매장 소개 요약</span>
                    <p className="mt-1 text-sm text-foreground whitespace-pre-wrap rounded-lg bg-muted/40 p-3">
                      {k.summary ?? '등록된 매장 소개가 없어요.'}
                    </p>
                  </div>
                </Card>
              </div>
            )
          }}</Section>
        </TabsContent>

        <TabsContent value="lifecycle" className="space-y-4">
          <div className="space-y-4">
            <Card className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="space-y-0.5">
                  <h2 className="text-base font-bold text-foreground">가입·제출 기록 및 정합 명세</h2>
                  <p className="text-xs text-muted-foreground">
                    계정 생성, 사업자 정보 제출, 서류 심사, 법적 약관 동의 상태를 분리하여 표시합니다.
                  </p>
                </div>
                {businessInfo?.submittedAt ? (
                  <span className="text-xs text-muted-foreground">
                    최종 접수/갱신: {formatKst(businessInfo.submittedAt)}
                  </span>
                ) : null}
              </div>

              {/* 4대 상태 분리 투영 그리드 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">기본 가입 (계정)</div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={businessInfo?.identityState === 'COMPLETED' ? 'success' : 'outline'}>
                      {businessInfo?.identityStateLabel ?? '가입 완료'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    생성: {formatKst(summary.createdAt)}
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">사업자 정보 제출</div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={businessInfo?.businessSubmissionState === 'SUBMITTED' ? 'purple' : businessInfo?.businessSubmissionState === 'QUERY_ERROR' ? 'warning' : 'outline'}>
                      {businessInfo?.businessSubmissionStateLabel ?? '미제출'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    {businessInfo?.businessSubmissionState === 'SUBMITTED' ? '신청 정보 접수됨' : '미제출 (체험 단계)'}
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">사업자 심사</div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={businessInfo?.status === 'VERIFIED' ? 'success' : businessInfo?.status === 'REJECTED' ? 'warning' : businessInfo?.status === 'SUBMITTED_PENDING' ? 'purple' : 'outline'}>
                      {businessInfo?.statusLabel ?? '미제출'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    {businessInfo?.status === 'REJECTED' ? (businessInfo.rejectionReason || '심사 반려') : businessInfo?.status === 'VERIFIED' ? '정식 회원' : '심사 대기 / 미접수'}
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">필수 약관 및 동의</div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={businessInfo?.legalConsentState === 'COMPLETED' ? 'success' : 'outline'}>
                      {businessInfo?.legalConsentStateLabel ?? '약관 확인 필요'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    {businessInfo?.marketingConsent ? (businessInfo.marketingConsent.agreed ? '마케팅 알림 동의함' : '마케팅 알림 미동의') : '마케팅 미선택'}
                  </div>
                </div>
              </div>

              {/* 저장 필드 및 출처 상세 테이블 */}
              <div className="space-y-2 pt-2">
                <h3 className="text-xs font-bold text-foreground">수집 및 저장 필드 정합 내역</h3>
                <div className="divide-y rounded-xl border bg-card">
                  <Row label="상호명">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{businessInfo?.companyName.value || '미입력'}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        출처: {sourceToKorean(businessInfo?.companyName.source)}
                      </Badge>
                    </span>
                  </Row>
                  <Row label="대표자명">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{businessInfo?.representativeName.value || '미입력'}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        출처: {sourceToKorean(businessInfo?.representativeName.source)}
                      </Badge>
                    </span>
                  </Row>
                  <Row label="사업자등록번호">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold font-mono">{formatBrn(businessInfo?.businessNumber.value)}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        출처: {sourceToKorean(businessInfo?.businessNumber.source)}
                      </Badge>
                    </span>
                  </Row>
                  <Row label="개업일자">
                    <span className="flex items-center gap-2">
                      <span>{formatStartDate(businessInfo?.startDate?.value)}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        출처: {sourceToKorean(businessInfo?.startDate?.source)}
                      </Badge>
                    </span>
                  </Row>
                  <Row label="사업자등록증">
                    <span>
                      {businessInfo?.hasDocument ? (
                        <span className="text-emerald-700 font-medium">서류 파일 접수됨 (검증 가능)</span>
                      ) : (
                        <span className="text-muted-foreground">미제출</span>
                      )}
                    </span>
                  </Row>
                  {businessInfo?.naverPlace?.url ? (
                    <Row label="네이버 플레이스">
                      <span className="flex items-center gap-2">
                        <span className="text-xs truncate max-w-xs">{businessInfo.naverPlace.url}</span>
                        <Badge variant="outline" className="text-[10px] font-normal">출처: 네이버 플레이스 연동</Badge>
                      </span>
                    </Row>
                  ) : null}
                </div>
              </div>

              {/* 약관 동의 세부 목록 */}
              {businessInfo?.agreements && businessInfo.agreements.length > 0 ? (
                <div className="space-y-2 pt-2">
                  <h3 className="text-xs font-bold text-foreground">약관 및 동의 기록 상세</h3>
                  <div className="overflow-x-auto rounded-xl border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-xs">동의 항목</TableHead>
                          <TableHead className="text-xs">상태</TableHead>
                          <TableHead className="text-xs">동의 일시 (KST)</TableHead>
                          <TableHead className="text-xs">버전</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {businessInfo.agreements.map((ag) => (
                          <TableRow key={ag.type}>
                            <TableCell className="text-xs font-medium">{ag.label}</TableCell>
                            <TableCell>
                              <Badge variant={ag.agreed ? 'success' : 'outline'} className="text-[11px]">
                                {ag.agreed ? '동의 완료' : '미동의 (거부)'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatKst(ag.agreedAt)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{ag.version ?? '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </Card>

            <Section state={reads?.lifecycle} emptyTitle="온보딩 활성화 검토 기록이 없어요">{() => {
              const overview = reads?.lifecycle.data?.[0]
              if (!overview) return null
              return (
                <Card className="space-y-2 p-5">
                  <h3 className="text-xs font-bold text-muted-foreground pb-1">온보딩 활성화 준비 개요</h3>
                  <Row label="가입 단계">{overview.lifecycle.data ? lifecycleLabel(overview.lifecycle.data.status) : '확인할 수 없어요'}</Row>
                  <Row label="활성화 준비">{overview.activation.ready ? '준비 완료' : `부족한 항목 ${overview.activation.missing.length}개`}</Row>
                  <Row label="약관 동의">{overview.agreements.data ? formatCount(overview.agreements.data.filter((a) => a.status === 'accepted').length, '건 동의') : '확인할 수 없어요'}</Row>
                  <Row label="채널 위임">{overview.delegations.data ? formatCount(overview.delegations.data.filter((d) => d.status === 'accepted').length, '건 동의') : '확인할 수 없어요'}</Row>
                </Card>
              )
            }}</Section>
          </div>
        </TabsContent>

        <TabsContent value="channels">
          <Section state={reads?.channels} emptyTitle="연결된 채널이 없어요">{() => (
            <div className="grid gap-3 md:grid-cols-2">
              {(channelRows ?? []).map((c) => (
                <Card key={c.channel} className="space-y-2 p-5">
                  <h2 className="text-sm font-bold">{channelLabel(c.channel)}</h2>
                  <Row label="연결 상태">{connectionLabel(c.connectionStatus)}</Row>
                  <Row label="계정">{c.accountLabel ?? '표시할 계정 이름이 없어요'}</Row>
                  <Row label="인증 만료">{formatKst(c.tokenExpiresAt)}</Row>
                  <Row label="마지막 수신">{formatRelativeKst(c.lastWebhookAt)}</Row>
                  {c.lastErrorCode ? <Row label="최근 오류">오류가 기록되어 있어요</Row> : null}
                </Card>
              ))}
            </div>
          )}</Section>
        </TabsContent>

        <TabsContent value="publishing">
          <Section state={reads?.publishing} emptyTitle="최근 게시 기록이 없어요">{() => (
            <Card className="divide-y p-0">
              {(reads?.publishing.data?.items ?? []).slice(0, 20).map((p) => (
                <div key={`${p.contentId}-${p.channel}-${p.attemptNumber ?? 0}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0"><div className="truncate font-medium">{p.contentTitle}</div><div className="text-xs text-muted-foreground">{channelLabel(p.channel)}</div></div>
                  <div className="text-right"><Badge variant={p.displayState === 'failure' ? 'warning' : 'outline'}>{publishStateLabel(p.displayState)}</Badge><div className="text-xs text-muted-foreground">{formatKst(p.publishedAt ?? p.publishAt)}</div></div>
                </div>
              ))}
            </Card>
          )}</Section>
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <Section state={reads?.billing} emptyTitle="결제·크레딧 기록이 없어요">{() => {
            const item = reads?.billing.data?.items[0]
            if (!item) return <EmptyNotice title="결제·크레딧 기록이 없어요" />
            return (
              <Card className="space-y-2 p-5">
                <Row label="요금제">{planLabel(item.entitlement.plan_code)}</Row>
                <Row label="이번 주기 한도">{formatCount(item.entitlement.weekly_limit, ' 크레딧')}</Row>
                <Row label="사용 가능">{formatCount(item.balance.available, ' 크레딧')}</Row>
                <Row label="사용함">{formatCount(item.balance.consumed, ' 크레딧')}</Row>
                <Row label="AI 비용">{item.cost.api_cost_krw === null ? '측정 전이에요' : `${item.cost.api_cost_krw.toLocaleString('ko-KR')}원`}</Row>
              </Card>
            )
          }}</Section>

          <Card className="overflow-hidden border border-border/80 shadow-xs">
            <div className="border-b bg-muted/20 p-4">
              <h2 className="text-sm font-bold text-foreground">
                최근 에이전트 크레딧 차감 내역 (최근 50건)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                에이전트 작업(글 생성, 이미지 렌더링 등)으로 실제 차감된 내역입니다.
              </p>
            </div>
            <div className="p-0">
              <Section state={reads?.creditConsumptions} emptyTitle="최근 차감된 크레딧 내역이 없어요">{() => {
                const consumptions = reads?.creditConsumptions?.data ?? []
                if (consumptions.length === 0) {
                  return <EmptyNotice title="최근 차감된 크레딧 내역이 없어요" />
                }
                return (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead>일시</TableHead>
                          <TableHead>작업 종류</TableHead>
                          <TableHead>차감 크레딧</TableHead>
                          <TableHead className="w-[120px]">멱등키 참조번호</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {consumptions.map((item) => (
                          <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {item.occurredAt}
                            </TableCell>
                            <TableCell className="text-xs font-medium text-foreground">
                              {item.action}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                              {item.amountLabel}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                              {item.idempotencyReference}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )
              }}</Section>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="support">
          <Section state={reads?.support as DetailReadState<unknown>} emptyTitle="지원 기록이 없어요">{() => (
            <Card className="divide-y p-0">
              {((reads?.support as { data?: readonly { sessionId: string; reason: string; startedAt: string; status: string }[] } | undefined)?.data ?? []).map((s) => (
                <div key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate">{s.reason}</span>
                  <span className="text-xs text-muted-foreground">{formatKst(s.startedAt)}</span>
                </div>
              ))}
            </Card>
          )}</Section>
        </TabsContent>

        <TabsContent value="audit">
          <Section state={reads?.audit} emptyTitle="감사 기록이 없어요">{() => (
            <Card className="divide-y p-0">
              {(reads?.audit.data?.items ?? []).map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate">{e.reason || '사유 없음'}</span>
                  <span className="text-right text-xs text-muted-foreground"><Badge variant={e.result === 'succeeded' ? 'success' : 'warning'}>{RESULT_LABEL[e.result]}</Badge> {formatKst(e.createdAt)}</span>
                </div>
              ))}
            </Card>
          )}</Section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
