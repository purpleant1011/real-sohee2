import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createEngagementService } from '@/features/engagement/compose'
import { ingestChannelComments } from '@/features/engagement/ingest'
import { filterAllowedConnections } from '@/features/engagement/allowed-connections'
import { isEngagementFeatureOn } from '@/features/engagement/engagement-allowlist'
import { pollInstagramDms } from '@/features/engagement/dm/poll'
import { ingestDmMessage } from '@/features/engagement/dm/ingest'
import { SupabaseInstagramDmRepository } from '@/features/engagement/dm/repository'
import { resolveInstagramBusinessId } from '@/features/engagement/dm/account-identity'
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification'
import { ensureInstagramWebhookSubscription } from '@/features/channels/oauth/ensure-webhook-subscription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const left = Buffer.from(supplied.slice(7))
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Reading and drafting for customers' accounts starts only when the operator turns the cycle on.
  if (process.env.ENGAGEMENT_CYCLE_ENABLED !== '1') {
    return NextResponse.json({ workspacesProcessed: 0, cycles: [], skipped: true })
  }

  try {
    const admin = createAdminSupabaseClient() as any
    const service = createEngagementService(admin)

    // Find active workspaces with connected Meta channels
    const { data: connections, error: connErr } = await admin
      .from('channel_connections')
      .select('id, workspace_id, channel, status, external_account_id, webhook_status, account_label, profile_metadata')
      .in('channel', ['instagram', 'threads'])
      .in('status', ['connected', 'verified', 'authorized'])

    const rawConnections = !connErr && Array.isArray(connections) ? connections : []
    const connectionsFound = rawConnections.length

    if (connErr || connectionsFound === 0) {
      const emptyStats = {
        connectionsFound,
        afterAllowlist: 0,
        workspaces: 0,
        perConnection: [],
      }
      console.warn('[engagement-run]', JSON.stringify(emptyStats))
      return NextResponse.json({
        workspacesProcessed: 0,
        cycles: [],
        ...emptyStats,
      })
    }

    const allowedConnections = filterAllowedConnections(rawConnections)
    const afterAllowlist = allowedConnections.length

    // Group connections by workspace
    const connectionsByWorkspace = new Map<string, typeof allowedConnections>()
    for (const conn of allowedConnections) {
      const existing = connectionsByWorkspace.get(conn.workspace_id) || []
      existing.push(conn)
      connectionsByWorkspace.set(conn.workspace_id, existing)
    }

    const cycles: Array<{
      workspaceId: string
      classified: number
      drafted: number
      autoSent: number
      skipped: number
    }> = []

    type PerConnectionReport = {
      channel: 'instagram' | 'threads'
      hasCredential: boolean
      hasCommentScope: boolean
      scopesCount: number
      ingested: number
      skippedReason: string | null
    }
    const perConnection: PerConnectionReport[] = []

    for (const [workspaceId, wsConns] of connectionsByWorkspace.entries()) {
      // 1. Ingest comments for each channel connection
      for (const conn of wsConns) {
        const channel = (conn.channel || '').toLowerCase() as 'instagram' | 'threads'
        if (channel !== 'instagram' && channel !== 'threads') {
          perConnection.push({
            channel: channel || 'instagram',
            hasCredential: false,
            hasCommentScope: false,
            scopesCount: 0,
            ingested: 0,
            skippedReason: 'unsupported_channel',
          })
          continue
        }

        try {
          const cred = await admin
            .from('meta_channel_credentials')
            .select('encrypted_access_token, access_token_iv, encryption_algorithm, granted_scopes')
            .eq('workspace_id', workspaceId)
            .eq('channel_connection_id', conn.id)
            .eq('status', 'active')
            .maybeSingle()

          if (!cred?.data) {
            console.warn(`[internal-engagement-run] No active credential found for connection ${conn.id} in workspace ${workspaceId}`)
            perConnection.push({
              channel,
              hasCredential: false,
              hasCommentScope: false,
              scopesCount: 0,
              ingested: 0,
              skippedReason: 'no_credential',
            })
            continue
          }

          const { decryptChannelCredential } = await import('@/lib/security/channel-credential-crypto')
          let decryptedToken: string
          try {
            decryptedToken = await decryptChannelCredential({
              ciphertext: cred.data.encrypted_access_token,
              iv: cred.data.access_token_iv,
              algorithm: cred.data.encryption_algorithm,
            }, process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? '')
          } catch (decryptErr) {
            console.warn(`[internal-engagement-run] Decryption failed for connection ${conn.id}:`, decryptErr)
            perConnection.push({
              channel,
              hasCredential: true,
              hasCommentScope: false,
              scopesCount: (cred.data.granted_scopes ?? []).length,
              ingested: 0,
              skippedReason: 'decrypt_failed',
            })
            continue
          }

          const normalizedScopes = normalizeChannelScopes(channel, cred.data.granted_scopes ?? [])
          const scopesCount = normalizedScopes.length

          if (channel === 'instagram') {
            await ensureInstagramWebhookSubscription({
              connection: conn,
              accessToken: decryptedToken,
              igUserId: conn.external_account_id || null,
            }).catch((webhookErr) => {
              console.warn('[webhook-ensure] unexpected error:', webhookErr)
            })
          }

          const hasCommentScope = channel === 'instagram'
            ? normalizedScopes.includes('instagram_business_manage_comments') || normalizedScopes.includes('instagram_manage_comments')
            : true

          if (hasCommentScope) {
            let ingested = 0
            let ingestSkippedReason: string | null = null
            try {
              const profileUsername = typeof (conn as any).profile_metadata === 'object' && (conn as any).profile_metadata !== null
                ? (conn as any).profile_metadata.username
                : undefined
              const effectiveUsername = typeof profileUsername === 'string' && profileUsername.trim()
                ? profileUsername.trim()
                : conn.account_label?.trim() || undefined

              const ingestRes = await ingestChannelComments({
                workspaceId,
                channelConnectionId: conn.id,
                channel,
                accessToken: decryptedToken,
                accountId: conn.external_account_id || '',
                accountHandle: conn.account_label?.trim() || undefined,
                accountUsername: effectiveUsername,
                repo: service.repo,
                maxCommentAgeDays: 7,
              })
              ingested = ingestRes.ingestedCount
              if (ingestRes.ingestedCount > 0) {
                console.warn(`[internal-engagement-run] Ingested ${ingestRes.ingestedCount} comments for ${channel} in workspace ${workspaceId}`)
              }
            } catch (ingestErr) {
              console.warn(`[internal-engagement-run] Ingest error for connection ${conn.id}:`, ingestErr)
              ingestSkippedReason = 'ingest_error'
            }

            perConnection.push({
              channel,
              hasCredential: true,
              hasCommentScope: true,
              scopesCount,
              ingested,
              skippedReason: ingestSkippedReason,
            })
          } else {
            console.warn(`[internal-engagement-run] Skipped comment ingestion for connection ${conn.id}: missing comment scope for ${channel}`)
            perConnection.push({
              channel,
              hasCredential: true,
              hasCommentScope: false,
              scopesCount,
              ingested: 0,
              skippedReason: 'missing_comment_scope',
            })
          }

          if (
            channel === 'instagram'
            && isEngagementFeatureOn('ENGAGEMENT_DM_INGEST_ENABLED', workspaceId)
            && normalizeChannelScopes('instagram', cred.data.granted_scopes ?? []).includes('instagram_manage_messages')
          ) {
              const dmRepo = new SupabaseInstagramDmRepository(admin)
              try {
                const metaApi = await import('@/lib/providers/meta-api')
                const identity = await resolveInstagramBusinessId(
                  { workspaceId, connectionId: conn.id, storedExternalAccountId: conn.external_account_id ?? null, accessToken: decryptedToken },
                  {
                    getProfileIds: ({ accessToken }) => metaApi.getInstagramProfileIds({ accessToken }),
                    updateExternalAccountId: async ({ workspaceId: ws, connectionId, externalAccountId }) => {
                      const { error } = await admin
                        .from('channel_connections')
                        .update({ external_account_id: externalAccountId })
                        .eq('workspace_id', ws)
                        .eq('id', connectionId)
                      return { ok: !error }
                    },
                  },
                )
                if (identity.status !== 'ok') {
                  console.warn('[internal-engagement-run] DM identity unavailable', identity.reason)
                } else {
                  const dm = await pollInstagramDms({
                    workspaceId,
                    channelConnectionId: conn.id,
                    businessIgId: identity.businessIgId,
                    accessToken: decryptedToken,
                    repo: dmRepo,
                    deps: {
                      listConversations: metaApi.listInstagramConversations,
                      listMessageIds: metaApi.listInstagramConversationMessageIds,
                      getMessage: metaApi.getInstagramMessage,
                      ingest: (dmInput) => {
                        const { projectInboundMessageToRecovery } = require('@/features/booking-recovery/inbound-projector')
                        return ingestDmMessage(
                          dmInput,
                          dmRepo,
                          new Date(),
                          async ({ workspaceId: wsId, threadId, message }) => {
                            await projectInboundMessageToRecovery(admin, {
                              workspaceId: wsId,
                              threadId,
                              message: {
                                id: message.id,
                                sender_type: message.sender_type,
                                sender_id: message.sender_id,
                                text: message.text,
                                sent_at: message.sent_at,
                              },
                            }).catch((err: any) => {
                              console.warn('[internal-engagement-run] recovery projection notice:', err)
                            })
                          }
                        )
                      },
                    },
                  })
                  console.warn('[internal-engagement-run] dm poll', JSON.stringify({ conversations: dm.conversations, ingested: dm.ingested, duplicates: dm.duplicates, skipped: dm.skipped, failures: dm.failures }))
                }
              } catch (dmErr) {
                console.warn(`[internal-engagement-run] DM poll warning for workspace ${workspaceId}:`, (dmErr as Error)?.message)
              }
            }
        } catch (ingestErr) {
          console.warn(`[internal-engagement-run] Ingest warning for workspace ${workspaceId}:`, ingestErr)
          perConnection.push({
            channel,
            hasCredential: false,
            hasCommentScope: false,
            scopesCount: 0,
            ingested: 0,
            skippedReason: 'ingest_warning',
          })
        }
      }

      // 2. Run engagement cycle
      try {
        const cycleRes = await service.runCycle(workspaceId)
        cycles.push({
          workspaceId,
          classified: cycleRes.classifiedCount,
          drafted: cycleRes.draftedCount,
          autoSent: cycleRes.autoSentCount,
          skipped: cycleRes.skippedCount,
        })
      } catch (cycleErr) {
        console.warn(`[internal-engagement-run] Cycle warning for workspace ${workspaceId}:`, cycleErr)
      }
    }

    const runStats = {
      connectionsFound,
      afterAllowlist,
      workspaces: connectionsByWorkspace.size,
      perConnection,
    }
    console.warn('[engagement-run]', JSON.stringify(runStats))

    return NextResponse.json({
      workspacesProcessed: cycles.length,
      cycles,
      connectionsFound: runStats.connectionsFound,
      afterAllowlist: runStats.afterAllowlist,
      workspaces: runStats.workspaces,
      perConnection: runStats.perConnection,
    })
  } catch (err: any) {
    console.error('[internal-engagement-run] Failed:', err)
    return NextResponse.json({ error: 'engagement_unavailable' }, { status: 503 })
  }
}
