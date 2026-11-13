import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecoveryResult } from './contracts';

// Runtime validation of W4's serialized VerifiedDmDeliveryEvidence contract.
// A stage label or provider acknowledgement is not independent delivery proof.
const deliveryEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.literal('instagram'),
  providerMessageId: z.string().min(1),
  payloadFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  senderId: z.string().min(1),
  recipientRef: z.string().min(1),
  requestedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
}).strict();

const verifiedStepSchema = z.object({
  workspace_id: z.string().min(1),
  case_id: z.string().min(1),
  kind: z.enum(['SEND_DM_VERIFIED', 'RECONCILE_VERIFIED']),
  status: z.literal('COMPLETED'),
  input_fingerprint: z.string().min(1),
  provider_message_id: z.string().min(1),
  actor_id: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  evidence_ref: z.string().min(1),
}).passthrough();

export interface CustomerAcceptanceEvidenceInput {
  workspaceId: string;
  caseId: string;
  fingerprint: string;
  customerRef: string;
  senderId: string;
  latestCustomerMessageId: string | null;
  message: { id: string; senderId: string; senderType: string; sentAt: string };
  step: unknown;
  now?: string;
}

function unverified(): RecoveryResult<never> {
  return {
    ok: false,
    code: 'CONTEXT_REQUIRED',
    message: '고객에게 제안이 전달된 근거와 최신 답변을 확인한 뒤 예약 수락을 확인해 주세요.',
  };
}

export function verifyCustomerAcceptanceEvidence(
  input: CustomerAcceptanceEvidenceInput
): RecoveryResult<{ observedAt: string }> {
  const step = verifiedStepSchema.safeParse(input.step);
  if (!step.success) return unverified();

  let serialized: unknown;
  try {
    serialized = JSON.parse(step.data.evidence_ref);
  } catch {
    return unverified();
  }
  const evidence = deliveryEvidenceSchema.safeParse(serialized);
  if (!evidence.success) return unverified();
  const proof = evidence.data;

  if (
    !input.senderId.trim() ||
    step.data.workspace_id !== input.workspaceId || step.data.case_id !== input.caseId ||
    step.data.input_fingerprint !== input.fingerprint ||
    step.data.provider_message_id !== proof.providerMessageId ||
    proof.payloadFingerprint !== input.fingerprint || proof.senderId !== input.senderId ||
    proof.recipientRef !== input.customerRef || input.message.senderType !== 'customer' ||
    input.message.senderId !== input.customerRef ||
    input.latestCustomerMessageId !== input.message.id
  ) return unverified();

  const now = Date.parse(input.now ?? new Date().toISOString());
  const requested = Date.parse(proof.requestedAt);
  const observed = Date.parse(proof.observedAt);
  const recorded = Date.parse(step.data.occurred_at);
  const accepted = Date.parse(input.message.sentAt);
  if (
    ![now, requested, observed, recorded, accepted].every(Number.isFinite) ||
    requested > observed || observed > recorded || recorded > now ||
    accepted <= observed || accepted > now
  ) return unverified();

  return { ok: true, value: { observedAt: proof.observedAt } };
}

function lookupFailed(): RecoveryResult<never> {
  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: '전송 근거를 조회하지 못했습니다. 상태를 다시 확인해 주세요.',
  };
}

/** Read-only fresh evidence resolution; query errors are distinct from missing proof. */
export async function loadCustomerAcceptanceEvidence(
  client: SupabaseClient<any>,
  input: Omit<CustomerAcceptanceEvidenceInput, 'senderId' | 'latestCustomerMessageId' | 'step'> & { threadId: string }
): Promise<RecoveryResult<{ observedAt: string }>> {
  try {
    const { data: thread, error: threadError } = await client
      .from('instagram_dm_threads').select('channel_connection_id')
      .eq('workspace_id', input.workspaceId).eq('id', input.threadId).maybeSingle();
    if (threadError) return lookupFailed();
    if (!thread?.channel_connection_id) return unverified();

    const { data: channel, error: channelError } = await client
      .from('channel_connections').select('external_account_id')
      .eq('workspace_id', input.workspaceId).eq('id', thread.channel_connection_id).maybeSingle();
    if (channelError) return lookupFailed();
    if (!channel?.external_account_id) return unverified();

    const { data: step, error: stepError } = await client
      .from('booking_recovery_steps').select('*')
      .eq('workspace_id', input.workspaceId).eq('case_id', input.caseId)
      .eq('status', 'COMPLETED').eq('input_fingerprint', input.fingerprint)
      .in('kind', ['SEND_DM_VERIFIED', 'RECONCILE_VERIFIED'])
      .order('occurred_at', { ascending: false }).limit(1).maybeSingle();
    if (stepError) return lookupFailed();
    if (!step) return unverified();

    const { data: latest, error: latestError } = await client
      .from('instagram_dm_messages').select('id')
      .eq('workspace_id', input.workspaceId).eq('thread_id', input.threadId)
      .eq('sender_type', 'customer').eq('sender_id', input.customerRef)
      .order('sent_at', { ascending: false }).order('created_at', { ascending: false })
      .order('id', { ascending: false }).limit(1).maybeSingle();
    if (latestError) return lookupFailed();
    if (!latest) return unverified();

    return verifyCustomerAcceptanceEvidence({
      ...input, senderId: channel.external_account_id,
      step, latestCustomerMessageId: latest.id,
    });
  } catch {
    return lookupFailed();
  }
}
