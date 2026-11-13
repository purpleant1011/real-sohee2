import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('성과 KPI 카드', () => {
  it('값이 아니라 안내 문구일 때는 숫자용 큰 글씨를 쓰지 않는다', () => {
    const src = readFileSync('src/features/mobile-results/results-view.tsx', 'utf8')
    expect(src).toMatch(/display\.kind === 'value' \? 'text-2xl[^']*' : 'text-base[^']*'/)
  })
})
