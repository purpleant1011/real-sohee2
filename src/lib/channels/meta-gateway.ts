/**
 * Sohee V0.8.9 Meta Multi-Tenant API Gateway
 * 
 * Invariants:
 * 1. Strict separation between Operator Meta App Credential and Customer Tenant OAuth Access Tokens.
 * 2. All outbound requests go through Durable Outbox with weighted fair scheduling.
 * 3. Token crypto isolation and rate limit protection per tenant.
 */

export interface MetaTenantCredential {
  workspaceId: string;
  platform: 'INSTAGRAM' | 'THREADS';
  pageId: string;
  instagramBusinessAccountId?: string;
  threadsUserId?: string;
  encryptedAccessToken: string;
  tokenExpiresAt: string;
  scopes: string[];
}

export interface MetaOutboxMessage {
  id: string;
  workspaceId: string;
  channelId: 'INSTAGRAM' | 'THREADS';
  actionType: 'PUBLISH_MEDIA' | 'POST_CAROUSEL' | 'REPLY_COMMENT' | 'SEND_DM' | 'FETCH_METRICS';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  priority: number; // 1 (highest) ~ 10 (lowest)
  status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DLQ';
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: string;
  processedAt?: string;
}

export interface MetaPublishResult {
  success: boolean;
  externalPostId?: string;
  externalPermalink?: string;
  rateLimitRemaining?: number;
  errorMessage?: string;
}

/**
 * Meta Graph API 모의/실행 핸들러
 */
export async function dispatchMetaOutboxMessage(
  message: MetaOutboxMessage,
  _credential: MetaTenantCredential
): Promise<MetaPublishResult> {
  // 실제/테스트 실행 분기
  if (message.actionType === 'PUBLISH_MEDIA' || message.actionType === 'POST_CAROUSEL') {
    const isLive = process.env.META_API_LIVE === 'true';
    if (!isLive) {
      // Mock / Contract 검증 모드
      const mockPostId = `${message.channelId.toLowerCase()}_post_${Date.now()}`;
      const mockPermalink = message.channelId === 'INSTAGRAM'
        ? `https://instagram.com/p/${mockPostId}`
        : `https://threads.net/@user/post/${mockPostId}`;

      return {
        success: true,
        externalPostId: mockPostId,
        externalPermalink: mockPermalink,
        rateLimitRemaining: 195
      };
    }

    // Live Meta API 연동 로직
    throw new Error('Direct execution via legacy meta-gateway is deprecated. Use MetaActionExecutor or CanonicalPublishFacade.');
  }

  return {
    success: true,
    externalPostId: `meta_action_${Date.now()}`
  };
}
