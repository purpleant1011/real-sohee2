import type { MetaProviderDiagnosticCategory, MetaProviderDiagnosticCode } from './publish-provider'

export type MetaFetch = (input: string, init?: RequestInit) => Promise<Response>

type InstagramPublishInput = Readonly<{
  accountId: string
  signal?: AbortSignal
  accessToken: string
  caption: string
  imageUrls: readonly string[]
  isAiGenerated: boolean
  onContainerCreated?: (containerId: string) => Promise<void>
}>

type ThreadsPublishInput = Readonly<{
  accountId: string
  signal?: AbortSignal
  accessToken: string
  text: string
  imageUrls: readonly string[]
  onContainerCreated?: (containerId: string) => Promise<void>
}>

type DirectMessageInput = Readonly<{
  accountId: string
  signal?: AbortSignal
  recipientId: string
  accessToken: string
  text: string
}>

type ReplyInput = Readonly<{
  accountId: string
  signal?: AbortSignal
  targetId: string
  accessToken: string
  text: string
}>

type MetaIdResponse = Readonly<{ id: string }>
type MetaContainerState = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export class MetaProviderError extends Error {
  readonly code: 'RATE_LIMITED' | 'TOKEN_EXPIRED' | 'TEMPORARY_NETWORK' | 'RESULT_UNKNOWN' | 'PROVIDER_REJECTED'
  readonly diagnosticCode: MetaProviderDiagnosticCode | null

  constructor(code: MetaProviderError['code'], diagnosticCode: MetaProviderDiagnosticCode | string | null = null) {
    const detail = typeof diagnosticCode === 'string' ? `: ${diagnosticCode}` : ''
    super(`Meta 요청을 완료하지 못했습니다. (${code}${detail})`)
    this.name = 'MetaProviderError'
    this.code = code
    this.diagnosticCode = code === 'PROVIDER_REJECTED' && typeof diagnosticCode === 'string' && diagnosticCode.startsWith('META_') ? diagnosticCode as MetaProviderDiagnosticCode : null
  }
}

function safeProviderInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function providerDiagnostic(payload: unknown): MetaProviderDiagnosticCode | null {
  if (typeof payload !== 'object' || payload === null) return null
  const error = (payload as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const code = safeProviderInteger((error as { code?: unknown }).code)
  if (code === null) return null
  const subcode = safeProviderInteger((error as { error_subcode?: unknown }).error_subcode) ?? 0
  const category: MetaProviderDiagnosticCategory = code === 190
    ? 'AUTH'
    : [3, 10, 200].includes(code)
      ? 'PERMISSION'
      : [4, 17, 32, 613].includes(code)
        ? 'RATE_LIMIT'
        : [100, 36003].includes(code)
          ? 'VALIDATION'
          : 'CLIENT'
  return `META_C${code}_S${subcode}_${category}`
}

export function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,255}$/u.test(value)) throw new MetaProviderError('PROVIDER_REJECTED')
  return value
}

export function safeToken(value: string): string {
  if (value.length < 8 || value.length > 4096) throw new MetaProviderError('TOKEN_EXPIRED')
  return value
}

function safeText(value: string, max: number): string {
  if (value.length < 1 || value.length > max) throw new MetaProviderError('PROVIDER_REJECTED')
  return value
}

