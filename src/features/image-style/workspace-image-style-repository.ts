import 'server-only'

import {
  CUSTOM_IMAGE_STYLE_RULE_KEY,
  LEGACY_IMAGE_STYLE_RULE_KEYS,
  pickWorkspaceImageStyle,
  type WorkspaceImageStyle,
} from './workspace-image-style'

type RuleReader = Readonly<{
  from(table: 'harness_rules'): {
    select(columns: string): {
      eq(column: string, value: string): unknown
    }
  }
}>

type Query = {
  eq(column: string, value: string): Query
  in(column: string, values: readonly string[]): Query
  then: PromiseLike<{ data: Array<{ rule_key: string; structured_rule: unknown }> | null; error: unknown }>['then']
}

/** 작업공간이 등록한 이미지 스타일. 읽기 실패는 생성을 막지 않고 null(범용 스타일)로 처리한다. */
export async function loadWorkspaceImageStyle(
  client: unknown,
  workspaceId: string,
): Promise<WorkspaceImageStyle | null> {
  try {
    const query = (client as RuleReader).from('harness_rules').select('rule_key, structured_rule') as unknown as Query
    const result = await query
      .eq('workspace_id', workspaceId)
      .eq('rule_type', 'image_generation')
      .eq('status', 'active')
      .in('rule_key', [CUSTOM_IMAGE_STYLE_RULE_KEY, ...LEGACY_IMAGE_STYLE_RULE_KEYS])
    if (result.error || !result.data) return null
    return pickWorkspaceImageStyle(result.data)
  } catch {
    return null
  }
}
