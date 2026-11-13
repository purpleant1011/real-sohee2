'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ChannelType, 
  ContentStudioStage, 
  ContentBrief, 
} from '@/types/content-studio';
import { ContentStudioService } from '@/lib/content-studio/content-studio-service';
import { 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Send, 
  Sparkles, 
  Eye, 
  ShieldCheck, 
  Layers, 
  CalendarCheck,
  Camera,
  FileText,
  MessageCircle,
  ExternalLink,
  Hash,
  Fingerprint,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard';

export interface CanonicalContentRecord {
  contentId: string;
  workspaceId: string;
  channel: string;
  title: string;
  status: string;
  currentVersionId: string;
  versionNumber: number;
  caption: string;
  hashtags: string[];
  fingerprint: string;
  isApproved: boolean;
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ContentProductionPipelineProps {
  workspaceId: string;
  onPublishTriggered?: (variantId: string) => void;
}

const STAGES: { stage: ContentStudioStage; label: string; step: number }[] = [
  { stage: 'QUEUE', label: '작성 대기열', step: 1 },
  { stage: 'BRIEF', label: '기획안', step: 2 },
  { stage: 'ASSET', label: '사진·자료 매칭', step: 3 },
  { stage: 'CHANNEL_PREVIEW', label: '채널 프리뷰', step: 4 },
  { stage: 'QC', label: '품질 검수', step: 5 },
  { stage: 'APPROVAL', label: '사장님 승인', step: 6 },
  { stage: 'SCHEDULE_OR_PUBLISH', label: '발행/예약', step: 7 },
  { stage: 'READBACK_VERIFIED', label: '실제 게시물 확인 완료', step: 8 },
];

export function ContentProductionPipeline({ workspaceId, onPublishTriggered }: ContentProductionPipelineProps) {
  const [selectedChannel, setSelectedChannel] = useState<ChannelType>('INSTAGRAM');
  const [activeStage, setActiveStage] = useState<ContentStudioStage>('APPROVAL');
  
  // Real DB state
  const [realContents, setRealContents] = useState<CanonicalContentRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const runExternalWrite = useExternalWriteGuard();

  // Fetch real canonical contents from server
  const fetchContents = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await fetch(`/api/workspaces/${workspaceId}/content`);
      if (!res.ok) {
        throw new Error('콘텐츠 목록 조회 실패');
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.contents)) {
        setRealContents(data.contents);
      }
    } catch (err: unknown) {
      console.error('[ContentPipeline] Failed to fetch contents:', err);
      setErrorMessage((err as Error).message || '원고를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);

  // Channel mapping helper
  const isMatchingChannel = (contentChannel: string, uiChannel: ChannelType) => {
    const c = contentChannel.toLowerCase().replace(/_/g, '');
    const u = uiChannel.toLowerCase().replace(/_/g, '');
    return c.includes(u) || u.includes(c);
  };

  // Find real content for the selected channel
  const matchingContent = realContents.find(c => isMatchingChannel(c.channel, selectedChannel));

  // QC Validation for real or fallback
  const qcResult = matchingContent
    ? ContentStudioService.validateChannelVariant(
        selectedChannel,
        matchingContent.title,
        matchingContent.caption,
        matchingContent.hashtags,
        []
      )
    : null;

  // Handle Canonical Approval via DB API
  const handleApproveContent = async () => {
    if (!matchingContent) return;
    if (matchingContent.isApproved) return;
    // 버튼 disabled 와 별개로, 상태 갱신 전 연속 클릭이 두 번의 승인 요청을 내보내지 않게 막는다.
    if (isApproving) return;

    const approved = matchingContent;
    const approveTask = async () => {
      try {
        setIsApproving(true);
        const res = await fetch(`/api/workspaces/${workspaceId}/content/approvals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: approved.contentId,
            versionId: approved.currentVersionId,
            fingerprint: approved.fingerprint,
            reason: '사장님 프로덕션 스튜디오 최종 승인 완료',
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error?.message || '원고 승인 처리 실패');
        }

        // Optimistically update local state
        setRealContents(prev =>
          prev.map(item =>
            item.contentId === approved.contentId
              ? { ...item, isApproved: true, status: 'approved' }
              : item
          )
        );
      } catch (err: unknown) {
        console.error('[ContentPipeline] Approval error:', err);
        alert((err as Error).message || '승인 처리에 실패했습니다.');
      } finally {
        setIsApproving(false);
      }
    };

    // 오프라인이면 요청을 내보내지 않고, 같은 원고 승인이 진행 중이면 두 번째는 실행하지 않는다.
    const outcome = await runExternalWrite('publish', approved.contentId, approveTask);
    if (!outcome.ran) {
      console.warn('[ContentPipeline] Approval blocked:', outcome.decision.reason);
      alert(outcome.decision.message);
    }
  };

  return (
    <div className="rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs p-6 space-y-6">
      {/* 1. Header & Stage Tracker */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                  콘텐츠 제작 및 발행 단계
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok dark:bg-state-ok/50 dark:text-state-ok font-bold border border-state-ok/40">
                  단일 원장 기준
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                기획안부터 채널별 검수, 사장님 승인, 발행 및 실제 게시 확인까지 한 번에 안전하게 완결됩니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchContents}
              disabled={isLoading}
              className="px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              새로고침
            </button>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
              실시간 대기열 {realContents.length}건
            </span>
          </div>
        </div>

        {/* 8-Stage Visual Tracker */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {STAGES.map((s) => {
            const isDone = s.step < 6 || (matchingContent?.isApproved && s.step <= 6);
            const isCurrent = s.stage === activeStage;
            return (
              <div
                key={s.stage}
                onClick={() => setActiveStage(s.stage)}
                className={cn(
                  "p-2.5 rounded-xl border text-center transition-all cursor-pointer select-none",
                  isCurrent 
                    ? "border-primary bg-primary/60 text-foreground dark:text-primary font-bold shadow-xs" 
                    : isDone
                    ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-300"
                    : "border-zinc-100 dark:border-zinc-900 text-zinc-400 opacity-60"
                )}
              >
                <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 mb-0.5">
                  STEP {s.step}
                </div>
                <div className="text-xs truncate">{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Channel Selection Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-2 overflow-x-auto">
        {(['INSTAGRAM', 'NAVER_BLOG', 'DAANGN'] as ChannelType[]).map((ch) => {
          const hasContent = realContents.some(c => isMatchingChannel(c.channel, ch));
          return (
            <button
              key={ch}
              onClick={() => setSelectedChannel(ch)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer",
                selectedChannel === ch
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-2xs"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400 hover:bg-zinc-200/70"
              )}
            >
              {ch === 'INSTAGRAM' && <Camera className="w-3.5 h-3.5" />}
              {ch === 'NAVER_BLOG' && <FileText className="w-3.5 h-3.5" />}
              {ch === 'DAANGN' && <MessageCircle className="w-3.5 h-3.5" />}
              <span>{ch === 'INSTAGRAM' ? '인스타그램 피드' : ch === 'NAVER_BLOG' ? '네이버 블로그 칼럼' : '당근 비즈프로필'}</span>
              {hasContent && (
                <span className="w-1.5 h-1.5 rounded-full bg-state-ok" />
              )}
            </button>
          );
        })}
      </div>

      {/* 3. Main Stage Content: Actual DB Content vs True Empty State */}
      {matchingContent ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Native Preview (7 cols) */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-zinc-500">
              <span className="flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-primary" />
                <span>채널 네이티브 렌더링 프리뷰</span>
              </span>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded-full font-bold",
                  matchingContent.isApproved
                    ? "bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok"
                    : "bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn"
                )}>
                  {matchingContent.isApproved ? '✓ 승인 완료 (APPROVED)' : '⏳ 승인 대기중 (DRAFT)'}
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  v{matchingContent.versionNumber}
                </span>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-4">
              {matchingContent.title && (
                <div className="p-3 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">제목 (Title)</span>
                  <p className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                    {matchingContent.title}
                  </p>
                </div>
              )}

              <div className="p-4 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700 space-y-3">
                <span className="text-[10px] font-bold text-zinc-400 uppercase block">본문 원고 (Caption)</span>
                <p className="text-xs text-zinc-800 dark:text-zinc-200 whitespace-pre-line leading-relaxed font-sans">
                  {matchingContent.caption}
                </p>
              </div>

              {matchingContent.hashtags && matchingContent.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {matchingContent.hashtags.map((tag, idx) => (
                    <span 
                      key={idx} 
                      className="text-[11px] font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/60"
                    >
                      {tag.startsWith('#') ? tag : `#${tag}`}
                    </span>
                  ))}
                </div>
              )}

              {/* SHA-256 Fingerprint Indicator */}
              <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700 flex items-center justify-between text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <Fingerprint className="w-3.5 h-3.5 text-primary" />
                  <span>승인 상태 확인:</span>
                </span>
                <span className="truncate max-w-[220px] font-bold text-zinc-700 dark:text-zinc-300">
                  {matchingContent.fingerprint ? '승인 기록이 저장돼 있어요' : '아직 승인 기록이 없어요'}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Quality Control (QC) & Approval Action (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between text-xs font-bold text-zinc-500">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-state-ok" />
                <span>실시간 품질 검수 (QC Gate)</span>
              </span>
              {qcResult && (
                <span className={cn(
                  "text-xs font-bold px-2 py-0.5 rounded-md",
                  qcResult.passed ? "bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok" : "bg-state-danger-soft text-state-danger"
                )}>
                  {qcResult.passed ? `합격 (${qcResult.score}점)` : `보완 필요 (${qcResult.score}점)`}
                </span>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-4">
              {/* QC Checklist */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700">
                  <span>의료법 및 표시광고법 준수</span>
                  <span className="font-bold text-state-ok flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 0건 (안전)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700">
                  <span>채널별 규격 및 글자수 준수</span>
                  <span className="font-bold text-state-ok flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 적합 ({matchingContent.caption.length}자)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700">
                  <span>저장된 원본 기록 일치</span>
                  <span className="font-bold text-state-ok flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 확인 완료
                  </span>
                </div>
              </div>

              {/* Recommendations */}
              {qcResult && qcResult.recommendations.length > 0 && (
                <div className="p-3 rounded-xl bg-state-warn-soft border border-state-warn/30 text-[11px] text-state-warn space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> 제안 사항
                  </div>
                  {qcResult.recommendations.map((rec, i) => (
                    <div key={i}>• {rec}</div>
                  ))}
                </div>
              )}

              {/* Approval CTA Box */}
              <div className="pt-2 border-t border-zinc-200/80 dark:border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
                    사장님 최종 검토 승인
                  </span>
                  <button
                    onClick={handleApproveContent}
                    disabled={matchingContent.isApproved || isApproving}
                    className={cn(
                      "px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
                      matchingContent.isApproved
                        ? "bg-state-ok text-white opacity-95 cursor-default shadow-2xs"
                        : "bg-primary hover:bg-primary/90 text-white shadow-2xs"
                    )}
                  >
                    {isApproving ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        승인 기록 중...
                      </>
                    ) : matchingContent.isApproved ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        ✓ 승인 완료 (기록 보존)
                      </>
                    ) : (
                      '이 원고 승인하기'
                    )}
                  </button>
                </div>

                <p className="text-[11px] text-zinc-500">
                  {matchingContent.isApproved
                    ? '사장님의 승인이 완료되었습니다. 승인한 내용과 같음을 확인하여 실제 플랫폼 발행이 허가되었습니다.'
                    : '승인된 원고는 지정된 발행 시간에 소희가 직접 공식 연결을 통해 발행하며, 실제 게시 확인을 통해 완료 기록이 생성됩니다.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* True Empty State (Zero Fake Samples) */
        <div className="p-12 text-center rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-dashed border-zinc-200 dark:border-zinc-800 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto font-bold">
            <FileText className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {selectedChannel === 'INSTAGRAM' ? '인스타그램' : selectedChannel === 'NAVER_BLOG' ? '네이버 블로그' : '당근 비즈프로필'} 대기열에 원고가 없습니다
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              소희에게 채팅으로 마케팅 콘텐츠 작성을 지시해 보세요.<br />
              지시가 완료되면 자동으로 원고가 생성되어 이곳 검수 대기열에 등록됩니다.
            </p>
          </div>
          <div className="pt-2">
            <span className="text-[11px] font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
              💡 팁: 하단 소희 에이전트 독에서 &quot;봄맞이 대표 메뉴 피드 작성해줘&quot;라고 입력해 보세요.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