function safeImages(values: readonly string[], max = INSTAGRAM_MAX_MEDIA): readonly string[] {
  if (values.length > max) throw new MetaProviderError('PROVIDER_REJECTED')
  return values.map((value) => {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:') throw new Error('protocol')
      return parsed.toString()
    } catch {
      throw new MetaProviderError('PROVIDER_REJECTED')
    }
  })
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(15_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function requestId(
  fetcher: MetaFetch,
  url: string,
  body: URLSearchParams,
  accessToken: string,
  resultMayExist = false,
  signal?: AbortSignal,
): Promise<MetaIdResponse> {
  signal?.throwIfAborted()
  const token = safeToken(accessToken)
  let response: Response
  try {
    response = await fetcher(url, {
      method: 'POST',
      signal: requestSignal(signal),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
  } catch {
    console.error('[meta-provider-request] TRANSPORT_FAILED')
    throw new MetaProviderError(resultMayExist ? 'RESULT_UNKNOWN' : 'TEMPORARY_NETWORK')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MetaProviderError(resultMayExist && (response.ok || response.status >= 500)
      ? 'RESULT_UNKNOWN'
      : response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED', `json_err_HTTP_${response.status}_${url}`)
  }
  if (!response.ok || typeof payload !== 'object' || payload === null) {
    console.error(
      '[meta-provider-request]',
      `HTTP_${response.status}`,
      providerDiagnostic(payload) ?? 'NO_PROVIDER_DIAGNOSTIC',
    )
    if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
    if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
    throw new MetaProviderError(resultMayExist && (response.ok || response.status >= 500)
      ? 'RESULT_UNKNOWN'
      : response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED', providerDiagnostic(payload))
  }
  const id = (payload as { id?: unknown; message_id?: unknown }).id
    ?? (payload as { message_id?: unknown }).message_id
  if (typeof id !== 'string' || id.length === 0 || id.length > 500) {
    console.error('[meta-provider-request] INVALID_ID_RESPONSE')
    throw new MetaProviderError(resultMayExist ? 'RESULT_UNKNOWN' : 'PROVIDER_REJECTED')
  }
  return { id }
}

async function requestContainerState(
  fetcher: MetaFetch,
  url: string,
  accessToken: string,
  field: 'status' | 'status_code',
  signal?: AbortSignal,
): Promise<MetaContainerState> {
  signal?.throwIfAborted()
  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${safeToken(accessToken)}` },
      signal: requestSignal(signal),
      cache: 'no-store',
    })
  } catch {
    signal?.throwIfAborted()
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }
  signal?.throwIfAborted()
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MetaProviderError(response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED')
  }
  if (!response.ok || typeof payload !== 'object' || payload === null) {
    if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
    if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
    throw new MetaProviderError(response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED')
  }
  const state = (payload as Record<string, unknown>)[field]
  if (!['EXPIRED', 'ERROR', 'FINISHED', 'IN_PROGRESS', 'PUBLISHED'].includes(String(state))) {
    throw new MetaProviderError('PROVIDER_REJECTED')
  }
  return state as MetaContainerState
}

function safeDestinationUrl(channel: 'instagram' | 'threads', value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    const allowedHosts = channel === 'instagram'
      ? new Set(['instagram.com', 'www.instagram.com'])
      : new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'])
    return url.protocol === 'https:' && allowedHosts.has(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

async function requestPermalink(input: Readonly<{
  fetcher: MetaFetch
  base: string
  channel: 'instagram' | 'threads'
  providerPostId: string
  accessToken: string
}>): Promise<string | null> {
  try {
    const response = await input.fetcher(
      `${input.base}/${safeId(input.providerPostId)}?fields=permalink`,
      {
        headers: { authorization: `Bearer ${safeToken(input.accessToken)}` },
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      },
    )
    if (!response.ok) return null
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) return null
    return safeDestinationUrl(input.channel, (payload as { permalink?: unknown }).permalink)
  } catch {
    return null
  }
}

export async function getPublishedMetaPostPermalink(input: Readonly<{
  channel: 'instagram' | 'threads'
  providerPostId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<string | null> {
  return requestPermalink({
    fetcher: input.fetcher ?? fetch,
    base: input.channel === 'instagram'
      ? 'https://graph.instagram.com/v26.0'
      : 'https://graph.threads.net/v1.0',
    channel: input.channel,
    providerPostId: input.providerPostId,
    accessToken: input.accessToken,
  })
}

async function awaitContainerReady(input: Readonly<{
  fetcher: MetaFetch
  url: string
  accessToken: string
  field: 'status' | 'status_code'
  signal?: AbortSignal
  delay: (milliseconds: number) => Promise<void>
}>) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await requestContainerState(input.fetcher, input.url, input.accessToken, input.field, input.signal)
    input.signal?.throwIfAborted()
    if (state === 'FINISHED' || state === 'PUBLISHED') return
    if (state === 'ERROR' || state === 'EXPIRED') throw new MetaProviderError('PROVIDER_REJECTED')
    if (attempt < 29) await input.delay(1_000)
  }
  throw new MetaProviderError('TEMPORARY_NETWORK', `container_timeout_${input.url}`)
}

async function checkpointContainer(
  containerId: string,
  checkpoint: ((containerId: string) => Promise<void>) | undefined,
) {
  if (!checkpoint) return
  try {
    await checkpoint(safeId(containerId))
  } catch {
    throw new MetaProviderError('RESULT_UNKNOWN')
  }
}

function form(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries)
}

export function createInstagramProvider(
  fetcher: MetaFetch = fetch,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const base = 'https://graph.instagram.com/v26.0'
  return Object.freeze({
    async publish(input: InstagramPublishInput) {
      const accountId = safeId(input.accountId)
      const caption = safeText(input.caption, INSTAGRAM_MAX_TEXT_LENGTH)
      const imageUrls = safeImages(input.imageUrls)
      if (imageUrls.length === 0) throw new MetaProviderError('PROVIDER_REJECTED')

      let creationId: string
      if (imageUrls.length === 1) {
        creationId = (await requestId(fetcher, `${base}/${accountId}/media`, form({
          image_url: imageUrls[0]!,
          caption,
          ...(input.isAiGenerated ? { is_ai_generated: 'true' } : {}),
        }), input.accessToken, false, input.signal)).id
        await checkpointContainer(creationId, input.onContainerCreated)
        await awaitContainerReady({
          fetcher, url: `${base}/${safeId(creationId)}?fields=status_code`, accessToken: input.accessToken,
          field: 'status_code', delay, signal: input.signal,
        })
      } else {
        const children: string[] = []
        for (const imageUrl of imageUrls) {
          const child = (await requestId(fetcher, `${base}/${accountId}/media`, form({
            image_url: imageUrl,
            is_carousel_item: 'true',
          }), input.accessToken, false, input.signal)).id
          await awaitContainerReady({
            fetcher, url: `${base}/${safeId(child)}?fields=status_code`, accessToken: input.accessToken,
            field: 'status_code', delay, signal: input.signal,
          })
          children.push(child)
        }
        creationId = (await requestId(fetcher, `${base}/${accountId}/media`, form({
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption,
          ...(input.isAiGenerated ? { is_ai_generated: 'true' } : {}),
        }), input.accessToken, false, input.signal)).id
        await checkpointContainer(creationId, input.onContainerCreated)
        await awaitContainerReady({
          fetcher, url: `${base}/${safeId(creationId)}?fields=status_code`, accessToken: input.accessToken,
          field: 'status_code', delay, signal: input.signal,
        })
      }
      const published = await requestId(fetcher, `${base}/${accountId}/media_publish`, form({
        creation_id: creationId,
      }), input.accessToken, true, input.signal)
      const destinationUrl = await requestPermalink({
        fetcher,
        base,
        channel: 'instagram',
        providerPostId: published.id,
        accessToken: input.accessToken,
      })
      return Object.freeze({ providerPostId: published.id, destinationUrl })
    },

    async sendCommentReply(input: ReplyInput) {
      const result = await requestId(fetcher, `${base}/${safeId(input.targetId)}/replies`, form({
        message: safeText(input.text, 2_200),
      }), input.accessToken, true, input.signal)
      return Object.freeze({ providerReplyId: result.id })
    },

    async listComments(input: Readonly<{ mediaId: string; accessToken: string; limit?: number }>) {
      return listInstagramComments({ ...input, fetcher })
    },

    async getCommentReplyReadback(input: Readonly<{ replyId: string; accessToken: string }>) {
      return getInstagramCommentReplyReadback({ ...input, fetcher })
    },

    async sendDirectMessage(input: DirectMessageInput) {
      const result = await requestId(fetcher, `${base}/${safeId(input.accountId)}/messages`, form({
        recipient: JSON.stringify({ id: safeId(input.recipientId) }),
        message: JSON.stringify({ text: safeText(input.text, 1_000) }),
      }), input.accessToken, true, input.signal)
      return Object.freeze({ providerMessageId: result.id })
    },

    async getDirectMessageReadback(input: Readonly<{ messageId: string; accessToken: string }>) {
      return getInstagramDirectMessageReadback({ ...input, fetcher })
    },
  })
}

export function createThreadsProvider(
  fetcher: MetaFetch = fetch,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const base = 'https://graph.threads.net/v1.0'
  async function createAndPublish(input: ReplyInput | ThreadsPublishInput, replyToId?: string) {
    const imageUrls = safeImages('imageUrls' in input ? input.imageUrls : [], THREADS_MAX_MEDIA)
    const text = safeText('text' in input ? input.text : '', THREADS_MAX_TEXT_LENGTH)
    const isImage = imageUrls.length > 0
    const targetEndpoint = input.accountId && input.accountId !== 'anonymous' ? safeId(input.accountId) : 'me'
    const container = await requestId(fetcher, `${base}/${targetEndpoint}/threads`, form({
      media_type: isImage ? 'IMAGE' : 'TEXT',
      text,
      ...(isImage && imageUrls[0] ? { image_url: imageUrls[0] } : {}),
      ...(replyToId ? { reply_to_id: safeId(replyToId) } : {}),
    }), input.accessToken, false, input.signal)
    await checkpointContainer(container.id, 'onContainerCreated' in input ? input.onContainerCreated : undefined)
    await awaitContainerReady({
      fetcher, url: `${base}/${safeId(container.id)}?fields=status%2Cerror_message`, accessToken: input.accessToken,
      field: 'status', delay, signal: input.signal,
    })
    const published = await requestId(
      fetcher,
      `${base}/${targetEndpoint}/threads_publish`,
      form({ creation_id: container.id }),
      input.accessToken,
      true,
      input.signal,
    )
    return published.id
  }

  return Object.freeze({
    async publish(input: ThreadsPublishInput) {
      const providerPostId = await createAndPublish(input)
      const destinationUrl = await requestPermalink({
        fetcher,
        base,
        channel: 'threads',
        providerPostId,
        accessToken: input.accessToken,
      })
      return Object.freeze({ providerPostId, destinationUrl })
    },
    async sendReply(input: ReplyInput) {
      return Object.freeze({ providerReplyId: await createAndPublish({ ...input, accountId: 'me' }, input.targetId) })
    },
    async listReplies(input: Readonly<{ mediaId: string; accessToken: string; limit?: number }>) {
      return listThreadsReplies({ ...input, fetcher })
    },
    async getReplyReadback(input: Readonly<{ replyId: string; accessToken: string }>) {
      return getThreadsReplyReadback({ ...input, fetcher })
    },
  })
}

export type RecentPublishedMetaPost = Readonly<{
  id: string
  text: string
  timestamp: string
}>

export async function listRecentPublishedMetaPosts(input: Readonly<{
  channel: 'instagram' | 'threads'
  accountId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<readonly RecentPublishedMetaPost[]> {
  const fetcher = input.fetcher ?? fetch
  const accountId = safeId(input.accountId)
  const base = input.channel === 'instagram'
    ? 'https://graph.instagram.com/v26.0'
    : 'https://graph.threads.net/v1.0'
  const collection = input.channel === 'instagram' ? 'media' : 'threads'
  const textField = input.channel === 'instagram' ? 'caption' : 'text'
  const fields = encodeURIComponent(`id,${textField},timestamp`)
  const targetId = input.channel === 'threads' ? 'me' : accountId
  let response: Response
  try {
    response = await fetcher(`${base}/${targetId}/${collection}?fields=${fields}&limit=50`, {
      headers: { authorization: `Bearer ${safeToken(input.accessToken)}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MetaProviderError(response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED')
  }
  if (!response.ok || typeof payload !== 'object' || payload === null) {
    if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
    if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
    throw new MetaProviderError(
      response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED',
      providerDiagnostic(payload),
    )
  }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data) || data.length > 50) throw new MetaProviderError('PROVIDER_REJECTED')
  return data.map((row) => {
    if (typeof row !== 'object' || row === null) throw new MetaProviderError('PROVIDER_REJECTED')
    const id = (row as Record<string, unknown>).id
    const rawText = (row as Record<string, unknown>)[textField]
    const text = rawText == null ? '' : rawText
    const timestamp = (row as Record<string, unknown>).timestamp
    if (
      typeof id !== 'string'
      || typeof text !== 'string'
      || typeof timestamp !== 'string'
      || !Number.isFinite(Date.parse(timestamp))
    ) throw new MetaProviderError('PROVIDER_REJECTED')
    return Object.freeze({ id: safeId(id), text, timestamp })
  })
}

export type MetaComment = Readonly<{
  id: string
  text: string
  timestamp: string
  authorHandle: string
  authorId?: string
  parentId?: string
}>

export type MetaReplyReadbackResult = Readonly<{
  isLive: boolean
  replyId: string
  text?: string
  authorHandle?: string
  timestamp?: string
  observedAt: string
  error?: string
}>

export async function listInstagramComments(input: Readonly<{
  mediaId: string
  accessToken: string
  limit?: number
  fetcher?: MetaFetch
}>): Promise<readonly MetaComment[]> {
  const fetcher = input.fetcher ?? fetch
  const mediaId = safeId(input.mediaId)
  const token = safeToken(input.accessToken)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const base = 'https://graph.instagram.com/v26.0'
  const fields = encodeURIComponent('id,text,timestamp,username,from')
  const url = `${base}/${mediaId}/comments?fields=${fields}&limit=${limit}`

  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MetaProviderError(response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED')
  }

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
    if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
    throw new MetaProviderError(
      response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED',
      providerDiagnostic(payload),
    )
  }

  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) throw new MetaProviderError('PROVIDER_REJECTED')

  return data.map((row) => {
    if (typeof row !== 'object' || row === null) throw new MetaProviderError('PROVIDER_REJECTED')
    const rec = row as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id : ''
    const text = typeof rec.text === 'string' ? rec.text : ''
    const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : ''
    const fromObj = rec.from && typeof rec.from === 'object' ? (rec.from as Record<string, unknown>) : null
    const authorHandle = (typeof rec.username === 'string' && rec.username)
      || (typeof fromObj?.username === 'string' && fromObj.username)
      || 'anonymous'
    const authorId = typeof fromObj?.id === 'string' ? fromObj.id : undefined
    const parentId = typeof rec.parent_id === 'string'
      ? rec.parent_id
      : rec.parent && typeof rec.parent === 'object' && typeof (rec.parent as Record<string, unknown>).id === 'string'
        ? ((rec.parent as Record<string, unknown>).id as string)
        : undefined

    if (!id || !timestamp || !Number.isFinite(Date.parse(timestamp))) {
      throw new MetaProviderError('PROVIDER_REJECTED')
    }
    return Object.freeze({
      id: safeId(id),
      text,
      timestamp,
      authorHandle,
      authorId,
      parentId,
    })
  })
}

export async function getInstagramCommentReplyReadback(input: Readonly<{
  replyId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<MetaReplyReadbackResult> {
  const fetcher = input.fetcher ?? fetch
  const observedAt = new Date().toISOString()
  let replyId: string
  let token: string
  try {
    replyId = safeId(input.replyId)
    token = safeToken(input.accessToken)
  } catch (err: any) {
    return {
      isLive: false,
      replyId: input.replyId,
      observedAt,
      error: `Invalid identifier or token: ${err?.message || String(err)}`,
    }
  }

  const base = 'https://graph.instagram.com/v26.0'
  const fields = encodeURIComponent('id,text,timestamp,username,from')
  const url = `${base}/${replyId}?fields=${fields}`

  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      isLive: false,
      replyId,
      observedAt,
      error: 'Invalid JSON response from Meta Graph API readback',
    }
  }

  if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
  if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
  if (response.status >= 500) throw new MetaProviderError('TEMPORARY_NETWORK')

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    const errorMsg = (payload as any)?.error?.message || `HTTP ${response.status}`
    return {
      isLive: false,
      replyId,
      observedAt,
      error: `Meta Graph GET failed: ${errorMsg}`,
    }
  }

  const rec = payload as Record<string, unknown>
  const returnedId = typeof rec.id === 'string' ? rec.id : ''
  if (!returnedId || returnedId !== replyId) {
    return {
      isLive: false,
      replyId,
      observedAt,
      error: 'Readback id mismatch or missing in response',
    }
  }

  const fromObj = rec.from && typeof rec.from === 'object' ? (rec.from as Record<string, unknown>) : null
  const authorHandle = (typeof rec.username === 'string' && rec.username)
    || (typeof fromObj?.username === 'string' && fromObj.username)
    || undefined

  return {
    isLive: true,
    replyId: returnedId,
    text: typeof rec.text === 'string' ? rec.text : undefined,
    authorHandle,
    timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : undefined,
    observedAt,
  }
}

