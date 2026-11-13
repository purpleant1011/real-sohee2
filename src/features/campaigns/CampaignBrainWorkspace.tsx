'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Brain,
  Calendar,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  RefreshCw,
  Layers,
  Zap,
  Eye,
  Send,
  Lock,
  Plus,
  FileText,
  Share2,
  Target,
  BarChart3,
  Users,
  Check,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export interface CampaignBrainWorkspaceProps {
  workspaceId: string;
  businessName?: string;
  industry?: string;
  initialEntries?: any[];
  /** 실제 잔여 크레딧. 넘기지 않으면 '크레딧 확인 필요'로 표시하며 임의 기본값을 쓰지 않는다. */
  availableCredits?: number;
  /** 이번 주 잔여 슬롯 수. 측정값이 없으면 넘기지 않는다(리터럴 대체 금지). */
  remainingSlots?: number | null;
  /** 목표 예약 건수와 현재 확정 건수. 측정값이 없으면 넘기지 않는다. */
  targetBookings?: number | null;
  confirmedBookings?: number | null;
}

interface ActionGraphStep {
  step: number;
  title: string;
  subtitle: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING_APPROVAL' | 'SCHEDULED';
  capability: string;
  riskClass: 'READ' | 'DRAFT' | 'WRITE' | 'SPEND';
  costCredits: number;
  icon: React.ReactNode;
}

