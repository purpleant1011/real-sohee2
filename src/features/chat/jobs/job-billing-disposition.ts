import type { ContentInterviewState } from '../content-interview'

export function decidePreparedJobBillingDisposition(input: Readonly<{
  responseOk: boolean
  providerUsageCount: number
  clarificationStatus: ContentInterviewState['status'] | null
}>): 'settle_usage' | 'release' {
  if (!Number.isSafeInteger(input.providerUsageCount) || input.providerUsageCount < 0) {
    throw new Error('PROVIDER_USAGE_COUNT_INVALID')
  }
  if (input.providerUsageCount > 0) return 'settle_usage'
  if (!input.responseOk) return 'release'
  if (input.clarificationStatus !== null) return 'release'
  return 'settle_usage'
}
