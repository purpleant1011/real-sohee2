import { READINESS_LABELS } from './labels'
import type {
  ChannelReadiness,
  OverallReadinessState,
  PublishReadinessResult,
  ReadinessChannelName,
  ReadinessItem,
} from './types'
import { formatAccountLabel } from '@/features/vault/ui/release-panel/release-service'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'

const CHANNELS: readonly ReadinessChannelName[] = ['instagram', 'threads']

export async function getPublishReadiness(
  admin: any,
  workspaceId: string,
  now: Date = new Date()
): Promise<PublishReadinessResult> {
  const nowMs = now.getTime()

  // 1. Evaluate per-channel items
  const channelResults: ChannelReadiness[] = await Promise.all(
    CHANNELS.map(async (channel) => {
      let connData: any = null
      let connError: any = null
      let credData: any = null
      let credError: any = null
      let receiptData: any = null

      try {
        const { data, error } = await admin
          .from('channel_connections')
          .select('account_label,status,external_account_id')
          .eq('workspace_id', workspaceId)
          .eq('channel', channel)
          .maybeSingle()
        if (error) connError = error
        else connData = data
      } catch (err) {
        connError = err
      }

      try {
        const { data, error } = await admin
          .from('meta_channel_credentials')
          .select('status,token_expires_at,granted_scopes')
          .eq('workspace_id', workspaceId)
          .eq('provider', channel)
          .maybeSingle()
        if (error) credError = error
        else credData = data
      } catch (err) {
        credError = err
      }

      try {
        const { data } = await admin
          .from('channel_verification_runs')
          .select('status,created_at,read_after_write_at')
          .eq('workspace_id', workspaceId)
          .eq('channel', channel)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        receiptData = data
      } catch {
        // Receipt verification is non-fatal if connection status is verified
      }

      const items: ReadinessItem[] = []

      // (1) 채널 연결 — connected + verified
      if (connError) {
        items.push({
          key: 'channel_connection',
          label: READINESS_LABELS.channelItems.connection,
          state: 'unknown',
          reason: READINESS_LABELS.reasons.loaderError,
          action: null,
        })
      } else if (!connData || !['connected', 'verified'].includes(connData.status)) {
        items.push({
          key: 'channel_connection',
          label: READINESS_LABELS.channelItems.connection,
          state: 'blocked',
          reason: READINESS_LABELS.reasons.channelNotConnected,
          action: READINESS_LABELS.actions.connectChannel,
        })
      } else {
        const receiptValid =
          receiptData?.status === 'VERIFIED' &&
          Number(Date.parse(receiptData.read_after_write_at || receiptData.created_at)) >
            nowMs - 7 * 86_400_000
        const isVerified = connData.status === 'verified' || receiptValid

        // Mirror the preflight rule: only a recent independent verification counts as verified.
        if (isVerified) {
          items.push({
            key: 'channel_connection',
            label: READINESS_LABELS.channelItems.connection,
            state: 'ok',
            reason: null,
            action: null,
          })
        } else {
          items.push({
            key: 'channel_connection',
            label: READINESS_LABELS.channelItems.connection,
            state: 'blocked',
            reason: READINESS_LABELS.reasons.channelNotVerified,
            action: READINESS_LABELS.actions.reconnectChannel,
          })
        }
      }

      // (2) 로그인 유지 — token not expired and valid >= 24h
      if (credError) {
        items.push({
          key: 'login_persistence',
          label: READINESS_LABELS.channelItems.loginPersistence,
          state: 'unknown',
          reason: READINESS_LABELS.reasons.loaderError,
          action: null,
        })
      } else if (!credData || !credData.token_expires_at) {
        items.push({
          key: 'login_persistence',
          label: READINESS_LABELS.channelItems.loginPersistence,
          state: 'blocked',
          reason: READINESS_LABELS.reasons.tokenMissing,
          action: READINESS_LABELS.actions.reconnectChannel,
        })
      } else {
        const expiresMs = Date.parse(credData.token_expires_at)
        if (!Number.isFinite(expiresMs)) {
          items.push({
            key: 'login_persistence',
            label: READINESS_LABELS.channelItems.loginPersistence,
            state: 'unknown',
            reason: READINESS_LABELS.reasons.loaderError,
            action: null,
          })
        } else if (expiresMs <= nowMs) {
          items.push({
            key: 'login_persistence',
            label: READINESS_LABELS.channelItems.loginPersistence,
            state: 'blocked',
            reason: READINESS_LABELS.reasons.tokenExpired,
            action: READINESS_LABELS.actions.reconnectChannel,
          })
        } else if (expiresMs - nowMs < 24 * 60 * 60 * 1000) {
          items.push({
            key: 'login_persistence',
            label: READINESS_LABELS.channelItems.loginPersistence,
            state: 'blocked',
            reason: READINESS_LABELS.reasons.tokenExpiringSoon,
            action: READINESS_LABELS.actions.reconnectChannel,
          })
        } else {
          items.push({
            key: 'login_persistence',
            label: READINESS_LABELS.channelItems.loginPersistence,
            state: 'ok',
            reason: null,
            action: null,
          })
        }
      }

      // (3) 게시 권한 — required scopes granted
      if (credError) {
        items.push({
          key: 'publish_permission',
          label: READINESS_LABELS.channelItems.publishPermission,
          state: 'unknown',
          reason: READINESS_LABELS.reasons.loaderError,
          action: null,
        })
      } else if (!credData) {
        items.push({
          key: 'publish_permission',
          label: READINESS_LABELS.channelItems.publishPermission,
          state: 'blocked',
          reason: READINESS_LABELS.reasons.scopeDeficient,
          action: READINESS_LABELS.actions.grantPermission,
        })
      } else {
        const scopes = Array.isArray(credData.granted_scopes) ? credData.granted_scopes : []
        const hasPublishScope =
          channel === 'instagram'
            ? scopes.includes('instagram_business_content_publish') ||
              scopes.includes('instagram_content_publish')
            : scopes.includes('threads_content_publish')

        if (hasPublishScope) {
          items.push({
            key: 'publish_permission',
            label: READINESS_LABELS.channelItems.publishPermission,
            state: 'ok',
            reason: null,
            action: null,
          })
        } else {
          items.push({
            key: 'publish_permission',
            label: READINESS_LABELS.channelItems.publishPermission,
            state: 'blocked',
            reason: READINESS_LABELS.reasons.scopeDeficient,
            action: READINESS_LABELS.actions.grantPermission,
          })
        }
      }

      // (4) 계정 확인 — account label known, else unknown
      if (connError && credError) {
        items.push({
          key: 'account_verification',
          label: READINESS_LABELS.channelItems.accountVerification,
          state: 'unknown',
          reason: READINESS_LABELS.reasons.loaderError,
          action: null,
        })
      } else {
        const rawLabel = connData?.account_label ?? credData?.account_label
        const formatted = formatAccountLabel(rawLabel)
        const isKnown = Boolean(
          rawLabel &&
          rawLabel.trim() !== '' &&
          formatted !== '연결된 계정'
        )

        if (isKnown || (rawLabel && rawLabel.trim() !== '')) {
          items.push({
            key: 'account_verification',
            label: READINESS_LABELS.channelItems.accountVerification,
            state: 'ok',
            reason: null,
            action: null,
          })
        } else {
          items.push({
            key: 'account_verification',
            label: READINESS_LABELS.channelItems.accountVerification,
            state: 'unknown',
            reason: READINESS_LABELS.reasons.accountUnknown,
            action: READINESS_LABELS.actions.checkAccount,
          })
        }
      }

      const allOk = items.every((it) => it.state === 'ok')
      const anyBlocked = items.some((it) => it.state === 'blocked')

      return {
        channel,
        channel_label: READINESS_LABELS.channels[channel],
        state: allOk ? 'ready' : anyBlocked ? 'blocked' : 'unknown',
        items,
      }
    })
  )

  // 2. Evaluate global items
  const globalItems: ReadinessItem[] = []

  // (5) 소희의 실제 게시 기능 — switch VAULT_PUBLISH_ENABLED==='1' AND Meta app mode/review/tier allows public customers AND workspace allowlisted
  const isSwitchOn = process.env.VAULT_PUBLISH_ENABLED === '1'
  let isMetaPublicReady = false
  try {
    const { getMetaCapabilityTruth } = await import('@/features/channels/meta-capability-truth')
    const igEvidence = getMetaCapabilityTruth('instagram', now.toISOString())
    const thEvidence = getMetaCapabilityTruth('threads', now.toISOString())
    isMetaPublicReady = Boolean(igEvidence.isPublicCustomerReady && thEvidence.isPublicCustomerReady)
  } catch {
    isMetaPublicReady = false
  }

  const isLiveAllowed = isMetaLiveAllowed(workspaceId)

  if (isSwitchOn && isMetaPublicReady && isLiveAllowed) {
    globalItems.push({
      key: 'system_publish_feature',
      label: READINESS_LABELS.globalItems.publishFeature,
      state: 'ok',
      reason: null,
      action: null,
    })
  } else {
    globalItems.push({
      key: 'system_publish_feature',
      label: READINESS_LABELS.globalItems.publishFeature,
      state: 'blocked',
      reason: READINESS_LABELS.reasons.publishFeatureOff,
      action: null,
    })
  }

  // (6) 일시 정지 — workspace agent paused flag
  let agentPaused = false
  let pauseError = false
  try {
    const { data: ctrlData, error: ctrlErr } = await admin
      .from('workspace_runtime_control_states')
      .select('kill_switch_active')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (ctrlErr) throw ctrlErr

    const { checkKillSwitchPreflight } = await import('@/lib/safety/kill-switch-guard')
    const killCheck = await checkKillSwitchPreflight(admin, { workspaceId })

    // The autonomous agent being paused (the default) does not stop user-approved publishing; only an emergency stop does.
    agentPaused = Boolean(killCheck.blocked || ctrlData?.kill_switch_active === true)
  } catch {
    pauseError = true
  }

  if (pauseError) {
    globalItems.push({
      key: 'agent_pause_status',
      label: READINESS_LABELS.globalItems.agentPause,
      state: 'unknown',
      reason: READINESS_LABELS.reasons.loaderError,
      action: null,
    })
  } else if (agentPaused) {
    globalItems.push({
      key: 'agent_pause_status',
      label: READINESS_LABELS.globalItems.agentPause,
      state: 'blocked',
      reason: READINESS_LABELS.reasons.agentPaused,
      action: null,
    })
  } else {
    globalItems.push({
      key: 'agent_pause_status',
      label: READINESS_LABELS.globalItems.agentPause,
      state: 'ok',
      reason: null,
      action: null,
    })
  }

  // (7) 승인된 보관 글 — count of vault items releasable for channel
  let releasableVaultCount = 0
  let vaultError = false
  try {
    const { data: vaultItems, error: vErr } = await admin
      .from('vault_items')
      .select('id, channel, release_gate, approval_state, deleted_at')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)

    if (vErr) throw vErr

    const releasable = (vaultItems ?? []).filter((item: any) =>
      item.deleted_at === null &&
      item.approval_state === 'APPROVED' &&
      item.release_gate !== null &&
      item.release_gate !== 'RELEASE_REQUESTED' &&
      ['HELD_USER', 'HELD_PROVIDER_PENDING', 'HELD_CONNECTION_PENDING'].includes(item.release_gate)
    )
    releasableVaultCount = releasable.length
  } catch {
    vaultError = true
  }

  if (vaultError) {
    globalItems.push({
      key: 'approved_vault_items',
      label: READINESS_LABELS.globalItems.approvedVaultItems,
      state: 'unknown',
      reason: READINESS_LABELS.reasons.loaderError,
      action: null,
    })
  } else if (releasableVaultCount === 0) {
    globalItems.push({
      key: 'approved_vault_items',
      label: READINESS_LABELS.globalItems.approvedVaultItems,
      state: 'blocked',
      reason: READINESS_LABELS.reasons.noApprovedVaultItems,
      action: READINESS_LABELS.actions.createContent,
    })
  } else {
    globalItems.push({
      key: 'approved_vault_items',
      label: READINESS_LABELS.globalItems.approvedVaultItems,
      state: 'ok',
      reason: null,
      action: null,
    })
  }

  // 3. Compute overall state
  // Ready only if every item for at least one channel and all global items are ok
  // Blocked if any item blocked
  // Else unknown
  const hasReadyChannel = channelResults.some((ch) => ch.items.every((it) => it.state === 'ok'))
  const allGlobalOk = globalItems.every((it) => it.state === 'ok')

  let overallState: OverallReadinessState
  if (hasReadyChannel && allGlobalOk) {
    overallState = 'ready'
  } else {
    const anyItemBlocked =
      globalItems.some((it) => it.state === 'blocked') ||
      channelResults.some((ch) => ch.items.some((it) => it.state === 'blocked'))
    if (anyItemBlocked) {
      overallState = 'blocked'
    } else {
      overallState = 'unknown'
    }
  }

  return {
    state: overallState,
    channels: channelResults,
    global_items: globalItems,
  }
}
