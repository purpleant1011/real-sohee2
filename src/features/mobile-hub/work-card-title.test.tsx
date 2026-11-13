import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('작업 카드 제목', () => {
  it('긴 제목은 1줄(truncate)로 줄여 목록이 한눈에 들어오게 한다', () => {
    const src = readFileSync('src/features/mobile-hub/hub-view.tsx', 'utf8')
    expect(/className="[^"]*truncate[^"]*"\>\{item\.title\}/.test(src)).toBe(true)
  })
})
