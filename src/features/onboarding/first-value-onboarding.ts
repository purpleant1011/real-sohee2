/**
 * First Value Onboarding Engine (ANI-865)
 * 5단계 이내 첫 Verified Action 달성 경로
 */

export type OnboardingStep =
  | 'BIZ_PROFILE_INPUT'
  | 'HARNESS_VOICE_ANALYSIS'
  | 'SINGLE_CHANNEL_CONNECT'
  | 'FIRST_DRAFT_GENERATE'
  | 'FIRST_VERIFIED_ACTION';

export interface OnboardingJourneyState {
  workspaceId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  isFirstValueAchieved: boolean;
  firstVerifiedActionId?: string;
  startedAt: string;
  completedAt?: string;
}

export const ONBOARDING_STEP_ORDER: OnboardingStep[] = [
  'BIZ_PROFILE_INPUT',
  'HARNESS_VOICE_ANALYSIS',
  'SINGLE_CHANNEL_CONNECT',
  'FIRST_DRAFT_GENERATE',
  'FIRST_VERIFIED_ACTION',
];

export class FirstValueOnboardingEngine {
  private journeys: Map<string, OnboardingJourneyState> = new Map();

  startJourney(workspaceId: string): OnboardingJourneyState {
    const state: OnboardingJourneyState = {
      workspaceId,
      currentStep: 'BIZ_PROFILE_INPUT',
      completedSteps: [],
      isFirstValueAchieved: false,
      startedAt: new Date().toISOString(),
    };

    this.journeys.set(workspaceId, state);
    return state;
  }

  /**
   * 온보딩 단계 전진
   */
  advanceStep(
    workspaceId: string,
    completedStep: OnboardingStep,
    actionId?: string
  ): OnboardingJourneyState {
    let state = this.journeys.get(workspaceId);
    if (!state) {
      state = this.startJourney(workspaceId);
    }

    if (!state.completedSteps.includes(completedStep)) {
      state.completedSteps.push(completedStep);
    }

    const currentIndex = ONBOARDING_STEP_ORDER.indexOf(completedStep);
    if (currentIndex < ONBOARDING_STEP_ORDER.length - 1) {
      state.currentStep = ONBOARDING_STEP_ORDER[currentIndex + 1];
    } else {
      state.isFirstValueAchieved = true;
      state.firstVerifiedActionId = actionId;
      state.completedAt = new Date().toISOString();
    }

    return state;
  }

  getJourney(workspaceId: string): OnboardingJourneyState | undefined {
    return this.journeys.get(workspaceId);
  }
}
