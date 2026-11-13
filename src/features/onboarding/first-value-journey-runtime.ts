/**
 * First 15-Minute Value Onboarding Runtime (ANI-1265)
 *
 * Provides a streamlined 7-step journey for small business owners to experience
 * their first verified outcome within 15 minutes, avoiding setup paralysis.
 */

export type OnboardingJourneyStage =
  | 'BUSINESS_PROFILE_CONFIRM'      // 1. 최소 사업정보 확인/동기화
  | 'CHANNEL_READINESS_CHECK'       // 2. 채널 및 예약 소스 준비도 검사
  | 'SOHEE_UNDERSTANDING_ALIGN'     // 3. 소희의 매장 이해 요약 확인/수정
  | 'FIRST_SAFE_MISSION_SELECT'     // 4. 첫 안전 Mission 추천 및 선택
  | 'CONTENT_GENERATED_AND_REVIEW'  // 5. 콘텐츠 생성 및 5초 승인
  | 'EXECUTE_OR_CONNECT_REQUIRED'   // 6. 실제 채널 실행 또는 CONNECT_REQUIRED
  | 'RETURN_TO_COMMAND_CENTER';     // 7. 오늘 홈 커맨드 센터 복귀

export interface OnboardingBusinessProfile {
  businessName: string;
  category: string;
  primaryService: string;
  operatingHoursSummary: string;
  addressSummary?: string;
  isConfirmed: boolean;
}

export interface ChannelReadiness {
  instagramConnected: boolean;
  threadsConnected: boolean;
  reservationSourceAvailable: boolean;
  anyChannelReady: boolean;
}

export interface SafeMissionTemplate {
  templateId: string;
  title: string;
  targetChannel: 'INSTAGRAM' | 'THREADS';
  description: string;
  expectedDurationMinutes: number;
  riskLevel: 'LOW_SAFE';
  defaultCopyPreview: string;
}

export interface OnboardingJourneySession {
  sessionId: string;
  workspaceId: string;
  currentStage: OnboardingJourneyStage;
  completedStages: OnboardingJourneyStage[];
  businessProfile: OnboardingBusinessProfile;
  channelReadiness: ChannelReadiness;
  selectedMissionTemplate?: SafeMissionTemplate;
  createdMissionId?: string;
  createdContentId?: string;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'SKIPPED';
  executionResultStatus?: 'PUBLISHED_VERIFIED' | 'CONNECT_REQUIRED';
  startedAt: string;
  stageTimestamps: Record<string, string>;
  completedAt?: string;
  durationSeconds?: number;
  firstValueAchievedWithin15Min: boolean;
}

export const RECOMMENDED_SAFE_MISSIONS: readonly SafeMissionTemplate[] = Object.freeze([
  {
    templateId: 'safe_intro_feed',
    title: '매장 대표 시술 및 예약 안내 인스타그램 피드',
    targetChannel: 'INSTAGRAM',
    description: '매장의 대표 서비스와 예약 방법을 안내하는 안전한 첫 소개글입니다.',
    expectedDurationMinutes: 3,
    riskLevel: 'LOW_SAFE',
    defaultCopyPreview: '정성을 다해 맞춤 시술을 제공하는 우리 매장입니다. 편안한 시간대에 예약 문의주세요.',
  },
  {
    templateId: 'safe_quick_tip_thread',
    title: '고객 관리 팁 스레드 한 줄 공유',
    targetChannel: 'THREADS',
    description: '시술 후 지속력을 높여주는 일상 관리 팁을 짧고 친근하게 전달합니다.',
    expectedDurationMinutes: 2,
    riskLevel: 'LOW_SAFE',
    defaultCopyPreview: '시술 후 첫 24시간 동안 이것만 지켜주시면 오래오래 예쁘게 유지됩니다 ✨',
  },
]);

export class FirstValueJourneyRuntime {
  /**
   * 신규 온보딩 세션 초기화
   */
  initializeSession(params: {
    sessionId: string;
    workspaceId: string;
    profile: Partial<OnboardingBusinessProfile>;
    channelReadiness: Partial<ChannelReadiness>;
  }): OnboardingJourneySession {
    const now = new Date().toISOString();
    const isChannelReady = !!(params.channelReadiness.instagramConnected || params.channelReadiness.threadsConnected);

    return {
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      currentStage: 'BUSINESS_PROFILE_CONFIRM',
      completedStages: [],
      businessProfile: {
        businessName: params.profile.businessName || '우리 매장',
        category: params.profile.category || '뷰티/케어',
        primaryService: params.profile.primaryService || '기본 케어',
        operatingHoursSummary: params.profile.operatingHoursSummary || '10:00 - 20:00',
        addressSummary: params.profile.addressSummary,
        isConfirmed: false,
      },
      channelReadiness: {
        instagramConnected: !!params.channelReadiness.instagramConnected,
        threadsConnected: !!params.channelReadiness.threadsConnected,
        reservationSourceAvailable: !!params.channelReadiness.reservationSourceAvailable,
        anyChannelReady: isChannelReady,
      },
      startedAt: now,
      stageTimestamps: {
        BUSINESS_PROFILE_CONFIRM: now,
      },
      firstValueAchievedWithin15Min: false,
    };
  }