export function CampaignBrainWorkspace({
  workspaceId,
  businessName,
  industry = '뷰티 / 헤어·아이래쉬',
  initialEntries = [],
  availableCredits,
  remainingSlots = null,
  targetBookings = null,
  confirmedBookings = null,
}: CampaignBrainWorkspaceProps) {
  // 측정 전에는 매장명을 지어내지 않고 중립 문구를 쓴다.
  const displayName = businessName?.trim() || '우리 가게'
  const [entries, setEntries] = useState<any[]>(initialEntries);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPreviewEntry, setSelectedPreviewEntry] = useState<any | null>(null);
  const [approvalApproved, setApprovalApproved] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // 4대 액션 그래프 노드 상태 정의
  const [actionSteps, setActionSteps] = useState<ActionGraphStep[]>([
    {
      step: 1,
      title: '상권·트렌드 리서치',
      subtitle: '지역 2040 검색 키워드 및 경쟁사 3곳 모니터링',
      status: 'COMPLETED',
      capability: 'research.analyze_market',
      riskClass: 'READ',
      costCredits: 50,
      icon: <Brain className="size-4 text-purple-400" />,
    },
    {
      step: 2,
      title: '전략 및 크리에이티브 시안',
      subtitle: '인스타 피드 2건, 스레드 2건, 네이버 블로그 1건 제작',
      status: 'COMPLETED',
      capability: 'creative.generate_variants',
      riskClass: 'DRAFT',
      costCredits: 350,
      icon: <Layers className="size-4 text-sky-400" />,
    },
    {
      step: 3,
      title: '채널 발행 및 예약 슬롯 집행',
      subtitle: '사장님 승인 대기 중 (인스타그램 자동 송출 & 네이버 블로그 원고 준비)',
      status: approvalApproved ? 'COMPLETED' : 'PENDING_APPROVAL',
      capability: 'execution.publish_and_open_slots',
      riskClass: 'WRITE',
      costCredits: 1200,
      icon: <Send className="size-4 text-amber-400" />,
    },
    {
      step: 4,
      title: '영수증 검증 & 성과 기여 피드백',
      subtitle: '고객 문의·예약 11대 이벤트 추적 및 모델 가중치 업데이트',
      status: approvalApproved ? 'IN_PROGRESS' : 'SCHEDULED',
      capability: 'attribution.closed_loop_feedback',
      riskClass: 'READ',
      costCredits: 80,
      icon: <BarChart3 className="size-4 text-emerald-400" />,
    },
  ]);

  const handleAutoGenerate = async () => {
    try {
      setIsGenerating(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/campaigns/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: `${displayName} 신규 예약 유치 및 주말 잔여 슬롯 소진`,
          targetAudience: '상권 내 2040 여성 및 직장인',
          focusTheme: '시그니처 맞춤 케어 및 봄맞이 예약 혜택',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setFeedbackMessage('새로운 7일 주간 캠페인 액션 그래프와 콘텐츠 시안 5건이 생성되었습니다!');
        setTimeout(() => setFeedbackMessage(null), 4000);
        // Add sample items to view
        setEntries([
          { id: 'entry-1', channel: 'INSTAGRAM', title: '[Day 1] 시그니처 케어 소개', scheduled_date: 'Day 1' },
          { id: 'entry-2', channel: 'THREADS', title: '[Day 2] 사장님의 솔직 꿀팁', scheduled_date: 'Day 2' },
          { id: 'entry-3', channel: 'NAVER_BLOG', title: '[Day 3] 공식 방문 가이드 & 리뷰', scheduled_date: 'Day 3' },
          { id: 'entry-4', channel: 'INSTAGRAM', title: '[Day 5] 주말 잔여 슬롯 한정 이벤트', scheduled_date: 'Day 5' },
          { id: 'entry-5', channel: 'NAVER_BLOG', title: '[Day 7] 1주차 감사 및 다음 주 예고', scheduled_date: 'Day 7' },
        ]);
      }
    } catch (err) {
      console.error('Auto generate error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveAll = () => {
    setApprovalApproved(true);
    setFeedbackMessage('✓ 3단계 액션 승인이 완료되었습니다! 예약된 일정에 맞춰 실행이 준비됩니다.');
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  const getStatusBadge = (status: ActionGraphStep['status']) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] gap-1">
            <CheckCircle2 className="size-3" />
            완료됨 (READY)
          </Badge>
        );
      case 'IN_PROGRESS':
        return (
          <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/30 text-[10px] gap-1">
            <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
            실행 중
          </Badge>
        );
      case 'PENDING_APPROVAL':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px] gap-1">
            <AlertTriangle className="size-3" />
            사장님 승인 대기
          </Badge>
        );
      case 'SCHEDULED':
        return (
          <Badge variant="outline" className="bg-zinc-800/60 text-zinc-400 border-zinc-700/60 text-[10px] gap-1">
            <Clock className="size-3" />
            후속 대기
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16 font-sans">
      {/* 1. 최상단 타이틀 & 1클릭 캠페인 생성 액션 */}
      <div className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950 p-6 sm:p-8 shadow-xl text-white">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-72 h-72 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-indigo-500/25 text-indigo-200 border-indigo-400/40 text-xs px-2.5 py-0.5 font-bold">
                <Brain className="size-3.5 mr-1" />
                SOHEE CAMPAIGN BRAIN & ACTION GRAPH
              </Badge>
              <span className="text-xs text-zinc-400 font-medium">· 자율 마케팅 V0.9</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
              소희 캠페인 브레인 워크스페이스
            </h1>
            <p className="text-sm text-zinc-200 max-w-2xl leading-relaxed">
              목표를 제시하면 소희가 [리서치 ➔ 전략수립 ➔ 콘텐츠 시안 ➔ 채널발행/성과기여] 4단계 액션 그래프를 구축하고 자율 운영합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleAutoGenerate}
              disabled={isGenerating}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-2xl shadow-md shadow-indigo-500/20 gap-2 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  캠페인 그래프 수립 중...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  새 캠페인 가설 & 그래프 수립
                </>
              )}
            </Button>
            <Link
              href="/app/conversations"
              className="px-4 py-2.5 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xs border border-zinc-700 transition flex items-center gap-1.5 shadow-sm"
            >
              소희와 대화로 조율
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        {/* 액션 피드백 배너 */}
        {feedbackMessage && (
          <div className="mt-4 p-3 rounded-xl bg-indigo-500/25 border border-indigo-400/40 text-indigo-100 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="size-4 shrink-0 text-indigo-300" />
            <span>{feedbackMessage}</span>
          </div>
        )}
      </div>

      {/* 2. 소희 모닝 브리핑 카드 (Sohee Morning Briefing) */}
      <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-indigo-500 animate-ping" />
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                소희 자율 마케팅 주간 브리핑
              </span>
            </div>
            <h2 className="text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
              &ldquo;{displayName} 이번 주 캠페인 운영 현황을 정리했어요.&rdquo;
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {remainingSlots === null ? '잔여 슬롯은 아직 확인하지 못했어요.' : `이번 주 잔여 슬롯 ${remainingSlots}건이에요.`}
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-3xl">
              상권 검색량이 화/수요일에 급증하는 패턴에 맞추어 인스타그램 피드 릴스 발행 후 네이버 블로그 상세 가이드를 연동하도록 설계되었습니다.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 text-center space-y-1">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold">타겟 KPI</span>
              <strong className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 block">
                {targetBookings === null ? '측정 전' : `예약 ${targetBookings}건 목표`}
              </strong>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold font-mono">
                {confirmedBookings === null ? '확정 건수 확인 전' : `현재 ${confirmedBookings}건 확정`}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 text-center space-y-1">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold">예산 상한</span>
              <strong className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 block">₩0 (순수 유기농)</strong>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">광고 집행 없음</span>
            </div>
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 text-center space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold">보유 크레딧</span>
              <strong className="text-sm font-black text-indigo-600 dark:text-indigo-400 block tabular-nums">
                {availableCredits === undefined ? '크레딧 확인 필요' : `${availableCredits.toLocaleString()} SC`}
              </strong>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                {availableCredits === undefined ? '잔여 크레딧을 확인하지 못했어요' : availableCredits > 0 ? '자율 실행 가능' : '크레딧 충전이 필요해요'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* 3. 4단계 Action Graph (Interactive Visualizer) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Layers className="size-4 text-indigo-500" />
              <span>4단계 실행 액션 그래프 (Campaign Action Graph)</span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              각 단계의 위험도(Risk Class)와 사전 검증 조건이 충족되면 순차적으로 안전하게 실행됩니다.
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700">
            ANI-766 CONFORMANT
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {actionSteps.map((step) => (
            <div
              key={step.step}
              className={`p-5 rounded-3xl border transition-all flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md ${
                step.status === 'COMPLETED'
                  ? 'bg-white dark:bg-zinc-900 border-emerald-400/60 dark:border-emerald-500/40 ring-1 ring-emerald-500/20'
                  : step.status === 'PENDING_APPROVAL'
                  ? 'bg-white dark:bg-zinc-900 border-amber-400/60 dark:border-amber-500/40 ring-1 ring-amber-500/20 shadow-amber-500/5'
                  : step.status === 'IN_PROGRESS'
                  ? 'bg-white dark:bg-zinc-900 border-sky-400/60 dark:border-sky-500/40 ring-1 ring-sky-500/20'
                  : 'bg-zinc-50 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-6 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-xs font-black text-zinc-800 dark:text-zinc-200">
                      {step.step}
                    </span>
                    <span className="p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                      {step.icon}
                    </span>
                  </div>
                  <div>{getStatusBadge(step.status)}</div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-snug">{step.title}</h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed line-clamp-2">
                    {step.subtitle}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 font-semibold">
                  {step.riskClass}
                </span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{step.costCredits} SC</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Action Approval Envelope (사전 승인 봉투) */}
      {!approvalApproved && (
        <Card className="rounded-3xl border border-amber-300 dark:border-amber-700/60 bg-amber-50/70 dark:bg-amber-950/20 p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-extrabold">
                <ShieldCheck className="size-4" />
                <span>승인 대기 중인 액션 봉투 (Action Approval Envelope)</span>
              </div>
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                3단계: 인스타그램 피드 자동 발행 및 네이버 블로그 콘텐츠 원고 준비 승인
              </h3>
              <p className="text-xs text-zinc-700 dark:text-zinc-300 max-w-2xl leading-relaxed font-medium">
                소희가 작성한 콘텐츠 시안이 준비되었습니다. 승인하시면 지정된 최적 발행 시각(오늘 18:00)에 안전하게 외부 채널로 송출됩니다.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <Button
                onClick={handleApproveAll}
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs h-10 px-5 rounded-2xl shadow-md shadow-amber-500/25 gap-2 cursor-pointer"
              >
                <Check className="size-4" />
                1-클릭 일괄 승인 및 가동
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* 5. 이번 주 콘텐츠 캘린더 (7-Day Plan View) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Calendar className="size-4 text-indigo-500" />
              <span>주간 콘텐츠 캘린더 (실행 일정)</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              {entries.length > 0
                ? '소희가 채널별 최적 시간대에 맞춰 배치한 7일간의 콘텐츠 일정입니다.'
                : '등록된 주간 계획이 없습니다. 상단에서 새 캠페인을 수립해 보세요.'}
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 border-indigo-500/20 w-fit">
            총 {entries.length}개 포스팅 일정 확보됨
          </Badge>
        </div>

        {entries.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {entries.map((entry, idx) => (
              <div
                key={entry.id || idx}
                onClick={() => setSelectedPreviewEntry(entry)}
                className="p-4 rounded-2xl bg-zinc-900/60 border border-border/80 hover:border-indigo-500/50 transition cursor-pointer space-y-2.5 group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                  <span className="text-indigo-400 group-hover:text-indigo-300 font-mono text-[11px]">
                    {entry.channel || 'INSTAGRAM'}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {entry.scheduled_date || `Day ${idx + 1}`}
                  </span>
                </div>
                <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
                  {entry.title || entry.caption || '콘텐츠 시안 준비됨'}
                </p>
                <div className="pt-2 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40">
                  <span>상태: 승인 대기</span>
                  <Eye className="size-3 text-zinc-500 group-hover:text-foreground" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 rounded-2xl bg-zinc-950/40 border border-dashed border-border text-center space-y-3">
            <Calendar className="size-8 text-muted-foreground mx-auto" />
            <p className="text-xs font-semibold text-foreground">주간 계획이 아직 없습니다</p>
            <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
              상단의 [새 캠페인 가설 & 그래프 수립] 버튼을 누르면 소희가 7일치 채널별 맞춤 일정을 생성합니다.
            </p>
          </div>
        )}
      </div>

      {/* 시안 미리보기 모달 */}
      <Dialog
        open={!!selectedPreviewEntry}
        onOpenChange={(open) => !open && setSelectedPreviewEntry(null)}
        title={selectedPreviewEntry?.title || '콘텐츠 시안 미리보기'}
      >
        <div className="space-y-4 p-2">
          <p className="text-xs text-muted-foreground">
            {selectedPreviewEntry?.channel} · {selectedPreviewEntry?.scheduled_date} 발행 예정
          </p>

          <div className="p-4 rounded-2xl bg-zinc-900 border border-border text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
            {selectedPreviewEntry?.body ||
              `${displayName}의 시그니처 케어로 이번 주를 특별하게 시작해 보세요. \n\n📍 사전 예약 시 웰컴 서비스 증정 \n✨ 네이버 예약 및 프로필 링크에서 지금 신청하세요.`}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setSelectedPreviewEntry(null)}
              className="text-xs rounded-xl"
            >
              닫기
            </Button>
            <Button
              onClick={() => {
                setSelectedPreviewEntry(null);
                setFeedbackMessage('시안이 승인 대기열에 반영되었습니다.');
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-xl font-semibold"
            >
              시안 채택하기
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
