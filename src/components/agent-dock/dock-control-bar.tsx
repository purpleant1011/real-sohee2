'use client';

import React, { useState } from 'react';
import { Pause, Play, AlertOctagon, RefreshCw } from 'lucide-react';

interface DockControlBarProps {
  actualMode: string;
  isRunning: boolean;
  killSwitchActive: boolean;
  isLoading?: boolean;
  onPause: () => Promise<void> | void;
  onResume: () => Promise<void> | void;
  onEmergencyStop: () => Promise<void> | void;
}

export function DockControlBar({
  actualMode,
  isRunning,
  killSwitchActive,
  isLoading = false,
  onPause,
  onResume,
  onEmergencyStop,
}: DockControlBarProps) {
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const handlePause = async () => {
    setActionInProgress('PAUSE');
    try {
      await onPause();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleResume = async () => {
    setActionInProgress('RESUME');
    try {
      await onResume();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleEmergencyStop = async () => {
    setActionInProgress('STOP');
    try {
      await onEmergencyStop();
    } finally {
      setActionInProgress(null);
    }
  };

  const isBusy = isLoading || Boolean(actionInProgress);

  return (
    <div
      aria-label="소희 자율근무 상태 제어면"
      className="p-3 bg-muted/40 border-b border-border/80 flex flex-col gap-2.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">현재 상태:</span>
          {isLoading || actualMode === 'UNKNOWN' || actualMode === 'DEGRADED' || actualMode === 'ARMING' ? (
            <span className="text-xs font-medium text-muted-foreground" role="status">{isLoading ? '상태 확인 중' : '상태 확인 안 됨'}</span>
          ) : killSwitchActive || actualMode === 'BLOCKED' ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-extrabold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              차단됨
            </span>
          ) : isRunning ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              자율 실행 중
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-extrabold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              일시 정지
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground font-semibold">
          실시간 제어
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {/* Pause Button */}
        <button
          type="button"
          onClick={handlePause}
          disabled={isBusy || !isRunning}
          aria-label="소희 자율근무 일시정지"
          className={`flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg text-xs font-bold transition-all ${
            isRunning
              ? 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800/80 cursor-pointer shadow-2xs'
              : 'bg-muted/50 text-muted-foreground/50 border border-transparent cursor-not-allowed opacity-60'
          }`}
        >
          {actionInProgress === 'PAUSE' ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Pause className="w-3.5 h-3.5" />
          )}
          <span>일시정지</span>
        </button>

        {/* Resume Button */}
        <button
          type="button"
          onClick={handleResume}
          disabled={isBusy || isRunning || !['PAUSED', 'OFF'].includes(actualMode)}
          aria-label="소희 자율근무 재개"
          className={`flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg text-xs font-bold transition-all ${
            !isRunning
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 shadow-2xs cursor-pointer'
              : 'bg-muted/50 text-muted-foreground/50 border border-transparent cursor-not-allowed opacity-60'
          }`}
        >
          {actionInProgress === 'RESUME' ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          <span>재개</span>
        </button>

        {/* Emergency Stop Button */}
        <button
          type="button"
          onClick={handleEmergencyStop}
          disabled={isBusy}
          aria-label="소희 자율근무 긴급 중단"
          className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg text-xs font-bold bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-800/80 cursor-pointer shadow-2xs transition-all"
          title="모든 외부 쓰기 작업 즉시 긴급 차단(Kill Switch)"
        >
          {actionInProgress === 'STOP' ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <AlertOctagon className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          )}
          <span>긴급 정지</span>
        </button>
      </div>
    </div>
  );
}
