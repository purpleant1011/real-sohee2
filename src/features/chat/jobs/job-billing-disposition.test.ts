import { describe, expect, it } from 'vitest'
import { decidePreparedJobBillingDisposition } from './job-billing-disposition'

describe('prepared conversation job billing disposition', () => {
  it('releases the full reservation for a collecting interview with no provider usage', () => {
    expect(decidePreparedJobBillingDisposition({
      responseOk: true,
      providerUsageCount: 0,
      clarificationStatus: 'collecting',
    })).toBe('release')
  })

  it('releases the full reservation for a ready interview summary with no provider usage', () => {
    expect(decidePreparedJobBillingDisposition({
      responseOk: true,
      providerUsageCount: 0,
      clarificationStatus: 'ready_to_generate',
    })).toBe('release')
  })

  it('settles actual provider usage even when the response also carries clarification state', () => {
    expect(decidePreparedJobBillingDisposition({
      responseOk: true,
      providerUsageCount: 1,
      clarificationStatus: 'collecting',
    })).toBe('settle_usage')
  })

  it('preserves the estimated-usage fallback for a completed response with missing provider usage', () => {
    expect(decidePreparedJobBillingDisposition({
      responseOk: true,
      providerUsageCount: 0,
      clarificationStatus: null,
    })).toBe('settle_usage')
  })

  it('releases credit for a failed response before provider completion', () => {
    expect(decidePreparedJobBillingDisposition({
      responseOk: false,
      providerUsageCount: 0,
      clarificationStatus: null,
    })).toBe('release')
  })
})
