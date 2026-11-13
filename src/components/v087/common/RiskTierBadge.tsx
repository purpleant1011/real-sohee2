import React from "react";
import { RiskTier } from "@/lib/read-models/types";

interface RiskTierBadgeProps {
  tier: RiskTier;
  className?: string;
}

export function RiskTierBadge({ tier, className = "" }: RiskTierBadgeProps) {
  const configs: Record<
    RiskTier,
    { label: string; bg: string; text: string; border: string }
  > = {
    low: {
      label: "저위험",
      bg: "bg-zinc-100 dark:bg-zinc-800",
      text: "text-zinc-600 dark:text-zinc-300",
      border: "border-zinc-200 dark:border-zinc-700",
    },
    medium: {
      label: "중위험 (승인 권장)",
      bg: "bg-state-warn-soft",
      text: "text-state-warn",
      border: "border-state-warn/30",
    },
    high: {
      label: "고위험 (승인 필수)",
      bg: "bg-state-danger-soft",
      text: "text-state-danger",
      border: "border-state-danger/30",
    },
    critical: {
      label: "긴급 차단 대상",
      bg: "bg-state-danger-soft",
      text: "text-state-danger",
      border: "border-state-danger/40",
    },
  };

  const config = configs[tier] || configs.low;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      {config.label}
    </span>
  );
}
