export type KakaoUnlinkReferrerType =
  | 'ACCOUNT_DELETE'
  | 'FORCED_ACCOUNT_DELETE'
  | 'UNLINK_FROM_ADMIN'
  | 'UNLINK_FROM_APPS'
  | 'INCOMPLETE_SIGN_UP'
  | (string & {})

export interface KakaoUnlinkPayload {
  readonly appId: string
  readonly userId: string
  readonly referrerType: KakaoUnlinkReferrerType
  readonly groupUserToken?: string
}

export type KakaoUnlinkHandler = (
  userId: string,
  payload: KakaoUnlinkPayload,
) => Promise<void> | void

export interface IdempotencyStore {
  has(key: string): boolean | Promise<boolean>
  set(key: string): void | Promise<void>
}

export interface KakaoWebhookProcessResult {
  readonly status: number
  readonly body: {
    readonly ok: boolean
    readonly code: string
    readonly message?: string
    readonly idempotencyKey?: string
    readonly duplicate?: boolean
  }
}

export interface HandleKakaoWebhookOptions {
  readonly authHeader?: string | null
  readonly secret?: string | null
  readonly rawBody?: unknown
  readonly onUnlinked?: KakaoUnlinkHandler
  readonly idempotencyStore?: IdempotencyStore
}
