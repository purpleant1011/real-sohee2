export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';
import { WingStackControlTower } from '@/lib/admin-ops/control-tower/wing-stack-control-tower';
import { ProviderCircuitBreakerRegistry } from '@/lib/channel-execution/core/provider-circuit-breaker';

const circuitBreakers = new ProviderCircuitBreakerRegistry();
const wingStackControlTower = new WingStackControlTower(circuitBreakers);

export async function GET(req: NextRequest) {
  try {
    await requireOperatorAnyScope('dashboard.read');
    
    const components = wingStackControlTower.getAllComponents();
    const auditLogs = wingStackControlTower.getAuditLogs();
    const isGlobalKillActive = circuitBreakers.getKillSwitchStatus().isGlobalKilled;

    return NextResponse.json({
      components,
      auditLogs,
      isGlobalKillActive,
      asOf: new Date().toISOString(),
    });
  } catch (err: any) {
    const isAuthError =
      err?.name === 'OperatorAccessError' ||
      err?.code === 'AUTH_REQUIRED' ||
      err?.code === 'PLATFORM_ADMIN_REQUIRED' ||
      err?.code === 'OPERATOR_DISABLED' ||
      err?.code === 'MFA_REQUIRED' ||
      err?.code === 'PERMISSION_DENIED' ||
      err?.code === 'WORKSPACE_SCOPE_DENIED' ||
      err?.message?.includes('로그인') ||
      err?.message?.includes('AUTH') ||
      err?.message?.includes('DENIED') ||
      err?.message?.includes('Unauthorized');
    return NextResponse.json({ error: err.message || 'Error' }, { status: isAuthError ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const operator = await requireOperatorAnyScope('dashboard.read');
    const body = await req.json();

    const { action, scope, target, reason } = body;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return NextResponse.json({ error: 'Privileged operation rejected: Reason is mandatory' }, { status: 400 });
    }

    const actorId = (operator as any)?.operatorId || (operator as any)?.email || 'admin-operator';

    if (action === 'TRIGGER_KILL_SWITCH') {
      wingStackControlTower.executePrivilegedKillSwitch(
        scope || 'PROVIDER',
        target || 'ALL',
        reason,
        actorId
      );
    } else if (action === 'RELEASE_KILL_SWITCH') {
      wingStackControlTower.executePrivilegedReleaseKillSwitch(
        scope || 'PROVIDER',
        target || 'ALL',
        reason,
        actorId
      );
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      action,
      scope,
      target,
      audit: {
        adminActorId: actorId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    const isAuthError =
      err?.name === 'OperatorAccessError' ||
      err?.code === 'AUTH_REQUIRED' ||
      err?.code === 'PLATFORM_ADMIN_REQUIRED' ||
      err?.code === 'OPERATOR_DISABLED' ||
      err?.code === 'MFA_REQUIRED' ||
      err?.code === 'PERMISSION_DENIED' ||
      err?.code === 'WORKSPACE_SCOPE_DENIED' ||
      err?.message?.includes('로그인') ||
      err?.message?.includes('AUTH') ||
      err?.message?.includes('DENIED') ||
      err?.message?.includes('Unauthorized');
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: isAuthError ? 401 : 500 });
  }
}
