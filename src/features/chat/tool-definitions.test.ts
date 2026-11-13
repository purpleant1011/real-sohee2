import { describe, expect, it } from 'vitest'
import { soheeToolDefinitions } from './tool-definitions'

it('exposes E5 proposal and review tools without external execution', () => {
  const names = soheeToolDefinitions.map((definition) => definition.name)
  expect(names).toEqual(expect.arrayContaining([
    'propose_automation_rule', 'save_automation_rule', 'pause_automation_rule',
    'resume_automation_rule', 'request_direction_discussion', 'review_learning_candidate',
  ]))
  expect(names.some((name) => /external.*execute|publish/.test(name))).toBe(false)
})

const allowedNames = [
  'get_workspace_brief',
  'get_approved_profile_facts',
  'search_approved_knowledge',
  'get_work_item',
  'get_content_version',
  'get_report_metrics',
  'get_customer_conversation_summary',
  'propose_content_plan',
  'propose_schedule_options',
  'propose_harness_rule',
  'get_credit_balance',
  'propose_period_plan',
  'propose_automation_rule',
  'save_automation_rule',
  'pause_automation_rule',
  'resume_automation_rule',
  'request_direction_discussion',
  'review_learning_candidate',
] as const

describe('soheeToolDefinitions', () => {
  it('읽기·제안 도구만 노출하고 실행 도구는 노출하지 않는다', () => {
    expect(soheeToolDefinitions.map((tool) => tool.name)).toEqual(allowedNames)
    expect(soheeToolDefinitions.every((tool) => tool.type === 'function' && tool.strict)).toBe(true)
    expect(soheeToolDefinitions.every((tool) => tool.parameters.additionalProperties === false)).toBe(true)

    const serialized = JSON.stringify(soheeToolDefinitions)
    for (const forbidden of ['approve', 'publish', 'pay', 'change_permission']) {
      expect(serialized).not.toContain(`"name":"${forbidden}"`)
    }
  })
})
