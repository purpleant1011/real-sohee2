import React from 'react';
import { Eye, Calculator, Sparkles, TrendingUp, Target } from 'lucide-react';
import type { DataProvenance } from '@/lib/read-models/types';

interface EvidenceBadgeProps {
  provenance: DataProvenance | 'target';
  className?: string;
  showIcon?: boolean;
}

export function EvidenceBadge({ provenance, className = '', showIcon = true }: EvidenceBadgeProps) {
  switch (provenance) {
    case 'measured':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#F3F4F6] text-[#374151] border border-[#E5E7EB] dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 ${className}`}
          title="실제 관측된 원본 데이터입니다 (실측 사실)"
        >
          {showIcon && <Eye className="w-2.5 h-2.5" />}
          <span>실측 사실</span>
        </span>
      );

    case 'calculated':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#EFF6FF] text-[#1D4ED8] border border-[#DBEAFE] dark:bg-state-wait/60 dark:text-state-wait dark:border-state-wait/40 ${className}`}
          title="정확한 분모와 공식으로 산출된 계산 수치입니다"
        >
          {showIcon && <Calculator className="w-2.5 h-2.5" />}
          <span>계산 수치</span>
        </span>
      );

    case 'estimated':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] dark:bg-state-warn/60 dark:text-state-warn dark:border-state-warn/40 ${className}`}
          title="과거 데이터 기반의 예측/추정 수치입니다"
        >
          {showIcon && <TrendingUp className="w-2.5 h-2.5" />}
          <span>예측 추정치</span>
        </span>
      );

    case 'demo':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#F1EDFF] text-[#5333E0] border border-[#DDD6FE] dark:bg-[#231C44] dark:text-[#C3B4FF] dark:border-[#3D3168] ${className}`}
          title="체험용 데모 데이터입니다"
        >
          {showIcon && <Sparkles className="w-2.5 h-2.5" />}
          <span>데모 데이터</span>
        </span>
      );

    case 'target':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] dark:bg-state-ok/60 dark:text-state-ok dark:border-state-ok/40 ${className}`}
          title="사장님이 설정한 목표치입니다"
        >
          {showIcon && <Target className="w-2.5 h-2.5" />}
          <span>목표치</span>
        </span>
      );

    default:
      return null;
  }
}
