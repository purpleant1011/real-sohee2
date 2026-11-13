import { evaluateReadiness } from '@/features/readiness'
import type { SoheeReadinessSnapshot, SoheeReadinessFactKey } from '@/features/sohee-ready/types'

/**
 * 채널 게시 가능 판정(연결 + 게시 scope + 토큰 만료 여유 + 최근 readback 검증 + 계정 식별자).
 * 승인 옵션과 초안 DTO 가 같은 판정을 쓰도록 분리했다. 동작은 분리 전과 같다.
 */
export function isMetaChannelPublishVerified(
  channel: 'instagram' | 'threads',
  credentials: any[],
  receipts: any[],
  now: number = Date.now(),
): boolean {
  const cred = credentials.find((r: any) => r.provider === channel)
  const receipt = receipts.find((r: any) => r.channel === channel)
  const required = channel === 'instagram' ? ['instagram_business_basic', 'instagram_business_content_publish'] : ['threads_basic', 'threads_content_publish']
  return Boolean(cred && ['active', 'connected'].includes(cred.status) && required.every(scope => (cred.granted_scopes ?? []).includes(scope)) && Date.parse(cred.token_expires_at) > now + 86_400_000 && receipt && Date.parse(receipt.read_after_write_at || receipt.created_at) > now - 7 * 86_400_000 && cred.channel_connections?.external_account_id)
}

/** Approval options use persisted facts only; loadReadiness may trigger a provider probe. */
export async function readQuickPostApprovalReadiness(admin: any, workspaceId: string) {
  const [knowledge, text, image, policy, credentials, receipts] = await Promise.all([
    admin.from('workspace_knowledge_harnesses').select('harness_version_id').eq('workspace_id', workspaceId).eq('is_active', true).limit(1).maybeSingle(),
    ...(['text_generation', 'image_generation', 'approval_policy'] as const).map(rule => admin.from('harness_rules').select('id,approved_at').eq('workspace_id', workspaceId).eq('rule_type', rule).eq('status', 'active').limit(1).maybeSingle()),
    admin.from('meta_channel_credentials').select('provider,status,granted_scopes,token_expires_at,channel_connections(external_account_id)').eq('workspace_id', workspaceId),
    admin.from('channel_verification_runs').select('channel,status,read_after_write_at,created_at').eq('workspace_id', workspaceId).in('channel', ['instagram', 'threads']).in('status', ['VERIFIED', 'success']).order('created_at', { ascending: false }),
  ])
  if ([knowledge, text, image, policy, credentials, receipts].some(r => r.error)) { console.error('[quick-post] readiness read failed', [knowledge, text, image, policy, credentials, receipts].map(r => r.error)); throw new Error('Readiness unavailable') }
  const verified = (channel: 'instagram' | 'threads') => isMetaChannelPublishVerified(channel, credentials.data ?? [], receipts.data ?? [])
  const states: Partial<Record<SoheeReadinessFactKey, boolean>> = {
    BUSINESS_VERIFIED: false, INSTAGRAM_VERIFIED: verified('instagram'), THREADS_VERIFIED: verified('threads'),
    BUSINESS_KNOWLEDGE_CONFIRMED: Boolean(knowledge.data), TEXT_HARNESS_CONFIRMED: Boolean(text.data),
    IMAGE_HARNESS_CONFIRMED: Boolean(image.data), OPERATING_POLICY_CONFIRMED: Boolean(policy.data?.approved_at),
  }
  const facts = Object.fromEntries(Object.entries(states).map(([key, value]) => [key, { verified: value }])) as unknown as SoheeReadinessSnapshot['facts']
  return evaluateReadiness({ workspaceId, ready: false, facts, blockers: [], evaluatedAt: new Date().toISOString() })
}
