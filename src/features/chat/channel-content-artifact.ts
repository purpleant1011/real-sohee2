import type { ChannelContent } from '@/features/content/channel-content-schema'
import type { SafeIntegrationArtifact } from './stream-events'
export function channelContentArtifact(content: ChannelContent): SafeIntegrationArtifact {
  const manual = content.channel === 'naver_place'
  const automatedNaver = content.channel === 'naver_blog'
  return Object.freeze({
    id: `channel-${content.channel}`,
    kind: manual ? 'manual_assist' : 'channel_preview',
    title: manual ? '수동 마무리 패키지' : automatedNaver ? '네이버 블로그 게시 전 검토' : '채널 초안',
    href: '/app/work',
    statusLabel: manual ? '수동 마무리 필요' : automatedNaver ? '검토 준비됨' : '검토 준비됨',
    requiresConfirmation: true,
  })
}
export function scheduleProjection(input:Readonly<{contentVersionId:string|null;approvalId:string|null;fingerprint:string|null}>){return input.contentVersionId&&input.approvalId&&input.fingerprint?{allowed:true as const}:{allowed:false as const,code:'APPROVAL_IDENTITY_REQUIRED' as const}}
