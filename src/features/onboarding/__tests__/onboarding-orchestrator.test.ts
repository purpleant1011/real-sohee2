import { describe, it, expect, beforeEach } from 'vitest'
import { OnboardingOrchestrator } from '../orchestrator/onboarding-orchestrator'

describe('OnboardingOrchestrator V0.8.8 State Machine', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes with default v0.8.8 quest state', () => {
    const orchestrator = new OnboardingOrchestrator()
    const state = orchestrator.getState()

    expect(state.version).toBe('v0.8.8')
    expect(state.step).toBe(0)
    expect(state.completedSteps).toEqual([])
    expect(state.data.category).toBe('뷰티/반영구')
    expect(state.data.revenueGoal).toBe('FILL_EMPTY_SLOTS')
  })

  it('updates data and persists correctly', () => {
    const orchestrator = new OnboardingOrchestrator()
    orchestrator.updateData({
      businessName: '바이름 청라점',
      brandTone: '친절하고 전문적인',
      revenueGoal: 'ATTRACT_NEW_CLIENTS'
    })

    const state = orchestrator.getState()
    expect(state.data.businessName).toBe('바이름 청라점')
    expect(state.data.revenueGoal).toBe('ATTRACT_NEW_CLIENTS')

    // Test persistence across new instance
    const secondInstance = new OnboardingOrchestrator()
    expect(secondInstance.getState().data.businessName).toBe('바이름 청라점')
  })

  it('advances quest steps sequentially', () => {
    const orchestrator = new OnboardingOrchestrator()
    orchestrator.advanceStep(0)
    expect(orchestrator.getState().step).toBe(1)
    expect(orchestrator.getState().completedSteps).toContain(0)

    orchestrator.advanceStep(1)
    expect(orchestrator.getState().step).toBe(2)
    expect(orchestrator.getState().completedSteps).toContain(1)
  })

  it('marks onboarding completed with mission result', () => {
    const orchestrator = new OnboardingOrchestrator()
    orchestrator.markCompleted({
      missionId: 'mission-first-wow-01',
      publishedUrl: 'https://instagram.com/p/first-wow',
      usedCredits: 350
    })

    const state = orchestrator.getState()
    expect(state.step).toBe(5)
    expect(state.completedSteps.length).toBe(6)
    expect(state.data.missionId).toBe('mission-first-wow-01')
    expect(state.data.publishedUrl).toBe('https://instagram.com/p/first-wow')
    expect(state.data.usedCredits).toBe(350)
  })
})
