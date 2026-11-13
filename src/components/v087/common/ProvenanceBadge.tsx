import React from "react";
import { DataProvenance } from "@/lib/read-models/types";

interface ProvenanceBadgeProps {
  provenance: DataProvenance;
  sourceDescription?: string;
  className?: string;
}

export function ProvenanceBadge({
  provenance,
  sourceDescription,
  className = "",
}: ProvenanceBadgeProps) {
  const configs: Record<
    DataProvenance,
    { label: string; bg: string; text: string; border: string }
  > = {
    measured: {
      label: "실측 원장",
      bg: "bg-state-ok-soft",
      text: "text-state-ok",
      border: "border-state-ok/30",
    },
    calculated: {
      label: "산출치",
      bg: "bg-state-wait-soft",
      text: "text-state-wait",
      border: "border-state-wait/30",
    },
    estimated: {
      label: "추정치",
      bg: "bg-state-warn-soft",
      text: "text-state-warn",
      border: "border-state-warn/30",
    },
    demo: {
      label: "데모 시나리오",
      bg: "bg-primary/10",
      text: "text-foreground dark:text-primary",
      border: "border-primary/30",
    },
  };

  const config = configs[provenance] || configs.measured;

  return (
    <span
      title={sourceDescription || config.label}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      <span>{config.label}</span>
    </span>
  );
}
