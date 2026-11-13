export const officialNaverLoginUrl = 'https://nid.naver.com/nidlogin.login'

export type NaverCapability = 'local_connector' | 'manual_assist_only' | 'unsupported'

export type NaverConnectionSummary = Readonly<{
  accountLabel: string | null
  placeCapability: NaverCapability
  blogCapability: NaverCapability
  lastVerifiedAt: string | null
  reauthRequired: boolean
}>

export function createNaverConnectionSummary(input: NaverConnectionSummary): NaverConnectionSummary {
  return Object.freeze({ ...input })
}
