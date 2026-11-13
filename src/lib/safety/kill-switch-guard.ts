import { SupabaseClient } from '@supabase/supabase-js';

export interface KillSwitchCheckOptions {
  workspaceId?: string;
  channel?: string;
  provider?: string;
}

export async function checkKillSwitchPreflight(
  supabase: SupabaseClient,
  options: KillSwitchCheckOptions = {}
): Promise<{ blocked: boolean; reason?: string; scope?: string }> {
  try {
    const { data: switches, error } = await (supabase as any)
      .from('kill_switches')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('[checkKillSwitchPreflight] Database query error (Fail-Closed):', error);
      return {
        blocked: true,
        scope: 'FAIL_CLOSED',
        reason: `보안 제어 시스템 조회 실패로 안전을 위해 외부 작업이 차단되었습니다. (${error.message})`
      };
    }

    if (!switches || switches.length === 0) {
      return { blocked: false };
    }

    for (const sw of switches) {
      // 1. GLOBAL scope kill switch
      if (sw.scope === 'GLOBAL') {
        return {
          blocked: true,
          scope: 'GLOBAL',
          reason: `전사 시스템 긴급 킬스위치가 활성화되어 외부 작업이 중단되었습니다. (${sw.reason})`
        };
      }

      // 2. WORKSPACE scope
      if (sw.scope === 'WORKSPACE' && options.workspaceId && sw.target_id === options.workspaceId) {
        return {
          blocked: true,
          scope: 'WORKSPACE',
          reason: `해당 매장의 자율 작업 킬스위치가 활성화되어 있습니다. (${sw.reason})`
        };
      }

      // 3. CHANNEL scope
      if (sw.scope === 'CHANNEL' && options.channel && sw.target_id?.toLowerCase() === options.channel.toLowerCase()) {
        return {
          blocked: true,
          scope: 'CHANNEL',
          reason: `${options.channel} 채널 긴급 킬스위치가 활성화되어 있습니다. (${sw.reason})`
        };
      }
    }

    return { blocked: false };
  } catch (err: any) {
    console.error('[checkKillSwitchPreflight] Check exception (Fail-Closed):', err);
    return {
      blocked: true,
      scope: 'FAIL_CLOSED',
      reason: `보안 제어 시스템 예외 발생으로 안전을 위해 외부 작업이 차단되었습니다: ${err?.message || '알 수 없는 오류'}`
    };
  }
}
