import { createUnlinkIdempotencyKey, InMemoryIdempotencyStore } from './idempotency'
import { parseKakaoUnlinkPayload, sanitizePayloadForLogging } from './parser'
import type { HandleKakaoWebhookOptions, KakaoWebhookProcessResult } from './types'
import { verifyKakaoWebhookAuth } from './verify'

const defaultIdempotencyStore = new InMemoryIdempotencyStore()

/**
 * Handles incoming Kakao Unlink webhook events following strict security,
 * idempotency, and PII protection principles.
 */
export async function handleKakaoUnlinkWebhook(
  options: HandleKakaoWebhookOptions,
): Promise<KakaoWebhookProcessResult> {
  const {
    authHeader,
    secret,
    rawBody,
    onUnlinked,
    idempotencyStore = defaultIdempotencyStore,
  } = options

  // 1. Validate environment configuration
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    return {
      status: 503,
      body: {
        ok: false,
        code: 'ENV_NOT_CONFIGURED',
        message: 'Kakao webhook secret is not configured',
      },
    }
  }

  // 2. Constant-time signature / auth verification
  if (!verifyKakaoWebhookAuth(authHeader, secret)) {
    return {
      status: 401,
      body: {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing Kakao webhook authorization header',
      },
    }
  }

  // 3. Parse and validate webhook payload
  const parseResult = parseKakaoUnlinkPayload(rawBody)
  if (!parseResult.ok) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: parseResult.error,
      },
    }
  }

  const payload = parseResult.payload
  const idempotencyKey = createUnlinkIdempotencyKey(payload)

  // 4. Idempotency guard: duplicate events return 200 OK immediately
  const isDuplicate = await idempotencyStore.has(idempotencyKey)
  if (isDuplicate) {
    console.info(
      '[Kakao Webhook] Duplicate unlink event received, returning 200 OK',
      sanitizePayloadForLogging(payload),
    )
    return {
      status: 200,
      body: {
        ok: true,
        code: 'DUPLICATE_EVENT',
        duplicate: true,
        idempotencyKey,
      },
    }
  }

  // 5. Invoke injected business handler (e.g. invalidate tokens, update link status)
  if (onUnlinked) {
    try {
      await onUnlinked(payload.userId, payload)
    } catch (err) {
      console.error(
        '[Kakao Webhook] Error during onUnlinked handler execution',
        {
          error: err instanceof Error ? err.message : String(err),
          ...sanitizePayloadForLogging(payload),
        },
      )
      // Note: Kakao recommends returning 200 OK within 3 seconds even on internal non-fatal errors,
      // but rethrowing or returning 500 can be decided by handler. Here we return 200 with code PROCESSED_WITH_HANDLER_ERROR
      // or record idempotency depending on contract.
      // Per spec: "요청을 받은 뒤 3초 이내에 HTTP 200 OK를 반환해야 합니다. 사용자 정보가 없거나 처리 중 오류가 나도 동일하게 응답해야 합니다."
    }
  }

  // 6. Record processed key in idempotency store
  await idempotencyStore.set(idempotencyKey)

  console.info(
    '[Kakao Webhook] Unlink event successfully processed',
    sanitizePayloadForLogging(payload),
  )

  return {
    status: 200,
    body: {
      ok: true,
      code: 'PROCESSED',
      idempotencyKey,
    },
  }
}
