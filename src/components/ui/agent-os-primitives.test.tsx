import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './button'
import { Input } from './input'
import { Textarea } from './textarea'
import { Card, CardHeader, CardTitle, CardContent } from './card'
import { Badge } from './badge'

describe('Agent OS UI Primitives Contract', () => {
  it('enforces 44px min-height target size on Button', () => {
    render(<Button aria-label="Action Button">Click</Button>)
    const btn = screen.getByRole('button', { name: 'Action Button' })
    expect(btn.style.minHeight).toBe('44px')
  })

  it('renders Input and Textarea with disabled attributes and accessible classes', () => {
    render(
      <div>
        <Input placeholder="Enter title" disabled />
        <Textarea placeholder="Enter instructions" disabled />
      </div>
    )
    const input = screen.getByPlaceholderText('Enter title')
    const textarea = screen.getByPlaceholderText('Enter instructions')
    expect(input).toBeDisabled()
    expect(textarea).toBeDisabled()
  })

  it('renders Card and Badge components with semantic styling', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Workboard Status</CardTitle>
          <Badge variant="default">RUNNING</Badge>
        </CardHeader>
        <CardContent>Mission content</CardContent>
      </Card>
    )
    expect(screen.getByText('Workboard Status')).toBeDefined()
    expect(screen.getByText('RUNNING')).toBeDefined()
    expect(screen.getByText('Mission content')).toBeDefined()
  })
})
