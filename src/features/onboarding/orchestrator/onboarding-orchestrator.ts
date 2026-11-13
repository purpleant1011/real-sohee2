/**
 * [ANI-461][I18] Deterministic OnboardingOrchestrator
 * Versioned Quest State Machine & Local/Remote Sync for Sohee V0.8.8
 */

export type QuestStep = 0 | 1 | 2 | 3 | 4 | 5

export interface QuestState {
  version: 'v0.8.8'
  step: QuestStep
  completedSteps: QuestStep[]
  data: {
    // Quest 0: Business Profile
    businessName: string
    representativeName: string
    category: string
    registrationNumber: string
    phone: string
    address: string
    
    // Quest 1: Brand & Style
    brandTone: string
    signatureService: string
    priceInfo: string
    forbiddenTerms: string
    
    // Quest 2: Channels
    instagramHandle: string
    threadsHandle: string
    naverBlogId: string
    daangnProfile: string
    
    // Quest 3: Operating Rule
    autonomyLevel: 'APPROVAL_REQUIRED' | 'GUARDED_AUTO'
    revenueGoal: 'FILL_EMPTY_SLOTS' | 'ATTRACT_NEW_CLIENTS' | 'INCREASE_TICKET_SIZE'
    
    // Quest 4 & 5: Execution & First Wow
    missionId?: string
    publishedUrl?: string
    usedCredits?: number
  }
  updatedAt: string
}

const STORAGE_KEY = 'sohee_quest_state_v088'

export class OnboardingOrchestrator {
  private state: QuestState

  constructor(initialState?: Partial<QuestState>) {
    this.state = this.loadState(initialState)
  }

  private loadState(fallback?: Partial<QuestState>): QuestState {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.version === 'v0.8.8') {
            return parsed
          }
        }
      } catch (err) {
        console.warn('Failed to load local quest state:', err)
      }
    }

    return {
      version: 'v0.8.8',
      step: 0,
      completedSteps: [],
      data: {
        businessName: '',
        representativeName: '',
        category: '뷰티/반영구',
        registrationNumber: '',
        phone: '',
        address: '',
        brandTone: '친절하고 전문적인',
        signatureService: '',
        priceInfo: '',
        forbiddenTerms: '의료법 위반 소지 단어, 100% 완벽 보장, 최저가',
        instagramHandle: '',
        threadsHandle: '',
        naverBlogId: '',
        daangnProfile: '',
        autonomyLevel: 'APPROVAL_REQUIRED',
        revenueGoal: 'FILL_EMPTY_SLOTS',
        ...fallback?.data
      },
      updatedAt: new Date().toISOString(),
      ...fallback
    }
  }

  public getState(): QuestState {
    return { ...this.state }
  }

  public updateData(partialData: Partial<QuestState['data']>): QuestState {
    this.state = {
      ...this.state,
      data: {
        ...this.state.data,
        ...partialData
      },
      updatedAt: new Date().toISOString()
    }
    this.persist()
    return this.getState()
  }

  public advanceStep(fromStep: QuestStep): QuestState {
    const nextStep = Math.min(fromStep + 1, 5) as QuestStep
    const completed = Array.from(new Set([...this.state.completedSteps, fromStep]))
    
    this.state = {
      ...this.state,
      step: nextStep,
      completedSteps: completed,
      updatedAt: new Date().toISOString()
    }
    this.persist()
    return this.getState()
  }

  public setStep(step: QuestStep): QuestState {
    this.state = {
      ...this.state,
      step,
      updatedAt: new Date().toISOString()
    }
    this.persist()
    return this.getState()
  }

  public markCompleted(result: { missionId: string; publishedUrl?: string; usedCredits: number }): QuestState {
    this.state = {
      ...this.state,
      step: 5,
      completedSteps: [0, 1, 2, 3, 4, 5],
      data: {
        ...this.state.data,
        missionId: result.missionId,
        publishedUrl: result.publishedUrl,
        usedCredits: result.usedCredits
      },
      updatedAt: new Date().toISOString()
    }
    this.persist()
    return this.getState()
  }

  public reset(): QuestState {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
    this.state = this.loadState()
    return this.getState()
  }

  private persist() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
      } catch (err) {
        console.warn('Failed to persist quest state:', err)
      }
    }
  }
}
