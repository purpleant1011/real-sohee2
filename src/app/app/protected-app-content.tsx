import React from "react";
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveHostPresentation } from '@/features/mobile-shell/host-presentation';
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate';
import { PersistentMobileShell } from '@/features/mobile-shell/mobile-app-shell';
import { ConversationNavigationProvider } from '@/features/agent-dock/conversation-navigation-provider';
import { isConversationWorkbenchEnabled } from '@/features/chat/conversation-rollout';
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag';
import { MobileUiProvider } from '@/features/mobile-decision/mobile-ui-provider';
import { resolveMobileUiEnabled } from '@/features/mobile-decision/navigation';
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readAppWorkspace } from "@/features/auth/app-workspace.server";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { MembershipBanner, UserMembershipTier } from "@/components/membership/membership-banner";
import { getMembershipTier } from "@/features/membership/membership-tier";

export default async function ProtectedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { supabase, userId, workspace, error } = await readAppWorkspace();
  const requestHeaders = await headers();
  const requestedPath = requestHeaders.get('x-sohee-pathname') ?? '/app';
  const nextPath = (requestedPath === '/app' || requestedPath.startsWith('/app/')) && !requestedPath.includes('\\')
    ? requestedPath.slice(0, 2048) : '/app';
  if (!userId || typeof userId !== 'string') redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (error) throw new Error('WORKSPACE_MEMBERSHIP_UNAVAILABLE');
  if (!workspace?.workspaceId) {
    if (nextPath.split('?')[0] === '/app/onboarding') return <>{children}</>;
    redirect('/app/onboarding');
  }

  // [HF-07 / RED-03 / P0-4] App Shell Gate: Enforce SOHEE_READY
  // Pre-ready users MUST be redirected to Education Shell (/start)
  const { getSoheeReadiness } = await import("@/features/sohee-ready/read-model");
  const { resolveAppShellMode } = await import("@/features/sohee-ready/shell-resolver");
  let adminClient: any;
  try {
    adminClient = createAdminSupabaseClient();
  } catch (adminErr) {
    console.warn("[ProtectedAppLayout] Admin Supabase client creation failed, falling back to session client:", adminErr);
  }

  // 같은 인가 가게의 독립 조회만 요청 안에서 병렬화한다. 전역·개인정보 캐시는 만들지 않는다.
  const [{ data: wsRecord }, readiness, { data: bvRow }, membershipTier] = await Promise.all([
    (supabase as any).from("workspaces").select("name").eq("id", workspace.workspaceId).maybeSingle(),
    getSoheeReadiness(workspace.workspaceId, { supabaseClient: supabase, adminClient }),
    (supabase as any).from("business_verifications").select("status, document_url").eq("workspace_id", workspace.workspaceId).maybeSingle(),
    getMembershipTier(adminClient ?? supabase, workspace.workspaceId),
  ]);
  const shellMode = resolveAppShellMode(readiness);
  const tier: UserMembershipTier = membershipTier;

  const { isApplicationSubmitted, resolveAppEntryRedirect } = await import(
    "@/features/business-verification/entry-gate"
  );
  const { isReviewAccountUser } = await import(
    "@/features/business-verification/review-account"
  );
  const { evaluateReadiness } = await import("@/features/readiness");
  const entryRedirect = resolveAppEntryRedirect({
    applicationSubmitted: isApplicationSubmitted({
      status: bvRow?.status,
      hasDocument: Boolean(bvRow?.document_url),
    }),
    prepared: evaluateReadiness(readiness).prepared,
    educationShell: shellMode === "EDUCATION_SHELL",
    reviewAccount: isReviewAccountUser(userId, process.env),
  });
  if (entryRedirect) {
    const { redirect } = await import("next/navigation");
    redirect(entryRedirect);
  }

  const contextValue = {
    workspaceId: workspace.workspaceId,
    workspaceName: wsRecord?.name || null,
    workspaceKind: null,
    membershipRole: workspace.role || "member",
    actorId: userId,
    resolutionSource: "membership" as const,
    workspaceSelectionFellBack: workspace.fellBack,
    // 사령관 결정(2026-10-24): 활성 가게가 1개면 선택기를 숨기고 이름만 보여 준다.
    workspaceCanSwitch: workspace.activeWorkspaceCount > 1,
    conversationWorkbenchEnabled: isConversationWorkbenchEnabled(workspace.workspaceId),
  };

  // 접속 도메인별 분기: m.example.com은 모바일 셸 고정, example.com은 PC 버전 레이아웃 제공
  const { forceMobile, forcePc, initialMobile } = resolveHostPresentation(requestHeaders.get('host'), requestHeaders.get('user-agent'));

  return (
    <WorkspaceProvider value={contextValue}>
      <MobileR2Provider initialMobile={initialMobile} forceMobile={forceMobile} forcePc={forcePc} enabled={resolveMobileR2Enabled(process.env.MOBILE_R2_UI_ENABLED, process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST, workspace.workspaceId)}>
      <MobileUiProvider enabled={resolveMobileUiEnabled(process.env.MOBILE_DECISION_UI_ENABLED, process.env.MOBILE_DECISION_UI_WORKSPACE_ALLOWLIST, workspace.workspaceId)}>
        <div className="min-h-screen bg-[var(--v088-bg,#f8fafc)] text-[var(--v088-ink,#0f172a)]">
          <MembershipBanner tier={tier} />
          <ConversationNavigationProvider key={workspace.workspaceId} workspaceId={workspace.workspaceId}>
            <PersistentMobileShell key={workspace.workspaceId}>{children}</PersistentMobileShell>
          </ConversationNavigationProvider>
        </div>
      </MobileUiProvider>
      </MobileR2Provider>
    </WorkspaceProvider>
  );
}
