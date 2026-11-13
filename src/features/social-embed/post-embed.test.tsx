import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PostEmbed } from './post-embed'

describe('PostEmbed', () => {
  afterEach(cleanup)

  describe('When embed URL is available (Instagram / Threads)', () => {
    const instagramUrl = 'https://www.instagram.com/p/Cxyz123/'
    const threadsUrl = 'https://threads.net/@sohee/post/THREAD123'

    it('renders closed by default with "게시물 미리 보기" toggle and no iframe', () => {
      render(<PostEmbed permalink={instagramUrl} />)

      const toggleButton = screen.getByRole('button', { name: '게시물 미리 보기' })
      expect(toggleButton).toBeInTheDocument()
      expect(screen.queryByTitle(/인스타그램 게시물 미리 보기|게시물 미리 보기/)).not.toBeInTheDocument()
      expect(document.querySelector('iframe')).toBeNull()
    })

    it('loads iframe only when expanded and hides it when collapsed', () => {
      render(<PostEmbed permalink={instagramUrl} />)

      const toggleButton = screen.getByRole('button', { name: '게시물 미리 보기' })
      fireEvent.click(toggleButton)

      expect(screen.getByRole('button', { name: '접기' })).toBeInTheDocument()
      const iframe = document.querySelector('iframe')
      expect(iframe).not.toBeNull()
      expect(iframe).toHaveAttribute('src', 'https://www.instagram.com/p/Cxyz123/embed')
      expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups')
      expect(iframe).toHaveAttribute('loading', 'lazy')
      expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
      expect(iframe).toHaveAttribute('title', '인스타그램 게시물 미리 보기')
      expect(iframe).toHaveAttribute('height', '480')

      // collapse again
      fireEvent.click(screen.getByRole('button', { name: '접기' }))
      expect(screen.getByRole('button', { name: '게시물 미리 보기' })).toBeInTheDocument()
      expect(document.querySelector('iframe')).toBeNull()
    })

    it('renders Korean title for threads iframe when expanded', () => {
      render(<PostEmbed permalink={threadsUrl} />)

      fireEvent.click(screen.getByRole('button', { name: '게시물 미리 보기' }))
      const iframe = document.querySelector('iframe')
      expect(iframe).not.toBeNull()
      expect(iframe).toHaveAttribute('src', 'https://www.threads.com/@sohee/post/THREAD123/embed')
      expect(iframe).toHaveAttribute('title', '스레드 게시물 미리 보기')
    })

    it('custom title can be supplied', () => {
      render(<PostEmbed permalink={instagramUrl} title="커스텀 타이틀" />)

      fireEvent.click(screen.getByRole('button', { name: '게시물 미리 보기' }))
      const iframe = screen.getByTitle('커스텀 타이틀')
      expect(iframe).toBeInTheDocument()
    })
  })

  describe('When embed URL is null (non-embeddable or external url)', () => {
    it('renders only "실제 게시물 보기" external link when permalink is not embeddable', () => {
      render(<PostEmbed permalink="https://blog.naver.com/test/123" />)

      expect(screen.queryByRole('button', { name: /게시물 미리 보기|접기/ })).toBeNull()
      expect(document.querySelector('iframe')).toBeNull()

      const link = screen.getByRole('link', { name: '실제 게시물 보기' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', 'https://blog.naver.com/test/123')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders nothing when permalink is null or empty', () => {
      const { container: nullContainer } = render(<PostEmbed permalink={null} />)
      expect(nullContainer.firstChild).toBeNull()

      const { container: emptyContainer } = render(<PostEmbed permalink="" />)
      expect(emptyContainer.firstChild).toBeNull()
    })
  })
})
