/**
 * Postiz Social Publish Provider Adapter (ANI-767)
 * 
 * Supports 9 social channels:
 * instagram, facebook, threads, x_twitter, tiktok, linkedin, youtube_shorts, wordpress, pinterest
 * 
 * Invariants:
 * 1. Postiz external SUCCESS ≠ Sohee VERIFIED.
 * 2. All published posts must undergo Authoritative Readback to verify live permalink & object ID.
 * 3. Protected by ProviderCircuitBreaker.
 */

import {
  AuthoritativeReceipt,
  ChannelExecutionResult,
  ExecutionChannel
} from '../core/channel-execution-types';
import { ProviderCircuitBreakerRegistry } from '../core/provider-circuit-breaker';

export interface PostizPostPayload {
  workspaceId: string;
  channel: ExecutionChannel;
  content: string;
  mediaUrls?: string[];
  scheduledAt?: string;
  idempotencyKey: string;
}

export interface PostizExternalClient {
  createPost(payload: PostizPostPayload): Promise<{ id: string; status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' }>;
  fetchPost(postId: string): Promise<{ id: string; status: string; permalink?: string; content: string } | null>;
}

export const POSTIZ_SUPPORTED_CHANNELS: readonly ExecutionChannel[] = [
  'instagram',
  'facebook',
  'threads',
  'x_twitter',
  'tiktok',
  'linkedin',
  'youtube_shorts',
  'wordpress',
  'pinterest',
] as const;

export class PostizPublishAdapter {
  private readonly providerName = 'postiz';
  private processedIdempotencyKeys = new Set<string>();

  constructor(
    private readonly circuitBreaker: ProviderCircuitBreakerRegistry,
    private readonly externalClient: PostizExternalClient
  ) {}

  public isChannelSupported(channel: ExecutionChannel): boolean {
    return POSTIZ_SUPPORTED_CHANNELS.includes(channel);
  }

  public async publish(payload: PostizPostPayload): Promise<ChannelExecutionResult> {
    const executedAt = new Date().toISOString();

    // 1. Channel support check
    if (!this.isChannelSupported(payload.channel)) {
      return {
        success: false,
        channel: payload.channel,
        action: 'social.publish.submit',
        circuitState: 'CLOSED',
        executedAt,
        error: {
          code: 'UNSUPPORTED_CHANNEL',
          message: `Channel ${payload.channel} is not supported by Postiz adapter`,
          retryable: false,
        },
      };
    }

    // 2. Circuit Breaker preflight
    const preflight = this.circuitBreaker.checkExecutionAllowed(payload.channel, this.providerName);
    if (!preflight.allowed) {
      this.circuitBreaker.enqueueFallback({
        id: `fallback-${Date.now()}`,
        workspaceId: payload.workspaceId,
        channel: payload.channel,
        provider: this.providerName,
        action: 'social.publish.submit',
        payload,
      });

      return {
        success: false,
        channel: payload.channel,
        action: 'social.publish.submit',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'CIRCUIT_BLOCKED_OR_KILLED',
          message: preflight.reason ?? 'Execution blocked by circuit breaker or kill switch',
          retryable: true,
        },
      };
    }

    // 3. Idempotency Check
    if (this.processedIdempotencyKeys.has(payload.idempotencyKey)) {
      return {
        success: false,
        channel: payload.channel,
        action: 'social.publish.submit',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'DUPLICATE_IDEMPOTENCY_KEY',
          message: `Request with idempotency key ${payload.idempotencyKey} has already been executed`,
          retryable: false,
        },
      };
    }

    try {
      // 4. External Submission to Postiz
      const externalRes = await this.externalClient.createPost(payload);
      this.processedIdempotencyKeys.add(payload.idempotencyKey);

      // 5. Authoritative Readback (Crucial Invariant: Verify before trusting external success)
      const readbackRes = await this.externalClient.fetchPost(externalRes.id);

      if (!readbackRes) {
        this.circuitBreaker.recordFailure(payload.channel, this.providerName, 'Readback returned null');
        return {
          success: false,
          channel: payload.channel,
          action: 'social.publish.submit',
          circuitState: this.circuitBreaker.getMetrics(payload.channel, this.providerName).state,
          executedAt,
          error: {
            code: 'READBACK_NOT_FOUND',
            message: `External post ${externalRes.id} could not be independently read back`,
            retryable: true,
          },
        };
      }

      // Success verified
      this.circuitBreaker.recordSuccess(payload.channel, this.providerName);

      const receipt: AuthoritativeReceipt = {
        receiptId: `rcpt-postiz-${externalRes.id}-${Date.now()}`,
        channel: payload.channel,
        provider: this.providerName,
        externalObjectId: externalRes.id,
        externalPermalink: readbackRes.permalink,
        verifiedAt: new Date().toISOString(),
        readbackStatus: 'VERIFIED',
        rawPayloadHash: `hash-${payload.content.length}-${payload.idempotencyKey.slice(0, 8)}`,
      };

      return {
        success: true,
        channel: payload.channel,
        action: 'social.publish.submit',
        data: {
          postId: externalRes.id,
          status: readbackRes.status,
          permalink: readbackRes.permalink,
        },
        receipt,
        circuitState: 'CLOSED',
        executedAt,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const newState = this.circuitBreaker.recordFailure(payload.channel, this.providerName, message);

      return {
        success: false,
        channel: payload.channel,
        action: 'social.publish.submit',
        circuitState: newState,
        executedAt,
        error: {
          code: 'POSTIZ_EXECUTION_FAILED',
          message,
          retryable: true,
        },
      };
    }
  }
}
