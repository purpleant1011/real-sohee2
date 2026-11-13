import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from '../use-media-query'
import { mockMatchMedia } from '@/test/mock-match-media'

let media: ReturnType<typeof mockMatchMedia> | null = null
afterEach(() => {
  media?.restore()
  media = null
})

describe('useMediaQuery', () => {
  it('returns the server default when matchMedia is unavailable', () => {
    expect(renderHook(() => useMediaQuery('(min-width: 1440px)', true)).result.current).toBe(true)
    expect(renderHook(() => useMediaQuery('(min-width: 1440px)')).result.current).toBe(false)
  })

  it('reads the current match and reacts to changes', () => {
    media = mockMatchMedia({ '(min-width: 1440px)': false })
    const { result } = renderHook(() => useMediaQuery('(min-width: 1440px)'))
    expect(result.current).toBe(false)
    act(() => media!.set('(min-width: 1440px)', true))
    expect(result.current).toBe(true)
  })
})
