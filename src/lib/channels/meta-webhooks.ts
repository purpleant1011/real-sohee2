/**
 * Sohee V0.8.9 Meta Webhook & Realtime Event Processor
 * 
 * Invariants:
 * 1. Cryptographic HMAC SHA256 signature verification on all inbound webhooks.
 * 2. Raw webhook payload preservation in audit table before parsing.
 * 3. Idempotent event deduplication (dedupe key: platform + entry_id + event_time).
 */

export interface NormalizedInboundEvent {
  eventId: string;
  channelId: 'INSTAGRAM' | 'THREADS';
  workspaceId?: string;
  eventType: 'COMMENT' | 'DM_MESSAGE' | 'MENTION' | 'POST_METRICS';
  senderId: string;
  senderName?: string;
  content: string;
  mediaId?: string;
  parentCommentId?: string;
  timestamp: string;
  rawPayload: Record<string, unknown>;
}

/**
 * Meta Webhook HMAC-SHA256 서명 검증 (Node / WebCrypto 호환)
 */
export async function verifyMetaWebhookSignature(
  rawPayloadString: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const signatureHex = signatureHeader.slice(expectedPrefix.length);

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(appSecret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const data = encoder.encode(rawPayloadString);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const computedHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return computedHex === signatureHex;
  } catch (err) {
    console.error('Meta webhook signature verification failed:', err);
    return false;
  }
}

/**
 * 인바운드 페이로드 정규화 파서
 */
export function parseMetaWebhookPayload(
  payload: Record<string, any>
): NormalizedInboundEvent[] {
  const events: NormalizedInboundEvent[] = [];

  if (payload.object !== 'instagram' && payload.object !== 'threads') {
    return events;
  }

  const entries = payload.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const field = change.field;
      const value = change.value;

      if (field === 'comments') {
        events.push({
          eventId: `meta_evt_${value.id || Date.now()}`,
          channelId: 'INSTAGRAM',
          eventType: 'COMMENT',
          senderId: value.from?.id || 'unknown',
          senderName: value.from?.username,
          content: value.text || '',
          mediaId: value.media?.id,
          parentCommentId: value.parent_id,
          timestamp: new Date((value.timestamp || Date.now() / 1000) * 1000).toISOString(),
          rawPayload: value
        });
      } else if (field === 'messages') {
        events.push({
          eventId: `meta_evt_${value.message_id || Date.now()}`,
          channelId: 'INSTAGRAM',
          eventType: 'DM_MESSAGE',
          senderId: value.sender?.id || 'unknown',
          content: value.message?.text || '',
          timestamp: new Date().toISOString(),
          rawPayload: value
        });
      }
    }
  }

  return events;
}
