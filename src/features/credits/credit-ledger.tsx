'use client'

import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Sparkles,
  Image as ImageIcon,
  MessageSquare,
  FileText,
  RotateCcw,
  PlusCircle,
  HelpCircle,
  Calendar,
  Layers,
  CheckCircle2,
} from 'lucide-react'
import type { CreditLedgerEntry, CreditLedgerKind } from './types'

const labels: Readonly<Record<CreditLedgerKind, string>> = {
  grant: '제공',
  reserve: '임시 확보',
  consume: '사용',
  release: '반환 또는 조정',
  refund: '반환 또는 조정',
  adjustment: '반환 또는 조정',
}

function getActionFriendlyDescription(entry: CreditLedgerEntry): {
  title: string
  hint: string
  icon: typeof Sparkles
} {
  const isConsume = entry.kind === 'consume'
  const isReserve = entry.kind === 'reserve'
  const isRelease = entry.kind === 'release' || entry.kind === 'refund'
  const isGrant = entry.kind === 'grant'

  switch (entry.action as string | null | undefined) {
    case 'text_generation':
      return {
        title: isConsume ? '인스타그램 글 생성' : isReserve ? '인스타그램 글 생성 예약' : '인스타그램 글 생성 정산',
        hint: '소희 에이전트의 AI 맞춤 카피라이팅 및 캡션 작성',
        icon: FileText,
      }
    case 'image_generation':
      return {
        title: isConsume ? '고화질 이미지 렌더링' : isReserve ? '고화질 이미지 렌더링 예약' : '이미지 렌더링 정산',
        hint: '인스타그램 피드 및 마케팅용 맞춤 비주얼 이미지 생성',
        icon: ImageIcon,
      }
    case 'image_edit':
      return {
        title: isConsume ? '이미지 리터칭 및 수정' : isReserve ? '이미지 수정 예약' : '이미지 수정 정산',
        hint: 'AI 이미지 후보정 및 리사이징 작업',
        icon: ImageIcon,
      }
    case 'chat_turn':
      return {
        title: isConsume ? '소희 AI 상담 및 대화' : isReserve ? 'AI 대화 예약' : 'AI 상담 정산',
        hint: '마케팅 비서 소희와의 1:1 브랜드 전략 질의응답',
        icon: MessageSquare,
      }
    case 'source_analysis':
      return {
        title: isConsume ? '브랜드 및 레퍼런스 분석' : isReserve ? '자료 분석 예약' : '자료 분석 정산',
        hint: '고객사 브랜드 아이덴티티 및 참고 콘텐츠 분석',
        icon: Layers,
      }
    case 'harness_generation':
      return {
        title: isConsume ? '콘텐츠 기획안 생성' : isReserve ? '기획안 생성 예약' : '기획안 생성 정산',
        hint: '타깃 고객 맞춤 콘텐츠 주제 및 스토리라인 기획',
        icon: Sparkles,
      }
    case 'period_plan_generation':
      return {
        title: isConsume ? '정기 발행 플랜 수립' : isReserve ? '플랜 수립 예약' : '발행 플랜 정산',
        hint: '주간/월간 소셜 콘텐츠 캘린더 자동 편성',
        icon: Calendar,
      }
    case 'performance_report':
      return {
        title: isConsume ? '성과 분석 리포트 발행' : isReserve ? '리포트 생성 예약' : '성과 리포트 정산',
        hint: '소셜 채널 성과 데이터 종합 및 개선 인사이트 도출',
        icon: CheckCircle2,
      }
    case 'external_action_execute':
      return {
        title: isConsume ? '인스타그램 채널 자동 발행' : isReserve ? '발행 대기' : '발행 완료 정산',
        hint: '소셜 미디어 채널 원클릭 예약 발행 집행',
        icon: Sparkles,
      }
    default:
      if (isGrant) {
        return {
          title: '정기 지급 및 혜택 제공',
          hint: '플랜 구독 주기 갱신 또는 프로모션 혜택 적용',
          icon: PlusCircle,
        }
      }
      if (isRelease) {
        return {
          title: '실패 작업 반환 및 잔여 환급',
          hint: '작업 미사용 분 또는 실패 작업 안전 반환',
          icon: RotateCcw,
        }
      }
      if (entry.kind === 'adjustment') {
        return {
          title: '운영자 수기 조정',
          hint: '고객센터 지원 및 운영자 승인에 따른 내역 변동',
          icon: HelpCircle,
        }
      }
      return {
        title: entry.action || '에이전트 작업 실행',
        hint: '소희 에이전트 서비스 이용',
        icon: Sparkles,
      }
  }
}

