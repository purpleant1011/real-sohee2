import { describe, it, expect } from 'vitest'
import { resolveTurbopackRoot } from './turbopack-root'

describe('resolveTurbopackRoot', () => {
  const cwd = '/Volumes/Development/Github/real-sohee/.claude/worktrees/v093-w3-local-e2e'
  const localE2ERoot = '/Volumes/Development/Github/real-sohee'

  it('isLocalE2E=false + localE2ERoot 지정 → cwd 반환 (기본 동작 불변, 프로덕션 영향 0)', () => {
    const result = resolveTurbopackRoot({
      cwd,
      isLocalE2E: false,
      localE2ERoot,
    })
    expect(result).toBe(cwd)
  })

  it('isLocalE2E=true + localE2ERoot 지정 → localE2ERoot 반환', () => {
    const result = resolveTurbopackRoot({
      cwd,
      isLocalE2E: true,
      localE2ERoot,
    })
    expect(result).toBe(localE2ERoot)
  })

  it('isLocalE2E=true + localE2ERoot 미지정 → cwd 반환', () => {
    const result = resolveTurbopackRoot({
      cwd,
      isLocalE2E: true,
      localE2ERoot: undefined,
    })
    expect(result).toBe(cwd)
  })

  it('isLocalE2E=false + localE2ERoot 미지정 → cwd 반환', () => {
    const result = resolveTurbopackRoot({
      cwd,
      isLocalE2E: false,
      localE2ERoot: undefined,
    })
    expect(result).toBe(cwd)
  })
})
