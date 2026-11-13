import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { createV08AutomationRepository } from './v08-automation-repository'
import { v08AutomationKinds } from './v08-rule-schema'

/** Uses the existing rule parser and native state. This port cannot save, activate, or publish. */
export async function loadConversationAutomationRules(input: { client: ServerSupabaseClient; workspaceId: string }) {
  const workspaceId = z.string().uuid().parse(input.workspaceId)
  let partial = false
  const unavailable = async (): Promise<never> => { throw new Error('AUTOMATION_READ_ONLY_PORT') }
  const repository = createV08AutomationRepository({
    list: async () => {
      const result = await input.client.from('automation_rules')
        .select('id,workspace_id,kind,active,approval_required,timezone,next_run_at,configuration_version,configuration')
        .eq('workspace_id', workspaceId).in('kind', [...v08AutomationKinds])
        .order('updated_at', { ascending: false }).limit(26)
      if (result.error || !Array.isArray(result.data)) return { data: null, error: true }
      // Validate the entire observed window, including the extra row, before truncating.
      partial = result.data.length > 25
      return result
    },
    find: unavailable, insert: unavailable, update: unavailable,
  })
  const result = await repository.list(workspaceId)
  if (result.error || !result.data) throw new Error('AUTOMATION_READ_UNAVAILABLE')
  return {
    workspaceId, observedAt: new Date().toISOString(), rules: result.data.slice(0, 25), partial,
    notice: '현재 저장된 report-only 자동화 설정의 제한 조회입니다. 활성 설정은 실행 완료가 아니며 자동 게시·발송·결제 권한도 아닙니다. 주간 계획 종류 역시 저장된 성과 기반 보고이며 범용 콘텐츠 자동 생성은 아닙니다. 실행 결과는 업무 원장에서 확인하세요.',
  }
}