export async function listThreadsReplies(input: Readonly<{
  mediaId: string
  accessToken: string
  limit?: number
  fetcher?: MetaFetch
}>): Promise<readonly MetaComment[]> {
  const fetcher = input.fetcher ?? fetch
  const mediaId = safeId(input.mediaId)
  const token = safeToken(input.accessToken)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const base = 'https://graph.threads.net/v1.0'
  const fields = encodeURIComponent('id,text,timestamp,username')
  const url = `${base}/${mediaId}/replies?fields=${fields}&limit=${limit}`

  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MetaProviderError(response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED')
  }

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
    if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
    throw new MetaProviderError(
      response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED',
      providerDiagnostic(payload),
    )
  }

  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) throw new MetaProviderError('PROVIDER_REJECTED')

  return data.map((row) => {
    if (typeof row !== 'object' || row === null) throw new MetaProviderError('PROVIDER_REJECTED')
    const rec = row as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id : ''
    const text = typeof rec.text === 'string' ? rec.text : ''
    const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : ''
    const fromObj = rec.from && typeof rec.from === 'object' ? (rec.from as Record<string, unknown>) : null
    const authorHandle = (typeof rec.username === 'string' && rec.username)
      || (typeof fromObj?.username === 'string' && fromObj.username)
      || 'anonymous'
    const authorId = typeof fromObj?.id === 'string'
      ? fromObj.id
      : typeof rec.user_id === 'string'
        ? rec.user_id
        : undefined
    const parentId = typeof rec.parent_id === 'string'
      ? rec.parent_id
      : rec.parent && typeof rec.parent === 'object' && typeof (rec.parent as Record<string, unknown>).id === 'string'
        ? ((rec.parent as Record<string, unknown>).id as string)
        : undefined

    if (!id || !timestamp || !Number.isFinite(Date.parse(timestamp))) {
      throw new MetaProviderError('PROVIDER_REJECTED')
    }
    return Object.freeze({
      id: safeId(id),
      text,
      timestamp,
      authorHandle,
      authorId,
      parentId,
    })
  })
}

