import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MobileUiProvider, useMobileUi } from './mobile-ui-provider'
function Probe() { return <p>{useMobileUi().enabled ? 'new' : 'legacy'}</p> }
it('defaults to legacy without a server supplied rollout decision', () => {
  render(<Probe />)
  expect(screen.getByText('legacy')).toBeVisible()
})
it('carries only the server supplied presentation boolean', () => {
  render(<MobileUiProvider enabled><Probe /></MobileUiProvider>)
  expect(screen.getByText('new')).toBeVisible()
})
