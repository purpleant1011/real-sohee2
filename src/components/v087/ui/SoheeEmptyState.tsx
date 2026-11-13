import React from "react";
import { AlertCircle, Link2, Sparkles, RefreshCw } from "lucide-react";
import { SoheeButton } from "./SoheeButton";

interface SoheeEmptyStateProps {
  type?: 'insufficient_data' | 'no_opportunity' | 'disconnected' | 'permission_expired' | 'empty';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export function SoheeEmptyState({
  type = 'empty',
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = "",
}: SoheeEmptyStateProps) {
  const icons = {
    insufficient_data: <Link2 className="w-8 h-8 text-[#6D4AFF]" />,
    no_opportunity: <Sparkles className="w-8 h-8 text-[#2B9B67]" />,
    disconnected: <AlertCircle className="w-8 h-8 text-[#C8841A]" />,
    permission_expired: <RefreshCw className="w-8 h-8 text-[#D64A4A]" />,
    empty: <AlertCircle className="w-8 h-8 text-[#8C8A87]" />,
  };

  return (
    <div
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-2xl bg-[#FAF9F7] dark:bg-[#18191C] border border-dashed border-[#D6D2CC] dark:border-[#2D3038] ${className}`}
    >
      <div className="w-14 h-14 rounded-2xl bg-white dark:bg-[#222429] border border-[#EAE7E3] dark:border-[#2D3038] flex items-center justify-center shadow-sm mb-4">
        {icons[type] || icons.empty}
      </div>
      <h3 className="text-base sm:text-lg font-bold text-[#171717] dark:text-zinc-100 mb-1">
        {title}
      </h3>
      <p className="text-xs sm:text-sm text-[#686868] dark:text-zinc-400 max-w-md mb-6 leading-relaxed">
        {description}
      </p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actionLabel && (
            <SoheeButton variant="primary" size="sm" onClick={onAction}>
              {actionLabel}
            </SoheeButton>
          )}
          {secondaryActionLabel && (
            <SoheeButton variant="outline" size="sm" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </SoheeButton>
          )}
        </div>
      )}
    </div>
  );
}
