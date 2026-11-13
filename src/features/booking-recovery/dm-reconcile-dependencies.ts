import type { AttemptedSendEvidence, ReconcileDependencies } from './reconcile';
import type { BookingRecoveryRepository, RecoveryOutboxItem } from './repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovedReplyDto } from './approved-reply';
import { validateApprovedReply } from './approval-binding';
import { loadChannelCredential } from '@/features/channels/credential-repository';
import { getInstagramDirectMessageReadback } from '@/lib/providers/meta-api';

/** Never selects the latest arbitrary message/step to reconcile an older operation. */
export function createDmReconcileDependencies(
  repository: BookingRecoveryRepository,
  client: SupabaseClient<any>
): ReconcileDependencies {
  async function loadCredential(workspaceId: string, caseId: string) {
    const caseItem = await repository.getCase(workspaceId, caseId);
    if (!caseItem || caseItem.id !== caseId || caseItem.workspace_id !== workspaceId) return null;
    const { data: thread, error } = await client.from('instagram_dm_threads')
      .select('id, workspace_id, channel_connection_id')
      .eq('workspace_id', workspaceId).eq('id', caseItem.source_thread_id).maybeSingle();
    if (error || !thread || thread.workspace_id !== workspaceId || !thread.channel_connection_id) return null;
    const credential = await loadChannelCredential(workspaceId, thread.channel_connection_id, 'instagram');
    if (!credential.externalAccountId || !credential.accessToken) return null;
    return { caseItem, credential };
  }

  async function loadAttemptedSend(item: RecoveryOutboxItem): Promise<AttemptedSendEvidence | null> {
    try {
      if (item.kind !== 'SEND_DM') return null;
      const key = item.source_event_key;
      const { data: step, error: stepError } = await client.from('booking_recovery_steps')
        .select('workspace_id, case_id, kind, idempotency_key, input_fingerprint, actor_id, provider_message_id')
        .eq('workspace_id', item.workspace_id).eq('case_id', item.case_id)
        .eq('kind', 'SEND_DM').eq('idempotency_key', key).maybeSingle();
      if (stepError || !step || !step.actor_id || !step.input_fingerprint) return null;
      const { data: started, error: startedError } = await client.from('booking_recovery_steps')
        .select('actor_id, input_fingerprint, occurred_at')
        .eq('workspace_id', item.workspace_id).eq('case_id', item.case_id)
        .eq('kind', 'SEND_DM_REQUESTED').eq('idempotency_key', `${key}:started`).maybeSingle();
      if (startedError || !started || started.actor_id !== step.actor_id ||
        started.input_fingerprint !== step.input_fingerprint) return null;
      const { data: proposal, error: proposalError } = await client.from('booking_recovery_proposals')
        .select('*').eq('workspace_id', item.workspace_id).eq('case_id', item.case_id)
        .eq('payload_fingerprint', step.input_fingerprint).maybeSingle();
      // Nullable field added by the v2 persistence consumer; legacy rows remain unverified.
      const reply = proposal?.approved_reply_snapshot as ApprovedReplyDto | undefined;
      if (proposalError || !reply || reply.proposalId !== proposal.id || reply.revision !== proposal.revision ||
        reply.workspaceId !== item.workspace_id || reply.caseId !== item.case_id ||
        !validateApprovedReply(reply, step.input_fingerprint, new Date(started.occurred_at)) ||
        key !== `recovery:${item.case_id}:send:${reply.sourceMessageId}:${reply.fingerprint}`) return null;
      const { data: approval, error: approvalError } = await client.from('booking_recovery_approvals')
        .select('approved_by, approved_at, expires_at, source_message_id')
        .eq('workspace_id', item.workspace_id).eq('case_id', item.case_id)
        .eq('step_kind', 'SEND').eq('payload_fingerprint', reply.fingerprint)
        .eq('approved_by', step.actor_id).order('approved_at', { ascending: false }).limit(1).maybeSingle();
      if (approvalError || !approval || approval.source_message_id !== reply.sourceMessageId ||
        !(Date.parse(approval.approved_at) <= Date.parse(started.occurred_at)) ||
        !(Date.parse(approval.expires_at) > Date.parse(started.occurred_at))) return null;
      const { data: member, error: memberError } = await client.from('workspace_members')
        .select('role').eq('workspace_id', item.workspace_id).eq('user_id', step.actor_id)
        .eq('status', 'active').maybeSingle();
      if (memberError || !member || !['owner', 'manager'].includes(member.role)) return null;
      const connection = await loadCredential(item.workspace_id, item.case_id);
      if (!connection || connection.caseItem.customer_ref !== reply.recipientRef) return null;
      return {
        reply: structuredClone(reply), providerMessageId: step.provider_message_id || null,
        senderId: connection.credential.externalAccountId!, requestedAt: started.occurred_at,
        actor: { workspaceId: item.workspace_id, userId: step.actor_id, role: member.role },
      };
    } catch {
      return null;
    }
  }

  return {
    repository, client, loadAttemptedSend,
    readbackFetcher: async ({ workspaceId, caseId, sourceEventKey, attemptedSend }) => {
      if (!attemptedSend || attemptedSend.reply.workspaceId !== workspaceId ||
        attemptedSend.reply.caseId !== caseId || !attemptedSend.providerMessageId ||
        sourceEventKey !== `recovery:${caseId}:send:${attemptedSend.reply.sourceMessageId}:${attemptedSend.reply.fingerprint}`) {
        return { verified: false, reason: '원본 전송 식별자 확인 필요' };
      }
      const connection = await loadCredential(workspaceId, caseId);
      if (!connection || connection.credential.externalAccountId !== attemptedSend.senderId) {
        return { verified: false, reason: '원래 발신 계정 확인 필요' };
      }
      const evidence = await getInstagramDirectMessageReadback({
        messageId: attemptedSend.providerMessageId, accessToken: connection.credential.accessToken,
      });
      return {
        verified: evidence.isLive, providerMessageId: evidence.messageId,
        text: evidence.text, recipientRef: evidence.recipientId, senderId: evidence.senderId,
        observedAt: evidence.observedAt,
      };
    },
  };
}
