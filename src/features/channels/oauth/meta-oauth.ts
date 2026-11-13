import { z } from 'zod'
export {
  isExtendedMetaScopeAllowed,
  canRequestExtendedMetaScope,
  type ExtendedMetaScopeGateInput,
} from './extended-scope-gate'

export type MetaOAuthChannel = 'instagram' | 'threads'
export type MetaOAuthFetch = (input: string, init?: RequestInit) => Promise<Response>
export type MetaOAuthFailureStage = 'token_exchange' | 'profile_lookup'
export type SafeMetaOAuthCallbackCode =
  | 'META_OAUTH_INTERNAL'
  | 'META_OAUTH_TOKEN_EXCHANGE'
  | 'META_OAUTH_ACCOUNT_LOOKUP'
  | 'META_OAUTH_PERSISTENCE'
  | 'SCOPE_MISSING'
  | 'SCOPE_VERIFICATION_UNAVAILABLE'
  | 'ACCOUNT_ALREADY_CONNECTED'
  | 'CONNECTION_SAVE_FAILED'

export class ScopeMissingError extends Error {
  readonly code = 'SCOPE_MISSING' as const
  constructor(message = 'SCOPE_MISSING: 필수 게시 권한이 필요합니다.') {
    super(message)
    this.name = 'ScopeMissingError'
  }
}

export class ScopeVerificationUnavailableError extends Error {
  readonly code = 'SCOPE_VERIFICATION_UNAVAILABLE' as const
  constructor(message = 'SCOPE_VERIFICATION_UNAVAILABLE: 권한을 확인할 수 없습니다.') {
    super(message)
    this.name = 'ScopeVerificationUnavailableError'
  }
}

export class DuplicateBindingError extends Error {
  readonly code = 'DUPLICATE_BINDING' as const
  constructor(message = 'DUPLICATE_BINDING: Account is already connected to another workspace') {
    super(message)
    this.name = 'DuplicateBindingError'
  }
}

const contracts = {
  instagram: {
    authorizationEndpoint: 'https://www.instagram.com/oauth/authorize',
    tokenEndpoint: 'https://api.instagram.com/oauth/access_token',
    exchangeEndpoint: 'https://graph.instagram.com/access_token',
    profileEndpoint: 'https://graph.instagram.com/v21.0/me?fields=id,user_id,username,name,account_type',
    // Only what the first-post lane uses today. Comment/DM/insight scopes are added together with their App Review (ANI-1504).
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  },
  threads: {
    authorizationEndpoint: 'https://threads.net/oauth/authorize',
    tokenEndpoint: 'https://graph.threads.net/oauth/access_token',
    exchangeEndpoint: 'https://graph.threads.net/access_token',
    profileEndpoint: 'https://graph.threads.net/v1.0/me?fields=id%2Cusername',
    debugEndpoint: 'https://graph.threads.net/v1.0/debug_token',
    // First-post login requests only reviewed read/publish scopes; reply access is checked separately.
    scopes: ['threads_basic', 'threads_content_publish'],
  },
} as const

export class MetaOAuthError extends Error {
  readonly code: 'AUTHORIZATION_REJECTED' | 'TEMPORARY_UNAVAILABLE' | 'INVALID_PROVIDER_RESPONSE'
  readonly stage: MetaOAuthFailureStage
  readonly diagnosticCode: string | null

  constructor(
    code: MetaOAuthError['code'],
    stage: MetaOAuthFailureStage = 'token_exchange',
    diagnosticCode: string | null = null,
  ) {
    super(`채널 계정 연결을 완료하지 못했습니다. (${code})`)
    this.name = 'MetaOAuthError'
    this.code = code
    this.stage = stage
    this.diagnosticCode = diagnosticCode
  }
}

