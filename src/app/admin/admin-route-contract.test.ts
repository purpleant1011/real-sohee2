import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { operatorNavigation, operatorNavigationGroups } from '@/components/operator-shell/operator-navigation'

describe('canonical admin route contract', () => {
  it('groups navigation into the six spec groups with unique /admin hrefs', () => {
    expect(operatorNavigationGroups.map((group) => group.title)).toEqual([
      '대시보드', '고객사', '콘텐츠·발행', '채널', '매출·비용', '안전·운영',
    ])
    expect(operatorNavigation).toHaveLength(22)
    expect(new Set(operatorNavigation.map((item) => item.href)).size).toBe(22)
    expect(operatorNavigation.every((item) => item.href === '/admin' || item.href.startsWith('/admin/'))).toBe(true)
  })

  it('has a page file for every navigation href', () => {
    for (const item of operatorNavigation) {
      const dir = item.href === '/admin' ? 'admin' : item.href.slice(1)
      expect(existsSync(join(process.cwd(), 'src/app', dir, 'page.tsx')), item.href).toBe(true)
    }
  })

  it('never links to the retired redirect-only pages', () => {
    const retired = ['control-tower', 'control-plane', 'agents', 'support', 'privileged-access', 'plugins', 'go-nogo']
    for (const item of operatorNavigation) {
      expect(retired.some((name) => item.href === `/admin/${name}`)).toBe(false)
    }
  })
})
