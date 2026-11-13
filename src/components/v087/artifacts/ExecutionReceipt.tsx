import React from 'react';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { SoheeCard } from '../ui/SoheeCard';

export interface ExecutionReceiptProps {
  id: string;
  title: string;
  channel: 'instagram' | 'threads' | 'naver_blog' | 'kakaotalk' | 'google_business';
  publishedAt: string;
  permalink?: string | null;
  providerPostId?: string | null;
  actor?: string;
  resultSummary?: string;
  className?: string;
}

export function ExecutionReceipt({
  id,
  title,
  channel,
  publishedAt,
  permalink,
  providerPostId,
  actor = '소희 AI 마케팅 에이전트',
  resultSummary,
  className = '',
}: ExecutionReceiptProps) {
  const getChannelBadge = () => {
    switch (channel) {
      case 'instagram':
        return { label: '인스타그램 피드', bg: 'bg-primary/10 text-primary border-primary/30 dark:bg-primary/60 dark:text-primary' };
      case 'threads':
        return { label: '스레드 (Threads)', bg: 'bg-zinc-100 text-zinc-800 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-200' };
      case 'naver_blog':
        return { label: '네이버 블로그', bg: 'bg-state-ok-soft text-state-ok border-state-ok/30 dark:bg-state-ok/60 dark:text-state-ok' };
      case 'kakaotalk':
        return { label: '카카오톡 채널', bg: 'bg-state-warn-soft text-state-warn border-state-warn/30 dark:bg-state-warn/60 dark:text-state-warn' };
      default:
        return { label: '외부 채널', bg: 'bg-zinc-100 text-zinc-700 border-zinc-200' };
    }
  };

  const channelInfo = getChannelBadge();

  return (
    <SoheeCard
      variant="elevated"
      className={`border-l-4 border-l-[#10B981] space-y-4 relative overflow-hidden bg-gradient-to-r from-state-ok/20 via-white to-white dark:from-state-ok/10 dark:via-[#141517] dark:to-[#141517] ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#10B981] text-white shadow-xs">
            <CheckCircle2 className="w-4 h-4" />
          </span>
          <div>
            <span className="text-xs font-black text-[#10B981] tracking-tight">실제 게시 완료 영수증</span>
            <span className="text-[10px] text-[#8C8A87] ml-2">ID: {id.slice(0, 8)}</span>
          </div>
        </div>

        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${channelInfo.bg}`}>
          {channelInfo.label}
        </span>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-black text-[#171717] dark:text-white leading-snug">{title}</h4>
        {resultSummary && (
          <p className="text-xs text-[#555555] dark:text-zinc-300 font-medium">{resultSummary}</p>
        )}
      </div>

      <div className="p-3 rounded-xl bg-[#FAF9F7] dark:bg-zinc-900/80 border border-[#EAE7E3] dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px]">
        <div>
          <span className="block text-[#8C8A87] text-[10px] font-bold">게시 시각</span>
          <span className="font-extrabold text-[#171717] dark:text-white tabular-nums">{publishedAt}</span>
        </div>
        <div>
          <span className="block text-[#8C8A87] text-[10px] font-bold">실행 주체</span>
          <span className="font-extrabold text-[#171717] dark:text-white">{actor}</span>
        </div>
        {providerPostId && (
          <div className="col-span-2 sm:col-span-1">
            <span className="block text-[#8C8A87] text-[10px] font-bold">Provider Post ID</span>
            <span className="font-mono text-[10px] text-[#555555] dark:text-zinc-400 truncate block">
              {providerPostId}
            </span>
          </div>
        )}
      </div>

      {permalink && (
        <div className="flex justify-end pt-1">
          <a
            href={permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#6D4AFF] hover:bg-[#5835E5] text-white text-xs font-black transition-all shadow-xs"
          >
            <span>실제 게시물 보러가기</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </SoheeCard>
  );
}