export async function getThreadsReplyReadback(input: Readonly<{
  replyId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<MetaReplyReadbackResult> {
  const fetcher = input.fetcher ?? fetch
  const observedAt = new Date().toISOString()
  let replyId: string
  let token: string
  try {
    replyId = safeId(input.replyId)
    token = safeToken(input.accessToken)
  } catch (err: any) {
    return {
      isLive: false,
      replyId: input.replyId,
      observedAt,
      error: `Invalid identifier or token: ${err?.message || String(err)}`,
    }
  }

  const base = 'https://graph.threads.net/v1.0'
  const fields = encodeURIComponent('id,text,timestamp,username')
  const url = `${base}/${replyId}?fields=${fields}`

  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      isLive: false,
      replyId,
      observedAt,
      error: 'Invalid JSON response from Threads Graph API readback',
    }
  }

  if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
  if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
  if (response.status >= 500) throw new MetaProviderError('TEMPORARY_NETWORK')

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    const errorMsg = (payload as any)?.error?.message || `HTTP ${response.status}`
    return {
      isLive: false,
      replyId,
      observedAt,
      error: `Threads Graph GET failed: ${errorMsg}`,
    }
  }

  const rec = payload as Record<string, unknown>
  const returnedId = typeof rec.id === 'string' ? rec.id : ''
  if (!returnedId || returnedId !== replyId) {
    return {
      isLive: false,
      replyId,
      observedAt,
      error: 'Readback id mismatch or missing in response',
    }
  }

  return {
    isLive: true,
    replyId: returnedId,
    text: typeof rec.text === 'string' ? rec.text : undefined,
    authorHandle: typeof rec.username === 'string' ? rec.username : undefined,
    timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : undefined,
    observedAt,
  }
}

