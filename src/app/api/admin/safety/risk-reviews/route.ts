export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';

export async function GET() {
  try {
    await requireOperatorAnyScope('admin.read');
    const supabase = await createServerSupabaseClient();

    // 1. Query risk reviews from audit_events (Strict column: created_at: ANI-610)
    const { data: riskAudits, error: auditErr } = await (supabase as any)
      .from('audit_events')
      .select('*')
      .in('event_type', ['risk_event_detected', 'kill_switch_toggled', 'admin_credit_adjustment'])
      .order('created_at', { ascending: false })
      .limit(30);

    // 2. Query active kill switches to compute real safety metrics
    const { data: activeSwitches, error: ksErr } = await (supabase as any)
      .from('kill_switches')
      .select('id, scope, target_id, is_active')
      .eq('is_active', true);

    // 3. Query notification outbox
    const { data: outbox } = await (supabase as any)
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // 4. UNKNOWN 원칙 & 실제 지표 기반 위험도 평가 (ANI-610)
    let systemRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'LOW';
    if (auditErr || ksErr) {
      systemRiskLevel = 'UNKNOWN'; // 텔레메트리 쿼리 실패 시 결코 LOW로 가짜 판정하지 않음
    } else if (activeSwitches && activeSwitches.length > 0) {
      const hasGlobal = activeSwitches.some((s: any) => s.scope === 'GLOBAL');
      systemRiskLevel = hasGlobal ? 'CRITICAL' : 'HIGH';
    }

    return NextResponse.json({
      success: true,
      riskEvents: riskAudits || [],
      notifications: outbox || [],
      safetyOverview: {
        systemRiskLevel,
        activeKillSwitchesCount: activeSwitches?.length || 0,
        activeThrottledWorkspacesCount: (activeSwitches || []).filter((s: any) => s.scope === 'WORKSPACE').length,
        monitoredAt: new Date().toISOString()
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '안전 지표 조회 실패' }, { status: 403 });
  }
}
