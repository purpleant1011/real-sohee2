import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AccountReadinessMetric } from './account-readiness-metric'

describe('AccountReadinessMetric', () => {
  it('keeps an accessible static readiness value around the animated number', () => {
    render(<AccountReadinessMetric percentage={33} readyCount={2} />)

    expect(screen.getByLabelText('소희 준비도 33퍼센트')).toHaveTextContent('2/6 준비')
  })
})
