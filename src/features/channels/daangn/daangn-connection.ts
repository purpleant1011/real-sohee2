export const officialDaangnBusinessLoginUrl = 'https://business.daangn.com/'

export type DaangnBusinessProfile = Readonly<{
  accountLabel: string | null
  externalProfileId: string | null
  region: string | null
  introductionState: 'ready' | 'needs_information'
  recentNewsCount: number | null
  capability: 'local_connector' | 'manual_assist_only' | 'unsupported'
  lastVerifiedAt: string | null
  reauthState: 'user_login_required' | 'verification_required'
}>

export function createDaangnBusinessProfile(input: DaangnBusinessProfile): DaangnBusinessProfile {
  return Object.freeze({ ...input })
}