export function toSafeMetaOAuthCallbackCode(
  error: unknown,
  fallback: SafeMetaOAuthCallbackCode,
): SafeMetaOAuthCallbackCode {
  if (error instanceof ScopeVerificationUnavailableError) return 'SCOPE_VERIFICATION_UNAVAILABLE'
  if (error instanceof ScopeMissingError) return 'SCOPE_MISSING'
  if (error instanceof DuplicateBindingError) return 'ACCOUNT_ALREADY_CONNECTED'
  if (error instanceof Error) {
    const msg = error.message || ''
    if (msg.includes('SCOPE_VERIFICATION_UNAVAILABLE') || (error as any).code === 'SCOPE_VERIFICATION_UNAVAILABLE') {
      return 'SCOPE_VERIFICATION_UNAVAILABLE'
    }
    if (msg.includes('SCOPE_MISSING') || (error as any).code === 'SCOPE_MISSING') {
      return 'SCOPE_MISSING'
    }
    if (msg.includes('DUPLICATE_BINDING') || msg.includes('이미 다른') || (error as any).code === 'DUPLICATE_BINDING') {
      return 'ACCOUNT_ALREADY_CONNECTED'
    }
  }
  if (!(error instanceof MetaOAuthError)) return fallback
  return error.stage === 'profile_lookup'
    ? 'META_OAUTH_ACCOUNT_LOOKUP'
    : 'META_OAUTH_TOKEN_EXCHANGE'
}

const tokenSchema = z.object({
  access_token: z.string().min(8).max(4096),
  expires_in: z.number().int().positive().max(31_536_000).optional(),
}).passthrough()
const threadsDebugTokenSchema = z.object({
  data: z.object({
    is_valid: z.boolean().optional(),
    scopes: z.array(z.string().min(1).max(200)),
    user_id: z.union([z.string(), z.number()]).transform(String).optional(),
  }).passthrough(),
}).passthrough()
const instagramPermissionsSchema = z.union([
  z.array(z.string().min(1).max(200)).min(1).max(50),
  z.string().min(1).max(2_000).transform((value) => value.split(',')),
]).transform((permissions) => permissions.map((scope) => scope.trim()).filter(Boolean))
const instagramShortTokenItemSchema = z.object({
  access_token: z.string().min(8).max(4096),
  user_id: z.union([z.string(), z.number()]).transform(String),
  permissions: instagramPermissionsSchema,
}).passthrough()
const instagramShortTokenSchema = z.union([
  instagramShortTokenItemSchema,
  z.object({ data: z.array(instagramShortTokenItemSchema).length(1) }).passthrough()
    .transform((value) => value.data[0]!),
])
const instagramProfileSchema = z.object({ user_id: z.union([z.string(), z.number()]).transform(String), username: z.string().min(1).max(120) }).passthrough()
const threadsProfileSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String), username: z.string().min(1).max(120) }).passthrough()

function failureForStatus(status: number) {
  return status >= 500 || status === 429 ? 'TEMPORARY_UNAVAILABLE' : 'AUTHORIZATION_REJECTED'
}

function safeProviderInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function oauthDiagnostic(status: number, payload: unknown): string {
  const error = typeof payload === 'object' && payload !== null
    ? (payload as { error?: unknown }).error
    : null
  const record = typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : {}
  return `META_HTTP_${status}_C${safeProviderInteger(record.code)}_S${safeProviderInteger(record.error_subcode)}`
}

async function safeJson(
  fetcher: MetaOAuthFetch,
  input: string,
  stage: MetaOAuthFailureStage,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(input, init)
  } catch {
    throw new MetaOAuthError('TEMPORARY_UNAVAILABLE', stage)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    if (!response.ok) {
      throw new MetaOAuthError(
        failureForStatus(response.status),
        stage,
        oauthDiagnostic(response.status, null),
      )
    }
    throw new MetaOAuthError('INVALID_PROVIDER_RESPONSE', stage)
  }
  if (!response.ok) {
    throw new MetaOAuthError(
      failureForStatus(response.status),
      stage,
      oauthDiagnostic(response.status, payload),
    )
  }
  return payload
}

export function createAuthorizationRequest(
  channel: MetaOAuthChannel,
  input: Readonly<{
    appId: string
    redirectUri: string
    state: string
    scopes?: readonly string[]
    extended?: boolean
  }>,
): URL {
  const contract = contracts[channel]
  const scopes = input.scopes ?? getMetaOAuthScopes(channel, { extended: input.extended })
  const url = new URL(contract.authorizationEndpoint)
  url.search = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: scopes.join(','),
    state: input.state,
  }).toString()
  // Meta replaced force_authentication with force_reauth (2025-06-14).
  // A cached Instagram session must not silently pick the previously connected account.
  if (channel === 'instagram') url.searchParams.set('force_reauth', 'true')
  return url
}

