'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  Play,
  AlertTriangle,
  Clock,
  CheckCircle2
} from 'lucide-react'
import { StateView } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'

interface WorkSubViewProps {
  isTestAccount?: boolean
}

// 1. RUNNING TASKS VIEW
export function RunningTasksView({ isTestAccount = false }: WorkSubViewProps) {
  const runningTasks = isTestAccount ? [
    {
      id: 'run-1',
      title: '04. 사전 품질 게이트(Quality Gate) 자동 검증',
      executor: 'Quality Gate Engine',
      startedAt: '12:35:10',
      progress: '96%',
      statusText: '의료법/과대광고 금지어 0건 확인 완료. 텍스트 해상도 및 이미지 규격 정밀 체크 중',
      badge: '품질 검수 중'
    },
    {
      id: 'run-2',
      title: '05. SNS 발행 및 네이버 블로그 원고 준비 대기열',
      executor: 'Meta API Publisher & Blog Drafter',
      startedAt: '12:36:00',
      progress: '대기 중',
      statusText: '사장님 승인 수신 즉시 SNS 발행 및 블로그 원고·사진 준비 대기',
      badge: '발행 대기'
    }
  ] : []

  if (runningTasks.length === 0) {
    return (
      <StateView
        kind="confirmed_empty"
        title="현재 실행 중인 작업이 없습니다"
        description="소희에게 새로운 마케팅 업무를 지시하면 실시간 실행 현황이 표시됩니다."
        action={
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href="/app">소희에게 업무 지시하기</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-[var(--v088-ink)] flex items-center gap-2">
          <Play className="w-4 h-4 text-primary animate-pulse" />
          <span>실시간 실행 중인 업무 ({runningTasks.length}건)</span>
        </h3>
        <span className="text-xs text-[var(--v088-muted)]">소희 에이전트 실시간 가동 중</span>
      </div>

      <div className="space-y-3">
        {runningTasks.map((task) => (
          <div
            key={task.id}
            className="p-5 rounded-2xl bg-[var(--v088-surface)] border-2 border-primary/40 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary animate-ping" />
                <h4 className="font-bold text-sm text-[var(--v088-ink)]">{task.title}</h4>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-foreground dark:text-primary font-bold">
                {task.badge}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--v088-surface-subtle)] text-xs text-[var(--v088-ink)] leading-relaxed space-y-1">
              <div className="flex justify-between text-[11px] text-[var(--v088-muted)]">
                <span>담당 실행자: <strong className="text-[var(--v088-ink)]">{task.executor}</strong></span>
                <span className="font-mono">시작 시각: {task.startedAt}</span>
              </div>
              <p className="text-[var(--v088-muted)] pt-1">{task.statusText}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 2. DECISION QUEUE VIEW
export function DecisionQueueView({ isTestAccount = false }: WorkSubViewProps) {
  const [completedList, setCompletedList] = useState<string[]>([])

  const decisions = isTestAccount ? [
    {
      id: 'dec-1',
      title: '네이버 블로그 [봄맞이 매장 대표 가이드] 원고 준비 및 복사',
      whyNow: '주말 대비 주중 검색 트래픽 선점을 위해 오늘 오후 2시 전 발행 필요',
      expectedEffect: '동네 대표 키워드 검색 시 정보 노출 지원 및 매장 인지도 향상',
      riskTier: 'R1 (원고 준비)',
      actions: ['네이버 블로그 원고 및 사진 구성 완료', '원고 복사 대기', '인스타그램 피드 연계 준비']
    },
    {
      id: 'dec-2',
      title: '주중 화/수 첫 방문 고객 15% 할인 프로모션 오퍼 적용',
      whyNow: '화요일/수요일 오후 2~5시 유휴 슬롯 4개 예약 전환율 향상',
      expectedEffect: '첫 방문 고객 혜택 안내를 통한 유휴 시간대 예약 문의 증대 기대',
      riskTier: 'R2 (가격 정책 적용)',
      actions: ['당근마켓 소식 원고 및 안내 초안 준비', '인스타그램 프로필 링크 안내 문구 준비']
    }
  ] : []

  const handleApprove = (id: string) => {
    setCompletedList(prev => [...prev, id])
  }

  const handleReject = (id: string) => {
    setCompletedList(prev => [...prev, id])
  }

  const activeDecisions = decisions.filter(d => !completedList.includes(d.id))

  if (activeDecisions.length === 0) {
    return (
      <StateView
        kind="confirmed_empty"
        title="결재 대기 중인 업무가 없습니다"
        description="외부 실제 발행이나 가격 할인 등 승인이 필요한 업무가 생성되면 여기에 표시됩니다."
        action={
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href="/app">오늘 현황 보러가기</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-[var(--v088-ink)] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-state-warn" />
          <span>사장님 결정 대기 업무 ({activeDecisions.length}건)</span>
        </h3>
        <span className="text-xs text-[var(--v088-muted)]">결정하시면 다음 작업이 바로 진행됩니다</span>
      </div>

      <div className="space-y-4">
        {activeDecisions.map((item) => (
          <div
            key={item.id}
            className="p-5 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn">
                {item.riskTier}
              </span>
              <span className="text-[11px] text-[var(--v088-muted)] font-mono">확인 후 바로 승인</span>
            </div>

            <h4 className="font-bold text-base text-[var(--v088-ink)]">{item.title}</h4>

            <div className="p-3.5 rounded-xl bg-[var(--v088-surface-subtle)] text-xs text-[var(--v088-ink)] space-y-2">
              <div>
                <span className="font-semibold text-foreground dark:text-primary block mb-0.5">🔍 왜 지금 결정해야 하나요?</span>
                <span className="text-[var(--v088-muted)]">{item.whyNow}</span>
              </div>
              <div>
                <span className="font-semibold text-state-ok block mb-0.5">📈 예상 비즈니스 효과</span>
                <span className="text-[var(--v088-muted)]">{item.expectedEffect}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--v088-border)]">
              <button
                onClick={() => handleReject(item.id)}
                className="px-4 py-2 rounded-xl border border-[var(--v088-border)] text-xs font-bold hover:bg-[var(--v088-surface-subtle)] transition-colors cursor-pointer"
              >
                반려
              </button>
              <button
                onClick={() => handleApprove(item.id)}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all cursor-pointer"
              >
                즉시 승인
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 3. WAITING TASKS VIEW
export function WaitingTasksView({ isTestAccount = false }: WorkSubViewProps) {
  const waitingTasks = isTestAccount ? [
    {
      id: 'wait-1',
      title: '06. SNS 게시물 링크 확인 및 예약 유입 추적',
      scheduledAt: '게시물 발행 완료 직후 (오늘 14:05 예정)',
      objective: 'SNS 게시물 정상 게시 확인 및 예약 링크 유입 추적기 활성화',
      executor: 'External Verifier Engine'
    }
  ] : []

  if (waitingTasks.length === 0) {
    return (
      <StateView
        kind="confirmed_empty"
        title="발행 또는 예약 대기 중인 업무가 없습니다"
        description="예약된 콘텐츠나 다음 단계 실행 대기 중인 작업이 생기면 여기에 표시됩니다."
        action={
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href="/app/content">콘텐츠 허브로 이동</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-[var(--v088-ink)] flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span>발행/예약 대기 중인 업무 ({waitingTasks.length}건)</span>
        </h3>
        <span className="text-xs text-[var(--v088-muted)]">이전 단계 완료 후 순차 진행</span>
      </div>

      <div className="space-y-3">
        {waitingTasks.map((task) => (
          <div
            key={task.id}
            className="p-5 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-[var(--v088-ink)]">{task.title}</h4>
              <span className="text-xs text-primary font-mono font-bold">{task.scheduledAt}</span>
            </div>
            <p className="text-xs text-[var(--v088-muted)] leading-relaxed">{task.objective}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// 4. COMPLETED TASKS VIEW
export function CompletedTasksView({ isTestAccount = false }: WorkSubViewProps) {
  const completedTasks = isTestAccount ? [
    { id: 'c-1', name: '01. 화·수·목 유휴 슬롯 및 상권 축제 기회 탐지', completedAt: '오늘 09:00:18', duration: '6초', score: '100점' },
    { id: 'c-2', name: '02. 주간 타깃 세그먼트 및 15% 할인 프로모션 오퍼 설계', completedAt: '오늘 09:02:15', duration: '75초', score: '98점' },
    { id: 'c-3', name: '03. 네이버 블로그 상세 칼럼 초안 생성', completedAt: '오늘 09:05:40', duration: '40초', score: '96점' },
    { id: 'c-4', name: '04. 인스타그램 피드 및 릴스 홍보 문구 생성', completedAt: '오늘 09:07:10', duration: '30초', score: '98점' },
    { id: 'c-5', name: '05. 인스타그램 고객 문의 실시간 AI 추천 답변 생성', completedAt: '오늘 11:45:20', duration: '12초', score: '100점' },
    { id: 'c-6', name: '06. 고객 360 타임라인 및 예약 의도 분류', completedAt: '오늘 11:46:00', duration: '5초', score: '100점' },
    { id: 'c-7', name: '07. 스레드(Threads) 이용 후 관리 팁 자동 게시', completedAt: '어제 19:00:05', duration: '3초', score: '95점' },
    { id: 'c-8', name: '08. 지난주 성과 분석 및 플레이북 개선안 학습', completedAt: '어제 23:59:00', duration: '15초', score: '100점' }
  ] : []

  if (completedTasks.length === 0) {
    return (
      <div className="p-8 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-center space-y-2">
        <CheckCircle2 className="w-8 h-8 text-zinc-400 mx-auto" />
        <h3 className="font-bold text-sm text-[var(--v088-ink)]">아직 완료된 업무 기록이 없습니다</h3>
        <p className="text-xs text-[var(--v088-muted)]">소희가 실행하고 완결한 마케팅 미션의 실행 증거와 소요 시간, 품질 점수가 이곳에 투명하게 기록됩니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-[var(--v088-ink)] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-state-ok" />
          <span>완료된 업무 아카이브 (총 {completedTasks.length}건)</span>
        </h3>
        <span className="text-xs text-[var(--v088-muted)]">최근 7일간 완료된 에이전트 미션</span>
      </div>

      <div className="space-y-2.5">
        {completedTasks.map((task) => (
          <div
            key={task.id}
            className="p-4 rounded-xl bg-[var(--v088-surface)] border border-[var(--v088-border)] flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-state-ok shrink-0" />
              <div>
                <h4 className="font-bold text-xs md:text-sm text-[var(--v088-ink)]">{task.name}</h4>
                <span className="text-[11px] text-[var(--v088-muted)] font-mono">소요 시간: {task.duration} · 품질 점수: {task.score}</span>
              </div>
            </div>

            <span className="text-xs font-mono text-[var(--v088-muted)] shrink-0">
              {task.completedAt}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
