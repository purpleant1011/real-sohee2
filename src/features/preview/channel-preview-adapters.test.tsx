import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { channelPreviewAdapters } from './channel-preview-adapters'
import { ChannelPreview } from './channel-preview'

const ids = ['instagram', 'threads', 'naver_blog', 'daangn_business'] as const

describe('channel preview adapters', () => {
  it('registers the four channels with an input contract and required/optional fields', () => {
    expect(Object.keys(channelPreviewAdapters)).toEqual(ids)
    for (const id of ids) {
      expect(channelPreviewAdapters[id].id).toBe(id)
      expect(channelPreviewAdapters[id].requiredFields.length).toBeGreaterThan(0)
      expect(channelPreviewAdapters[id].optionalFields).toBeDefined()
    }
  })

  it('wraps existing Instagram and Threads preview renderers', () => {
    render(<>
      <ChannelPreview channel="instagram" variant={{ handle: '@가게', caption: '실제 인스타 글', hashtags: ['소식'], imageUrl: null }} />
      <ChannelPreview channel="threads" variant={{ handle: '@가게', caption: '실제 스레드 글', imageUrl: null }} />
    </>)
    expect(within(screen.getByRole('region', { name: '인스타그램 예상 화면' })).getByText('실제 인스타 글')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '스레드 예상 화면' })).getByText('실제 스레드 글')).toBeInTheDocument()
    expect(screen.getAllByText('실제 게시 화면과 다를 수 있어요.')).toHaveLength(2)
  })

  it.each(['naver_blog', 'daangn_business'] as const)('never fabricates %s preview content before an adapter is built', (channel) => {
    const view = render(<ChannelPreview channel={channel} />)
    expect(screen.getByText('준비 중')).toBeInTheDocument()
    expect(screen.getByText('실제 게시 화면과 다를 수 있어요.')).toBeInTheDocument()
    expect(view.container.querySelector('article')).toBeNull()
    expect(view.container.querySelector('img')).toBeNull()
  })
})
