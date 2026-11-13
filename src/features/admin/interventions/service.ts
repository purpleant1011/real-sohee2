import { z } from 'zod'

const uuid = z.string().uuid()
const channel = z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business'])
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WORKSPACE'), workspaceId: uuid }).strict(),
  z.object({ kind: z.literal('CHANNEL'), workspaceId: uuid, channel }).strict(),
  z.object({ kind: z.literal('GLOBAL'), workspaceId: uuid }).strict(),
  z.object({ kind: z.literal('CREDIT'), workspaceId: uuid, amount: z.number().int().positive().max(50000) }).strict(),
])
export const interventionInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WORKSPACE'), workspaceId: uuid, active: z.boolean(), reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true), idempotencyKey: z.string().trim().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('CHANNEL'), workspaceId: uuid, channel, active: z.boolean(), reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true), idempotencyKey: z.string().trim().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('GLOBAL'), workspaceId: uuid, active: z.boolean(), reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true), idempotencyKey: z.string().trim().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('CREDIT'), workspaceId: uuid, amount: z.number().int().positive().max(50000), reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true), idempotencyKey: z.string().trim().min(1).max(128) }).strict(),
])
export type Intervention = z.infer<typeof interventionInput>
export type InterventionTarget = z.infer<typeof target>

type Client = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { message: string } | null }> }
const labels: Record<string, string> = { instagram: '인스타그램', threads: '스레드', naver_blog: '네이버 블로그', daangn_business: '당근 비즈니스' }

/** Only counts actual persisted rows. Unknown counts never masquerade as zero. */
export async function previewIntervention(db: Client, input: InterventionTarget) {
  const value = target.parse(input)
  if (value.kind === 'CREDIT') {
    const { data, error } = await db.rpc('get_workspace_credit_balance', { p_workspace_id: value.workspaceId })
    if (error || !data || !Number.isFinite(Number(data.available))) throw new Error('크레딧 잔여량을 확인하지 못했어요')
    return { affectedCount: 1, stateLabel: `크레딧 ${value.amount.toLocaleString('ko-KR')}개를 지급해요`, detail: `현재 사용 가능 ${Number(data.available).toLocaleString('ko-KR')}개 · 지급 후 ${(+data.available + value.amount).toLocaleString('ko-KR')}개`, active: false }
  }
  const query = db.from('vault_items').select('id', { count: 'exact', head: true }).eq('workspace_id', value.workspaceId).is('deleted_at', null)
  const { count, error } = value.kind === 'CHANNEL' ? await query.eq('channel', value.channel) : await query
  if (error || !Number.isInteger(count)) throw new Error('영향받는 보관 글 수를 확인하지 못했어요')
  const { data: switches, error: switchError } = await db.from('kill_switches').select('scope,target_id,is_active').eq('is_active', true)
  if (switchError || !Array.isArray(switches)) throw new Error('현재 중단 상태를 확인하지 못했어요')
  const scope = value.kind
  const key = scope === 'WORKSPACE' ? value.workspaceId : scope === 'CHANNEL' ? value.channel : 'ALL'
  const active = switches.some((row: { scope: string; target_id: string }) => row.scope === scope && row.target_id === key)
  return { affectedCount: count, active, stateLabel: '소희가 잠시 멈췄어요', detail: scope === 'CHANNEL' ? `${labels[value.channel]} 채널 전체 발행을 멈춰요 · 이 매장의 보관 글 ${count}건은 남아요` : scope === 'GLOBAL' ? `전체 발행을 멈춰요 · 이 매장의 보관 글 ${count}건은 남아요` : `발행 요청과 일괄 발행을 멈춰요 · 보관 글 ${count}건은 그대로 남아요` }
}

/** DB RPC commits intervention and immutable audit in one transaction. No fallback writes. */
export async function executeIntervention(db: Client, actorId: string, input: unknown) {
  const value = interventionInput.parse(input)
  const { data, error } = await db.rpc('apply_safety_intervention_ani1560', {
    p_workspace_id: value.workspaceId, p_kind: value.kind,
    p_channel: value.kind === 'CHANNEL' ? value.channel : null,
    p_active: value.kind === 'CREDIT' ? null : value.active,
    p_amount: value.kind === 'CREDIT' ? value.amount : null,
    p_reason: value.reason, p_idempotency_key: value.idempotencyKey, p_actor_id: actorId,
  })
  if (error || !data || data.success !== true) throw new Error('개입과 감사 기록을 함께 완료하지 못했어요')
  return data as { success: true; is_replay: boolean; active?: boolean; balance?: number }
}