export async function exchangeAuthorizationCode(
  channel: MetaOAuthChannel,
  input: Readonly<{ appId: string; appSecret: string; code: string; redirectUri: string }>,
  fetcher: MetaOAuthFetch = fetch,
) {
  const contract = contracts[channel]
  const cleanCode = input.code.replace(/#_.*$/, '')
  const shortParams = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: cleanCode,
  })
  const shortPayload = await safeJson(fetcher, contract.tokenEndpoint, 'token_exchange', {
    method: 'POST',
    body: shortParams,
  })
  let shortAccessToken: string
  let grantedScopes: readonly string[]
  if (channel === 'instagram') {
    const parsed = instagramShortTokenSchema.safeParse(shortPayload)
    if (parsed.success) {
      grantedScopes = Object.freeze(parsed.data.permissions)
      shortAccessToken = parsed.data.access_token
      const { normalizeInstagramScopes } = await import('../dual-channel-verification')
      const normalizedGranted = normalizeInstagramScopes(grantedScopes)
      if (getMetaRequiredScopes(channel, 'read').some((scope) => !normalizedGranted.includes(scope))) {
        throw new ScopeMissingError('SCOPE_MISSING: 계정 조회 권한이 누락되었습니다.')
      }
    } else {
      const parsedGeneral = tokenSchema.safeParse(shortPayload)
      if (!parsedGeneral.success) throw new MetaOAuthError('INVALID_PROVIDER_RESPONSE', 'token_exchange')
      // A token is not evidence that any requested permission was granted.
      throw new ScopeMissingError('SCOPE_MISSING: 부여된 권한을 확인할 수 없습니다.')
    }
  } else {
    const parsed = tokenSchema.safeParse(shortPayload)
    if (!parsed.success) throw new MetaOAuthError('INVALID_PROVIDER_RESPONSE', 'token_exchange')
    shortAccessToken = parsed.data.access_token
    const rawScope = parsed.data.scope ?? parsed.data.permissions
    const scopeEvidence = instagramPermissionsSchema.safeParse(rawScope)
    if (scopeEvidence.success) {
      grantedScopes = Object.freeze(scopeEvidence.data)
    } else {
      const appAccessToken = input.appId.startsWith('TH|')
        ? input.appId
        : `TH|${input.appId}|${input.appSecret}`
      const debugUrl = new URL(contracts.threads.debugEndpoint)
      debugUrl.search = new URLSearchParams({
        access_token: appAccessToken,
        input_token: shortAccessToken,
      }).toString()
      let debugPayload: unknown
      try {
        debugPayload = await safeJson(fetcher, debugUrl.toString(), 'token_exchange')
      } catch {
        throw new ScopeVerificationUnavailableError('SCOPE_VERIFICATION_UNAVAILABLE: 권한을 확인할 수 없습니다.')
      }
      const parsedDebug = threadsDebugTokenSchema.safeParse(debugPayload)
      if (!parsedDebug.success || parsedDebug.data.data.is_valid === false) {
        throw new ScopeVerificationUnavailableError('SCOPE_VERIFICATION_UNAVAILABLE: 권한을 확인할 수 없습니다.')
      }
      grantedScopes = Object.freeze(parsedDebug.data.data.scopes)
    }
    if (getMetaRequiredScopes(channel, 'read').some((scope) => !grantedScopes.includes(scope))) {
      throw new ScopeMissingError('SCOPE_MISSING: 계정 조회 권한을 확인할 수 없습니다.')
    }
  }

  const exchange = new URL(contract.exchangeEndpoint)
  exchange.search = new URLSearchParams({
    grant_type: channel === 'instagram' ? 'ig_exchange_token' : 'th_exchange_token',
    client_secret: input.appSecret,
    access_token: shortAccessToken,
  }).toString()
  let longPayload: unknown
  try {
    longPayload = await safeJson(fetcher, exchange.toString(), 'token_exchange')
  } catch (err) {
    if (channel === 'instagram') {
      const fbExchange = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
      fbExchange.search = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: input.appId,
        client_secret: input.appSecret,
        fb_exchange_token: shortAccessToken,
      }).toString()
      longPayload = await safeJson(fetcher, fbExchange.toString(), 'token_exchange')
    } else {
      throw err
    }
  }
  const longToken = tokenSchema.safeParse(longPayload)
  if (!longToken.success) throw new MetaOAuthError('INVALID_PROVIDER_RESPONSE', 'token_exchange')

  const profilePayload = await safeJson(fetcher, contract.profileEndpoint, 'profile_lookup', {
    headers: { authorization: `Bearer ${longToken.data.access_token}` },
  })
  let externalAccountId: string
  let username: string
  if (channel === 'instagram') {
    const accountsData = profilePayload as any
    let discoveredIgId: string | null = null
    let discoveredUsername: string | null = null
    if (accountsData?.data && Array.isArray(accountsData.data)) {
      for (const page of accountsData.data) {
        if (page?.instagram_business_account?.id) {
          discoveredIgId = page.instagram_business_account.id
          discoveredUsername = page.instagram_business_account.username || page.instagram_business_account.name
          break
        }
      }
    }
    if (discoveredIgId) {
      externalAccountId = discoveredIgId
      username = discoveredUsername || discoveredIgId
    } else {
      const profile = instagramProfileSchema.safeParse(profilePayload)
      if (profile.success) {
        externalAccountId = profile.data.user_id
        username = profile.data.username
      } else {
        const idOnly = (profilePayload as any)?.id
        const nameOnly = (profilePayload as any)?.username || (profilePayload as any)?.name
        if (idOnly) {
          externalAccountId = String(idOnly)
          username = nameOnly || String(idOnly)
        } else {
          throw new MetaOAuthError('INVALID_PROVIDER_RESPONSE', 'profile_lookup')
        }
      }
    }
  } else {
    const profile = threadsProfileSchema.safeParse(profilePayload)
    if (!profile.success) throw new MetaOAuthError('INVALID_PROVIDER_RESPONSE', 'profile_lookup')
    externalAccountId = profile.data.id
    username = profile.data.username
  }
  return Object.freeze({
    accessToken: longToken.data.access_token,
    externalAccountId,
    accountLabel: `@${username}`,
    expiresInSeconds: longToken.data.expires_in ?? null,
    grantedScopes,
  })
}

