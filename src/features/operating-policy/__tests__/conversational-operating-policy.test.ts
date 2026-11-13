import { describe, it, expect } from 'vitest'
import { CONVERSATIONAL_POLICY_SCENARIOS } from '../conversational-operating-policy'

describe('CONVERSATIONAL_POLICY_SCENARIOS Policy Copy Audit', () => {
  it('does not use exaggerated terms such as 100%, 1초, or 즉시 in scenario descriptions and options', () => {
    const approvalScenario = CONVERSATIONAL_POLICY_SCENARIOS.find((s) => s.id === 'scen-approval')
    const autoOption = approvalScenario?.choiceOptions.find((o) => o.id === 'conditional_auto')
    expect(autoOption?.description).not.toContain('100%')
    expect(autoOption?.description).toContain('검증 기준을 충족하는')

    const handoffScenario = CONVERSATIONAL_POLICY_SCENARIOS.find((s) => s.id === 'scen-handoff')
    const handoffOption = handoffScenario?.choiceOptions.find((o) => o.id === 'handoff_all')
    expect(handoffOption?.label).not.toContain('즉시')
    expect(handoffOption?.label).toContain('신속 인계')

    const killSwitchScenario = CONVERSATIONAL_POLICY_SCENARIOS.find((s) => s.id === 'scen-killswitch')
    expect(killSwitchScenario?.scenarioDescription).not.toContain('단 1초')
    expect(killSwitchScenario?.scenarioDescription).not.toContain('즉시')
    expect(killSwitchScenario?.scenarioDescription).toContain('신속하게')
  })
})
