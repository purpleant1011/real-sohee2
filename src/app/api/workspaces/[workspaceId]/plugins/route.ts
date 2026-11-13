export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { FIRST_PARTY_PLUGIN_CATALOG } from '@/lib/plugin-platform/core/first-party-plugin-catalog';
import { defaultPluginInstallationService } from '@/lib/plugin-platform/core/plugin-installation-service';
import { BYREUM_WORKSPACE_ID } from '@/features/content/content-draft-service';
import type { AgentEnergyPlanTier } from '@/types/autonomous-outcome-os';

// 기본 초기 시딩 (사용자 경험을 위해 인스타그램, 카카오톡, 네이버 블로그 시드)
// Byreum 전용 테스트 계정 연결은 Byreum 워크스페이스에만 한정. 비Byreum은 계정 미연결(AUTH_REQUIRED) 상태 유지.
function seedInitialPluginsIfEmpty(workspaceId: string) {
  const existing = defaultPluginInstallationService.listWorkspaceInstallations(workspaceId);
  if (existing.length === 0) {
    const instagramManifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.pluginId === 'plg_instagram_growth');
    const kakaoManifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.pluginId === 'plg_kakao_consult');
    const naverManifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.pluginId === 'plg_naver_blog_marketing');

    if (instagramManifest) {
      defaultPluginInstallationService.installPlugin({
        workspaceId,
        manifest: instagramManifest,
        currentPlanTier: 'TIER_300K_GROWTH',
      });
      if (workspaceId === BYREUM_WORKSPACE_ID) {
        defaultPluginInstallationService.markAccountConnected(workspaceId, 'plg_instagram_growth', '@studio_byreum');
      }
    }

    if (kakaoManifest) {
      defaultPluginInstallationService.installPlugin({
        workspaceId,
        manifest: kakaoManifest,
        currentPlanTier: 'TIER_300K_GROWTH',
      });
    }

    if (naverManifest) {
      defaultPluginInstallationService.installPlugin({
        workspaceId,
        manifest: naverManifest,
        currentPlanTier: 'TIER_300K_GROWTH',
      });
      if (workspaceId === BYREUM_WORKSPACE_ID) {
        defaultPluginInstallationService.markAccountConnected(workspaceId, 'plg_naver_blog_marketing', 'byreum_beauty');
      }
    }
  }
}

import { PluginArtifactService } from '@/lib/plugin-platform/core/plugin-artifact-service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
  }

  // Cross-tenant guard: plugin installations are per-workspace state.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;

  try {

    const { searchParams } = new URL(req.url);
    const planTier = (searchParams.get('planTier') as AgentEnergyPlanTier) || 'TIER_300K_GROWTH';

    seedInitialPluginsIfEmpty(workspaceId);

    const installations = defaultPluginInstallationService.listWorkspaceInstallations(workspaceId);
    const installationMap = new Map(installations.map((i) => [i.pluginId, i]));

    const catalogWithState = FIRST_PARTY_PLUGIN_CATALOG.map((manifest) => {
      const inst = installationMap.get(manifest.pluginId);
      const artifact = PluginArtifactService.computeArtifactMetadata(manifest);
      const { stage, reason: stageReason } = PluginArtifactService.evaluateOperationalStage({
        manifest,
        installation: inst,
        currentPlanTier: planTier,
        isCircuitBreakerOpen: inst?.isCircuitBreakerOpen,
      });

      return {
        manifest,
        installed: !!inst && inst.state !== 'UNINSTALLED',
        state: inst ? inst.state : 'AVAILABLE',
        stage,
        stageReason,
        artifactDigest: artifact.sha256,
        signatureStatus: artifact.signatureStatus,
        healthStatus: inst ? inst.healthStatus : 'UNKNOWN',
        connectedAccountId: inst?.connectedAccountId || null,
        installedAt: inst?.installedAt || null,
      };
    });

    const activeReadyCount = catalogWithState.filter((p) => p.stage === 'READY').length;

    return NextResponse.json({
      workspaceId,
      plugins: catalogWithState,
      totalCatalogCount: FIRST_PARTY_PLUGIN_CATALOG.length,
      installedCount: installations.filter((i) => i.state !== 'UNINSTALLED').length,
      readyCount: activeReadyCount,
      asOf: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load plugins' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Cross-tenant guard: refuse a non-member before installing or removing plugins.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;

  try {
    const body = await req.json();
    const { action, pluginId, planTier, accountId } = body;

    if (!pluginId) {
      return NextResponse.json({ error: 'pluginId is required' }, { status: 400 });
    }

    const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.pluginId === pluginId);
    if (!manifest) {
      return NextResponse.json({ error: `Plugin not found: ${pluginId}` }, { status: 404 });
    }

    const currentPlan: AgentEnergyPlanTier = planTier || 'TIER_300K_GROWTH';

    if (action === 'INSTALL') {
      const res = defaultPluginInstallationService.installPlugin({
        workspaceId,
        manifest,
        currentPlanTier: currentPlan,
      });

      return NextResponse.json({
        success: res.success,
        installation: res.installation,
        state: res.state,
        reason: res.reason,
      });
    }

    if (action === 'CONNECT') {
      const connected = defaultPluginInstallationService.markAccountConnected(
        workspaceId,
        pluginId,
        accountId || 'connected_account_auto'
      );
      return NextResponse.json({
        success: true,
        installation: connected,
        state: 'READY',
      });
    }

    if (action === 'TOGGLE') {
      const updated = defaultPluginInstallationService.togglePluginEnabled(workspaceId, pluginId);
      return NextResponse.json({
        success: true,
        installation: updated,
        state: updated?.state || 'AVAILABLE',
      });
    }

    if (action === 'UNINSTALL') {
      const deleted = defaultPluginInstallationService.uninstallPlugin(workspaceId, pluginId);
      return NextResponse.json({
        success: deleted,
        state: 'AVAILABLE',
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update plugin' }, { status: 500 });
  }
}