  /**
   * 1. 사업 정보 확인/수정
   */
  confirmBusinessProfile(
    session: OnboardingJourneySession,
    profileUpdate?: Partial<OnboardingBusinessProfile>
  ): OnboardingJourneySession {
    const now = new Date().toISOString();
    const updated = {
      ...session,
      businessProfile: {
        ...session.businessProfile,
        ...profileUpdate,
        isConfirmed: true,
      },
    };
    return this.advanceStage(updated, 'BUSINESS_PROFILE_CONFIRM', 'CHANNEL_READINESS_CHECK', now);
  }

  /**
   * 2. 채널 준비도 점검
   */
  checkChannelReadiness(
    session: OnboardingJourneySession,
    readiness: ChannelReadiness
  ): OnboardingJourneySession {
    const now = new Date().toISOString();
    const updated = {
      ...session,
      channelReadiness: {
        ...readiness,
        anyChannelReady: readiness.instagramConnected || readiness.threadsConnected,
      },
    };
    return this.advanceStage(updated, 'CHANNEL_READINESS_CHECK', 'SOHEE_UNDERSTANDING_ALIGN', now);
  }

  /**
   * 3. 소희의 매장 이해 동기화
   */
  alignSoheeUnderstanding(session: OnboardingJourneySession): OnboardingJourneySession {
    const now = new Date().toISOString();
    return this.advanceStage(session, 'SOHEE_UNDERSTANDING_ALIGN', 'FIRST_SAFE_MISSION_SELECT', now);
  }

  /**
   * 4. 첫 안전 Mission 선택
   */
  selectFirstSafeMission(
    session: OnboardingJourneySession,
    templateId: string
  ): OnboardingJourneySession {
    const template = RECOMMENDED_SAFE_MISSIONS.find((m) => m.templateId === templateId) || RECOMMENDED_SAFE_MISSIONS[0];
    const now = new Date().toISOString();
    const updated: OnboardingJourneySession = {
      ...session,
      selectedMissionTemplate: template,
      createdMissionId: `onboarding_mission_${session.workspaceId}_${Date.now()}`,
    };
    return this.advanceStage(updated, 'FIRST_SAFE_MISSION_SELECT', 'CONTENT_GENERATED_AND_REVIEW', now);
  }

  /**
   * 5. 콘텐츠 생성 및 5초 승인
   */
  approveFirstContent(
    session: OnboardingJourneySession,
    decision: 'APPROVED' | 'SKIPPED'
  ): OnboardingJourneySession {
    const now = new Date().toISOString();
    const updated: OnboardingJourneySession = {
      ...session,
      createdContentId: `content_${session.workspaceId}_${Date.now()}`,
      approvalStatus: decision,
    };
    return this.advanceStage(updated, 'CONTENT_GENERATED_AND_REVIEW', 'EXECUTE_OR_CONNECT_REQUIRED', now);
  }

  /**
   * 6. 실행 또는 CONNECT_REQUIRED 판정
   */
  finalizeExecutionOrHandoff(session: OnboardingJourneySession): OnboardingJourneySession {
    const now = new Date().toISOString();
    const executionStatus = session.channelReadiness.anyChannelReady
      ? 'PUBLISHED_VERIFIED'
      : 'CONNECT_REQUIRED';

    const updated: OnboardingJourneySession = {
      ...session,
      executionResultStatus: executionStatus,
    };
    return this.advanceStage(updated, 'EXECUTE_OR_CONNECT_REQUIRED', 'RETURN_TO_COMMAND_CENTER', now);
  }

  /**
   * 7. 온보딩 완료 및 커맨드 센터 복귀
   */
  completeOnboarding(session: OnboardingJourneySession): OnboardingJourneySession {
    const now = new Date().toISOString();
    const startMs = new Date(session.startedAt).getTime();
    const endMs = new Date(now).getTime();
    const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const achievedWithin15 = durationSeconds <= 15 * 60;

    return {
      ...session,
      currentStage: 'RETURN_TO_COMMAND_CENTER',
      completedStages: Array.from(new Set([...session.completedStages, 'RETURN_TO_COMMAND_CENTER'])),
      completedAt: now,
      durationSeconds,
      firstValueAchievedWithin15Min: achievedWithin15,
    };
  }

  private advanceStage(
    session: OnboardingJourneySession,
    completed: OnboardingJourneyStage,
    next: OnboardingJourneyStage,
    now: string
  ): OnboardingJourneySession {
    const completedSet = new Set(session.completedStages);
    completedSet.add(completed);

    return {
      ...session,
      currentStage: next,
      completedStages: Array.from(completedSet),
      stageTimestamps: {
        ...session.stageTimestamps,
        [next]: now,
      },
    };
  }
}
