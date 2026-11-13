'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Puzzle,
  Share2,
  FileText,
  Target,
  MessageSquare,
  Calendar,
  Zap,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ToolItem {
  id: string;
  name: string;
  state: 'READY' | 'AUTH_REQUIRED' | 'DISABLED';
  icon: React.ReactNode;
  summary: string;
  account?: string;
}

export function LiveChatToolbeltBar({ workspaceId }: { workspaceId?: string }) {
  const [tools, setTools] = useState<ToolItem[]>([
    {
      id: 'plugin-instagram',
      name: '인스타그램',
      state: 'READY',
      icon: <Share2 className="size-3.5 text-primary" />,
      summary: '피드/릴스 발행 및 DM 초안 준비',
    },
    {
      id: 'plugin-naver-blog',
      name: '네이버 블로그',
      state: 'READY',
      icon: <FileText className="size-3.5 text-[var(--v088-verified)]" />,
      summary: '검색 최적화 원고 및 사진 준비',
    },
    {
      id: 'plugin-google-ads-autopilot',
      name: '구글 광고',
      state: 'READY',
      icon: <Target className="size-3.5 text-[var(--v088-live)]" />,
      summary: '타겟 CPA/ROAS 오토파일럿',
    },
    {
      id: 'plugin-kakao-channel',
      name: '카카오톡',
      state: 'AUTH_REQUIRED',
      icon: <MessageSquare className="size-3.5 text-[var(--v088-warning)]" />,
      summary: '알림톡·상담톡 답변 초안 준비',
    },
    {
      id: 'plugin-smart-booking',
      name: '스마트 예약',
      state: 'READY',
      icon: <Calendar className="size-3.5 text-primary" />,
      summary: '빈 시간대 슬롯 자동 채우기',
    },
  ]);

  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    const fetchLivePlugins = async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/plugins`);
        if (res.ok) {
          const data = await res.json();
          if (data.plugins && Array.isArray(data.plugins)) {
            const mapped: ToolItem[] = data.plugins.slice(0, 5).map((p: any) => {
              let icon = <Zap className="size-3.5 text-primary" />;
              if (p.manifest.icon === 'instagram') icon = <Share2 className="size-3.5 text-primary" />;
              if (p.manifest.icon === 'file-text') icon = <FileText className="size-3.5 text-[var(--v088-verified)]" />;
              if (p.manifest.icon === 'target') icon = <Target className="size-3.5 text-[var(--v088-live)]" />;
              if (p.manifest.icon === 'message-square') icon = <MessageSquare className="size-3.5 text-[var(--v088-warning)]" />;
              if (p.manifest.icon === 'calendar') icon = <Calendar className="size-3.5 text-primary" />;

              return {
                id: p.manifest.pluginId,
                name: p.manifest.displayName,
                state: p.state,
                icon,
                summary: p.manifest.summary,
                account: p.connectedAccountId || undefined,
              };
            });
            if (mapped.length > 0) setTools(mapped);
          }
        }
      } catch (err) {
        // Keep initial fallback tools
      }
    };
    fetchLivePlugins();
  }, [workspaceId]);

  const readyCount = tools.filter((t) => t.state === 'READY').length;

  return (
    <div className="relative border-b border-border/60 bg-zinc-950/70 backdrop-blur-md px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 overflow-x-auto py-1">
        <div className="flex items-center gap-1.5 text-zinc-400 shrink-0 font-medium mr-1">
          <Puzzle className="size-3.5 text-primary" />
          <span className="text-[11px] font-bold text-foreground">소희 툴벨트</span>
          <span className="text-[10px] text-[var(--v088-live)] font-mono bg-white/10 px-1.5 py-0.5 rounded-md border border-white/20">
            {readyCount}/{tools.length} 가동
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {tools.map((tool) => {
            const isReady = tool.state === 'READY';
            const isAuthReq = tool.state === 'AUTH_REQUIRED';
            return (
              <div
                key={tool.id}
                onMouseEnter={() => setActiveTooltip(tool.id)}
                onMouseLeave={() => setActiveTooltip(null)}
                className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${
                  isReady
                    ? 'border-state-ok/30 bg-state-ok/5 text-zinc-200 hover:border-state-ok/50'
                    : isAuthReq
                    ? 'border-white/20 bg-white/5 text-[var(--v088-warning)] hover:border-[var(--v088-warning)]'
                    : 'border-border/60 bg-zinc-900/60 text-zinc-400'
                }`}
              >
                {tool.icon}
                <span className="font-semibold">{tool.name}</span>
                {isReady ? (
                  <span className="size-1.5 rounded-full bg-state-ok animate-pulse" />
                ) : (
                  <span className="text-[9px] text-[var(--v088-warning)] font-medium">연결필요</span>
                )}

                {/* Hover Popover Tooltip */}
                {activeTooltip === tool.id && (
                  <div className="absolute top-full left-0 mt-1.5 z-50 w-52 p-2.5 rounded-xl bg-zinc-900 border border-border shadow-xl space-y-1 text-left">
                    <div className="flex items-center justify-between font-bold text-foreground">
                      <span>{tool.name}</span>
                      <span className={`text-[10px] ${isReady ? 'text-[var(--v088-verified)]' : 'text-[var(--v088-warning)]'}`}>
                        {isReady ? 'READY (가동 가능)' : '연결 필요'}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{tool.summary}</p>
                    {tool.account ? (
                      <p className="text-[10px] font-mono text-[var(--v088-verified)] pt-0.5">계정: {tool.account}</p>
                    ) : (
                      <p className="text-[10px] text-zinc-400 pt-0.5">계정: 연결 전</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Link
          href="/app/plugins"
          className="text-[11px] text-primary hover:text-primary font-medium flex items-center gap-1 hover:underline"
        >
          <span>플러그인 마켓 관리</span>
          <ChevronRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
