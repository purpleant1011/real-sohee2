import { describe, expect, it } from 'vitest'
import {
  canViewOperatorNavigation,
  groupOperatorNavigation,
  isCurrentOperatorRoute,
  operatorNavigation,
  operatorNavigationGroups,
} from './operator-navigation'

describe('operatorNavigation', () => {
  it('has the six spec groups with their routes in order', () => {
    expect(operatorNavigationGroups.map((g) => [g.title, g.items.map((i) => i.href)])).toEqual([
      ['대시보드', ['/admin']],
      ['고객사', ['/admin/workspaces', '/admin/onboarding', '/admin/cohort', '/admin/feedback']],
      ['콘텐츠·발행', ['/admin/publishing', '/admin/engagement', '/admin/vault', '/admin/preflight', '/admin/reconcile', '/admin/missions']],
      ['채널', ['/admin/channels']],
      ['매출·비용', ['/admin/billing', '/admin/revenue', '/admin/credits', '/admin/finops', '/admin/cost']],
      ['안전·운영', ['/admin/interventions', '/admin/system', '/admin/audit', '/admin/admins', '/admin/governance']],
    ])
    expect(new Set(operatorNavigation.map((i) => i.label)).size).toBe(operatorNavigation.length)
    expect(operatorNavigation.every((i) => i.description && !/[A-Za-z]{4,}/.test(i.label))).toBe(true)
  })

  it('binds each item to the permission its page checks', () => {
    const byHref = Object.fromEntries(operatorNavigation.map((i) => [i.href, i.permission]))
    expect(byHref).toMatchObject({
      '/admin/vault': 'audit.read',
      '/admin/interventions': 'runtime_control.read',
      '/admin/onboarding': 'agreement.read',
      '/admin/preflight': 'content.read',
      '/admin/cost': 'finops.read',
      '/admin/admins': 'admin.read',
    })
  })

  it('filters display entries and drops empty groups without treating it as authorization', () => {
    const groups = groupOperatorNavigation(['dashboard.read', 'workspace.read'])
    expect(groups.map((g) => g.title)).toEqual(['대시보드', '고객사', '매출·비용'])
    expect(groups[1].items.map((i) => i.href)).toEqual(['/admin/workspaces', '/admin/cohort', '/admin/feedback'])
    expect(groupOperatorNavigation([])).toEqual([])
    expect(operatorNavigation.filter((item) => canViewOperatorNavigation(item, []))).toEqual([])
  })

  it.each([
    ['/admin', '/admin', true],
    ['/admin', '/admin/system', false],
    ['/admin/workspaces', '/admin/workspaces', true],
    ['/admin/workspaces', '/admin/workspaces/one', true],
    ['/admin/workspaces', '/admin/missions', false],
  ])('keeps current route exclusive: %s %s', (href, pathname, expected) => {
    expect(isCurrentOperatorRoute(pathname, href)).toBe(expected)
  })
})
