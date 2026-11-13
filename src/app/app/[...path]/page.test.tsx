import { describe, it, expect, vi } from 'vitest'
import ProtectedCatchAllPage from './page'

const notFoundMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  notFound: () => notFoundMock(),
}))

describe('ProtectedCatchAllPage (ANI-723)', () => {
  it('triggers notFound() instead of rendering false-success placeholder', () => {
    ProtectedCatchAllPage()
    expect(notFoundMock).toHaveBeenCalled()
  })
})