export interface MetaMessageReadbackResult {
  readonly isLive: boolean
  readonly messageId: string
  readonly senderId?: string
  readonly recipientId?: string
  readonly text?: string
  readonly timestamp?: string
  readonly observedAt: string
  readonly error?: string
}

export async function sendInstagramDirectMessage(input: Readonly<{
  pageId: string
  recipientId: string
  accessToken: string
  text: string
  fetcher?: MetaFetch
}>): Promise<Readonly<{ providerMessageId: string }>> {
  const fetcher = input.fetcher ?? fetch
  const base = 'https://graph.instagram.com/v26.0'
  const result = await requestId(fetcher, `${base}/${safeId(input.pageId)}/messages`, form({
    recipient: JSON.stringify({ id: safeId(input.recipientId) }),
    message: JSON.stringify({ text: safeText(input.text, 1_000) }),
  }), safeToken(input.accessToken))
  return Object.freeze({ providerMessageId: result.id })
}

export async function getInstagramDirectMessageReadback(input: Readonly<{
  messageId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<MetaMessageReadbackResult> {
  const fetcher = input.fetcher ?? fetch
  const observedAt = new Date().toISOString()
  let messageId: string
  let token: string
  try {
    messageId = safeId(input.messageId)
    token = safeToken(input.accessToken)
  } catch (err: any) {
    return {
      isLive: false,
      messageId: input.messageId,
      observedAt,
      error: `Invalid identifier or token: ${err?.message || String(err)}`,
    }
  }

  const base = 'https://graph.instagram.com/v26.0'
  const fields = encodeURIComponent('id,message,created_time,from,to')
  const url = `${base}/${messageId}?fields=${fields}`

  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      isLive: false,
      messageId,
      observedAt,
      error: 'Invalid JSON response from Meta Graph API message readback',
    }
  }

  if (response.status === 429) throw new MetaProviderError('RATE_LIMITED')
  if (response.status === 401 || response.status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
  if (response.status >= 500) throw new MetaProviderError('TEMPORARY_NETWORK')

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    return {
      isLive: false,
      messageId,
      observedAt,
      error: `Meta Graph message GET failed (HTTP ${response.status})`,
    }
  }

  const rec = payload as Record<string, unknown>
  const returnedId = typeof rec.id === 'string' ? rec.id : ''
  if (!returnedId || returnedId !== messageId) {
    return {
      isLive: false,
      messageId,
      observedAt,
      error: 'Readback id mismatch or missing in response',
    }
  }

  const from = typeof rec.from === 'object' && rec.from !== null ? rec.from as Record<string, unknown> : null
  const to = typeof rec.to === 'object' && rec.to !== null ? rec.to as Record<string, unknown> : null
  const recipients = Array.isArray(to?.data) ? to.data : []
  const recipient = recipients.length === 1 && typeof recipients[0] === 'object' && recipients[0] !== null
    ? recipients[0] as Record<string, unknown> : null
  if (typeof from?.id !== 'string' || !from.id || typeof recipient?.id !== 'string' || !recipient.id ||
    typeof rec.message !== 'string' || !rec.message || !dmTimeToIso(rec.created_time)) {
    return { isLive: false, messageId, observedAt, error: 'Incomplete independent message evidence' }
  }
  return {
    isLive: true,
    messageId: returnedId,
    senderId: from.id,
    recipientId: recipient.id,
    text: rec.message,
    timestamp: typeof rec.created_time === 'string' ? rec.created_time : undefined,
    observedAt,
  }
}

