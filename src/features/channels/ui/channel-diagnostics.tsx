import { Shield } from 'lucide-react'
import { CapabilityReadinessRow, ProductionReadinessCard, ScopeDriftAlert, WebhookHealthBadge } from '@/components/v088/same-truth'
import type { CredentialSummary, Verification } from './channel-display'

type CredentialDiagnostics = CredentialSummary & { webhook_status?: string | null; last_webhook_at?: string | null }
type ChannelId = 'instagram' | 'threads'

export function ChannelDiagnostics({ channels, credentials }: {
  channels: Record<ChannelId, Verification | null>
  credentials: Partial<Record<ChannelId, CredentialDiagnostics>>
}) {
  const lastWebhookAt = credentials.instagram?.last_webhook_at || credentials.threads?.last_webhook_at || null
  const webhookRaw = (credentials.instagram?.webhook_status || credentials.threads?.webhook_status || '').toLowerCase()
  const lag = lastWebhookAt ? Date.now() - new Date(lastWebhookAt).getTime() : Infinity
  const webhookStatus = webhookRaw === 'error' ? 'FAILED'
    : (webhookRaw === 'healthy' || webhookRaw === 'ready') && lastWebhookAt && Number.isFinite(lag)
      ? lag > 24 * 60 * 60_000 ? 'DEGRADED' : 'HEALTHY' : 'PENDING'

  // Verification only proves account access; it does not prove publishing or webhook delivery.
  const state = (channel: ChannelId) => channels[channel]?.status === 'VERIFIED' && channels[channel]?.verified
    ? 'AUTHORIZED' : channels[channel]?.status === 'CONNECTED_UNVERIFIED' ? 'CONNECTED' : 'DISCONNECTED'
  const capabilities = [
    { name: '인스타그램 피드 발행', channel: 'INSTAGRAM', state: state('instagram'), proof: '게시물 발행' },
    { name: '인스타그램 릴스 발행', channel: 'INSTAGRAM', state: state('instagram'), proof: '릴스 영상 발행' },
    { name: '인스타그램 댓글/DM 수신', channel: 'INSTAGRAM', state: state('instagram'), proof: '실시간 인바운드 웹훅' },
    { name: '인스타그램 답글 발행', channel: 'INSTAGRAM', state: state('instagram'), proof: '검토 후 답변 발송' },
    { name: '스레드 포스트 발행', channel: 'THREADS', state: state('threads'), proof: '스레드 텍스트 발행' },
    { name: '스레드 답글 발행', channel: 'THREADS', state: state('threads'), proof: '스레드 답글 파이프라인' },
    { name: '네이버 블로그 원고 준비', channel: 'NAVER_BLOG', state: 'PENDING', proof: '원고·사진 준비 및 미리보기' },
    { name: '당근 비즈프로필 소식 준비', channel: 'DAANGN', state: 'PENDING', proof: '소식 초안 준비' },
  ]
  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-4 sm:p-6">
      <p className="text-xs text-muted-foreground">운영 점검용 세부 정보예요. 아래 Meta 앱 준비도는 마지막 기록(2026-09-07) 기준이며, 실시간 연결 상태와 다를 수 있어요.</p>
      <ProductionReadinessCard appId="1568352131460103" appMode="development" accessLevel="standard" reviewStatus="unsubmitted" audience="TEST_ROLE_ONLY" isProductionReady={false} lastVerifiedAt="2026-09-07" />
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Meta 실시간 Webhook 파이프라인 감시 (Realtime Event Ingestion)</h3>
          <p className="text-xs text-muted-foreground">인스타그램 및 스레드의 멘션, 댓글, 메시지 이벤트 수신 상태</p>
        </div>
        <WebhookHealthBadge status={webhookStatus} lastReceivedAt={lastWebhookAt} />
      </div>
      {(['instagram', 'threads'] as const).map(channel => {
        const requiredScopes = channel === 'instagram'
          ? ['instagram_business_basic', 'instagram_business_content_publish']
          : ['threads_basic', 'threads_content_publish']
        const grantedScopes = channels[channel]?.scopes ?? []
        const missingScopes = requiredScopes.filter(scope => !grantedScopes.includes(scope))
        return channels[channel]?.status === 'SCOPE_INSUFFICIENT' && missingScopes.length > 0 ? (
          <ScopeDriftAlert key={channel} channel={channel}
            requiredScopes={requiredScopes} grantedScopes={grantedScopes} missingScopes={missingScopes} />
        ) : null
      })}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Shield className="size-4 text-primary" aria-hidden /> 소희 주요 채널 역량 준비 상태 (Capability Registry)</h3>
        <p className="text-xs text-muted-foreground">CONNECTED → AUTHORIZED → LISTENING → EXECUTABLE → PROVEN → AUTONOMOUS 단계별 점검</p>
        <div className="space-y-2">
          {capabilities.map(cap => <CapabilityReadinessRow key={cap.name} name={cap.name} channel={cap.channel} state={cap.state} proofStatus={cap.proof} failureCode={cap.channel === 'DAANGN' ? 'MANUAL_SETUP_PENDING' : undefined} />)}
        </div>
      </div>
    </div>
  )
}
