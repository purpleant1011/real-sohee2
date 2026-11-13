import { z } from 'zod'

export type MetaInsightsChannel = 'instagram' | 'threads'
export type MetaInsightsFetch = (input: string, init?: RequestInit) => Promise<Response>
export type SocialMetricName =
  | 'views'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'replies'
  | 'reposts'
  | 'quotes'
  | 'visits'
  | 'inquiries'
export type SocialMetricState =
  | 'available'
  | 'no_data'
  | 'not_supported'
  | 'permission_denied'
  | 'failed'

export type MetaInsightMetric = Readonly<{
  metric: SocialMetricName
  state: SocialMetricState
  value: number | null
}>

export type MetaInsightCollection = Readonly<{
  channel: MetaInsightsChannel
  metrics: readonly MetaInsightMetric[]
}>

export class MetaInsightsError extends Error {
  readonly code:
    | 'PERMISSION_DENIED'
    | 'RATE_LIMITED'
    | 'TEMPORARY_UNAVAILABLE'
    | 'INVALID_PROVIDER_RESPONSE'

  constructor(code: MetaInsightsError['code']) {
    super(`채널 성과를 수집하지 못했습니다. (${code})`)
    this.name = 'MetaInsightsError'
    this.code = code
  }
}

const contracts = {
  instagram: {
    baseUrl: 'https://graph.instagram.com/v26.0',
    supported: ['views', 'likes', 'comments', 'saved', 'shares'],
    unsupported: ['visits', 'inquiries'],
  },
  threads: {
    baseUrl: 'https://graph.threads.com/v1.0',
    supported: ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'],
    unsupported: ['comments', 'saved', 'visits', 'inquiries'],
  },
} as const satisfies Readonly<Record<MetaInsightsChannel, Readonly<{
  baseUrl: string
  supported: readonly SocialMetricName[]
  unsupported: readonly SocialMetricName[]
}>>>

const metricRowSchema = z.object({
  name: z.string(),
  values: z.array(z.object({ value: z.number().int().nonnegative().safe() }).passthrough()).optional(),
  total_value: z.object({ value: z.number().int().nonnegative().safe() }).passthrough().optional(),
}).passthrough()
const responseSchema = z.object({ data: z.array(metricRowSchema) }).passthrough()

function safeProviderPostId(value: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9._:-]{1,500}$/u.test(normalized)) {
    throw new MetaInsightsError('INVALID_PROVIDER_RESPONSE')
  }
  return normalized
}

function safeAccessToken(value: string): string {
  if (value.length < 8 || value.length > 4096 || /[\r\n]/u.test(value)) {
    throw new MetaInsightsError('PERMISSION_DENIED')
  }
  return value
}

function providerError(status: number): MetaInsightsError {
  if (status === 401 || status === 403) return new MetaInsightsError('PERMISSION_DENIED')
  if (status === 429) return new MetaInsightsError('RATE_LIMITED')
  return new MetaInsightsError(status >= 500
    ? 'TEMPORARY_UNAVAILABLE'
    : 'INVALID_PROVIDER_RESPONSE')
}

export async function collectMetaPostInsights(
  input: Readonly<{
    channel: MetaInsightsChannel
    providerPostId: string
    accessToken: string
    fetcher?: MetaInsightsFetch
  }>,
): Promise<MetaInsightCollection> {
  const contract = contracts[input.channel]
  const url = new URL(`${contract.baseUrl}/${safeProviderPostId(input.providerPostId)}/insights`)
  url.searchParams.set('metric', contract.supported.join(','))

  let response: Response
  try {
    response = await (input.fetcher ?? fetch)(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${safeAccessToken(input.accessToken)}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaInsightsError('TEMPORARY_UNAVAILABLE')
  }
  if (!response.ok) throw providerError(response.status)

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new MetaInsightsError('INVALID_PROVIDER_RESPONSE')
  }
  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) throw new MetaInsightsError('INVALID_PROVIDER_RESPONSE')

  const valueByMetric = new Map<string, number>()
  for (const row of parsed.data.data) {
    const value = row.total_value?.value ?? row.values?.at(-1)?.value
    if (value !== undefined) valueByMetric.set(row.name, value)
  }
  const metrics: MetaInsightMetric[] = [
    ...contract.supported.map((metric) => {
      const value = valueByMetric.get(metric)
      return Object.freeze(value === undefined
        ? { metric, state: 'no_data' as const, value: null }
        : { metric, state: 'available' as const, value })
    }),
    ...contract.unsupported.map((metric) => Object.freeze({
      metric,
      state: 'not_supported' as const,
      value: null,
    })),
  ]
  return Object.freeze({ channel: input.channel, metrics: Object.freeze(metrics) })
}