export function CreditLedger({ entries }: Readonly<{ entries: readonly CreditLedgerEntry[] }>) {
  const [kind, setKind] = useState<CreditLedgerKind | 'all'>('all')
  const [period, setPeriod] = useState('all')

  const periods = useMemo(
    () => [...new Set(entries.map((entry) => entry.occurredAt.slice(0, 7)))].sort().reverse(),
    [entries],
  )

  const visible = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (kind === 'all' || entry.kind === kind) &&
          (period === 'all' || entry.occurredAt.startsWith(period)),
      ),
    [entries, kind, period],
  )

  return (
    <section aria-labelledby="credit-ledger-title" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <h1 id="credit-ledger-title" className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            작업 이용 내역
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            소희 AI 에이전트 작업에 따른 처리 및 이용 내역을 확인합니다.
          </p>
        </div>

        {/* 필터 컨트롤 */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            기간 필터
            <select
              aria-label="기간 필터"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-2 focus-visible:outline-purple-600"
            >
              <option value="all">전체 기간</option>
              {periods.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            작업 종류 필터
            <select
              aria-label="작업 종류 필터"
              value={kind}
              onChange={(event) => setKind(event.target.value as CreditLedgerKind | 'all')}
              className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-2 focus-visible:outline-purple-600"
            >
              <option value="all">전체 작업</option>
              {Object.keys(labels).map((value) => (
                <option key={value} value={value}>
                  {labels[value as CreditLedgerKind]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">표시할 작업 이력이 없어요.</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {visible.map((entry) => {
            const friendly = getActionFriendlyDescription(entry)
            const Icon = friendly.icon
            const isConsume = entry.kind === 'consume'
            const isGrant = entry.kind === 'grant'
            const isRelease = entry.kind === 'release' || entry.kind === 'refund'
            const isReserve = entry.kind === 'reserve'

            return (
              <li key={entry.id}>
                <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 transition-all hover:border-purple-500/40 hover:shadow-xs">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`rounded-xl p-2.5 shrink-0 ${
                        isConsume
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : isGrant
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : isRelease
                              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      <Icon className="size-5" aria-hidden />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {friendly.title}
                        </span>
                        <Badge
                          variant={
                            isConsume
                              ? 'outline'
                              : isGrant
                                ? 'purple'
                                : isRelease
                                  ? 'outline'
                                  : 'outline'
                          }
                          className={`text-[10px] font-semibold ${
                            isConsume
                              ? 'border-rose-200 bg-rose-50/50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'
                              : isRelease
                                ? 'border-blue-200 bg-blue-50/50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300'
                                : ''
                          }`}
                        >
                          <strong>{labels[entry.kind]}</strong>
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground truncate">
                        {friendly.hint}
                      </p>

                      {/* 보조 메타 정보 및 일시 */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">{entry.action ?? '정책'}</span>
                        <span>·</span>
                        <time dateTime={entry.occurredAt} className="font-mono">
                          {entry.occurredAt}
                        </time>
                      </div>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0">
                    <span className="text-xs sm:text-sm font-semibold text-foreground">
                      {isConsume ? '처리 완료' : isReserve ? '작업 대기 중' : isRelease ? '복구 완료' : '제공 완료'}
                    </span>
                  </div>
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