import {
  INSTAGRAM_MAX_MEDIA,
  INSTAGRAM_MAX_TEXT_LENGTH,
  THREADS_MAX_MEDIA,
  THREADS_MAX_TEXT_LENGTH,
} from '@/features/publishing/meta-content-text'

export type MetaDmConversation = Readonly<{ id: string; updatedTime: string }>
export type MetaDmMessageRef = Readonly<{ id: string; createdAt: string }>
export type MetaDmMessage = Readonly<{
  id: string
  createdAt: string
  text: string
  fromId: string
  fromUsername?: string
  toId: string
}>

function dmTimeToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 1e12 ? value : value * 1000).toISOString()
  }
  if (typeof value === 'string' && value.length > 0) {
    // Graph returns "+0000" offsets, which Date.parse rejects in some runtimes.
    const normalized = value.replace(/([+-]\d{2})(\d{2})$/u, '$1:$2')
    const ms = Date.parse(normalized)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  return null
}

async function dmGetJson(fetcher: MetaFetch, url: string, token: string): Promise<{ ok: boolean; status: number; payload: unknown }> {
  let response: Response
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    if (response.ok) throw new MetaProviderError('PROVIDER_REJECTED')
  }
  return { ok: response.ok, status: response.status, payload }
}

function throwDmProviderError(status: number, payload: unknown): never {
  if (status === 429) throw new MetaProviderError('RATE_LIMITED')
  if (status === 401 || status === 403) throw new MetaProviderError('TOKEN_EXPIRED')
  throw new MetaProviderError(
    status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED',
    providerDiagnostic(payload),
  )
}

