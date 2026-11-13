import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HomeDashboardMetricsCards } from './home-dashboard-summary'
afterEach(cleanup)
it('does not display an unknown legacy metric as observed zero', () => {
  const unknown = { value: null, unit: '건', subtext: '근거 없음', hasError: false }
  render(<HomeDashboardMetricsCards metrics={{ activeTasks: { ...unknown, label: '진행' }, published: { ...unknown, label: '게시' }, confirmedBookings: { ...unknown, label: '예약' } }} />)
  expect(screen.queryAllByText('0건')).toHaveLength(0)
  expect(screen.getAllByText('아직 확인할 수 없어요')).toHaveLength(3)
})
