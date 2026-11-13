import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safe-next-path'

describe('safeNextPath', () => {
  it.each([
    ['https://evil.example'],
    ['//evil.example'],
    ['\\\\evil.example'],
    ['/%5C%5Cevil.example'],
    ['/login'],
    ['/login?next=%2Fapp'],
    ['/forgot-password'],
    ['/reset-password'],
    ['/auth/callback'],
    ['/'],
    ['/settings'],
    [undefined],
  ])('falls back to /app for an unsafe return path: %s', (input) => {
    expect(safeNextPath(input)).toBe('/app')
  })

  it.each([
    ['/app'],
    ['/app/work/123'],
    ['/app?tab=recent'],
    ['/app/work/123?sort=latest#notes'],
    ['/app/work?sort=latest&search=%EC%86%8C%ED%9D%AC'],
    ['/app/work?return=%2Fmarketing'],
    ['/start'],
    ['/start/preview'],
    ['/start?step=channels'],
  ])('keeps an internal app path: %s', (input) => {
    expect(safeNextPath(input)).toBe(input)
  })
})