export async function listInstagramConversations(input: Readonly<{
  accessToken: string
  limit?: number
  fetcher?: MetaFetch
}>): Promise<readonly MetaDmConversation[]> {
  const fetcher = input.fetcher ?? fetch
  const token = safeToken(input.accessToken)
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50)
  const url = `https://graph.instagram.com/v26.0/me/conversations?platform=instagram&fields=${encodeURIComponent('id,updated_time')}&limit=${limit}`
  const { ok, status, payload } = await dmGetJson(fetcher, url, token)
  if (!ok || typeof payload !== 'object' || payload === null) throwDmProviderError(status, payload)
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) throw new MetaProviderError('PROVIDER_REJECTED')
  const rows: MetaDmConversation[] = []
  for (const row of data) {
    if (typeof row !== 'object' || row === null) continue
    const rec = row as Record<string, unknown>
    const updatedTime = dmTimeToIso(rec.updated_time)
    if (typeof rec.id !== 'string' || !rec.id || !updatedTime) continue
    rows.push(Object.freeze({ id: safeId(rec.id), updatedTime }))
  }
  return rows
}

export async function listInstagramConversationMessageIds(input: Readonly<{
  conversationId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<readonly MetaDmMessageRef[]> {
  const fetcher = input.fetcher ?? fetch
  const token = safeToken(input.accessToken)
  const url = `https://graph.instagram.com/v26.0/${safeId(input.conversationId)}?fields=messages`
  const { ok, status, payload } = await dmGetJson(fetcher, url, token)
  if (!ok || typeof payload !== 'object' || payload === null) throwDmProviderError(status, payload)
  const data = (payload as { messages?: { data?: unknown } }).messages?.data
  if (data === undefined) return []
  if (!Array.isArray(data)) throw new MetaProviderError('PROVIDER_REJECTED')
  const refs: MetaDmMessageRef[] = []
  for (const row of data) {
    if (typeof row !== 'object' || row === null) continue
    const rec = row as Record<string, unknown>
    const createdAt = dmTimeToIso(rec.created_time)
    if (typeof rec.id !== 'string' || !rec.id || !createdAt) continue
    refs.push(Object.freeze({ id: rec.id, createdAt }))
  }
  return refs
}

export async function getInstagramMessage(input: Readonly<{
  messageId: string
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<MetaDmMessage | null> {
  const fetcher = input.fetcher ?? fetch
  const token = safeToken(input.accessToken)
  const fields = encodeURIComponent('id,created_time,from,to,message')
  const url = `https://graph.instagram.com/v26.0/${safeId(input.messageId)}?fields=${fields}`
  const { ok, status, payload } = await dmGetJson(fetcher, url, token)
  if (!ok) {
    // Only the latest 20 messages per conversation have details; older ones answer with a 4xx.
    if (status === 400 || status === 404) return null
    throwDmProviderError(status, payload)
  }
  if (typeof payload !== 'object' || payload === null) throw new MetaProviderError('PROVIDER_REJECTED')
  const rec = payload as Record<string, unknown>
  const createdAt = dmTimeToIso(rec.created_time)
  const from = rec.from && typeof rec.from === 'object' ? (rec.from as Record<string, unknown>) : null
  const toData = (rec.to as { data?: unknown } | undefined)?.data
  const to = Array.isArray(toData) && toData[0] && typeof toData[0] === 'object'
    ? (toData[0] as Record<string, unknown>)
    : null
  if (typeof rec.id !== 'string' || !createdAt || typeof from?.id !== 'string' || typeof to?.id !== 'string') {
    throw new MetaProviderError('PROVIDER_REJECTED')
  }
  return Object.freeze({
    id: rec.id,
    createdAt,
    text: typeof rec.message === 'string' ? rec.message : '',
    fromId: from.id,
    fromUsername: typeof from.username === 'string' ? from.username : undefined,
    toId: to.id,
  })
}

export type MetaInstagramProfileIds = Readonly<{
  appScopedId: string | null
  professionalId: string | null
  username: string | null
}>

export async function getInstagramProfileIds(input: Readonly<{
  accessToken: string
  fetcher?: MetaFetch
}>): Promise<MetaInstagramProfileIds> {
  const fetcher = input.fetcher ?? fetch
  const token = safeToken(input.accessToken)
  const url = `https://graph.instagram.com/v26.0/me?fields=${encodeURIComponent('id,user_id,username')}`
  const { ok, status, payload } = await dmGetJson(fetcher, url, token)
  if (!ok || typeof payload !== 'object' || payload === null) throwDmProviderError(status, payload)
  const root = payload as Record<string, unknown>
  // The documented example wraps the object in `data: [...]`; the live API returns it at the top level.
  const rec = Array.isArray(root.data) && root.data[0] && typeof root.data[0] === 'object'
    ? (root.data[0] as Record<string, unknown>)
    : root
  const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number') && String(value) ? String(value) : null
  return Object.freeze({
    appScopedId: text(rec.id),
    professionalId: text(rec.user_id),
    username: typeof rec.username === 'string' ? rec.username : null,
  })
}


