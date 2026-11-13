import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import PreviewGalleryPage from './page'

vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('not found') }) }))

describe('development preview gallery', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('renders five static samples for each of four channels without credentials', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<PreviewGalleryPage />)
    expect(screen.getAllByRole('region', { name: /예상 화면/ })).toHaveLength(20)
    expect(screen.getByText('2,200자 한글')).toBeVisible()
    expect(screen.getByText('이모지만')).toBeVisible()
  })

  it('gives every preview landmark a unique accessible name so repeated channels stay distinguishable', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<PreviewGalleryPage />)
    const names = screen.getAllByRole('region', { name: /예상 화면/ }).map((region) => region.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('대표 게시물 · 인스타그램 예상 화면')
    expect(names).toContain('긴 URL · 당근 비즈니스 예상 화면')
  })

  it('refuses to serve the gallery in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => PreviewGalleryPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
