import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'

/** One server truth for publish gates and user-facing copy. Query failure is blocked, not empty. */
export async function readInterventionState(db: any, workspaceId: string, channel?: string) {
  const check = await checkKillSwitchPreflight(db, { workspaceId, channel })
  return {
    blocked: check.blocked,
    label: check.blocked ? '소희가 잠시 멈췄어요' : null,
    detail: check.blocked ? '보관함은 그대로 두고, 새 발행과 발행 요청만 잠시 멈춰요. 운영팀에 확인해 주세요.' : null,
  }
}
