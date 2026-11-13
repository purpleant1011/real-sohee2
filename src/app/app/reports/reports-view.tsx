"use client";

import { V088AppShell } from "@/components/v088/layout/v088-app-shell";
import { AttributionOutcomeConsole } from "@/features/attribution/AttributionOutcomeConsole";
import { useWorkspaceId } from "@/hooks/use-workspace-context";

/** 플래그 OFF·넓은 화면의 기존 주간 보고(V088). 모바일 R2 분기 이전 화면 그대로다. */
export default function LegacyReportsView() {
  const workspaceId = useWorkspaceId();

  return (
    <V088AppShell workspaceId={workspaceId}>
      <AttributionOutcomeConsole workspaceId={workspaceId} />
    </V088AppShell>
  );
}
