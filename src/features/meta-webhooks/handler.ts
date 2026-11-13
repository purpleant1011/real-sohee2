export type MetaWebhookProvider = 'instagram' | 'threads'
export type MetaWebhookCategory = 'comment' | 'reply' | 'mention' | 'dm'

export type NormalizedMetaEvent = Readonly<{
  eventKey: string
  provider: MetaWebhookProvider
  category: MetaWebhookCategory
  providerEventId: string | null
  instagramAccountId: string | null
  externalAccountId: string
  externalSubjectId: string | null
  providerPostReference: string | null
  occurredAt: string
  payload: Readonly<Record<string, unknown>>
  payloadSha256: string
}>

export type MetaWebhookOptions = Readonly<{
  provider: MetaWebhookProvider
  verifyToken?: string
  appSecret?: string
  eventStore: { record(events: readonly NormalizedMetaEvent[]): Promise<void> }
}>

const encoder = new TextEncoder()
const maxBodyBytes = 1024 * 1024

function textResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function matchesSecret(received: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(received), sha256(expected)])
  let mismatch = left.length ^ right.length
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function verifySignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature || !/^sha256=[0-9a-f]{64}$/u.test(signature)) return false
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const bytes = new Uint8Array(signature.slice(7).match(/.{2}/gu)!.map((pair) => Number.parseInt(pair, 16)))
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(rawBody))
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 ? value : null
}

function eventText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 10_000 ? value : null
}

function extractAuthorHandle(value: Record<string, unknown>): string | null {
  const fromObj = object(value.from)
  const fromUsername = fromObj?.username
  if (typeof fromUsername === 'string' && fromUsername.length > 0 && fromUsername.length <= 100) {
    return fromUsername
  }
  const directUsername = value.username
  if (typeof directUsername === 'string' && directUsername.length > 0 && directUsername.length <= 100) {
    return directUsername
  }
  return null
}

function occurredAt(value: unknown): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric
  return new Date(milliseconds).toISOString()
}

function providerPostReference(value: Record<string, unknown>): string | null {
  return string(object(value.media)?.id)
    ?? string(value.media_id)
    ?? string(object(value.replied_to)?.id)
    ?? string(object(value.root_post)?.id)
    ?? string(object(value.post)?.id)
}

async function normalize(
  provider: MetaWebhookProvider,
  rawBody: string,
  payload: Record<string, unknown>,
): Promise<readonly NormalizedMetaEvent[]> {
  const rawDigest = await sha256(rawBody)
  const events: NormalizedMetaEvent[] = []
  for (const [entryIndex, rawEntry] of array(payload.entry).entries()) {
    const entry = object(rawEntry)
    if (!entry) continue
    const accountId = string(entry.id)
    if (!accountId) continue
    const entryTime = entry.time
    for (const [changeIndex, rawChange] of array(entry.changes).entries()) {
      const change = object(rawChange)
      const value = object(change?.value)
      const field = string(change?.field)
      if (!change || !value || !field) continue
      let category: MetaWebhookCategory | null = null
      if (provider === 'instagram' && (field === 'comments' || field === 'live_comments')) category = 'comment'
      if (provider === 'instagram' && field === 'mentions') category = 'mention'
      if (provider === 'threads' && field === 'replies') category = 'reply'
      if (provider === 'threads' && field === 'mentions') category = 'mention'
      if (!category) continue
      const eventId = string(value.id) ?? (category === 'mention' ? string(value.comment_id) : null)
      const targetId = providerPostReference(value)
      const handle = (category === 'comment' || category === 'reply') ? extractAuthorHandle(value) : null
      const minimalPayload = Object.freeze({
        id: eventId,
        text: eventText(value.text),
        targetId,
        ...(handle !== null ? { authorHandle: handle } : {}),
      })
      const eventKeySuffix = eventId ?? `${rawDigest}:${entryIndex}:${changeIndex}`
      events.push(Object.freeze({
        eventKey: `${provider}:${category}:${eventKeySuffix}`,
        provider,
        category,
        providerEventId: eventId,
        instagramAccountId: provider === 'instagram' ? accountId : null,
        externalAccountId: accountId,
        externalSubjectId: string(value.from) ?? string(object(value.from)?.id),
        providerPostReference: targetId,
        occurredAt: occurredAt(value.timestamp ?? entryTime),
        payload: minimalPayload,
        payloadSha256: await sha256(JSON.stringify(minimalPayload)),
      }))
    }
    if (provider === 'instagram') {
      for (const [messageIndex, rawMessage] of array(entry.messaging).entries()) {
        const message = object(rawMessage)
        const body = object(message?.message)
        if (!message || !body) continue
        const eventId = string(body.mid)
        const senderId = string(object(message.sender)?.id)
        const recipientId = string(object(message.recipient)?.id)
        const isEcho = body.is_echo === true
        const isSelf = body.is_self === true
        const isDeleted = body.is_deleted === true
        const minimalPayload = Object.freeze({
          id: eventId,
          text: eventText(body.text),
          targetId: null,
          recipientId,
          isEcho,
          isSelf,
          isDeleted,
        })
        const eventKeySuffix = eventId ?? `${rawDigest}:${entryIndex}:message:${messageIndex}`
        events.push(Object.freeze({
          eventKey: `instagram:dm:${eventKeySuffix}`,
          provider: 'instagram',
          category: 'dm',
          providerEventId: eventId,
          instagramAccountId: accountId,
          externalAccountId: accountId,
          // For an echo the customer is the recipient; for an inbound DM the customer is the sender.
          externalSubjectId: isEcho ? recipientId : senderId,
          providerPostReference: null,
          occurredAt: occurredAt(message.timestamp ?? entryTime),
          payload: minimalPayload,
          payloadSha256: await sha256(JSON.stringify(minimalPayload)),
        }))
      }
    }
  }
  return Object.freeze(events)
}

export async function handleMetaWebhook(request: Request, options: MetaWebhookOptions): Promise<Response> {
  if (request.method === 'GET') {
    if (!options.verifyToken) return textResponse('Service unavailable', 503)
    const url = new URL(request.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode !== 'subscribe' || token === null || challenge === null || challenge.length > 500) {
      return textResponse('Forbidden', 403)
    }
    return await matchesSecret(token, options.verifyToken)
      ? textResponse(challenge, 200)
      : textResponse('Forbidden', 403)
  }
  if (request.method !== 'POST') return textResponse('Method Not Allowed', 405)
  if (!options.appSecret) return textResponse('Service unavailable', 503)

  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const bytes = Number(declaredLength)
    if (!Number.isSafeInteger(bytes) || bytes < 0) return textResponse('Bad Request', 400)
    if (bytes > maxBodyBytes) return textResponse('Payload Too Large', 413)
  }

  const rawBody = await request.text()
  if (!(await verifySignature(rawBody, request.headers.get('x-hub-signature-256'), options.appSecret))) {
    return textResponse('Unauthorized', 401)
  }
  if (encoder.encode(rawBody).byteLength > maxBodyBytes) return textResponse('Payload Too Large', 413)
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return textResponse('Bad Request', 400)
  }
  const payload = object(parsed)
  if (!payload) return textResponse('Bad Request', 400)
  const events = await normalize(options.provider, rawBody, payload)
  try {
    if (events.length > 0) await options.eventStore.record(events)
  } catch {
    return textResponse('Webhook storage failed', 500)
  }
  return textResponse('EVENT_RECEIVED', 200)
}
