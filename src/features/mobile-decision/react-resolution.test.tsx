import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

function Counter() {
  const [count, setCount] = React.useState(0)
  return <Button asChild><button type="button" onClick={() => setCount(value => value + 1)}>검토 {count}</button></Button>
}
it('keeps React hooks and Radix Slot state in the same renderer', () => {
  render(<Counter />)
  fireEvent.click(screen.getByRole('button', { name: '검토 0' }))
  expect(screen.getByRole('button', { name: '검토 1' })).toBeVisible()
})
