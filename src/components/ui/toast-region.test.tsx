import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SoheeToastRegion, soheeToastQueue } from './toast-region'

describe('SoheeToastRegion', () => {
  it('announces a queued success message', async () => {
    render(<SoheeToastRegion />)
    soheeToastQueue.add({ title: '일정을 변경했어요.', description: '확인한 콘텐츠는 그대로 유지돼요.' })

    expect(await screen.findByText('일정을 변경했어요.')).toBeInTheDocument()
    expect(screen.getByText('확인한 콘텐츠는 그대로 유지돼요.')).toBeInTheDocument()
  })
})