export type MetaCredentialCapability = 'read' | 'publish' | 'comment_reply' | 'message' | 'reply'

export function getMetaRequiredScopes(channel: MetaOAuthChannel, capability: MetaCredentialCapability): readonly string[] {
  if (capability === 'read' || capability === 'publish') {
    return contracts[channel].scopes.slice(0, capability === 'read' ? 1 : 2)
  }
  if (channel === 'instagram' && capability === 'comment_reply') {
    return ['instagram_business_basic', 'instagram_business_manage_comments']
  }
  if (channel === 'instagram' && capability === 'message') {
    return ['instagram_business_basic', 'instagram_business_manage_messages']
  }
  if (channel === 'threads' && capability === 'reply') {
    return ['threads_basic', 'threads_content_publish', 'threads_manage_replies']
  }
  throw new Error('지원하지 않는 채널 기능입니다.')
}

export const META_EXTENDED_SCOPES = {
  instagram: [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages',
    'instagram_business_manage_insights',
  ],
  threads: [
    'threads_basic',
    'threads_content_publish',
    'threads_read_replies',
    'threads_manage_replies',
    'threads_manage_insights',
  ],
} as const

export function getMetaOAuthScopes(
  channel: MetaOAuthChannel,
  options?: boolean | { extended?: boolean },
): readonly string[] {
  const isExtended = typeof options === 'boolean' ? options : Boolean(options?.extended)
  if (isExtended) {
    return META_EXTENDED_SCOPES[channel]
  }
  return contracts[channel].scopes
}
